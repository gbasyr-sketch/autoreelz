import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {StoreError,uuid} from './errors.ts';

export const libraryTypes="('image/jpeg','image/png','image/webp','image/avif','image/gif')";
// Serialize editor saves with trash commands, including photos referenced only in JSON.
export async function lockImageLibrary(c:PoolClient){await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-image-library',0))");}
export async function availableLibraryImages(c:PoolClient,ids:string[]){return(await c.query(`SELECT f.id FROM directus_files f WHERE f.id=ANY($1::uuid[]) AND f.type IN ${libraryTypes} AND NOT EXISTS(SELECT 1 FROM ar_product_image_trash t WHERE t.file_id=f.id)`,[ids])).rows.map(r=>r.id as string);}
// Conservative text matching also protects recipes, archived drafts and inline content images.
export const imageUsedSQL=`EXISTS(SELECT 1 FROM ar_product_media m WHERE m.file_id=f.id)
 OR EXISTS(SELECT 1 FROM ar_sku_media m WHERE m.file_id=f.id)
 OR EXISTS(SELECT 1 FROM ar_product_editor_drafts d WHERE position(f.id::text in coalesce(d.payload::text,'')||coalesce(d.infographic::text,''))>0)
 OR EXISTS(SELECT 1 FROM ar_articles a WHERE a.cover_file_id=f.id OR a.video_thumbnail_id=f.id OR position(f.id::text in a.body)>0)
 OR EXISTS(SELECT 1 FROM ar_pages p WHERE position(f.id::text in p.body)>0)`;
export function libraryQuery(params:URLSearchParams){
 const q=(params.get('q')??'').trim(),raw=params.get('page')??'1',scope=params.get('scope')??'active';
 if(q.length>120||!/^\d{1,5}$/.test(raw)||Number(raw)<1||!['active','trash'].includes(scope))throw new StoreError('LIBRARY_QUERY','Проверьте поиск и номер страницы.');
 return{q,page:Number(raw),scope};
}
export async function listLibraryImages(params:URLSearchParams){
 const{q,page,scope}=libraryQuery(params),limit=24;
 return transaction(async c=>{
  const where=`f.type IN ${libraryTypes} AND ${scope==='trash'?'':'NOT '}EXISTS(SELECT 1 FROM ar_product_image_trash t WHERE t.file_id=f.id)
   AND ($1='' OR position(lower($1) in lower(coalesce(f.title,'')))>0 OR EXISTS(
    SELECT 1 FROM ar_products p WHERE (position(lower($1) in lower(p.name))>0 OR EXISTS(SELECT 1 FROM ar_skus s WHERE s.product_id=p.id AND position(lower($1) in lower(s.article))>0))
    AND (EXISTS(SELECT 1 FROM ar_product_media m WHERE m.product_id=p.id AND m.file_id=f.id) OR EXISTS(SELECT 1 FROM ar_sku_media m JOIN ar_skus s ON s.id=m.sku_id WHERE s.product_id=p.id AND m.file_id=f.id))))`;
  const total=Number((await c.query(`SELECT count(*) FROM directus_files f WHERE ${where}`,[q])).rows[0].count);
  const items=(await c.query(`SELECT f.id,coalesce(nullif(f.title,''),'Фото без названия') title,f.width,f.height,(${imageUsedSQL}) used FROM directus_files f WHERE ${where} ORDER BY f.modified_on DESC NULLS LAST,f.id LIMIT $2 OFFSET $3`,[q,limit,(page-1)*limit])).rows;
  return{items,total,page,pages:Math.max(1,Math.ceil(total/limit))};
 });
}
export async function changeLibraryImage(actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.id),action=body.action;if(action!=='trash'&&action!=='restore')throw new StoreError('LIBRARY_ACTION','Неизвестное действие.');
 return transaction(async c=>{
  await lockImageLibrary(c);
  const file=(await c.query(`SELECT f.id,(${imageUsedSQL}) used FROM directus_files f WHERE f.id=$1 AND f.type IN ${libraryTypes}`,[id])).rows[0];
  if(!file)throw new StoreError('PHOTO_NOT_FOUND','Фотография не найдена.',404);
  if(action==='trash'){
   if(file.used)throw new StoreError('PHOTO_IN_USE','Фото используется в товаре, черновике или статье. Сначала уберите его оттуда и сохраните изменения.',409);
   await c.query('INSERT INTO ar_product_image_trash(file_id,actor_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,actor.id]);
  }else await c.query('DELETE FROM ar_product_image_trash WHERE file_id=$1',[id]);
  return{ok:true,id,action};
 },false);
}
