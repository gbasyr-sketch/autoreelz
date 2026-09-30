-- Owner editor: drafts are separate from the live catalog until atomic publication.
CREATE TABLE ar_product_editor_drafts (
 id uuid PRIMARY KEY,
 version integer NOT NULL DEFAULT 0,
 base_hash text,
 payload jsonb,
 actor_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_product_editor_uploads (
 file_id uuid PRIMARY KEY,
 draft_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 request_key uuid NOT NULL,
 digest text NOT NULL,
 ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
CREATE TABLE ar_product_editor_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('draft','publish','discard')),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE ON ar_product_editor_drafts,ar_product_editor_uploads TO ar_app;
GRANT SELECT,INSERT ON ar_product_editor_events TO ar_app;
-- Catalog writes are authorized by the existing owner session, never public CRUD.
GRANT INSERT,UPDATE ON ar_products,ar_skus TO ar_app;
GRANT INSERT ON ar_packages,ar_slug_registry,ar_slug_history TO ar_app;
-- Allows the short catalog lock to serialize publication with CMS package edits.
GRANT UPDATE ON ar_packages TO ar_app;
GRANT SELECT ON ar_slug_registry TO ar_app;
GRANT INSERT,UPDATE,DELETE ON ar_product_media,ar_sku_media,ar_product_attributes,ar_sku_attributes,ar_fitment TO ar_app;
-- Existing integrity triggers lock definitions with FOR SHARE (requires UPDATE).
-- The editor never changes dictionary rows; grant only the ID column for row locks.
GRANT UPDATE(id) ON ar_attributes TO ar_app;
GRANT UPDATE(id) ON ar_attribute_values TO ar_app;
