-- NULL policy marks old test orders; no terms or deadlines are backfilled.
ALTER TABLE ar_orders ADD COLUMN checkout_policy_version text;
ALTER TABLE ar_orders ADD COLUMN delivery_deadline date;
ALTER TABLE ar_payments ADD COLUMN provider_paid_at timestamptz;
CREATE FUNCTION ar_order_deadline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.checkout_policy_version IS DISTINCT FROM OLD.checkout_policy_version THEN
  RAISE EXCEPTION 'Checkout policy is immutable';
 END IF;
 IF NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline AND
    (OLD.payment_status IN ('pending','paid','review') OR OLD.status NOT IN ('open','preorder_pending','awaiting_payment')) THEN
  RAISE EXCEPTION 'Delivery deadline is locked';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_order_deadline_guard BEFORE UPDATE ON ar_orders FOR EACH ROW EXECUTE FUNCTION ar_order_deadline_guard();

ALTER TABLE ar_orders ADD CONSTRAINT ar_order_deadline_before_payment CHECK (
 checkout_policy_version IS NULL OR status <> 'awaiting_payment' OR delivery_deadline IS NOT NULL
);
CREATE FUNCTION ar_payment_paid_at_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.provider_paid_at IS NOT NULL AND NEW.provider_paid_at IS DISTINCT FROM OLD.provider_paid_at THEN
  RAISE EXCEPTION 'Provider payment time is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_payment_paid_at_guard BEFORE UPDATE ON ar_payments FOR EACH ROW EXECUTE FUNCTION ar_payment_paid_at_guard();
