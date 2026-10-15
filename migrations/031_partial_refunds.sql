-- Multiple sandbox refunds, immutable allocation/receipt and conservative money reservation.
ALTER TABLE ar_yookassa_refunds DROP CONSTRAINT ar_yookassa_refunds_payment_id_key;
ALTER TABLE ar_yookassa_refunds ADD COLUMN payment_amount_rubles numeric(16,2),
 ADD COLUMN selection_snapshot jsonb,
 ADD COLUMN receipt_snapshot jsonb;
ALTER TABLE ar_yookassa_refunds ADD CONSTRAINT ar_refund_selection_shape CHECK((
 (selection_snapshot IS NULL AND payment_amount_rubles IS NULL AND receipt_snapshot IS NULL)
 OR (payment_amount_rubles>0 AND payment_amount_rubles>=amount_rubles
  AND jsonb_typeof(selection_snapshot)='object' AND selection_snapshot->>'version'='1'
  AND (receipt_snapshot IS NULL OR jsonb_typeof(receipt_snapshot)='object'))) IS TRUE);
CREATE INDEX ar_refund_payment_history ON ar_yookassa_refunds(payment_id,created_at,id);
CREATE UNIQUE INDEX ar_refund_one_unresolved ON ar_yookassa_refunds(payment_id)
 WHERE state IN('queued','pending','uncertain','attention');
CREATE FUNCTION ar_refund_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p ar_payments%ROWTYPE;used numeric(16,2);
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.payment_amount_rubles,NEW.selection_snapshot,NEW.receipt_snapshot)
   IS DISTINCT FROM ROW(OLD.payment_amount_rubles,OLD.selection_snapshot,OLD.receipt_snapshot)
  THEN RAISE EXCEPTION 'Refund allocation snapshot is immutable'; END IF;
  IF OLD.state IN('succeeded','canceled') AND NEW.state IS DISTINCT FROM OLD.state
  THEN RAISE EXCEPTION 'Terminal refund state is immutable'; END IF;
 ELSE
  SELECT * INTO p FROM ar_payments WHERE id=NEW.payment_id FOR UPDATE;
  IF p.id IS NULL OR NEW.order_id<>p.order_id OR NEW.payment_amount_rubles IS DISTINCT FROM p.amount_rubles
   OR NEW.selection_snapshot IS NULL THEN RAISE EXCEPTION 'Refund payment snapshot mismatch'; END IF;
  SELECT coalesce(sum(amount_rubles),0) INTO used FROM ar_yookassa_refunds WHERE payment_id=p.id AND state<>'canceled';
  IF used+NEW.amount_rubles>p.amount_rubles THEN RAISE EXCEPTION 'Refund exceeds remaining payment'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_refund_allocation_guard BEFORE INSERT OR UPDATE ON ar_yookassa_refunds
 FOR EACH ROW EXECUTE FUNCTION ar_refund_allocation_guard();
