-- One explicit full sandbox refund per payment. Money return never implies physical stock return.
CREATE TABLE ar_yookassa_refunds (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES ar_orders(id),
 payment_id uuid NOT NULL UNIQUE REFERENCES ar_payments(id),
 provider_payment_id uuid NOT NULL,
 shop_id text NOT NULL,
 amount_rubles numeric(16,2) NOT NULL CHECK(amount_rubles>0),
 provider_key uuid NOT NULL UNIQUE,
 reason text NOT NULL,
 actor_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','pending','uncertain','succeeded','canceled','attention')),
 provider_id uuid UNIQUE,
 requested_at timestamptz,
 checked_at timestamptz,
 last_error text,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ar_yookassa_refunds_due ON ar_yookassa_refunds(next_check_at) WHERE state IN('queued','pending','uncertain');
CREATE FUNCTION ar_refund_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.order_id,NEW.payment_id,NEW.provider_payment_id,NEW.shop_id,NEW.amount_rubles,NEW.provider_key,NEW.reason,NEW.actor_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.payment_id,OLD.provider_payment_id,OLD.shop_id,OLD.amount_rubles,OLD.provider_key,OLD.reason,OLD.actor_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Refund snapshot is immutable'; END IF;
 IF OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'Refund provider identity is immutable'; END IF;
 IF OLD.requested_at IS NOT NULL AND NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN RAISE EXCEPTION 'Refund request time is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_refund_snapshot_guard BEFORE UPDATE ON ar_yookassa_refunds FOR EACH ROW EXECUTE FUNCTION ar_refund_snapshot_guard();
GRANT SELECT,INSERT,UPDATE ON ar_yookassa_refunds TO ar_app;
