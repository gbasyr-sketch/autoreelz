import {requireUnpurgedProduct} from './product-purges.ts';
import {withProductThumbnails} from './manager-product-thumbnails.ts';
import {canonicalProductId} from './product-merges.ts';
import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {StoreError,uuid} from './errors.ts';
import {hash,canonical,idempotent} from './security.ts';
import {live} from './product-editor.ts';
import type {ProductLifecycle} from '../lib/product-lifecycle.ts';
async function inspect(c:PoolClient,id:string){
 await requireUnpurgedProduct(c,id);
 if(await canonicalProductId(c,id)!==id)throw new StoreError('PRODUCT_MERGED','Товар объединён с общей карточкой. Откройте её для редактирования.',409);
 const product=(await c.query('SELECT * FROM ar_products WHERE id=$1',[id])).rows[0],draft=(await c.query('SELECT * FROM ar_product_editor_drafts WHERE id=$1',[id])).rows[0];
 if(!product&&!draft?.payload&&!draft?.archived_at)throw new StoreError('NOT_FOUND','Товар или черновик не найден.',404);
 const bundles=(await c.query("SELECT DISTINCT p.id,p.name FROM ar_bundle_components b JOIN ar_skus s ON s.id=b.sku_id JOIN ar_products p ON p.id=b.bundle_id WHERE s.product_id=$1 AND p.status='published' ORDER BY p.name,p.id",[id])).rows;
 const stock=(await c.query('SELECT coalesce(sum(st.on_hand),0)::int on_hand,coalesce(sum(st.reserved),0)::int reserved FROM ar_stock st JOIN ar_skus s ON s.id=st.sku_id WHERE s.product_id=$1',[id])).rows[0];
 const current=product?await live(c,id):null;
 const components=product?.kind==='bundle'?(await c.query('SELECT sku_id,quantity FROM ar_bundle_components WHERE bundle_id=$1 ORDER BY sku_id',[id])).rows:[];
 const archived=product?product.status==='archived':!!draft?.archived_at;
 const view:ProductLifecycle={id,name:product?.name||draft?.payload?.name||'Без названия',kind:product?.kind??draft?.payload?.kind??'single',archived,token:hash(canonical({product:product??null,liveHash:current?.hash??null,components,version:draft?.version??0,archived:!!draft?.archived_at,bundles})),hasLive:!!product,hasDraft:!!draft?.payload,bundles,onHand:stock.on_hand,reserved:stock.reserved};
 return{view,product,draft,current};
}
export const readProductLifecycle=(input:unknown)=>transaction(async c=>(await inspect(c,uuid(input))).view);
export const archivedProducts=()=>transaction(async c=>withProductThumbnails(c,(await c.query(`SELECT p.id,p.name,p.slug,p.status,p.kind,p.is_demo,p.category_id,ARRAY(SELECT pc.category_id FROM ar_product_categories pc WHERE pc.product_id=p.id) category_ids FROM ar_products p WHERE p.status='archived' AND NOT EXISTS(SELECT 1 FROM ar_product_purges x WHERE x.product_id=p.id) AND NOT EXISTS(SELECT 1 FROM ar_product_merges m WHERE m.source_product_id=p.id)
 UNION ALL SELECT d.id,coalesce(nullif(d.payload->>'name',''),'Без названия'),'','archived',coalesce(d.payload->>'kind','single'),coalesce(d.payload->'isDemo'='true'::jsonb,false),NULLIF(d.payload->>'categoryId','')::uuid,ARRAY[]::uuid[] FROM ar_product_editor_drafts d WHERE d.archived_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ar_product_purges x WHERE x.product_id=d.id) AND NOT EXISTS(SELECT 1 FROM ar_products p WHERE p.id=d.id) ORDER BY name,id`)).rows));
