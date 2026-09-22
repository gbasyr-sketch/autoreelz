import{generateLocalDescription}from'./adapters/description.ts';
import type {PoolClient} from 'pg';
import type {DescriptionDraft,GenerationProduct} from '../lib/management-types.ts';
import {query,transaction} from './db.ts';
import {requireLocalTest} from './config.ts';
import {StoreError,uuid,text,multilineText,iso} from './errors.ts';
import {idempotent,canonical,hash,sign} from './security.ts';
function productView(r:Record<string,any>):GenerationProduct{return{id:r.id,name:r.name,isDemo:r.is_demo,description:r.description??'',metaDescription:r.meta_description??'',seoTitle:r.seo_title??''};}
export async function generationProducts(){return(await query('SELECT id,name,is_demo,description,meta_description,seo_title FROM ar_products ORDER BY name LIMIT 1000')).rows.map(productView);}
async function inputs(c:PoolClient,id:string,lock=false){
 const p=(await c.query(`SELECT * FROM ar_products WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];if(!p)throw new StoreError('NOT_FOUND','Товар не найден.',404);
 const category=(await c.query('SELECT name FROM ar_categories WHERE id=$1',[p.category_id])).rows[0]?.name??'';
 const variants=(await c.query('SELECT id,article,name,status,price_rubles,media_mode,fitment_mode FROM ar_skus WHERE product_id=$1 ORDER BY id',[id])).rows;
 const attributes=(await c.query(`SELECT a.name, a.unit, v.label, x.text_value, x.number_value, x.boolean_value FROM ar_product_attributes x JOIN ar_attributes a ON a.id=x.attribute_id LEFT JOIN ar_attribute_values v ON v.id=x.value_id WHERE x.product_id=$1 ORDER BY a.id`,[id])).rows;
 const components=(await c.query('SELECT s.article,s.name,b.quantity FROM ar_bundle_components b JOIN ar_skus s ON s.id=b.sku_id WHERE b.bundle_id=$1 ORDER BY s.id',[id])).rows;
 const fitment=(await c.query('SELECT * FROM ar_fitment WHERE product_id=$1 ORDER BY id',[id])).rows;
 return{product:p,category,variants,attributes,components,fitment};
}

function draftView(r:Record<string,any>):DescriptionDraft{return{id:r.id,productId:r.product_id,description:r.description,metaDescription:r.meta_description,state:r.state,createdAt:iso(r.created_at)!,sourceFingerprint:r.source_fingerprint};}
async function rate(actor:string){
 await transaction(async c=>{
  const r=await c.query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+interval '1 hour' ELSE ar_rate_limits.reset_at END WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<20 RETURNING id`,[sign('description:'+actor)]);
  if(!r.rowCount)throw new StoreError('RATE_LIMIT','Лимит генераций — 20 в час. Повторите позже.',429);
 });
}
export async function generateDescription(actor:{id:string},body:Record<string,unknown>){
 requireLocalTest();const id=uuid(body.productId),fail=body.simulateFailure===true;
 const requestKey=uuid(body.idempotencyKey),payloadHash=hash(canonical({id,fail}));
 const cached=(await query('SELECT request_hash,result FROM ar_command_results WHERE scope=$1 AND request_key=$2',[`generate:${actor.id}`,requestKey])).rows[0];
 if(cached){if(cached.request_hash!==payloadHash)throw new StoreError('KEY_REUSED','Этот запрос уже использован с другими данными.',409);if(cached.result!==null)return cached.result as DescriptionDraft;}
 await rate(actor.id);
 return transaction(c=>idempotent(c,`generate:${actor.id}`,body.idempotencyKey,{id,fail},async()=>{
  const data=await inputs(c,id);
  if(fail)throw new StoreError('GENERATOR_UNAVAILABLE','Тестовый генератор временно недоступен. Текст товара сохранён без изменений.',503);
  const result=generateLocalDescription({name:data.product.name,kind:data.product.kind,isDemo:data.product.is_demo,category:data.category,variants:data.variants.map(v=>({name:v.name,article:v.article})),components:data.components.map(c=>({name:c.name,article:c.article,quantity:c.quantity})),attributes:data.attributes.map(a=>({name:a.name,value:String(a.label??a.text_value??a.number_value??(a.boolean_value===true?'да':a.boolean_value===false?'нет':''))+(a.unit?' '+a.unit:'')}))});
  const row=(await c.query('INSERT INTO ar_description_drafts(product_id,actor_id,source_fingerprint,description,meta_description) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,hash(canonical(data)),result.description,result.metaDescription])).rows[0];
  return draftView(row);
 }));
}
export async function applyDescription(actor:{id:string},body:Record<string,unknown>){
 requireLocalTest();const draftId=uuid(body.draftId),description=multilineText(body.description,'Описание',10,10000),metaDescription=text(body.metaDescription,'Meta description',10,320);
 return transaction(c=>idempotent(c,`apply-description:${actor.id}`,body.idempotencyKey,{draftId,description,metaDescription},async()=>{
  const draft=(await c.query('SELECT * FROM ar_description_drafts WHERE id=$1 AND actor_id=$2 FOR UPDATE',[draftId,actor.id])).rows[0];
  if(!draft)throw new StoreError('NOT_FOUND','Черновик не найден.',404);
  if(draft.state!=='preview')throw new StoreError('DRAFT_APPLIED','Черновик уже применён. Создайте новый.',409);
  const current=await inputs(c,draft.product_id,true);
  if(hash(canonical(current))!==draft.source_fingerprint)throw new StoreError('PRODUCT_CHANGED','Товар изменился в CMS. Сгенерируйте новый черновик, чтобы сохранить правки.',409);
  const row=(await c.query('UPDATE ar_products SET description=$2,meta_description=$3,updated_at=now() WHERE id=$1 RETURNING *',[draft.product_id,description,metaDescription])).rows[0];
  await c.query("UPDATE ar_description_drafts SET state='applied',description=$2,meta_description=$3,applied_at=now() WHERE id=$1",[draftId,description,metaDescription]);
  return{ok:true,product:productView(row)};
 }));
}
