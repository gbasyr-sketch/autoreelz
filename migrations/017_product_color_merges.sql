-- Audit one-off, owner-authorized consolidation while preserving product records and SKU IDs.
CREATE TABLE ar_product_merges (
 source_product_id uuid PRIMARY KEY REFERENCES ar_products(id) ON DELETE RESTRICT,
 target_product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_product_id<>target_product_id)
);
CREATE TABLE ar_product_variant_redirects (
 old_slug text PRIMARY KEY,
 target_product_id uuid NOT NULL REFERENCES ar_products(id) ON DELETE RESTRICT,
 sku_id uuid NOT NULL REFERENCES ar_skus(id) ON DELETE RESTRICT
);
GRANT SELECT ON ar_product_merges,ar_product_variant_redirects TO ar_app;
GRANT SELECT ON ar_product_merges TO ar_cms;

-- Ordinary CMS/editor writes still cannot reparent a SKU. Only the maintenance role,
-- with an explicit persisted source->target authorization, may consolidate one.
CREATE OR REPLACE FUNCTION ar_catalog_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
BEGIN
 IF TG_TABLE_NAME='ar_skus' THEN
  SELECT kind INTO parent_kind FROM ar_products WHERE id=NEW.product_id FOR UPDATE;
  IF parent_kind<>'single' THEN RAISE EXCEPTION 'SKU может принадлежать только отдельному товару'; END IF;
  IF TG_OP='UPDATE' AND NEW.product_id<>OLD.product_id THEN
   IF session_user<>'ar_migrator' THEN RAISE EXCEPTION 'Товар-владелец SKU фиксируется при создании'; END IF;
   IF NOT EXISTS(SELECT 1 FROM ar_product_merges WHERE source_product_id=OLD.product_id AND target_product_id=NEW.product_id) THEN
    RAISE EXCEPTION 'Перенос SKU требует подтверждённого объединения товаров';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='ar_bundle_components' THEN
  SELECT kind INTO parent_kind FROM ar_products WHERE id=NEW.bundle_id FOR UPDATE;
  IF parent_kind<>'bundle' THEN RAISE EXCEPTION 'Состав можно задать только комплекту'; END IF;
 ELSIF TG_TABLE_NAME='ar_products' THEN
  IF NEW.status='published' AND EXISTS(SELECT 1 FROM ar_product_merges WHERE source_product_id=NEW.id) THEN RAISE EXCEPTION 'Товар объединён с общей карточкой'; END IF;
  IF NEW.kind='bundle' AND EXISTS(SELECT 1 FROM ar_skus WHERE product_id=NEW.id) THEN RAISE EXCEPTION 'Товар с SKU нельзя превратить в комплект'; END IF;
  IF NEW.kind='single' AND EXISTS(SELECT 1 FROM ar_bundle_components WHERE bundle_id=NEW.id) THEN RAISE EXCEPTION 'Комплект с составом нельзя превратить в отдельный товар'; END IF;
  NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
