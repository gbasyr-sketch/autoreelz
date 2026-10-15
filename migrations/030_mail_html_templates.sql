-- New messages only; existing immutable mail remains untouched.
ALTER TABLE ar_mail_outbox ADD COLUMN html_body text,
 ADD COLUMN template_version text,
 ADD COLUMN inline_assets jsonb NOT NULL DEFAULT '[]';
ALTER TABLE ar_mail_outbox ADD CONSTRAINT ar_mail_html_size CHECK(html_body IS NULL OR octet_length(html_body)<=196608);
ALTER TABLE ar_mail_outbox ADD CONSTRAINT ar_mail_assets_shape CHECK(jsonb_typeof(inline_assets)='array' AND jsonb_array_length(inline_assets)<=1);
ALTER TABLE ar_mail_outbox ADD CONSTRAINT ar_mail_template_complete CHECK((html_body IS NULL AND template_version IS NULL AND inline_assets='[]'::jsonb) OR (html_body IS NOT NULL AND template_version IS NOT NULL AND jsonb_array_length(inline_assets)=1));
CREATE OR REPLACE FUNCTION ar_smtp_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.provider IS DISTINCT FROM OLD.provider OR (OLD.provider='timeweb-smtp' AND
  ROW(NEW.recipient,NEW.subject,NEW.body,NEW.deduplication_key,NEW.kind,NEW.notification_id,NEW.challenge_id,NEW.message_id,NEW.expires_at,NEW.created_at,NEW.html_body,NEW.template_version,NEW.inline_assets)
  IS DISTINCT FROM ROW(OLD.recipient,OLD.subject,OLD.body,OLD.deduplication_key,OLD.kind,OLD.notification_id,OLD.challenge_id,OLD.message_id,OLD.expires_at,OLD.created_at,OLD.html_body,OLD.template_version,OLD.inline_assets))
 THEN RAISE EXCEPTION 'Mail routing and SMTP snapshot are immutable'; END IF;
 RETURN NEW;
END $$;
