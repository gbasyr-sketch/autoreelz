-- Stage 5: content, customer features, owner operations. New store only.
CREATE TABLE ar_pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title text NOT NULL, body text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')),
 seo_title text, meta_description text, is_legal boolean NOT NULL DEFAULT false,
 is_draft_text boolean NOT NULL DEFAULT false, sort integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_blog_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')), sort integer NOT NULL DEFAULT 0
);
CREATE TABLE ar_blog_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE TABLE ar_articles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 category_id uuid NOT NULL REFERENCES ar_blog_categories(id), excerpt text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')), video_url text,
 cover_file_id uuid, seo_title text, meta_description text, is_demo boolean NOT NULL DEFAULT false,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_article_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), article_id uuid NOT NULL REFERENCES ar_articles(id) ON DELETE CASCADE,
 tag_id uuid NOT NULL REFERENCES ar_blog_tags(id) ON DELETE CASCADE, UNIQUE(article_id,tag_id)
);
CREATE TABLE ar_content_slugs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL, slug text NOT NULL,
 UNIQUE(entity_type,slug)
);
CREATE FUNCTION ar_content_slug_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claimed uuid;
BEGIN
 INSERT INTO ar_content_slugs(entity_type,entity_id,slug) VALUES(TG_ARGV[0],NEW.id,NEW.slug) ON CONFLICT DO NOTHING;
 SELECT entity_id INTO claimed FROM ar_content_slugs WHERE entity_type=TG_ARGV[0] AND slug=NEW.slug;
 IF claimed IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Адрес уже использован другой записью'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_page_slug BEFORE INSERT OR UPDATE OF slug ON ar_pages FOR EACH ROW EXECUTE FUNCTION ar_content_slug_guard('page');
CREATE TRIGGER ar_article_slug BEFORE INSERT OR UPDATE OF slug ON ar_articles FOR EACH ROW EXECUTE FUNCTION ar_content_slug_guard('article');
CREATE TRIGGER ar_blog_category_slug BEFORE INSERT OR UPDATE OF slug ON ar_blog_categories FOR EACH ROW EXECUTE FUNCTION ar_content_slug_guard('blog_category');
CREATE TRIGGER ar_blog_tag_slug BEFORE INSERT OR UPDATE OF slug ON ar_blog_tags FOR EACH ROW EXECUTE FUNCTION ar_content_slug_guard('blog_tag');

ALTER TABLE ar_orders ADD COLUMN tracking_number text;
ALTER TABLE ar_orders ADD COLUMN delivery_source text NOT NULL DEFAULT 'checkout' CHECK(delivery_source IN('checkout','manager','carrier'));
ALTER TABLE ar_orders ADD COLUMN delivery_override boolean NOT NULL DEFAULT false;
ALTER TABLE ar_orders ADD COLUMN carrier_status text;
ALTER TABLE ar_orders ADD COLUMN carrier_updated_at timestamptz;
ALTER TABLE ar_orders ADD COLUMN delivery_updated_at timestamptz;
ALTER TABLE ar_orders ADD COLUMN delivered_at timestamptz;
CREATE TABLE ar_order_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id),
 body text NOT NULL CHECK(length(body) BETWEEN 2 AND 2000), actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ar_delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id),
 provider_event_id text NOT NULL UNIQUE, payload_hash text NOT NULL, status text NOT NULL,
 occurred_at timestamptz NOT NULL, source text NOT NULL CHECK(source IN('carrier','manager')), actor_id uuid,
 reason text NOT NULL DEFAULT '', applied boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ar_delivery_events_order ON ar_delivery_events(order_id,created_at);
CREATE TRIGGER ar_order_notes_immutable BEFORE UPDATE OR DELETE ON ar_order_notes FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();
CREATE TRIGGER ar_delivery_events_immutable BEFORE UPDATE OR DELETE ON ar_delivery_events FOR EACH ROW EXECUTE FUNCTION ar_immutable_row();

