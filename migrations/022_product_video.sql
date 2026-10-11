-- One optional hosted video per product (including bundles), shared by all SKUs.
-- Nullable addition does not rewrite existing products or their saved drafts.
ALTER TABLE ar_products ADD COLUMN video_url text
 CHECK(video_url IS NULL OR (length(video_url) BETWEEN 1 AND 2048 AND video_url LIKE 'https://%'));