export async function changeProductLifecycle(actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.id),action=body.action;if(action!=='archive'&&action!=='restore'&&action!=='purge')throw new StoreError('PRODUCT_ACTION','Неизвестное действие.');
 if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new StoreError('PRODUCT_CONFLICT','Обновите сведения о товаре перед действием.',409);
 return transaction(c=>idempotent(c,`product-lifecycle:${actor.id}`,body.idempotencyKey,{id,action,token:body.token},async()=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-lifecycle-global',0))");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-editor:'||$1,0))",[id]);
  await c.query('SELECT id FROM ar_product_editor_drafts WHERE id=$1 FOR UPDATE',[id]);
  await c.query('LOCK TABLE ar_products,ar_skus,ar_packages,ar_product_media,ar_sku_media,ar_product_attributes,ar_sku_attributes,ar_fitment,ar_product_recommendations,ar_bundle_components IN SHARE ROW EXCLUSIVE MODE');
  const {view,product,draft,current:before}=await inspect(c,id);
  if(view.token!==body.token)throw new StoreError('PRODUCT_CONFLICT','Товар изменился. Закройте окно и проверьте сведения заново.',409);
  if(action==='purge'){
   if(!view.archived)throw new StoreError('PRODUCT_NOT_ARCHIVED','Окончательно удалить можно только товар из раздела «Удалённые».',409);
   await c.query('INSERT INTO ar_product_purges(product_id,actor_id) VALUES($1,$2)',[id,actor.id]);
   await c.query('UPDATE ar_product_editor_drafts SET payload=NULL,infographic=NULL,version=version+1,updated_at=now() WHERE id=$1',[id]);
   await c.query("INSERT INTO ar_product_editor_events(product_id,actor_id,action) VALUES($1,$2,'purge')",[id,actor.id]);
   return{id,action};
  }
  if(view.archived===(action==='archive'))return{id,action,unchanged:true};
  if(action==='archive'&&view.bundles.length)throw new StoreError('PRODUCT_IN_BUNDLE','Товар входит в опубликованный комплект. Сначала измените состав или уберите комплект с сайта.',409);
  if(product)await c.query('UPDATE ar_products SET status=$2 WHERE id=$1',[id,action==='archive'?'archived':'draft']);
  const after=product?await live(c,id):null;
  // Only rebase a current draft across our own status change; preserve a pre-existing CMS conflict.
  const baseHash=draft?.payload&&draft.base_hash!==before?.hash?draft.base_hash:after?.hash??null;
  await c.query(`INSERT INTO ar_product_editor_drafts(id,version,base_hash,payload,actor_id,archived_at) VALUES($1,1,$2,NULL,$3,$4)
   ON CONFLICT(id) DO UPDATE SET version=ar_product_editor_drafts.version+1,base_hash=excluded.base_hash,actor_id=excluded.actor_id,archived_at=excluded.archived_at,updated_at=now()`,[id,baseHash,actor.id,!product&&action==='archive'?new Date():null]);
  await c.query('INSERT INTO ar_product_editor_events(product_id,actor_id,action) VALUES($1,$2,$3)',[id,actor.id,action]);
  return{id,action};
 }),false);
}

async function trashSnapshot(c:PoolClient){
 const rows=(await c.query(`SELECT p.id FROM ar_products p WHERE p.status='archived'
 AND NOT EXISTS(SELECT 1 FROM ar_product_merges m WHERE m.source_product_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM ar_product_purges x WHERE x.product_id=p.id)
 UNION SELECT d.id FROM ar_product_editor_drafts d WHERE d.archived_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM ar_products p WHERE p.id=d.id)
 AND NOT EXISTS(SELECT 1 FROM ar_product_purges x WHERE x.product_id=d.id) ORDER BY id`)).rows;
 const items=[];for(const row of rows)items.push((await inspect(c,row.id)).view);
 return{count:items.length,token:hash(canonical(items.map(x=>({id:x.id,token:x.token})))),items};
}
export const readProductTrash=()=>transaction(trashSnapshot);
export async function purgeProductTrash(actor:{id:string},body:Record<string,unknown>){
 if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new StoreError('PRODUCT_CONFLICT','Обновите список удалённых товаров.',409);
 return transaction(c=>idempotent(c,`product-trash:${actor.id}`,body.idempotencyKey,{token:body.token},async()=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-lifecycle-global',0))");
  const initial=await trashSnapshot(c);
  for(const item of initial.items){await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-editor:'||$1,0))",[item.id]);await c.query('SELECT id FROM ar_product_editor_drafts WHERE id=$1 FOR UPDATE',[item.id]);}
  await c.query('LOCK TABLE ar_products,ar_skus,ar_packages,ar_product_media,ar_sku_media,ar_product_attributes,ar_sku_attributes,ar_fitment,ar_product_recommendations,ar_bundle_components IN SHARE ROW EXCLUSIVE MODE');
  const current=await trashSnapshot(c);
  if(current.token!==body.token)throw new StoreError('PRODUCT_CONFLICT','Список или товары изменились. Закройте окно и проверьте список заново.',409);
  for(const item of current.items){
   await c.query('INSERT INTO ar_product_purges(product_id,actor_id) VALUES($1,$2)',[item.id,actor.id]);
   await c.query('UPDATE ar_product_editor_drafts SET payload=NULL,infographic=NULL,version=version+1,updated_at=now() WHERE id=$1',[item.id]);
   await c.query("INSERT INTO ar_product_editor_events(product_id,actor_id,action) VALUES($1,$2,'purge')",[item.id,actor.id]);
  }
  return{action:'purge-all',count:current.count};
 }),false);
}
