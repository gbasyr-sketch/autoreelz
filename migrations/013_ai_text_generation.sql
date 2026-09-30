-- Metered generation is separate from catalog publication and stock.
CREATE TABLE ar_ai_text_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 request_key uuid NOT NULL,
 product_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('deepseek','openai')),
 model text NOT NULL,
 prompt_version text NOT NULL,
 input_hash text NOT NULL,
 source_hash text NOT NULL,
 source_facts jsonb NOT NULL,
 period date NOT NULL,
 reserved_usd numeric(12,8) NOT NULL CHECK(reserved_usd>=0),
 charged_upper_usd numeric(12,8),
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','failed','uncertain')),
 result jsonb,
 usage jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(actor_id,request_key),
 CHECK(charged_upper_usd IS NULL OR charged_upper_usd>=0)
);
CREATE INDEX ar_ai_text_requests_period ON ar_ai_text_requests(period);
GRANT SELECT,INSERT,UPDATE ON ar_ai_text_requests TO ar_app;
