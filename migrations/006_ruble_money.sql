-- Money is stored and calculated as exact decimal RUB. Apply with web/worker/CMS stopped.
-- Every existing amount retains its purchasing value; no stock operation is replayed.
ALTER TABLE ar_skus RENAME COLUMN price_kopecks TO price_rubles;
ALTER TABLE ar_skus ALTER COLUMN price_rubles TYPE numeric(16,2) USING price_rubles::numeric / 100;
ALTER TABLE ar_skus DROP CONSTRAINT ar_skus_price_kopecks_check;
ALTER TABLE ar_skus ADD CONSTRAINT ar_skus_price_rubles_check CHECK(price_rubles BETWEEN 0 AND 90071992547409.91);
ALTER TABLE ar_cart_lines RENAME COLUMN last_price_kopecks TO last_price_rubles;
ALTER TABLE ar_cart_lines ALTER COLUMN last_price_rubles TYPE numeric(16,2) USING last_price_rubles::numeric / 100;
ALTER TABLE ar_orders RENAME COLUMN product_total_kopecks TO product_total_rubles;
ALTER TABLE ar_orders ALTER COLUMN product_total_rubles TYPE numeric(16,2) USING product_total_rubles::numeric / 100;
ALTER TABLE ar_orders RENAME COLUMN shipping_cost_kopecks TO shipping_cost_rubles;
ALTER TABLE ar_orders ALTER COLUMN shipping_cost_rubles TYPE numeric(16,2) USING shipping_cost_rubles::numeric / 100;
ALTER TABLE ar_payments RENAME COLUMN amount_kopecks TO amount_rubles;
ALTER TABLE ar_payments ALTER COLUMN amount_rubles TYPE numeric(16,2) USING amount_rubles::numeric / 100;

-- Convert canonical DTO snapshots and cached command results, including nested components.
CREATE FUNCTION ar_migrate_money_json(value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; entry record; new_key text;
BEGIN
 IF jsonb_typeof(value)='array' THEN
  SELECT coalesce(jsonb_agg(ar_migrate_money_json(element) ORDER BY ordinal),'[]'::jsonb) INTO result
   FROM jsonb_array_elements(value) WITH ORDINALITY AS a(element,ordinal);
  RETURN result;
 ELSIF jsonb_typeof(value)='object' THEN
  result='{}'::jsonb;
  FOR entry IN SELECT * FROM jsonb_each(value) LOOP
   IF entry.key ~ '(Kopecks|_kopecks)$' THEN
    new_key=regexp_replace(regexp_replace(entry.key,'Kopecks$','Rubles'),'_kopecks$','_rubles');
    result=result||jsonb_build_object(new_key,CASE WHEN entry.value='null'::jsonb THEN 'null'::jsonb
     ELSE to_jsonb(((entry.value#>>'{}')::numeric / 100)::numeric(16,2)::text) END);
   ELSE result=result||jsonb_build_object(entry.key,ar_migrate_money_json(entry.value)); END IF;
  END LOOP;
  RETURN result;
 END IF;
 RETURN value;
END $$;

ALTER TABLE ar_orders DISABLE TRIGGER ar_order_snapshot_guard;
UPDATE ar_orders SET items_snapshot=ar_migrate_money_json(items_snapshot);
ALTER TABLE ar_orders ENABLE TRIGGER ar_order_snapshot_guard;
UPDATE ar_cart_quotes SET snapshot=ar_migrate_money_json(snapshot), expires_at=least(expires_at,now());
UPDATE ar_command_results SET result=ar_migrate_money_json(result) WHERE result IS NOT NULL;
-- A pre-migration browser must review a fresh quote in the new denomination.
UPDATE ar_carts SET version=version+1;
DROP FUNCTION ar_migrate_money_json(jsonb);

CREATE OR REPLACE FUNCTION ar_order_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.batch_id,NEW.session_id,NEW.kind,NEW.customer_name,NEW.customer_phone,NEW.customer_email,NEW.delivery_snapshot,NEW.items_snapshot,NEW.product_total_rubles,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.batch_id,OLD.session_id,OLD.kind,OLD.customer_name,OLD.customer_phone,OLD.customer_email,OLD.delivery_snapshot,OLD.items_snapshot,OLD.product_total_rubles,OLD.created_at)
 THEN RAISE EXCEPTION 'Снимок заказа неизменяем'; END IF;
 NEW.updated_at=now();RETURN NEW;
END $$;

DROP FUNCTION ar_bundle_offer(uuid);
CREATE FUNCTION ar_bundle_offer(bundle uuid) RETURNS TABLE(price_rubles numeric, available integer)
LANGUAGE sql STABLE AS $$
 SELECT round(sum(s.price_rubles*c.quantity)*(1-p.discount_percent/100),2),
  min(floor((coalesce(st.on_hand,0)-coalesce(st.reserved,0))::numeric/c.quantity))::integer
 FROM ar_products p JOIN ar_bundle_components c ON c.bundle_id=p.id JOIN ar_skus s ON s.id=c.sku_id
 LEFT JOIN ar_stock st ON st.sku_id=s.id WHERE p.id=bundle AND p.kind='bundle' GROUP BY p.id;
$$;
CREATE OR REPLACE FUNCTION ar_effective_sku(sku uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'sku_id',s.id,'product_id',p.id,'price_rubles',s.price_rubles,
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


REVOKE EXECUTE ON FUNCTION ar_bundle_offer(uuid),ar_effective_sku(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ar_bundle_offer(uuid),ar_effective_sku(uuid) TO ar_cms,ar_app;

-- Preserve owner/editor field settings and saved table layouts across the field rename.
UPDATE directus_fields SET field=replace(field,'_kopecks','_rubles')
 WHERE (collection,field) IN (('ar_skus','price_kopecks'),('ar_orders','product_total_kopecks'),('ar_orders','shipping_cost_kopecks'),('ar_payments','amount_kopecks'));
UPDATE directus_presets SET layout_query=replace(layout_query::text,'_kopecks','_rubles')::json
 WHERE collection IN ('ar_skus','ar_orders','ar_payments') AND layout_query::text LIKE '%_kopecks%';
