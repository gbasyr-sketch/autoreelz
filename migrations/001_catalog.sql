-- New AUTO REELZ database only. Applied once by scripts/migrate.mjs.
CREATE TABLE ar_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES ar_categories(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sort integer NOT NULL DEFAULT 0,
  seo_title text,
  meta_description text
);
CREATE TABLE ar_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  generation text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  year_from integer CHECK (year_from BETWEEN 1970 AND 2100),
  year_to integer CHECK (year_to BETWEEN 1970 AND 2100),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);
CREATE TABLE ar_vehicle_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES ar_vehicles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  note text,
  UNIQUE(vehicle_id,name)
);
CREATE TABLE ar_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL,
  value_type text NOT NULL DEFAULT 'select' CHECK (value_type IN ('select','text','number','boolean')),
  unit text,
  filterable boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0
);
CREATE TABLE ar_attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id uuid NOT NULL REFERENCES ar_attributes(id) ON DELETE RESTRICT,
  label text NOT NULL,
  code text NOT NULL,
  color text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  sort integer NOT NULL DEFAULT 0,
  UNIQUE(attribute_id,code)
);
CREATE TABLE ar_category_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES ar_categories(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES ar_attributes(id) ON DELETE RESTRICT,
  required boolean NOT NULL DEFAULT false,
  show_filter boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  UNIQUE(category_id,attribute_id)
);
CREATE TABLE ar_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text NOT NULL DEFAULT 'single' CHECK (kind IN ('single','bundle')),
  category_id uuid NOT NULL REFERENCES ar_categories(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  description text,
  seo_title text,
  meta_description text,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'bundle' OR discount_percent = 0)
);
CREATE TABLE ar_product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES ar_categories(id) ON DELETE RESTRICT,
  UNIQUE(product_id,category_id)
);
CREATE TABLE ar_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  weight_g integer NOT NULL CHECK (weight_g > 0),
  length_mm integer NOT NULL CHECK (length_mm > 0),
  width_mm integer NOT NULL CHECK (width_mm > 0),
  height_mm integer NOT NULL CHECK (height_mm > 0),
  note text
);
CREATE TABLE ar_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE RESTRICT,
  article text NOT NULL CHECK (article = btrim(article) AND length(article) > 0),
  name text NOT NULL,
  price_kopecks bigint NOT NULL CHECK (price_kopecks BETWEEN 0 AND 9007199254740991),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  media_mode text NOT NULL DEFAULT 'inherit' CHECK (media_mode IN ('inherit','replace')),
  fitment_mode text NOT NULL DEFAULT 'inherit' CHECK (fitment_mode IN ('inherit','replace')),
  package_id uuid REFERENCES ar_packages(id) ON DELETE RESTRICT,
  sort integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ar_skus_article_unique ON ar_skus(lower(article));
CREATE TABLE ar_product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
  alt text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0
);
CREATE TABLE ar_sku_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES ar_skus(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
  alt text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0
);
CREATE TABLE ar_product_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES ar_attributes(id) ON DELETE RESTRICT,
  value_id uuid REFERENCES ar_attribute_values(id) ON DELETE RESTRICT,
  text_value text,
  number_value numeric,
  boolean_value boolean,
  UNIQUE(product_id,attribute_id)
);
CREATE TABLE ar_sku_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES ar_skus(id) ON DELETE CASCADE,
  attribute_id uuid NOT NULL REFERENCES ar_attributes(id) ON DELETE RESTRICT,
  value_id uuid REFERENCES ar_attribute_values(id) ON DELETE RESTRICT,
  text_value text,
  number_value numeric,
  boolean_value boolean,
  UNIQUE(sku_id,attribute_id)
);
CREATE TABLE ar_fitment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES ar_skus(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES ar_vehicles(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES ar_vehicle_versions(id) ON DELETE RESTRICT,
  year_from integer CHECK (year_from BETWEEN 1970 AND 2100),
  year_to integer CHECK (year_to BETWEEN 1970 AND 2100),
  air_conditioning text NOT NULL DEFAULT 'unknown' CHECK (air_conditioning IN ('yes','no','any','unknown')),
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('compatible','incompatible','unknown')),
  note text,
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);
CREATE TABLE ar_bundle_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES ar_skus(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
  sort integer NOT NULL DEFAULT 0,
  UNIQUE(bundle_id,sku_id)
);
CREATE TABLE ar_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL UNIQUE REFERENCES ar_skus(id) ON DELETE RESTRICT,
  on_hand integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  CHECK (on_hand >= reserved AND reserved >= 0)
);
CREATE TABLE ar_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('product','category')),
  entity_id uuid NOT NULL,
  old_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type,old_slug)
);

