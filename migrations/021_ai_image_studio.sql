-- Independent image history and budget. Never shares the text-generation ledger.
CREATE TABLE ar_ai_image_assets (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 product_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('source','result')),
 name text NOT NULL,
 digest text NOT NULL,
 original_digest text NOT NULL,
 width integer NOT NULL CHECK(width>0),
 height integer NOT NULL CHECK(height>0),
 bytes integer NOT NULL CHECK(bytes>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ar_ai_image_source_digest ON ar_ai_image_assets(actor_id,product_id,digest) WHERE kind='source';
CREATE TABLE ar_ai_image_jobs (
 id uuid PRIMARY KEY,
 number bigserial UNIQUE,
 actor_id uuid NOT NULL,
 product_id uuid NOT NULL,
 request_key uuid NOT NULL,
 input_hash text NOT NULL,
 budget_key text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('openai','simulation')),
 model text NOT NULL,
 plan jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preparing','running','completed','failed','uncertain','cancelled')),
 estimated_usd numeric(12,8) NOT NULL CHECK(estimated_usd>=0),
 reserved_usd numeric(12,8) NOT NULL CHECK(reserved_usd>=0),
 charged_usd numeric(12,8) CHECK(charged_usd>=0),
 usage jsonb,
 provider_request_id text,
 error_code text,
 result_id uuid REFERENCES ar_ai_image_assets(id) ON DELETE RESTRICT,
 approved_at timestamptz,
 apply_file_id uuid REFERENCES directus_files(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 sent_at timestamptz,
 finished_at timestamptz,
 UNIQUE(actor_id,request_key)
);
CREATE INDEX ar_ai_image_queue ON ar_ai_image_jobs(created_at,id) WHERE state='queued';
CREATE INDEX ar_ai_image_history ON ar_ai_image_jobs(actor_id,product_id,number DESC);
CREATE FUNCTION ar_ai_image_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ar_ai_image_assets' THEN RAISE EXCEPTION 'Image assets are immutable'; END IF;
 IF ROW(NEW.actor_id,NEW.product_id,NEW.request_key,NEW.input_hash,NEW.budget_key,NEW.provider,NEW.model,NEW.plan,NEW.estimated_usd,NEW.reserved_usd)
 IS DISTINCT FROM ROW(OLD.actor_id,OLD.product_id,OLD.request_key,OLD.input_hash,OLD.budget_key,OLD.provider,OLD.model,OLD.plan,OLD.estimated_usd,OLD.reserved_usd)
 THEN RAISE EXCEPTION 'Image request is immutable'; END IF;
 IF OLD.charged_usd IS NOT NULL AND NEW.charged_usd IS DISTINCT FROM OLD.charged_usd THEN RAISE EXCEPTION 'Image charge is immutable'; END IF;
 IF OLD.result_id IS NOT NULL AND NEW.result_id IS DISTINCT FROM OLD.result_id THEN RAISE EXCEPTION 'Image result is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_ai_image_asset_immutable BEFORE UPDATE ON ar_ai_image_assets FOR EACH ROW EXECUTE FUNCTION ar_ai_image_immutable();
CREATE TRIGGER ar_ai_image_job_immutable BEFORE UPDATE ON ar_ai_image_jobs FOR EACH ROW EXECUTE FUNCTION ar_ai_image_immutable();
GRANT SELECT,INSERT ON ar_ai_image_assets TO ar_app;
GRANT SELECT,INSERT,UPDATE ON ar_ai_image_jobs TO ar_app;
GRANT USAGE,SELECT ON SEQUENCE ar_ai_image_jobs_number_seq TO ar_app;
