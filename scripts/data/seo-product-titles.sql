-- Reviewed content correction for the two public cards found in the 15.10 SEO audit.
-- Run transactionally with ar_migrator only during an authorized content publication.
-- Stable SKU IDs identify the cards; never overwrite an owner's existing manual title.
UPDATE ar_products p SET seo_title=v.title
FROM (VALUES
 ('4606fd6e-f55f-5230-a6c9-fad372d04fc0'::uuid,'kozyrek-pod-planshet-9-dyuymov-v-stile-priora-2-dlya-priora-1-chernyy-glyanets','Козырёк под планшет 9 дюймов для Приоры 1 в стиле Приоры 2 — чёрный глянец'),
 ('fad7e444-92e4-5be5-a808-66fc1588ab71'::uuid,'kozyrek-pod-planshet-9-dyuymov-v-stile-priora-2-dlya-priora-1-chernyy-matovyy','Козырёк под планшет 9 дюймов для Приоры 1 в стиле Приоры 2 — чёрный матовый')
) AS v(sku_id,slug,title), ar_skus s
WHERE s.id=v.sku_id AND s.product_id=p.id AND p.slug=v.slug
 AND p.name='Козырек под планшет 9 дюймов в стиле Приора 2 Для Приора 1'
 AND NULLIF(btrim(p.seo_title),'') IS NULL;
