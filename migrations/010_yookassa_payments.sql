ALTER TABLE ar_payments
 ADD COLUMN provider text NOT NULL DEFAULT 'simulation' CHECK(provider IN('simulation','yookassa-sandbox')),
 ADD COLUMN provider_shop_id text,
 ADD COLUMN provider_id text,
 ADD COLUMN provider_key uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN provider_return_url text,
 ADD COLUMN provider_status text CHECK(provider_status IN('pending','waiting_for_capture','succeeded','canceled')),
 ADD COLUMN provider_confirmation_url text,
 ADD COLUMN provider_requested_at timestamptz,
 ADD COLUMN provider_lease_id uuid,
 ADD COLUMN provider_lease_until timestamptz,
 ADD COLUMN provider_next_check_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN provider_checked_at timestamptz,
 ADD COLUMN provider_last_error text;
CREATE UNIQUE INDEX ar_payment_provider_id ON ar_payments(provider,provider_id) WHERE provider_id IS NOT NULL;
CREATE UNIQUE INDEX ar_payment_provider_key ON ar_payments(provider,provider_key);
ALTER TABLE ar_payments ADD CONSTRAINT ar_payment_yoo_snapshot CHECK(provider='simulation' OR
 (provider_shop_id IS NOT NULL AND provider_return_url IS NOT NULL AND method='card'));
CREATE FUNCTION ar_payment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.order_id,NEW.amount_rubles,NEW.currency,NEW.method,NEW.shipping_version,NEW.provider,NEW.provider_shop_id,NEW.provider_key,NEW.provider_return_url,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.amount_rubles,OLD.currency,OLD.method,OLD.shipping_version,OLD.provider,OLD.provider_shop_id,OLD.provider_key,OLD.provider_return_url,OLD.created_at)
 THEN RAISE EXCEPTION 'Payment snapshot is immutable'; END IF;
 IF OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'Provider payment identity is immutable'; END IF;
 IF OLD.provider_requested_at IS NOT NULL AND NEW.provider_requested_at IS DISTINCT FROM OLD.provider_requested_at THEN RAISE EXCEPTION 'First provider request time is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_payment_snapshot_guard BEFORE UPDATE ON ar_payments FOR EACH ROW EXECUTE FUNCTION ar_payment_snapshot_guard();
