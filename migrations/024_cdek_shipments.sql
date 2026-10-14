-- Durable outbound requests. The shop order and its stock/accounting snapshots remain unchanged.
CREATE TABLE ar_cdek_shipments (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES ar_orders(id),
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_hash text NOT NULL,
 number text NOT NULL UNIQUE,
 payload jsonb NOT NULL,
 fingerprint text NOT NULL,
 actor_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','uncertain','accepted','ready','attention','rejected','cancel_queued','cancelling','cancel_uncertain','cancelled')),
 provider_uuid uuid,
 tracking_number text,
 carrier_code text,
 carrier_at timestamptz,
 cancel_acknowledged_at timestamptz,
 last_error text,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,provider_uuid)
);
CREATE UNIQUE INDEX ar_cdek_one_active ON ar_cdek_shipments(order_id) WHERE state NOT IN ('rejected','cancelled');
CREATE INDEX ar_cdek_due ON ar_cdek_shipments(next_check_at);
CREATE TABLE ar_cdek_prints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shipment_id uuid NOT NULL REFERENCES ar_cdek_shipments(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','uncertain','pending','ready','failed','expired')),
 provider_uuid uuid,
 last_error text,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz
);
CREATE UNIQUE INDEX ar_cdek_one_print ON ar_cdek_prints(shipment_id) WHERE state NOT IN ('failed','expired');
CREATE TABLE ar_cdek_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shipment_id uuid NOT NULL REFERENCES ar_cdek_shipments(id),
 deduplication_key text NOT NULL UNIQUE,
 kind text NOT NULL,
 detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ar_cdek_history_immutable BEFORE UPDATE OR DELETE ON ar_cdek_history FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
CREATE FUNCTION ar_cdek_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.order_id,NEW.environment,NEW.account_hash,NEW.number,NEW.payload,NEW.fingerprint,NEW.actor_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.environment,OLD.account_hash,OLD.number,OLD.payload,OLD.fingerprint,OLD.actor_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Shipment snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_cdek_snapshot_guard BEFORE UPDATE ON ar_cdek_shipments FOR EACH ROW EXECUTE FUNCTION ar_cdek_snapshot_guard();
GRANT SELECT,INSERT,UPDATE ON ar_cdek_shipments,ar_cdek_prints TO ar_app;
GRANT SELECT,INSERT ON ar_cdek_history TO ar_app;
-- No CMS or public access: recipient data and documents are manager-only.
