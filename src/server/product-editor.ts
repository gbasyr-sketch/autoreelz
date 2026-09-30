import {normalizeInfographic,infographicFileIds} from '../lib/product-infographic.ts';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {StoreError,uuid,integer} from './errors.ts';
import {hash,idempotent} from './security.ts';
import {stockMove} from './orders.ts';
import {lockStock} from './pricing.ts';
import {parseRublesInput} from '../lib/money.ts';
import {emptyProduct,emptyPackage,emptyVariant,publicationIssues,hasPackage,packageValues,type EditorData,type EditorOptions,type EditorState,type EditorAttribute,type EditorPhoto,type EditorFitment} from '../lib/product-editor.ts';

type Row=Record<string,any>;
export class EditorError extends StoreError {issues:{path:string;message:string}[];constructor(issues:{path:string;message:string}[]){super('PRODUCT_FIELDS','Проверьте отмеченные поля.');this.issues=issues;}}
const conflict=()=>new StoreError('PRODUCT_CONFLICT','Товар или черновик изменён в другой вкладке или CMS. Обновите форму и сравните изменения перед сохранением.',409);
const object=(value:unknown):Row=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new StoreError('PRODUCT_INPUT','Не удалось прочитать данные товара.');return value;};
const string=(value:unknown,max=250)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new StoreError('PRODUCT_INPUT','Недопустимое или слишком длинное поле товара.');return value.trim();};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max)throw new StoreError('PRODUCT_INPUT','Слишком много элементов или неверный формат списка.');return value;};
const choice=(value:unknown,values:string[])=>{if(typeof value!=='string'||!values.includes(value))throw new StoreError('PRODUCT_INPUT','Неизвестное значение поля товара.');return value;};
const optionalId=(v:unknown)=>v===''?'':uuid(v);
function photos(value:unknown):EditorPhoto[]{return list(value,12).map(v=>{const x=object(v);return{id:uuid(x.id),alt:string(x.alt,500)};});}
function attributes(value:unknown):EditorAttribute[]{return list(value,40).map(v=>{const x=object(v);return{attributeId:optionalId(x.attributeId),value:string(x.value,2000)};});}
function fitment(value:unknown):EditorFitment[]{return list(value,30).map(v=>{const x=object(v);return{vehicleId:optionalId(x.vehicleId),versionId:optionalId(x.versionId),yearFrom:string(x.yearFrom,4),yearTo:string(x.yearTo,4),ac:choice(x.ac,['unknown','yes','no','any']),state:choice(x.state,['unknown','compatible','incompatible']),note:string(x.note,2000)};});}
export function normalizeProduct(value:unknown):EditorData{
 const x=object(value);if(typeof x.isDemo!=='boolean')throw new StoreError('PRODUCT_INPUT','Проверьте признак демонстрационного товара.');
 let infographic;try{infographic=normalizeInfographic(x.infographic);}catch(e){throw new StoreError('INFOGRAPHIC_INPUT',e instanceof Error?e.message:'Неверный макет.');}
 return{...(x.recommendedProductIds!==undefined?{recommendedProductIds:list(x.recommendedProductIds,8).map(uuid)}:{}),...(x.infographic!==undefined?{infographic}:{}),name:string(x.name),slug:string(x.slug,160),categoryId:optionalId(x.categoryId),description:string(x.description,12000),seoTitle:string(x.seoTitle,250),metaDescription:string(x.metaDescription,2000),isDemo:x.isDemo,photos:photos(x.photos),attributes:attributes(x.attributes),fitment:fitment(x.fitment),variants:list(x.variants,20).map(value=>{const v=object(value),p=object(v.package);return{id:uuid(v.id),name:string(v.name),article:string(v.article,160),price:string(v.price,40),status:choice(v.status,['draft','published','archived']) as 'draft'|'published'|'archived',package:{weightG:string(p.weightG,15),lengthCm:string(p.lengthCm,15),widthCm:string(p.widthCm,15),heightCm:string(p.heightCm,15)},initialStock:string(v.initialStock,10),stockReason:string(v.stockReason,500),photos:photos(v.photos),mediaMode:choice(v.mediaMode,['inherit','replace']) as 'inherit'|'replace',attributes:attributes(v.attributes),fitment:fitment(v.fitment),fitmentMode:choice(v.fitmentMode,['inherit','replace']) as 'inherit'|'replace'};})};
}
export async function productEditorOptions():Promise<EditorOptions>{return transaction(async c=>{
 const categories=(await c.query('SELECT id,name,parent_id,status FROM ar_categories ORDER BY sort,name')).rows;
 const attrs=(await c.query('SELECT id,name,value_type,unit FROM ar_attributes ORDER BY sort,name')).rows,values=(await c.query('SELECT id,attribute_id,label FROM ar_attribute_values ORDER BY sort,label')).rows,links=(await c.query('SELECT category_id,attribute_id FROM ar_category_attributes')).rows;
 const vehicles=(await c.query('SELECT id,name FROM ar_vehicles ORDER BY name')).rows,versions=(await c.query('SELECT id,vehicle_id,name FROM ar_vehicle_versions ORDER BY name')).rows;
 return {products:(await c.query("SELECT id,name,status FROM ar_products WHERE status<>'archived' ORDER BY name,id")).rows,categories:categories.map(r=>({id:r.id,name:r.name,parentId:r.parent_id,status:r.status})),attributes:attrs.map(r=>({id:r.id,name:r.name,type:r.value_type,unit:r.unit,categoryIds:links.filter(l=>l.attribute_id===r.id).map(l=>l.category_id),values:values.filter(v=>v.attribute_id===r.id).map(v=>({id:v.id,label:v.label}))})),vehicles:vehicles.map(v=>({id:v.id,name:v.name,versions:versions.filter(r=>r.vehicle_id===v.id).map(r=>({id:r.id,name:r.name}))}))};
 });}
