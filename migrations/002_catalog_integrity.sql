-- Resolve each trigger row shape before accessing its table-specific fields.
CREATE OR REPLACE FUNCTION ar_catalog_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ar_skus' THEN
    IF (SELECT kind FROM ar_products WHERE id=NEW.product_id) <> 'single' THEN
      RAISE EXCEPTION 'SKU может принадлежать только отдельному товару';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.product_id<>OLD.product_id THEN RAISE EXCEPTION 'Товар-владелец SKU фиксируется при создании'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='ar_bundle_components' THEN
    IF (SELECT kind FROM ar_products WHERE id=NEW.bundle_id) <> 'bundle' THEN RAISE EXCEPTION 'Состав можно задать только комплекту'; END IF;
  ELSIF TG_TABLE_NAME='ar_products' THEN
    IF NEW.kind='bundle' AND EXISTS(SELECT 1 FROM ar_skus WHERE product_id=NEW.id) THEN RAISE EXCEPTION 'Товар с SKU нельзя превратить в комплект'; END IF;
    IF NEW.kind='single' AND EXISTS(SELECT 1 FROM ar_bundle_components WHERE bundle_id=NEW.id) THEN RAISE EXCEPTION 'Комплект с составом нельзя превратить в отдельный товар'; END IF;
    NEW.updated_at=now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ar_attribute_definition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ar_attributes' THEN
    IF NEW.value_type<>OLD.value_type AND (
      EXISTS(SELECT 1 FROM ar_product_attributes WHERE attribute_id=NEW.id) OR
      EXISTS(SELECT 1 FROM ar_sku_attributes WHERE attribute_id=NEW.id) OR
      EXISTS(SELECT 1 FROM ar_attribute_values WHERE attribute_id=NEW.id)
    ) THEN RAISE EXCEPTION 'Нельзя менять тип используемой характеристики'; END IF;
  ELSIF TG_TABLE_NAME='ar_attribute_values' THEN
    IF NEW.attribute_id<>OLD.attribute_id AND (
      EXISTS(SELECT 1 FROM ar_product_attributes WHERE value_id=NEW.id) OR
      EXISTS(SELECT 1 FROM ar_sku_attributes WHERE value_id=NEW.id)
    ) THEN RAISE EXCEPTION 'Нельзя переносить используемое значение в другую характеристику'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_attribute_definition_guard BEFORE UPDATE ON ar_attributes FOR EACH ROW EXECUTE FUNCTION ar_attribute_definition_guard();
CREATE TRIGGER ar_attribute_value_guard BEFORE UPDATE ON ar_attribute_values FOR EACH ROW EXECUTE FUNCTION ar_attribute_definition_guard();
