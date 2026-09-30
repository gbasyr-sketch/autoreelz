-- Keep the editing recipe after publication without exposing a draft on the storefront.
ALTER TABLE ar_product_editor_drafts ADD COLUMN infographic jsonb;
ALTER TABLE ar_product_editor_drafts ADD CONSTRAINT ar_editor_infographic_object
 CHECK (infographic IS NULL OR (jsonb_typeof(infographic)='object' AND octet_length(infographic::text)<=8192));
