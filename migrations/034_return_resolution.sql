-- Closing a review records an immutable reconciliation, never money or stock movement.
ALTER TABLE ar_orders DROP CONSTRAINT ar_orders_status_check;
ALTER TABLE ar_orders ADD CONSTRAINT ar_orders_status_check CHECK(status IN('open','preorder_pending','awaiting_payment','paid','expired','cancelled','manual_review','return_closed'));
ALTER TABLE ar_orders DROP CONSTRAINT ar_orders_payment_status_check;
ALTER TABLE ar_orders ADD CONSTRAINT ar_orders_payment_status_check CHECK(payment_status IN('unpaid','pending','paid','failed','review','partially_refunded','refunded'));
CREATE TABLE ar_return_resolutions (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES ar_orders(id),
 revision text NOT NULL CHECK(revision~'^[a-f0-9]{64}$'),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL,
 summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,revision)
);
-- Only facts relevant to reconciliation; closing itself does not change this snapshot.
CREATE FUNCTION ar_return_resolution_snapshot(oid uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'order',jsonb_build_object('allocation',o.allocation_state,'delivery',o.delivery_status,'shippingVersion',o.shipping_version,'items',o.items_snapshot,'products',o.product_total_rubles,'shipping',o.shipping_cost_rubles),
 'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'provider',p.provider,'providerStatus',p.provider_status,'providerId',p.provider_id,'shop',p.provider_shop_id,'amount',p.amount_rubles,'currency',p.currency,'version',p.shipping_version,'receipt',p.receipt_snapshot IS NOT NULL,'registration',p.receipt_registration) ORDER BY p.id) FROM ar_payments p WHERE p.order_id=oid),'[]'),
 'refunds',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'payment',r.payment_id,'providerPayment',r.provider_payment_id,'shop',r.shop_id,'state',r.state,'providerId',r.provider_id,'checked',r.checked_at,'amount',r.amount_rubles,'paymentAmount',r.payment_amount_rubles,'selection',r.selection_snapshot,'receipt',r.receipt_snapshot IS NOT NULL,'registration',r.receipt_registration) ORDER BY r.id) FROM ar_yookassa_refunds r WHERE r.order_id=oid),'[]'),
 'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'inspection',i.id) ORDER BY r.id) FROM ar_return_receipts r LEFT JOIN ar_return_inspections i ON i.receipt_id=r.id WHERE r.order_id=oid),'[]'),
 'physical',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sku_id) FROM (SELECT l.sku_id,sum(l.quantity) received,coalesce(sum(i.restock_quantity),0) restocked,coalesce(sum(i.held_quantity),0) held FROM ar_return_receipt_lines l LEFT JOIN ar_return_inspection_lines i ON i.receipt_id=l.receipt_id AND i.sku_id=l.sku_id WHERE l.order_id=oid GROUP BY l.sku_id) x),'[]'),
 'components',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',c.sku_id,'quantity',c.quantity) ORDER BY c.sku_id) FROM ar_order_components c WHERE c.order_id=oid),'[]'),
 'issued',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sku_id) FROM (SELECT m.sku_id,greatest(0,-sum(m.stock_delta)) quantity FROM ar_stock_movements m WHERE m.order_id=oid AND m.operation_key NOT LIKE 'return-intake:%' GROUP BY m.sku_id) x),'[]'),
 'shipments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'state',s.state,'code',s.carrier_code,'provider',s.provider_uuid,'at',s.carrier_at) ORDER BY s.id) FROM ar_cdek_shipments s WHERE s.order_id=oid),'[]')
 ) FROM ar_orders o WHERE o.id=oid
$$;
CREATE FUNCTION ar_return_resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_snapshot jsonb; o ar_orders%ROWTYPE; payment ar_payments%ROWTYPE; amount numeric; received bigint; restocked bigint; held bigint;
BEGIN
 SELECT * INTO o FROM ar_orders WHERE id=NEW.order_id FOR UPDATE;
 current_snapshot:=ar_return_resolution_snapshot(NEW.order_id);
 IF current_snapshot IS DISTINCT FROM NEW.snapshot OR NEW.revision<>encode(sha256(convert_to(current_snapshot::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Return resolution snapshot is stale'; END IF;
 IF o.status NOT IN('manual_review','return_closed') OR o.allocation_state<>'settled' OR o.delivery_status NOT IN('shipped','delivered') THEN RAISE EXCEPTION 'Return resolution order requires review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ar_return_receipts WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM ar_return_receipts r LEFT JOIN ar_return_inspections i ON i.receipt_id=r.id WHERE r.order_id=o.id AND i.id IS NULL) THEN RAISE EXCEPTION 'Return resolution requires every inspection'; END IF;
 IF (SELECT count(*) FROM ar_payments WHERE order_id=o.id AND status='succeeded')<>1 OR EXISTS(SELECT 1 FROM ar_payments WHERE order_id=o.id AND status NOT IN('succeeded','failed')) THEN RAISE EXCEPTION 'Return resolution payment is unresolved'; END IF;
 SELECT * INTO payment FROM ar_payments WHERE order_id=o.id AND status='succeeded';
 IF payment.provider<>'yookassa-sandbox' OR payment.provider_status IS DISTINCT FROM 'succeeded' OR payment.provider_id IS NULL OR payment.currency<>'RUB' OR payment.shipping_version<>o.shipping_version OR payment.amount_rubles<>o.product_total_rubles+o.shipping_cost_rubles THEN RAISE EXCEPTION 'Return resolution payment mismatch'; END IF;
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
CREATE TRIGGER ar_return_resolution_guard BEFORE INSERT ON ar_return_resolutions FOR EACH ROW EXECUTE FUNCTION ar_return_resolution_guard();
CREATE FUNCTION ar_return_resolution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Return resolution is immutable'; END $$;
CREATE TRIGGER ar_return_resolution_immutable BEFORE UPDATE OR DELETE ON ar_return_resolutions FOR EACH ROW EXECUTE FUNCTION ar_return_resolution_immutable();
GRANT SELECT,INSERT ON ar_return_resolutions TO ar_app;

CREATE FUNCTION ar_return_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='return_closed' THEN
  IF NOT EXISTS(SELECT 1 FROM ar_return_resolutions r WHERE r.order_id=NEW.id AND r.snapshot=ar_return_resolution_snapshot(NEW.id) AND NEW.payment_status=CASE WHEN r.summary->>'kind'='full' THEN 'refunded' ELSE 'partially_refunded' END) OR NEW.review_reason IS NOT NULL THEN RAISE EXCEPTION 'Closed return requires a matching resolution'; END IF;
 ELSIF NEW.payment_status IN('refunded','partially_refunded') AND NOT EXISTS(SELECT 1 FROM ar_return_resolutions WHERE order_id=NEW.id) THEN RAISE EXCEPTION 'Refunded order requires resolution history';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ar_return_closed_guard AFTER INSERT OR UPDATE ON ar_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ar_return_closed_guard();
