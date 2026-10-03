-- Reversible library deletion; shared originals are never unlinked from products.
CREATE TABLE ar_product_image_trash (
 file_id uuid PRIMARY KEY REFERENCES directus_files(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,DELETE ON ar_product_image_trash TO ar_app;
