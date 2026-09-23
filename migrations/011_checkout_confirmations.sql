-- Legacy purchases remain NULL: acceptance is never fabricated retroactively.
ALTER TABLE ar_checkout_batches ADD COLUMN confirmation jsonb;
ALTER TABLE ar_checkout_batches ADD CONSTRAINT ar_checkout_confirmation_shape CHECK (
 confirmation IS NULL OR (jsonb_typeof(confirmation)='object' AND confirmation ?& ARRAY['version','label','body','acceptedAt'])
);
CREATE FUNCTION ar_checkout_confirmation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.confirmation IS DISTINCT FROM OLD.confirmation THEN RAISE EXCEPTION 'Checkout confirmation is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_checkout_confirmation_guard BEFORE UPDATE ON ar_checkout_batches FOR EACH ROW EXECUTE FUNCTION ar_checkout_confirmation_guard();
CREATE TABLE ar_service_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 service text NOT NULL CHECK(service='yandex-pickup-map'),
 version text NOT NULL, snapshot jsonb NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ar_service_consents_session ON ar_service_consents(session_id,accepted_at);
CREATE TRIGGER ar_service_consents_immutable BEFORE UPDATE OR DELETE ON ar_service_consents FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
GRANT SELECT,INSERT ON ar_service_consents TO ar_app;
