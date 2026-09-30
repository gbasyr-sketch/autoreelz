CREATE TABLE ar_product_recommendations (
 product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
 recommended_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
 sort integer NOT NULL DEFAULT 0 CHECK(sort>=0 AND sort<8),
 PRIMARY KEY(product_id,recommended_id),
 CHECK(product_id<>recommended_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_product_recommendations TO ar_app;
-- Serialize lifecycle changes with CMS composition edits; no component mutation endpoint is exposed.
GRANT UPDATE ON ar_bundle_components TO ar_app;
ALTER TABLE ar_product_editor_drafts ADD COLUMN archived_at timestamptz;
ALTER TABLE ar_product_editor_events DROP CONSTRAINT ar_product_editor_events_action_check;
ALTER TABLE ar_product_editor_events ADD CONSTRAINT ar_product_editor_events_action_check
 CHECK(action IN ('draft','publish','discard','archive','restore'));
