import type {PoolClient} from 'pg';

// One batched lookup for the list; never make a separate catalog query per row.
export async function withProductThumbnails<T extends {id:string}>(c:PoolClient,rows:T[],preferDraft=false):Promise<(T&{imageId:string|null})[]>{
 if(!rows.length)return[];
 const picks=(await c.query(`SELECT i.id,CASE WHEN $2::boolean OR NOT EXISTS(SELECT 1 FROM ar_products p WHERE p.id=i.id) THEN
  (SELECT f.id FROM ar_product_editor_drafts d JOIN directus_files f ON f.id::text=coalesce(
    d.payload#>>'{photos,0,id}',
    (SELECT v#>>'{photos,0,id}' FROM jsonb_array_elements(coalesce(d.payload->'variants','[]'::jsonb)) v WHERE v#>>'{photos,0,id}' IS NOT NULL LIMIT 1)
   ) WHERE d.id=i.id AND f.type LIKE 'image/%' LIMIT 1) ELSE coalesce(
  (SELECT m.file_id FROM ar_product_media m JOIN directus_files f ON f.id=m.file_id WHERE m.product_id=i.id AND f.type LIKE 'image/%' ORDER BY m.sort,m.id LIMIT 1),
  (SELECT m.file_id FROM ar_skus s JOIN ar_sku_media m ON m.sku_id=s.id JOIN directus_files f ON f.id=m.file_id WHERE s.product_id=i.id AND f.type LIKE 'image/%' ORDER BY s.sort,s.id,m.sort,m.id LIMIT 1)
 ) END image_id FROM unnest($1::uuid[]) i(id)`,[rows.map(r=>r.id),preferDraft])).rows;
 const byId=new Map(picks.map(r=>[r.id,r.image_id]));return rows.map(r=>({...r,imageId:byId.get(r.id)??null}));
}