export async function live(c:PoolClient,id:string){
 const product=(await c.query('SELECT * FROM ar_products WHERE id=$1',[id])).rows[0];if(!product)return null;
 if(product.kind!=='single')throw new StoreError('PRODUCT_BUNDLE','Комплекты пока редактируются в CMS: их цена и наличие зависят от состава.',409);
 const skus=(await c.query('SELECT * FROM ar_skus WHERE product_id=$1 ORDER BY sort,id',[id])).rows;
 const media=(await c.query('SELECT * FROM ar_product_media WHERE product_id=$1 ORDER BY sort,id',[id])).rows;
 const skuMedia=(await c.query('SELECT m.* FROM ar_sku_media m JOIN ar_skus s ON s.id=m.sku_id WHERE s.product_id=$1 ORDER BY m.sort,m.id',[id])).rows;
 const attrs=(await c.query('SELECT * FROM ar_product_attributes WHERE product_id=$1 ORDER BY id',[id])).rows;
 const skuAttrs=(await c.query('SELECT a.* FROM ar_sku_attributes a JOIN ar_skus s ON s.id=a.sku_id WHERE s.product_id=$1 ORDER BY a.id',[id])).rows;
 const fits=(await c.query('SELECT * FROM ar_fitment WHERE product_id=$1 ORDER BY id',[id])).rows;
 const packs=(await c.query('SELECT * FROM ar_packages WHERE id=ANY($1::uuid[]) ORDER BY id',[skus.flatMap(s=>s.package_id?[s.package_id]:[])])).rows;
 const recommendations=(await c.query('SELECT recommended_id,sort FROM ar_product_recommendations WHERE product_id=$1 ORDER BY sort,recommended_id',[id])).rows;
 const raw={product,skus,media,skuMedia,attrs,skuAttrs,fits,packs,...(recommendations.length?{recommendations}:{})};
 const image=(m:Row):EditorPhoto=>({id:m.file_id,alt:m.alt});
 const attr=(a:Row):EditorAttribute=>({attributeId:a.attribute_id,value:String(a.value_id??a.text_value??a.number_value??a.boolean_value??'')});
 const fit=(f:Row):EditorFitment=>({vehicleId:f.vehicle_id,versionId:f.version_id??'',yearFrom:String(f.year_from??''),yearTo:String(f.year_to??''),ac:f.air_conditioning,state:f.state,note:f.note??''});
 const data:EditorData={recommendedProductIds:recommendations.map(r=>r.recommended_id),name:product.name,slug:product.slug,categoryId:product.category_id,description:product.description??'',seoTitle:product.seo_title??'',metaDescription:product.meta_description??'',isDemo:product.is_demo,photos:media.map(image),attributes:attrs.map(attr),fitment:fits.filter(f=>!f.sku_id).map(fit),variants:skus.map(s=>{const p=packs.find(p=>p.id===s.package_id);return{...emptyVariant(s.id),name:s.name,article:s.article,price:s.price_rubles,status:s.status,package:p?{weightG:String(p.weight_g),lengthCm:String(p.length_mm/10),widthCm:String(p.width_mm/10),heightCm:String(p.height_mm/10)}:emptyPackage(),photos:skuMedia.filter(m=>m.sku_id===s.id).map(image),mediaMode:s.media_mode,attributes:skuAttrs.filter(a=>a.sku_id===s.id).map(attr),fitment:fits.filter(f=>f.sku_id===s.id).map(fit),fitmentMode:s.fitment_mode};})};
 return{data,raw,hash:hash(JSON.stringify(raw))};
}
export async function readProductEditor(input:unknown):Promise<EditorState>{const id=uuid(input);return transaction(async c=>{
 const current=await live(c,id),draft=(await c.query('SELECT * FROM ar_product_editor_drafts WHERE id=$1',[id])).rows[0];
 const stock=(await c.query('SELECT st.sku_id,st.on_hand,st.reserved FROM ar_stock st JOIN ar_skus s ON s.id=st.sku_id WHERE s.product_id=$1',[id])).rows;
 return{archived:current?current.raw.product.status==='archived':!!draft?.archived_at,liveStatus:current?.raw.product.status,id,version:draft?.version??0,baseHash:draft?.payload?draft.base_hash:current?.hash??null,data:{...(draft?.payload??current?.data??{...emptyProduct(),variants:[emptyVariant(randomUUID())]}),infographic:draft?.payload&&Object.hasOwn(draft.payload,'infographic')?draft.payload.infographic:draft?.infographic??null},hasDraft:!!draft?.payload,live:!!current,liveSlug:current?.data.slug,existingSkuIds:current?.data.variants.map(v=>v.id)??[],stock:Object.fromEntries(stock.map(s=>[s.sku_id,{onHand:s.on_hand,reserved:s.reserved}]))};
 });}