CREATE TABLE ar_favorites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,product_id)
);
CREATE TABLE ar_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES ar_customers(id),
 product_id uuid NOT NULL REFERENCES ar_products(id), order_id uuid NOT NULL REFERENCES ar_orders(id),
 author_name text NOT NULL CHECK(length(btrim(author_name)) BETWEEN 2 AND 80), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 20 AND 5000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 moderation_note text, moderated_by uuid, moderated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,product_id)
);
CREATE INDEX ar_reviews_product ON ar_reviews(product_id,status,created_at);
CREATE TABLE ar_review_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES ar_reviews(id) ON DELETE CASCADE,
 image_data bytea NOT NULL CHECK(octet_length(image_data) BETWEEN 1 AND 2097152), mime text NOT NULL DEFAULT 'image/webp' CHECK(mime='image/webp'),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 1600), height integer NOT NULL CHECK(height BETWEEN 1 AND 1600),
 sort integer NOT NULL CHECK(sort BETWEEN 0 AND 4), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(review_id,sort)
);

CREATE TABLE ar_description_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES ar_products(id), actor_id uuid NOT NULL,
 source_fingerprint text NOT NULL, description text NOT NULL, meta_description text NOT NULL,
 state text NOT NULL DEFAULT 'preview' CHECK(state IN('preview','applied')),
 created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
CREATE TABLE ar_owner_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES ar_orders(id), event_key text NOT NULL,
 channel text NOT NULL CHECK(channel IN('max','email')), subject text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','delivered','failed')), attempts integer NOT NULL DEFAULT 0,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, UNIQUE(event_key,channel)
);
CREATE FUNCTION ar_owner_order_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_number text;
BEGIN
 IF NEW.event_type IN('created','paid','preorder_confirmed','cancelled','late_payment','payment_review','shipped','delivered') THEN
  SELECT number INTO order_number FROM ar_orders WHERE id=NEW.order_id;
  INSERT INTO ar_owner_notifications(order_id,event_key,channel,subject,body)
   SELECT NEW.order_id,NEW.id::text,channel,'AUTO REELZ — '||order_number,
    'Локальное тестовое уведомление. Заказ '||order_number||', событие: '||NEW.event_type||'. Подробности в кабинете владельца.'
   FROM unnest(ARRAY['max','email']) AS channel ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ar_owner_order_notice AFTER INSERT ON ar_order_events FOR EACH ROW EXECUTE FUNCTION ar_owner_order_notice();

CREATE FUNCTION ar_stage5_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
CREATE TRIGGER ar_pages_touch BEFORE UPDATE ON ar_pages FOR EACH ROW EXECUTE FUNCTION ar_stage5_touch();
CREATE TRIGGER ar_articles_touch BEFORE UPDATE ON ar_articles FOR EACH ROW EXECUTE FUNCTION ar_stage5_touch();
CREATE TRIGGER ar_reviews_touch BEFORE UPDATE ON ar_reviews FOR EACH ROW EXECUTE FUNCTION ar_stage5_touch();

GRANT SELECT,INSERT,UPDATE,DELETE ON ar_pages,ar_blog_categories,ar_blog_tags,ar_articles,ar_article_tags TO ar_cms;
GRANT SELECT,INSERT ON ar_content_slugs TO ar_cms;
GRANT SELECT ON ar_pages,ar_blog_categories,ar_blog_tags,ar_articles,ar_article_tags,ar_content_slugs TO ar_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_favorites TO ar_app;
GRANT SELECT,INSERT,UPDATE ON ar_reviews,ar_description_drafts,ar_owner_notifications TO ar_app;
GRANT SELECT,INSERT ON ar_review_media,ar_order_notes,ar_delivery_events TO ar_app;
GRANT UPDATE(description,meta_description,updated_at) ON ar_products TO ar_app;
GRANT SELECT ON ar_reviews,ar_order_notes,ar_delivery_events,ar_description_drafts,ar_owner_notifications TO ar_cms;
