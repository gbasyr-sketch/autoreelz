-- Physical returned goods: immutable reception, then one inspection and atomic stock credit.
CREATE TABLE ar_return_receipts (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES ar_orders(id),
 tracking_number text NOT NULL CHECK(length(btrim(tracking_number)) BETWEEN 3 AND 100),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),created_txid bigint NOT NULL DEFAULT txid_current(),
 UNIQUE(id,order_id)
);
CREATE UNIQUE INDEX ar_return_receipt_reference ON ar_return_receipts(order_id,upper(regexp_replace(btrim(tracking_number),'[[:space:]]+',' ','g')));
CREATE TABLE ar_return_receipt_lines (
 receipt_id uuid NOT NULL,order_id uuid NOT NULL,sku_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
 name text NOT NULL,article text NOT NULL,source_labels jsonb NOT NULL CHECK(jsonb_typeof(source_labels)='array'),
 PRIMARY KEY(receipt_id,sku_id),
 FOREIGN KEY(receipt_id,order_id) REFERENCES ar_return_receipts(id,order_id),
 FOREIGN KEY(order_id,sku_id) REFERENCES ar_order_components(order_id,sku_id)
);
CREATE INDEX ar_return_received_budget ON ar_return_receipt_lines(order_id,sku_id);
CREATE TABLE ar_return_inspections (
 id uuid PRIMARY KEY,receipt_id uuid NOT NULL UNIQUE,order_id uuid NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 1000),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),created_txid bigint NOT NULL DEFAULT txid_current(),
 UNIQUE(id,receipt_id,order_id),
 FOREIGN KEY(receipt_id,order_id) REFERENCES ar_return_receipts(id,order_id)
);
CREATE TABLE ar_return_inspection_lines (
 inspection_id uuid NOT NULL,receipt_id uuid NOT NULL,order_id uuid NOT NULL,sku_id uuid NOT NULL,
 restock_quantity integer NOT NULL CHECK(restock_quantity BETWEEN 0 AND 1000000),
 held_quantity integer NOT NULL CHECK(held_quantity BETWEEN 0 AND 1000000),
 CHECK(restock_quantity+held_quantity>0),PRIMARY KEY(inspection_id,sku_id),
 FOREIGN KEY(inspection_id,receipt_id,order_id) REFERENCES ar_return_inspections(id,receipt_id,order_id),
 FOREIGN KEY(receipt_id,sku_id) REFERENCES ar_return_receipt_lines(receipt_id,sku_id)
);
CREATE FUNCTION ar_return_stamp_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.created_txid:=txid_current(); RETURN NEW; END $$;
CREATE TRIGGER ar_return_stamp_transaction BEFORE INSERT ON ar_return_receipts FOR EACH ROW EXECUTE FUNCTION ar_return_stamp_transaction();
CREATE TRIGGER ar_return_stamp_transaction BEFORE INSERT ON ar_return_inspections FOR EACH ROW EXECUTE FUNCTION ar_return_stamp_transaction();
CREATE FUNCTION ar_return_child_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ar_return_receipt_lines' THEN
  IF NOT EXISTS(SELECT 1 FROM ar_return_receipts WHERE id=NEW.receipt_id AND created_txid=txid_current())
   THEN RAISE EXCEPTION 'Return receipt items can only be inserted during reception'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM ar_return_inspections WHERE id=NEW.inspection_id AND created_txid=txid_current())
   THEN RAISE EXCEPTION 'Return inspection items can only be inserted during inspection'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_return_child_transaction_guard BEFORE INSERT ON ar_return_receipt_lines FOR EACH ROW EXECUTE FUNCTION ar_return_child_transaction_guard();
CREATE TRIGGER ar_return_child_transaction_guard BEFORE INSERT ON ar_return_inspection_lines FOR EACH ROW EXECUTE FUNCTION ar_return_child_transaction_guard();
CREATE FUNCTION ar_return_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.operation_key LIKE 'return-intake:%' OR (TG_OP='UPDATE' AND NEW.operation_key LIKE 'return-intake:%')
   THEN RAISE EXCEPTION 'Return stock movement is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF NEW.operation_key NOT LIKE 'return-intake:%' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM ar_return_inspections i JOIN ar_return_inspection_lines l ON l.inspection_id=i.id
  WHERE NEW.operation_key='return-intake:'||i.id::text AND i.created_txid=txid_current()
  AND i.order_id=NEW.order_id AND i.actor_id=NEW.actor_id AND l.sku_id=NEW.sku_id
  AND l.restock_quantity>0 AND l.restock_quantity=NEW.stock_delta AND NEW.reserved_delta=0)
 THEN RAISE EXCEPTION 'Return stock credit must match current inspection'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_return_stock_guard BEFORE INSERT OR UPDATE OR DELETE ON ar_stock_movements FOR EACH ROW EXECUTE FUNCTION ar_return_stock_guard();
