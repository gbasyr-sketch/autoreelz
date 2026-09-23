-- Verified video metadata is optional; absence never causes invented VideoObject fields.
ALTER TABLE ar_articles ADD COLUMN video_title text;
ALTER TABLE ar_articles ADD COLUMN video_description text;
ALTER TABLE ar_articles ADD COLUMN video_thumbnail_id uuid;
ALTER TABLE ar_articles ADD COLUMN video_uploaded_at timestamptz;
ALTER TABLE ar_articles ADD COLUMN video_duration_seconds integer CHECK(video_duration_seconds>0);
CREATE TABLE ar_article_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 article_id uuid NOT NULL REFERENCES ar_articles(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
 UNIQUE(article_id,product_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_article_products TO ar_cms;
GRANT SELECT ON ar_article_products TO ar_app;
-- YML requires numeric category IDs (<=18 digits); core entity IDs remain UUID.
ALTER TABLE ar_categories ADD COLUMN feed_id bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE ar_categories ADD CONSTRAINT ar_categories_feed_id_unique UNIQUE(feed_id);
ALTER TABLE ar_categories ADD CONSTRAINT ar_categories_feed_id_range CHECK(feed_id BETWEEN 1 AND 999999999999999999);
GRANT USAGE,SELECT ON SEQUENCE ar_categories_feed_id_seq TO ar_cms;
