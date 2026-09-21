CREATE OR REPLACE FUNCTION ar_catalog_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
BEGIN
  IF TG_TABLE_NAME='ar_skus' THEN
    SELECT kind INTO parent_kind FROM ar_products WHERE id=NEW.product_id FOR UPDATE;
    IF parent_kind <> 'single' THEN RAISE EXCEPTION 'SKU может принадлежать только отдельному товару'; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.product_id<>OLD.product_id THEN RAISE EXCEPTION 'Товар-владелец SKU фиксируется при создании'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='ar_bundle_components' THEN
    SELECT kind INTO parent_kind FROM ar_products WHERE id=NEW.bundle_id FOR UPDATE;
    IF parent_kind <> 'bundle' THEN RAISE EXCEPTION 'Состав можно задать только комплекту'; END IF;
  ELSIF TG_TABLE_NAME='ar_products' THEN
    IF NEW.kind='bundle' AND EXISTS(SELECT 1 FROM ar_skus WHERE product_id=NEW.id) THEN RAISE EXCEPTION 'Товар с SKU нельзя превратить в комплект'; END IF;
    IF NEW.kind='single' AND EXISTS(SELECT 1 FROM ar_bundle_components WHERE bundle_id=NEW.id) THEN RAISE EXCEPTION 'Комплект с составом нельзя превратить в отдельный товар'; END IF;
    NEW.updated_at=now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ar_version_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_id<>OLD.vehicle_id THEN RAISE EXCEPTION 'Автомобиль модификации фиксируется при создании'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_version_parent_guard BEFORE UPDATE ON ar_vehicle_versions FOR EACH ROW EXECUTE FUNCTION ar_version_parent_guard();

-- Lock attribute definitions while inserting a dependent value/assignment.
CREATE OR REPLACE FUNCTION ar_attribute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text; value_parent uuid;
BEGIN
  SELECT value_type INTO expected FROM ar_attributes WHERE id=NEW.attribute_id FOR SHARE;
  IF num_nonnulls(NEW.value_id,NEW.text_value,NEW.number_value,NEW.boolean_value)<>1 THEN RAISE EXCEPTION 'Заполните ровно одно значение характеристики'; END IF;
  IF (expected='select' AND NEW.value_id IS NULL) OR (expected='text' AND NEW.text_value IS NULL) OR
     (expected='number' AND NEW.number_value IS NULL) OR (expected='boolean' AND NEW.boolean_value IS NULL) THEN RAISE EXCEPTION 'Значение не соответствует типу характеристики'; END IF;
  IF NEW.value_id IS NOT NULL THEN
    SELECT attribute_id INTO value_parent FROM ar_attribute_values WHERE id=NEW.value_id FOR SHARE;
    IF value_parent IS DISTINCT FROM NEW.attribute_id THEN RAISE EXCEPTION 'Выбрано значение другой характеристики'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION ar_attribute_value_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type text;
BEGIN
  SELECT value_type INTO parent_type FROM ar_attributes WHERE id=NEW.attribute_id FOR SHARE;
  IF parent_type<>'select' THEN RAISE EXCEPTION 'Справочник значений доступен только для типа «Значение из справочника»'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_attribute_value_parent_guard BEFORE INSERT OR UPDATE ON ar_attribute_values FOR EACH ROW EXECUTE FUNCTION ar_attribute_value_parent_guard();

-- One unique namespace for current AND historical slugs prevents rename races.
CREATE TABLE ar_slug_registry (
  entity_type text NOT NULL,
  slug text NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY(entity_type,slug)
);
INSERT INTO ar_slug_registry SELECT 'product',slug,id FROM ar_products;
INSERT INTO ar_slug_registry SELECT 'category',slug,id FROM ar_categories;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ar_slug_history h JOIN ar_slug_registry r ON r.entity_type=h.entity_type AND r.slug=h.old_slug WHERE r.entity_id<>h.entity_id) THEN RAISE EXCEPTION 'Conflicting historical slug owners'; END IF;
END $$;
INSERT INTO ar_slug_registry SELECT entity_type,old_slug,entity_id FROM ar_slug_history ON CONFLICT DO NOTHING;
GRANT SELECT,INSERT ON ar_slug_registry TO ar_cms;
CREATE OR REPLACE FUNCTION ar_slug_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity text;
BEGIN
 entity=CASE WHEN TG_TABLE_NAME='ar_products' THEN 'product' ELSE 'category' END;
 INSERT INTO ar_slug_registry(entity_type,slug,entity_id) VALUES(entity,NEW.slug,NEW.id) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM ar_slug_registry WHERE entity_type=entity AND slug=NEW.slug AND entity_id=NEW.id) THEN RAISE EXCEPTION 'Адрес занят текущей или исторической страницей'; END IF;
 IF TG_OP='UPDATE' AND OLD.slug<>NEW.slug THEN
  INSERT INTO ar_slug_history(entity_type,entity_id,old_slug) VALUES(entity,NEW.id,OLD.slug) ON CONFLICT(entity_type,old_slug) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
