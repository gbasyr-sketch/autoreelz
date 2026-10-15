-- Supplier confirmation permits payment without pretending physical stock has arrived.
ALTER TABLE ar_orders DROP CONSTRAINT ar_orders_allocation_state_check;
ALTER TABLE ar_orders ADD CONSTRAINT ar_orders_allocation_state_check CHECK (
 allocation_state IN('none','reserved','debited','settled','released','supplier_pending','supplier_paid')
);
ALTER TABLE ar_orders ADD COLUMN supplier_confirmed_at timestamptz;
ALTER TABLE ar_orders ADD COLUMN supplier_confirmed_by uuid;
ALTER TABLE ar_orders ADD CONSTRAINT ar_supplier_confirmation_pair CHECK (
 (supplier_confirmed_at IS NULL)=(supplier_confirmed_by IS NULL)
);
ALTER TABLE ar_orders ADD CONSTRAINT ar_supplier_allocation_kind CHECK (
 allocation_state NOT IN('supplier_pending','supplier_paid') OR (kind='preorder' AND supplier_confirmed_at IS NOT NULL)
);
CREATE FUNCTION ar_supplier_confirmation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.supplier_confirmed_at IS NOT NULL AND
    (NEW.supplier_confirmed_at IS DISTINCT FROM OLD.supplier_confirmed_at OR NEW.supplier_confirmed_by IS DISTINCT FROM OLD.supplier_confirmed_by) THEN
  RAISE EXCEPTION 'Supplier confirmation is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_supplier_confirmation_guard BEFORE UPDATE ON ar_orders
 FOR EACH ROW EXECUTE FUNCTION ar_supplier_confirmation_guard();
DROP INDEX ar_orders_due;
CREATE INDEX ar_orders_due ON ar_orders(expires_at) WHERE allocation_state IN('reserved','debited','supplier_pending');
