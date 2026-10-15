-- Separate live provider and immutable delivery receipt jobs; no backfill or dispatch.
ALTER TABLE ar_payments DROP CONSTRAINT ar_payments_provider_check;
ALTER TABLE ar_payments ADD CONSTRAINT ar_payments_provider_check CHECK(provider IN('simulation','yookassa-sandbox','yookassa-live'));
ALTER TABLE ar_payments DROP CONSTRAINT ar_receipt_snapshot_shape;
ALTER TABLE ar_payments ADD CONSTRAINT ar_receipt_snapshot_shape CHECK(receipt_snapshot IS NULL OR (provider IN('yookassa-sandbox','yookassa-live') AND jsonb_typeof(receipt_snapshot)='object'));
CREATE TABLE ar_yookassa_closing_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES ar_orders(id),payment_id uuid NOT NULL UNIQUE REFERENCES ar_payments(id),
 provider text NOT NULL CHECK(provider IN('yookassa-sandbox','yookassa-live')),
 shop_id text NOT NULL,provider_payment_id uuid NOT NULL,
 amount_rubles numeric(16,2) NOT NULL CHECK(amount_rubles>0),
 receipt_snapshot jsonb NOT NULL CHECK(jsonb_typeof(receipt_snapshot)='object'),
 delivery_proof jsonb NOT NULL CHECK(jsonb_typeof(delivery_proof)='object'),
 provider_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','pending','uncertain','succeeded','canceled','attention')),
 provider_id text UNIQUE CHECK(provider_id IS NULL OR provider_id ~ '^rt-[0-9a-fA-F-]{36}$'),
 requested_at timestamptz,checked_at timestamptz,next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ar_closing_receipt_due ON ar_yookassa_closing_receipts(next_check_at) WHERE state IN('queued','pending','uncertain');
GRANT SELECT,INSERT,UPDATE ON ar_yookassa_closing_receipts TO ar_app;
CREATE FUNCTION ar_closing_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p ar_payments%ROWTYPE;refunded numeric(16,2);receipt_total numeric(16,2);
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO p FROM ar_payments WHERE id=NEW.payment_id FOR UPDATE;
  IF p.order_id IS DISTINCT FROM NEW.order_id OR p.provider IS DISTINCT FROM NEW.provider
   OR p.provider_shop_id IS DISTINCT FROM NEW.shop_id OR p.provider_id IS DISTINCT FROM NEW.provider_payment_id::text
   OR p.provider_status<>'succeeded' OR p.receipt_snapshot IS NULL THEN RAISE EXCEPTION 'Closing receipt payment mismatch'; END IF;
  SELECT coalesce(sum(amount_rubles),0) INTO refunded FROM ar_yookassa_refunds WHERE payment_id=p.id AND state='succeeded';
  IF EXISTS(SELECT 1 FROM ar_yookassa_refunds WHERE payment_id=p.id AND state IN('queued','pending','uncertain','attention')) OR NEW.amount_rubles IS DISTINCT FROM p.amount_rubles-refunded THEN RAISE EXCEPTION 'Closing receipt refund balance mismatch'; END IF;
  SELECT sum((i->'amount'->>'value')::numeric*(i->>'quantity')::numeric) INTO receipt_total FROM jsonb_array_elements(NEW.receipt_snapshot->'items') i;
  IF receipt_total IS DISTINCT FROM NEW.amount_rubles OR NEW.receipt_snapshot->>'payment_id' IS DISTINCT FROM p.provider_id
   OR NEW.receipt_snapshot->>'type' IS DISTINCT FROM 'payment' OR NEW.receipt_snapshot->>'send' IS DISTINCT FROM 'true'
   OR NEW.receipt_snapshot#>>'{customer,email}' IS DISTINCT FROM p.receipt_snapshot#>>'{customer,email}'
   OR NEW.receipt_snapshot#>>'{settlements,0,type}' IS DISTINCT FROM 'prepayment'
   OR (NEW.receipt_snapshot#>>'{settlements,0,amount,value}')::numeric IS DISTINCT FROM NEW.amount_rubles
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.receipt_snapshot->'items') i WHERE i->>'payment_mode' IS DISTINCT FROM 'full_payment') THEN RAISE EXCEPTION 'Closing receipt fiscal snapshot mismatch'; END IF;

 ELSE
  IF ROW(NEW.order_id,NEW.payment_id,NEW.provider,NEW.shop_id,NEW.provider_payment_id,NEW.amount_rubles,NEW.receipt_snapshot,NEW.delivery_proof,NEW.provider_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.order_id,OLD.payment_id,OLD.provider,OLD.shop_id,OLD.provider_payment_id,OLD.amount_rubles,OLD.receipt_snapshot,OLD.delivery_proof,OLD.provider_key,OLD.created_at)
   THEN RAISE EXCEPTION 'Closing receipt snapshot is immutable'; END IF;
  IF OLD.state IN('succeeded','canceled') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'Closing receipt terminal state is immutable'; END IF;
  IF OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'Closing receipt identity is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_closing_receipt_guard BEFORE INSERT OR UPDATE ON ar_yookassa_closing_receipts FOR EACH ROW EXECUTE FUNCTION ar_closing_receipt_guard();