CREATE FUNCTION ar_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_depth integer; subtree_height integer;
BEGIN
  PERFORM pg_advisory_xact_lock(320260901);
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'Категория не может быть своим родителем'; END IF;
  IF EXISTS (WITH RECURSIVE children AS (
    SELECT id FROM ar_categories WHERE parent_id=NEW.id
    UNION ALL SELECT c.id FROM ar_categories c JOIN children p ON c.parent_id=p.id
  ) SELECT 1 FROM children WHERE id=NEW.parent_id) THEN RAISE EXCEPTION 'Цикл в дереве категорий'; END IF;
  WITH RECURSIVE parents AS (
    SELECT id,parent_id,1 depth FROM ar_categories WHERE id=NEW.parent_id
    UNION ALL SELECT c.id,c.parent_id,p.depth+1 FROM ar_categories c JOIN parents p ON c.id=p.parent_id
  ) SELECT coalesce(max(depth),0) INTO parent_depth FROM parents;
  WITH RECURSIVE children AS (
    SELECT id,1 depth FROM ar_categories WHERE parent_id=NEW.id
    UNION ALL SELECT c.id,p.depth+1 FROM ar_categories c JOIN children p ON c.parent_id=p.id
  ) SELECT coalesce(max(depth),0) INTO subtree_height FROM children;
  IF parent_depth+1+subtree_height>3 THEN RAISE EXCEPTION 'Допустимы только три уровня: раздел, категория, подкатегория'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_category_guard BEFORE INSERT OR UPDATE OF parent_id ON ar_categories FOR EACH ROW EXECUTE FUNCTION ar_category_guard();

CREATE FUNCTION ar_catalog_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ar_skus' AND (SELECT kind FROM ar_products WHERE id=NEW.product_id) <> 'single' THEN
    RAISE EXCEPTION 'SKU может принадлежать только отдельному товару';
  ELSIF TG_TABLE_NAME='ar_bundle_components' THEN
    IF (SELECT kind FROM ar_products WHERE id=NEW.bundle_id) <> 'bundle' THEN RAISE EXCEPTION 'Состав можно задать только комплекту'; END IF;
  ELSIF TG_TABLE_NAME='ar_products' THEN
    IF NEW.kind='bundle' AND EXISTS(SELECT 1 FROM ar_skus WHERE product_id=NEW.id) THEN RAISE EXCEPTION 'Товар с SKU нельзя превратить в комплект'; END IF;
    IF NEW.kind='single' AND EXISTS(SELECT 1 FROM ar_bundle_components WHERE bundle_id=NEW.id) THEN RAISE EXCEPTION 'Комплект с составом нельзя превратить в отдельный товар'; END IF;
    NEW.updated_at=now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_product_guard BEFORE UPDATE ON ar_products FOR EACH ROW EXECUTE FUNCTION ar_catalog_kind_guard();
CREATE TRIGGER ar_sku_guard BEFORE INSERT OR UPDATE OF product_id ON ar_skus FOR EACH ROW EXECUTE FUNCTION ar_catalog_kind_guard();
CREATE TRIGGER ar_bundle_guard BEFORE INSERT OR UPDATE ON ar_bundle_components FOR EACH ROW EXECUTE FUNCTION ar_catalog_kind_guard();

CREATE FUNCTION ar_attribute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  SELECT value_type INTO expected FROM ar_attributes WHERE id=NEW.attribute_id;
  IF num_nonnulls(NEW.value_id,NEW.text_value,NEW.number_value,NEW.boolean_value)<>1 THEN RAISE EXCEPTION 'Заполните ровно одно значение характеристики'; END IF;
  IF (expected='select' AND NEW.value_id IS NULL) OR (expected='text' AND NEW.text_value IS NULL) OR
     (expected='number' AND NEW.number_value IS NULL) OR (expected='boolean' AND NEW.boolean_value IS NULL) THEN
    RAISE EXCEPTION 'Значение не соответствует типу характеристики';
  END IF;
  IF NEW.value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ar_attribute_values WHERE id=NEW.value_id AND attribute_id=NEW.attribute_id) THEN
    RAISE EXCEPTION 'Выбрано значение другой характеристики';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_product_attribute_guard BEFORE INSERT OR UPDATE ON ar_product_attributes FOR EACH ROW EXECUTE FUNCTION ar_attribute_guard();
CREATE TRIGGER ar_sku_attribute_guard BEFORE INSERT OR UPDATE ON ar_sku_attributes FOR EACH ROW EXECUTE FUNCTION ar_attribute_guard();

CREATE FUNCTION ar_fitment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sku_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ar_skus WHERE id=NEW.sku_id AND product_id=NEW.product_id) THEN RAISE EXCEPTION 'Исполнение принадлежит другому товару'; END IF;
  IF NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ar_vehicle_versions WHERE id=NEW.version_id AND vehicle_id=NEW.vehicle_id) THEN RAISE EXCEPTION 'Модификация принадлежит другому автомобилю'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_fitment_guard BEFORE INSERT OR UPDATE ON ar_fitment FOR EACH ROW EXECUTE FUNCTION ar_fitment_guard();

