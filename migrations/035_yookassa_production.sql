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