ALTER TABLE ar_payments DROP CONSTRAINT ar_payment_yoo_snapshot;
ALTER TABLE ar_payments ADD CONSTRAINT ar_payment_yoo_snapshot CHECK(provider='simulation' OR
 (provider_shop_id IS NOT NULL AND provider_return_url IS NOT NULL AND
 ((provider='yookassa-sandbox' AND method='card') OR (provider='yookassa-live' AND method IN('card','sbp') AND receipt_snapshot IS NOT NULL))));
-- Serialize direct fiscal/refund inserts on the same immutable payment, too.
CREATE FUNCTION ar_refund_closing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closing_state text;
BEGIN
 PERFORM id FROM ar_payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT state INTO closing_state FROM ar_yookassa_closing_receipts WHERE payment_id=NEW.payment_id;
 IF closing_state IS NOT NULL AND closing_state<>'succeeded' THEN RAISE EXCEPTION 'Closing receipt must be resolved before refund'; END IF;
 IF closing_state='succeeded' AND (NEW.receipt_snapshot IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.receipt_snapshot->'items') i WHERE i->>'payment_mode' IS DISTINCT FROM 'full_payment')) THEN RAISE EXCEPTION 'Post-delivery refund must use full payment receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_refund_closing_guard BEFORE INSERT ON ar_yookassa_refunds FOR EACH ROW EXECUTE FUNCTION ar_refund_closing_guard();
ALTER TABLE ar_payments ADD COLUMN closing_discovery_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN closing_discovery_error text;

