-- Existing plain text remains escaped until explicitly saved as rich text.
ALTER TABLE ar_pages ADD COLUMN body_format text NOT NULL DEFAULT 'plain' CHECK(body_format IN ('plain','html'));
ALTER TABLE ar_articles ADD COLUMN body_format text NOT NULL DEFAULT 'plain' CHECK(body_format IN ('plain','html'));
CREATE TABLE ar_content_editor_drafts (
 kind text NOT NULL CHECK(kind IN ('page','article')), id uuid NOT NULL,
 version integer NOT NULL DEFAULT 0, base_hash text, payload jsonb,
 actor_id uuid NOT NULL, archived_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,id)
);
CREATE TABLE ar_content_editor_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
 content_id uuid NOT NULL, actor_id uuid NOT NULL, action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE ON ar_content_editor_drafts TO ar_app;
GRANT SELECT,INSERT ON ar_content_editor_events TO ar_app;
GRANT INSERT,UPDATE ON ar_pages,ar_articles,ar_blog_categories,ar_blog_tags TO ar_app;
GRANT INSERT ON ar_content_slugs TO ar_app;
GRANT INSERT,UPDATE,DELETE ON ar_article_tags,ar_article_products TO ar_app;
