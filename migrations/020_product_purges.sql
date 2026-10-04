-- Permanent removal from the working catalog; accounting references stay intact.
CREATE TABLE ar_product_purges (
 product_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON ar_product_purges TO ar_app;
ALTER TABLE ar_product_editor_events DROP CONSTRAINT ar_product_editor_events_action_check;
ALTER TABLE ar_product_editor_events ADD CONSTRAINT ar_product_editor_events_action_check
 CHECK(action IN ('draft','publish','discard','archive','restore','purge'));
CREATE FUNCTION ar_product_purge_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status <> 'archived' AND EXISTS(SELECT 1 FROM public.ar_product_purges WHERE product_id=NEW.id) THEN
  RAISE EXCEPTION 'Permanently removed product cannot be published or restored';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_product_purge_guard BEFORE INSERT OR UPDATE ON ar_products FOR EACH ROW EXECUTE FUNCTION ar_product_purge_guard();
