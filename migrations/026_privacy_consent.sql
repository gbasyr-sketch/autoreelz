CREATE TABLE ar_privacy_events (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES ar_web_sessions(id),
 choice text NOT NULL CHECK(choice IN('accepted','rejected')),
 version text NOT NULL,
 consent_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX ar_privacy_events_session ON ar_privacy_events(session_id,created_at);
GRANT SELECT,INSERT ON ar_privacy_events TO ar_app;
CREATE TRIGGER ar_privacy_events_immutable BEFORE UPDATE OR DELETE ON ar_privacy_events FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