CREATE FUNCTION ar_return_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Return intake history is immutable'; END $$;
CREATE TRIGGER ar_return_history_immutable BEFORE UPDATE OR DELETE ON ar_return_receipts FOR EACH ROW EXECUTE FUNCTION ar_return_history_immutable();
CREATE TRIGGER ar_return_history_immutable BEFORE UPDATE OR DELETE ON ar_return_receipt_lines FOR EACH ROW EXECUTE FUNCTION ar_return_history_immutable();
CREATE TRIGGER ar_return_history_immutable BEFORE UPDATE OR DELETE ON ar_return_inspections FOR EACH ROW EXECUTE FUNCTION ar_return_history_immutable();
CREATE TRIGGER ar_return_history_immutable BEFORE UPDATE OR DELETE ON ar_return_inspection_lines FOR EACH ROW EXECUTE FUNCTION ar_return_history_immutable();
CREATE FUNCTION ar_return_received_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o ar_orders%ROWTYPE;ordered integer;issued bigint;received bigint;
BEGIN
 SELECT * INTO o FROM ar_orders WHERE id=NEW.order_id FOR UPDATE;
 IF o.id IS NULL OR o.allocation_state<>'settled' OR o.delivery_status NOT IN('shipped','delivered')
 THEN RAISE EXCEPTION 'Return requires issued and dispatched goods'; END IF;
 SELECT quantity INTO ordered FROM ar_order_components WHERE order_id=o.id AND sku_id=NEW.sku_id;
 SELECT greatest(0,-coalesce(sum(stock_delta),0)) INTO issued FROM ar_stock_movements
  WHERE order_id=o.id AND sku_id=NEW.sku_id AND operation_key NOT LIKE 'return-intake:%';
 SELECT coalesce(sum(quantity),0) INTO received FROM ar_return_receipt_lines WHERE order_id=o.id AND sku_id=NEW.sku_id;
 IF ordered IS NULL OR received+NEW.quantity>least(ordered::bigint,issued)
 THEN RAISE EXCEPTION 'Return quantity exceeds issued goods'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_return_received_guard BEFORE INSERT ON ar_return_receipt_lines FOR EACH ROW EXECUTE FUNCTION ar_return_received_guard();
CREATE FUNCTION ar_return_receipt_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ar_return_receipt_lines WHERE receipt_id=NEW.id) THEN RAISE EXCEPTION 'Return receipt must have physical items'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ar_return_receipt_complete AFTER INSERT ON ar_return_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ar_return_receipt_complete();
CREATE FUNCTION ar_return_inspection_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op text:='return-intake:'||NEW.id::text;
BEGIN
 IF EXISTS(SELECT 1 FROM ar_return_receipt_lines l LEFT JOIN ar_return_inspection_lines i ON i.inspection_id=NEW.id AND i.sku_id=l.sku_id
  WHERE l.receipt_id=NEW.receipt_id AND (i.sku_id IS NULL OR i.restock_quantity+i.held_quantity<>l.quantity))
 THEN RAISE EXCEPTION 'Inspection must account for every received item'; END IF;
 IF EXISTS(SELECT 1 FROM ar_return_inspection_lines i LEFT JOIN ar_stock_movements m ON m.operation_key=op AND m.sku_id=i.sku_id
  WHERE i.inspection_id=NEW.id AND ((i.restock_quantity>0 AND (m.id IS NULL OR m.stock_delta<>i.restock_quantity OR m.reserved_delta<>0 OR m.order_id IS DISTINCT FROM NEW.order_id))
   OR (i.restock_quantity=0 AND m.id IS NOT NULL)))
  OR EXISTS(SELECT 1 FROM ar_stock_movements m LEFT JOIN ar_return_inspection_lines i ON i.inspection_id=NEW.id AND i.sku_id=m.sku_id WHERE m.operation_key=op AND i.sku_id IS NULL)
 THEN RAISE EXCEPTION 'Inspection stock movement mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ar_return_inspection_complete AFTER INSERT ON ar_return_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ar_return_inspection_complete();
GRANT SELECT,INSERT ON ar_return_receipts,ar_return_receipt_lines,ar_return_inspections,ar_return_inspection_lines TO ar_app;
