CREATE TABLE ar_rate_limits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
 count integer NOT NULL DEFAULT 0, reset_at timestamptz NOT NULL
);
GRANT SELECT,INSERT,UPDATE ON ar_rate_limits TO ar_app;
