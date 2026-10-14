-- Only NEW messages explicitly routed by the application can use SMTP. Never backfill old mail.
ALTER TABLE ar_mail_outbox DROP CONSTRAINT ar_mail_outbox_status_check;
ALTER TABLE ar_mail_outbox ADD CONSTRAINT ar_mail_outbox_status_check CHECK(status IN('pending','sending','retry','delivered','failed','uncertain','blocked','expired'));
ALTER TABLE ar_mail_outbox
 ADD COLUMN provider text NOT NULL DEFAULT 'simulation' CHECK(provider IN('simulation','timeweb-smtp')),
 ADD COLUMN kind text NOT NULL DEFAULT 'customer' CHECK(kind IN('customer','login','owner','probe')),
 ADD COLUMN challenge_id uuid REFERENCES ar_login_challenges(id),
 ADD COLUMN notification_id uuid UNIQUE REFERENCES ar_owner_notifications(id),
 ADD COLUMN message_id text NOT NULL DEFAULT ('<ar-'||gen_random_uuid()::text||'@autoreelz.ru>'),
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '1 day'),
 ADD COLUMN lease_id uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN last_error text,
 ADD COLUMN smtp_accepted_at timestamptz;
CREATE UNIQUE INDEX ar_mail_message_id ON ar_mail_outbox(message_id);
CREATE INDEX ar_smtp_due ON ar_mail_outbox(next_attempt_at) WHERE provider='timeweb-smtp' AND status IN('pending','retry');
CREATE FUNCTION ar_smtp_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.provider IS DISTINCT FROM OLD.provider OR (OLD.provider='timeweb-smtp' AND
  ROW(NEW.recipient,NEW.subject,NEW.body,NEW.deduplication_key,NEW.kind,NEW.notification_id,NEW.challenge_id,NEW.message_id,NEW.expires_at,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.recipient,OLD.subject,OLD.body,OLD.deduplication_key,OLD.kind,OLD.notification_id,OLD.challenge_id,OLD.message_id,OLD.expires_at,OLD.created_at))
 THEN RAISE EXCEPTION 'Mail routing and SMTP snapshot are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_smtp_snapshot_guard BEFORE UPDATE ON ar_mail_outbox FOR EACH ROW EXECUTE FUNCTION ar_smtp_snapshot_guard();