CREATE FUNCTION ar_slug_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity text;
BEGIN
  entity=CASE WHEN TG_TABLE_NAME='ar_products' THEN 'product' ELSE 'category' END;
  IF EXISTS(SELECT 1 FROM ar_slug_history WHERE entity_type=entity AND old_slug=NEW.slug AND entity_id<>NEW.id) THEN
    RAISE EXCEPTION 'Адрес принадлежит истории другого объекта';
  END IF;
  IF TG_OP='UPDATE' AND OLD.slug<>NEW.slug THEN
    INSERT INTO ar_slug_history(entity_type,entity_id,old_slug) VALUES(entity,NEW.id,OLD.slug)
    ON CONFLICT(entity_type,old_slug) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_product_slug BEFORE INSERT OR UPDATE OF slug ON ar_products FOR EACH ROW EXECUTE FUNCTION ar_slug_guard();
CREATE TRIGGER ar_category_slug BEFORE INSERT OR UPDATE OF slug ON ar_categories FOR EACH ROW EXECUTE FUNCTION ar_slug_guard();

CREATE FUNCTION ar_bundle_offer(bundle uuid) RETURNS TABLE(price_kopecks bigint, available integer)
LANGUAGE sql STABLE AS $$
  SELECT round(sum(s.price_kopecks::numeric*c.quantity)*(1-p.discount_percent/100))::bigint,
    min(floor((coalesce(st.on_hand,0)-coalesce(st.reserved,0))::numeric/c.quantity))::integer
  FROM ar_products p JOIN ar_bundle_components c ON c.bundle_id=p.id JOIN ar_skus s ON s.id=c.sku_id
  LEFT JOIN ar_stock st ON st.sku_id=s.id WHERE p.id=bundle AND p.kind='bundle' GROUP BY p.id;
$$;

CREATE FUNCTION ar_effective_sku(sku uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'sku_id',s.id,'product_id',p.id,'price_kopecks',s.price_kopecks,
  'attributes',coalesce((SELECT jsonb_object_agg(attribute_id,value) FROM (
    SELECT attribute_id,jsonb_build_object('value_id',value_id,'text',text_value,'number',number_value,'boolean',boolean_value) value
    FROM ar_product_attributes a WHERE product_id=p.id AND NOT EXISTS(SELECT 1 FROM ar_sku_attributes b WHERE b.sku_id=s.id AND b.attribute_id=a.attribute_id)
    UNION ALL SELECT attribute_id,jsonb_build_object('value_id',value_id,'text',text_value,'number',number_value,'boolean',boolean_value) FROM ar_sku_attributes WHERE sku_id=s.id
  ) v),'{}'::jsonb),
  'media',CASE WHEN s.media_mode='inherit' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('file_id',file_id,'alt',alt) ORDER BY sort) FROM ar_product_media WHERE product_id=p.id),'[]'::jsonb)
    ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('file_id',file_id,'alt',alt) ORDER BY sort) FROM ar_sku_media WHERE sku_id=s.id),'[]'::jsonb) END,
  'fitment',coalesce((SELECT jsonb_agg(to_jsonb(f)-'id') FROM ar_fitment f WHERE f.product_id=p.id AND ((s.fitment_mode='inherit' AND f.sku_id IS NULL) OR (s.fitment_mode='replace' AND f.sku_id=s.id))),'[]'::jsonb)
 ) FROM ar_skus s JOIN ar_products p ON p.id=s.product_id WHERE s.id=sku;
$$;

-- CMS has catalog DML, but does not own domain tables or the stock ledger.
GRANT SELECT,INSERT,UPDATE,DELETE ON ar_categories,ar_vehicles,ar_vehicle_versions,ar_attributes,ar_attribute_values,
 ar_category_attributes,ar_products,ar_product_categories,ar_packages,ar_skus,ar_product_media,ar_sku_media,
 ar_product_attributes,ar_sku_attributes,ar_fitment,ar_bundle_components TO ar_cms;
GRANT SELECT,INSERT ON ar_slug_history TO ar_cms;
GRANT SELECT ON ar_stock TO ar_cms;
GRANT SELECT ON ar_categories,ar_vehicles,ar_vehicle_versions,ar_attributes,ar_attribute_values,
 ar_category_attributes,ar_products,ar_product_categories,ar_packages,ar_skus,ar_product_media,ar_sku_media,
 ar_product_attributes,ar_sku_attributes,ar_fitment,ar_bundle_components,ar_stock,ar_slug_history TO ar_app;
-- The reader will use an authenticated CMS policy; no blanket SQL catalog grant yet.
REVOKE ALL ON ar_stock FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ar_bundle_offer(uuid),ar_effective_sku(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ar_bundle_offer(uuid),ar_effective_sku(uuid) TO ar_cms,ar_app;