export async function editorDrafts(){return transaction(async c=>(await c.query("SELECT id,coalesce(nullif(payload->>'name',''),'Без названия') name,updated_at FROM ar_product_editor_drafts WHERE payload IS NOT NULL AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM ar_products p WHERE p.id=ar_product_editor_drafts.id AND p.status='archived') ORDER BY updated_at DESC LIMIT 200")).rows,false);}

async function checkReferences(c:PoolClient,id:string,actorId:string,data:EditorData,current:Awaited<ReturnType<typeof live>>){
 const issues:{path:string;message:string}[]=[];
 const related=data.recommendedProductIds;if(related&&(new Set(related).size!==related.length||related.includes(id)||(await c.query("SELECT id FROM ar_products WHERE id=ANY($1::uuid[]) AND status<>'archived'",[related])).rowCount!==related.length))issues.push({path:'recommendedProductIds',message:'Выберите до восьми разных доступных товаров, кроме текущего.'});
 const cat=(await c.query(`WITH RECURSIVE tree AS (SELECT id,parent_id,status FROM ar_categories WHERE id=$1 UNION ALL SELECT c.id,c.parent_id,c.status FROM ar_categories c JOIN tree t ON c.id=t.parent_id) SELECT * FROM tree`,[data.categoryId])).rows;
 if(!cat.length||cat.some(c=>c.status!=='published'))issues.push({path:'categoryId',message:'Выберите опубликованную категорию; её родительские разделы тоже должны быть опубликованы.'});
 const reserved=(await c.query("SELECT entity_id FROM ar_slug_registry WHERE entity_type='product' AND slug=$1",[data.slug])).rows[0];if(reserved&&reserved.entity_id!==id)issues.push({path:'slug',message:'Этот адрес уже использован. Укажите другой.'});
 const mediaIds=[...new Set([...data.photos,...data.variants.flatMap(v=>v.photos)].map(p=>p.id))];
 const allowed=new Set([...(current?.data.photos??[]),...(current?.data.variants.flatMap(v=>v.photos)??[])].map(p=>p.id));
 for(const r of (await c.query('SELECT file_id FROM ar_product_editor_uploads WHERE draft_id=$1 AND actor_id=$2 AND ready',[id,actorId])).rows)allowed.add(r.file_id);
 const files=(await c.query("SELECT id FROM directus_files WHERE id=ANY($1::uuid[]) AND type IN ('image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml')",[mediaIds])).rows;
 if(mediaIds.some(id=>!allowed.has(id)||!files.some(f=>f.id===id)))issues.push({path:'photos',message:'Некоторые фотографии недоступны. Загрузите их в этой форме заново.'});
 const skuIds=new Set<string>();for(const[i,v]of data.variants.entries()){
  if(skuIds.has(v.id))issues.push({path:'variants',message:'Исполнения не должны дублироваться.'});skuIds.add(v.id);
  const used=(await c.query('SELECT id,product_id FROM ar_skus WHERE lower(article)=lower($1) OR id=$2',[v.article,v.id])).rows;
  if(used.some(s=>s.id!==v.id||s.product_id!==id))issues.push({path:`variants.${i}.article`,message:'Артикул уже принадлежит другому исполнению.'});
 }
 if(current?.data.variants.some(v=>!skuIds.has(v.id)))issues.push({path:'variants',message:'Существующее исполнение нельзя удалить из формы. Выберите для него «Архив».'});
 const defs=(await c.query('SELECT id,value_type FROM ar_attributes')).rows;
 const verifyAttrs=async(rows:EditorAttribute[],path:string)=>{const ids=new Set<string>();for(const[a,entry]of rows.entries()){const def=defs.find(d=>d.id===entry.attributeId);let valid=!!def&&!ids.has(entry.attributeId);ids.add(entry.attributeId);if(def?.value_type==='select')valid=valid&&!!(await c.query('SELECT 1 FROM ar_attribute_values WHERE id=$1 AND attribute_id=$2',[uuid(entry.value),entry.attributeId])).rowCount;else if(def?.value_type==='boolean')valid=valid&&['true','false'].includes(entry.value);else if(def?.value_type==='number')valid=valid&&/^-?\d+(?:[.,]\d+)?$/.test(entry.value)&&Number.isFinite(Number(entry.value.replace(',','.')));else if(def?.value_type==='text')valid=valid&&!!entry.value;if(!valid)issues.push({path:`${path}.${a}.value`,message:'Проверьте значение характеристики и отсутствие повторов.'});}};
 const verifyFit=async(rows:EditorFitment[],path:string)=>{for(const[i,f]of rows.entries()){if(!(await c.query('SELECT 1 FROM ar_vehicles WHERE id=$1',[f.vehicleId])).rowCount||f.versionId&&!(await c.query('SELECT 1 FROM ar_vehicle_versions WHERE id=$1 AND vehicle_id=$2',[f.versionId,f.vehicleId])).rowCount)issues.push({path:`${path}.${i}.vehicleId`,message:'Модификация должна принадлежать выбранному автомобилю.'});}};
 await verifyAttrs(data.attributes,'attributes');await verifyFit(data.fitment,'fitment');for(const[i,v]of data.variants.entries()){await verifyAttrs(v.attributes,`variants.${i}.attributes`);await verifyFit(v.fitment,`variants.${i}.fitment`);}
 if(issues.length)throw new EditorError(issues);
}
async function writeRelations(c:PoolClient,id:string,sku:string|null,images:EditorPhoto[],attrs:EditorAttribute[],fits:EditorFitment[]){
 const table=sku?'ar_sku_media':'ar_product_media',key=sku?'sku_id':'product_id',parent=sku??id;
 await c.query(`DELETE FROM ${table} WHERE ${key}=$1`,[parent]);for(const[i,p]of images.entries())await c.query(`INSERT INTO ${table}(${key},file_id,alt,sort) VALUES($1,$2,$3,$4)`,[parent,p.id,p.alt,i]);
 const attrTable=sku?'ar_sku_attributes':'ar_product_attributes';await c.query(`DELETE FROM ${attrTable} WHERE ${key}=$1`,[parent]);
 for(const a of attrs){const type=(await c.query('SELECT value_type FROM ar_attributes WHERE id=$1',[a.attributeId])).rows[0].value_type;await c.query(`INSERT INTO ${attrTable}(${key},attribute_id,value_id,text_value,number_value,boolean_value) VALUES($1,$2,$3,$4,$5,$6)`,[parent,a.attributeId,type==='select'?a.value:null,type==='text'?a.value:null,type==='number'?a.value.replace(',','.'):null,type==='boolean'?a.value==='true':null]);}
 await c.query('DELETE FROM ar_fitment WHERE product_id=$1 AND sku_id IS NOT DISTINCT FROM $2::uuid',[id,sku]);
 for(const f of fits)await c.query('INSERT INTO ar_fitment(product_id,sku_id,vehicle_id,version_id,year_from,year_to,air_conditioning,state,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,sku,f.vehicleId,f.versionId||null,f.yearFrom?Number(f.yearFrom):null,f.yearTo?Number(f.yearTo):null,f.ac,f.state,f.note]);
}
export async function saveProductEditor(actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.id),version=integer(body.version,'Версия',0),data=normalizeProduct(body.data),action=choice(body.action,['draft','publish','discard']);
 const baseHash=body.baseHash===null?null:string(body.baseHash,64);
 try{return await transaction(c=>idempotent(c,`product-editor:${actor.id}`,body.idempotencyKey,{id,version,baseHash,data,action},async()=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('product-editor:'||$1,0))",[id]);
  const prior=(await c.query('SELECT * FROM ar_product_editor_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];if((prior?.version??0)!==version)throw conflict();
  // READ COMMITTED after these locks sees CMS changes committed before publication.
  if(action==='publish')await c.query('LOCK TABLE ar_products,ar_skus,ar_packages,ar_product_media,ar_sku_media,ar_product_attributes,ar_sku_attributes,ar_fitment,ar_product_recommendations IN SHARE ROW EXCLUSIVE MODE');
  const current=await live(c,id);
  if(current?current.raw.product.status==='archived':!!prior?.archived_at)throw new StoreError('PRODUCT_ARCHIVED','Сначала восстановите товар из удалённых в черновик.',409);
  if(action!=='discard'&&((current?.hash??null)!==baseHash||(prior?.payload&&prior.base_hash!==baseHash)))throw conflict();
  if(action!=='discard'){
   const ids=infographicFileIds(data.infographic);
   if(ids.length){
    const permitted=(await c.query(`SELECT file_id FROM ar_product_editor_uploads WHERE draft_id=$1 AND actor_id=$2 AND ready UNION SELECT file_id FROM ar_product_media WHERE product_id=$1 UNION SELECT m.file_id FROM ar_sku_media m JOIN ar_skus s ON s.id=m.sku_id WHERE s.product_id=$1`,[id,actor.id])).rows.map(r=>r.file_id);
    if(prior?.actor_id===actor.id)permitted.push(...infographicFileIds(prior.infographic));
    if(ids.some(file=>!permitted.includes(file)))throw new StoreError('INFOGRAPHIC_PHOTO','Фотографии макета недоступны. Выберите их заново.',403);
   }
  }
  let nextHash=baseHash;
  if(action==='discard')nextHash=current?.hash??null;
  if(action==='publish'){
   const issues=publicationIssues(data,current?.data.variants.map(v=>v.id)??[]);if(issues.length)throw new EditorError(issues);
   await checkReferences(c,id,actor.id,data,current);
   if(current)await c.query("UPDATE ar_products SET name=$2,slug=$3,category_id=$4,description=$5,seo_title=$6,meta_description=$7,is_demo=$8,status='published' WHERE id=$1",[id,data.name,data.slug,data.categoryId,data.description,data.seoTitle||null,data.metaDescription||null,data.isDemo]);
   else await c.query("INSERT INTO ar_products(id,name,slug,category_id,description,seo_title,meta_description,is_demo,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'published')",[id,data.name,data.slug,data.categoryId,data.description,data.seoTitle||null,data.metaDescription||null,data.isDemo]);
   if(data.recommendedProductIds!==undefined){await c.query('DELETE FROM ar_product_recommendations WHERE product_id=$1',[id]);for(const [sort,target] of data.recommendedProductIds.entries())await c.query('INSERT INTO ar_product_recommendations(product_id,recommended_id,sort) VALUES($1,$2,$3)',[id,target,sort]);}
   await writeRelations(c,id,null,data.photos,data.attributes,data.fitment);
   for(const[i,v]of data.variants.entries()){
    const old=current?.raw.skus.find(s=>s.id===v.id);let packageId:string|null=null;
    if(hasPackage(v.package)){
     const p=packageValues(v.package),priorPackage=current?.raw.packs.find(p=>p.id===old?.package_id);
     if(priorPackage&&priorPackage.weight_g===p.weightG&&priorPackage.length_mm===p.lengthMm&&priorPackage.width_mm===p.widthMm&&priorPackage.height_mm===p.heightMm)packageId=priorPackage.id;
     else{packageId=randomUUID();await c.query('INSERT INTO ar_packages(id,name,weight_g,length_mm,width_mm,height_mm) VALUES($1,$2,$3,$4,$5,$6)',[packageId,data.name+' · '+v.name,p.weightG,p.lengthMm,p.widthMm,p.heightMm]);}
    }
    const values=[v.id,id,v.article,v.name,parseRublesInput(v.price),v.status,packageId,i,v.mediaMode,v.fitmentMode];
    if(old)await c.query('UPDATE ar_skus SET article=$3,name=$4,price_rubles=$5,status=$6,package_id=$7,sort=$8,media_mode=$9,fitment_mode=$10 WHERE id=$1 AND product_id=$2',values);
    else await c.query('INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status,package_id,sort,media_mode,fitment_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',values);
    await writeRelations(c,id,v.id,v.photos,v.attributes,v.fitment);
    if(!old){const need=new Map([[v.id,Number(v.initialStock)]]);await lockStock(c,need);if(Number(v.initialStock)>0)await stockMove(c,null,need,`product-initial:${v.id}`,1,0,v.stockReason,actor.id);}
   }
   nextHash=(await live(c,id))!.hash;
  }
  await c.query(`INSERT INTO ar_product_editor_drafts(id,version,base_hash,payload,actor_id) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET version=excluded.version,base_hash=excluded.base_hash,payload=excluded.payload,actor_id=excluded.actor_id,updated_at=now()`,[id,version+1,nextHash,action==='draft'?JSON.stringify(data):null,actor.id]);
  if(action!=='discard'&&data.infographic!==undefined)await c.query('UPDATE ar_product_editor_drafts SET infographic=$2::jsonb WHERE id=$1',[id,data.infographic===null?null:JSON.stringify(data.infographic)]);
  await c.query('INSERT INTO ar_product_editor_events(product_id,actor_id,action) VALUES($1,$2,$3)',[id,actor.id,action]);
  return{id,version:version+1,action,slug:data.slug};
 }),false);}catch(error){if(error instanceof StoreError)throw error;const code=(error as{code?:string}).code;if(['23505','23503','23514','P0001'].includes(code??''))throw new StoreError('PRODUCT_RULE','Не удалось сохранить: проверьте уникальность адреса/артикулов, связи и значения характеристик.',409);throw error;}
}