-- Extend the immutable 034 review contract to authenticated live payments as well.
CREATE OR REPLACE FUNCTION ar_return_resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_snapshot jsonb; o ar_orders%ROWTYPE; payment ar_payments%ROWTYPE; amount numeric; received bigint; restocked bigint; held bigint;
BEGIN
 SELECT * INTO o FROM ar_orders WHERE id=NEW.order_id FOR UPDATE;
 current_snapshot:=ar_return_resolution_snapshot(NEW.order_id);
 IF current_snapshot IS DISTINCT FROM NEW.snapshot OR NEW.revision<>encode(sha256(convert_to(current_snapshot::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Return resolution snapshot is stale'; END IF;
 IF o.status NOT IN('manual_review','return_closed') OR o.allocation_state<>'settled' OR o.delivery_status NOT IN('shipped','delivered') THEN RAISE EXCEPTION 'Return resolution order requires review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ar_return_receipts WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM ar_return_receipts r LEFT JOIN ar_return_inspections i ON i.receipt_id=r.id WHERE r.order_id=o.id AND i.id IS NULL) THEN RAISE EXCEPTION 'Return resolution requires every inspection'; END IF;
 IF (SELECT count(*) FROM ar_payments WHERE order_id=o.id AND status='succeeded')<>1 OR EXISTS(SELECT 1 FROM ar_payments WHERE order_id=o.id AND status NOT IN('succeeded','failed')) THEN RAISE EXCEPTION 'Return resolution payment is unresolved'; END IF;
 SELECT * INTO payment FROM ar_payments WHERE order_id=o.id AND status='succeeded';
 IF payment.provider NOT IN('yookassa-sandbox','yookassa-live') OR payment.provider_status IS DISTINCT FROM 'succeeded' OR payment.provider_id IS NULL OR payment.currency<>'RUB' OR payment.shipping_version<>o.shipping_version OR payment.amount_rubles<>o.product_total_rubles+o.shipping_cost_rubles THEN RAISE EXCEPTION 'Return resolution payment mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ar_yookassa_refunds WHERE order_id=o.id AND state='succeeded') OR EXISTS(SELECT 1 FROM ar_yookassa_refunds WHERE order_id=o.id AND (state NOT IN('succeeded','canceled') OR (state='succeeded' AND (payment_id<>payment.id OR provider_payment_id::text<>payment.provider_id OR shop_id IS DISTINCT FROM payment.provider_shop_id OR provider_id IS NULL OR checked_at IS NULL OR selection_snapshot IS NULL OR selection_snapshot->>'opaque' IS DISTINCT FROM 'false' OR payment_amount_rubles IS DISTINCT FROM payment.amount_rubles)))) THEN RAISE EXCEPTION 'Return resolution refund is unresolved'; END IF;
 IF EXISTS(SELECT 1 FROM ar_cdek_shipments WHERE order_id=o.id AND state NOT IN('rejected','cancelled') AND (state='ready' AND carrier_code IN('DELIVERED','POSTOMAT_RECEIVED') AND provider_uuid IS NOT NULL AND carrier_at IS NOT NULL) IS NOT TRUE) THEN RAISE EXCEPTION 'Return resolution carrier is unresolved'; END IF;
 -- Missing JSON fields must fail explicitly: SQL NULL is not a valid reconciliation.
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r WHERE r.order_id=o.id AND r.state='succeeded' AND
  ((jsonb_typeof(r.selection_snapshot)='object' AND r.selection_snapshot->'version'='1'::jsonb AND r.selection_snapshot->'opaque'='false'::jsonb AND r.selection_snapshot->>'mode' IN('full','partial') AND jsonb_typeof(r.selection_snapshot->'lines')='array' AND jsonb_typeof(r.selection_snapshot->'shippingRubles')='string' AND r.selection_snapshot->>'shippingRubles'~'^[0-9]+\.[0-9]{2}$') IS NOT TRUE)) THEN RAISE EXCEPTION 'Return resolution selection shape mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r CROSS JOIN LATERAL jsonb_array_elements(r.selection_snapshot->'lines') line WHERE r.order_id=o.id AND r.state='succeeded' AND
  ((jsonb_typeof(line)='object' AND jsonb_typeof(line->'lineIndex')='number' AND line->>'lineIndex'~'^[0-9]+$' AND jsonb_typeof(line->'quantity')='number' AND line->>'quantity'~'^[1-9][0-9]*$' AND jsonb_typeof(line->'unitPriceRubles')='string' AND line->>'unitPriceRubles'~'^[0-9]+\.[0-9]{2}$') IS NOT TRUE)) THEN RAISE EXCEPTION 'Return resolution line shape mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r CROSS JOIN LATERAL jsonb_array_elements(r.selection_snapshot->'lines') line WHERE r.order_id=o.id AND r.state='succeeded' GROUP BY r.id,line->>'lineIndex' HAVING count(*)>1) THEN RAISE EXCEPTION 'Return resolution duplicate line'; END IF;
 -- Financial lines must retain the purchase price and a whole bounded purchased quantity.
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r CROSS JOIN LATERAL jsonb_array_elements(r.selection_snapshot->'lines') line
  WHERE r.order_id=o.id AND r.state='succeeded' AND ((line->>'lineIndex')::int<0 OR o.items_snapshot->((line->>'lineIndex')::int) IS NULL OR (line->>'quantity')::numeric<1 OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) OR (line->>'unitPriceRubles')::numeric<>(o.items_snapshot->((line->>'lineIndex')::int)->>'unitPriceRubles')::numeric))
 OR EXISTS(SELECT 1 FROM ar_yookassa_refunds r CROSS JOIN LATERAL jsonb_array_elements(r.selection_snapshot->'lines') line WHERE r.order_id=o.id AND r.state='succeeded' GROUP BY line->>'lineIndex' HAVING sum((line->>'quantity')::numeric)>(o.items_snapshot->((line->>'lineIndex')::int)->>'quantity')::numeric)
 THEN RAISE EXCEPTION 'Return resolution purchased lines mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ar_return_receipt_lines l JOIN ar_order_components c ON c.order_id=l.order_id AND c.sku_id=l.sku_id WHERE l.order_id=o.id GROUP BY l.sku_id,c.quantity HAVING sum(l.quantity)>least(c.quantity,coalesce((SELECT greatest(0,-sum(m.stock_delta)) FROM ar_stock_movements m WHERE m.order_id=o.id AND m.sku_id=l.sku_id AND m.operation_key NOT LIKE 'return-intake:%'),0))) THEN RAISE EXCEPTION 'Return resolution issued quantity mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r WHERE r.order_id=o.id AND r.state='succeeded' AND (r.selection_snapshot->>'shippingRubles')::numeric NOT IN(0,o.shipping_cost_rubles)) OR (SELECT coalesce(sum((selection_snapshot->>'shippingRubles')::numeric),0) FROM ar_yookassa_refunds WHERE order_id=o.id AND state='succeeded')>o.shipping_cost_rubles THEN RAISE EXCEPTION 'Return resolution shipping mismatch'; END IF;
 IF EXISTS(WITH purchased AS (SELECT component->>'skuId' sku,sum((item->>'quantity')::bigint*(component->>'quantity')::bigint) quantity FROM jsonb_array_elements(o.items_snapshot) item CROSS JOIN LATERAL jsonb_array_elements(item->'components') component GROUP BY component->>'skuId'), allocated AS (SELECT sku_id::text sku,quantity FROM ar_order_components WHERE order_id=o.id) SELECT 1 FROM purchased FULL JOIN allocated USING(sku) WHERE purchased.quantity IS DISTINCT FROM allocated.quantity) THEN RAISE EXCEPTION 'Return resolution purchase components mismatch'; END IF;
 IF (SELECT sum((item->>'quantity')::numeric*(item->>'unitPriceRubles')::numeric) FROM jsonb_array_elements(o.items_snapshot) item) IS DISTINCT FROM o.product_total_rubles THEN RAISE EXCEPTION 'Return resolution purchase amount mismatch'; END IF;
 -- Compare cumulative physical SKU quantities, expanding purchased bundle components.
 IF EXISTS(WITH financial AS (
  SELECT component->>'skuId' sku,sum((line->>'quantity')::bigint*(component->>'quantity')::bigint) quantity
  FROM ar_yookassa_refunds r CROSS JOIN LATERAL jsonb_array_elements(r.selection_snapshot->'lines') line
  CROSS JOIN LATERAL jsonb_array_elements(o.items_snapshot->((line->>'lineIndex')::int)->'components') component
  WHERE r.order_id=o.id AND r.state='succeeded' GROUP BY component->>'skuId'
 ), physical AS (SELECT sku_id::text sku,sum(quantity) quantity FROM ar_return_receipt_lines WHERE order_id=o.id GROUP BY sku_id)
 SELECT 1 FROM financial FULL JOIN physical USING(sku) WHERE financial.quantity IS DISTINCT FROM physical.quantity) THEN RAISE EXCEPTION 'Return resolution physical financial mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM ar_yookassa_refunds r WHERE r.order_id=o.id AND r.state='succeeded' AND r.amount_rubles<>coalesce((SELECT sum((line->>'quantity')::numeric*(line->>'unitPriceRubles')::numeric) FROM jsonb_array_elements(r.selection_snapshot->'lines') line),0)+(r.selection_snapshot->>'shippingRubles')::numeric) THEN RAISE EXCEPTION 'Return resolution refund amount mismatch'; END IF;
 SELECT sum(amount_rubles) INTO amount FROM ar_yookassa_refunds WHERE order_id=o.id AND state='succeeded';
 SELECT sum((x->>'received')::bigint),sum((x->>'restocked')::bigint),sum((x->>'held')::bigint) INTO received,restocked,held FROM jsonb_array_elements(current_snapshot->'physical') x;
 IF amount>payment.amount_rubles OR NEW.summary IS DISTINCT FROM jsonb_build_object('kind',CASE WHEN amount=payment.amount_rubles THEN 'full' ELSE 'partial' END,'paymentAmountRubles',payment.amount_rubles::text,'refundedRubles',amount::numeric(16,2)::text,'remainingRubles',(payment.amount_rubles-amount)::numeric(16,2)::text,'receivedQuantity',received,'restockedQuantity',restocked,'heldQuantity',held) THEN RAISE EXCEPTION 'Return resolution summary mismatch'; END IF;
 RETURN NEW;
END $$;
