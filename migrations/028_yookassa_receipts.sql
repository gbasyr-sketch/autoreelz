-- Local preparation for YooKassa receipts. No backfill or external operations.
ALTER TABLE ar_payments ADD COLUMN receipt_snapshot jsonb,
 ADD COLUMN receipt_registration text CHECK(receipt_registration IN('pending','succeeded','canceled')),
 ADD COLUMN receipt_checked_at timestamptz,
 ADD COLUMN receipt_last_error text,
 ADD COLUMN receipt_next_check_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ar_yookassa_refunds ADD COLUMN receipt_registration text CHECK(receipt_registration IN('pending','succeeded','canceled')),
 ADD COLUMN receipt_checked_at timestamptz,
 ADD COLUMN receipt_last_error text,
 ADD COLUMN receipt_next_check_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ar_payments ADD CONSTRAINT ar_receipt_snapshot_shape CHECK(receipt_snapshot IS NULL OR (provider='yookassa-sandbox' AND jsonb_typeof(receipt_snapshot)='object'));
CREATE FUNCTION ar_payment_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot THEN RAISE EXCEPTION 'Payment receipt snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_payment_receipt_guard BEFORE UPDATE ON ar_payments FOR EACH ROW EXECUTE FUNCTION ar_payment_receipt_guard();
CREATE INDEX ar_payment_receipt_due ON ar_payments(receipt_next_check_at) WHERE receipt_snapshot IS NOT NULL AND provider_id IS NOT NULL AND (receipt_registration IS NULL OR receipt_registration='pending');
