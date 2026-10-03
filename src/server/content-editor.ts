import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {StoreError,uuid,integer,multilineText} from './errors.ts';
import {hash,idempotent} from './security.ts';
import {lockImageLibrary} from './product-image-library.ts';
import {contentHtml,safeRichHtml,contentImageIds,previewContentHtml} from './rich-content.ts';
import {normalizeVideoUrl} from '../lib/content.ts';
import {emptyContent,type ContentData,type ContentKind,type ContentState} from '../lib/content-editor.ts';
const table={page:'ar_pages',article:'ar_articles'} as const;
export function contentKind(input:unknown):ContentKind{if(input!=='page'&&input!=='article')throw new StoreError('CONTENT_KIND','Выберите статьи или страницы.');return input;}
const str=(v:unknown,label:string,max=250)=>multilineText(v,label,0,max);
const optionalId=(v:unknown)=>v===''?'':uuid(v);
const ids=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)throw new StoreError('CONTENT_INPUT','Слишком много связанных записей.');const values=v.map(uuid);if(new Set(values).size!==values.length)throw new StoreError('CONTENT_INPUT','Связанные записи не должны повторяться.');return values;};
function date(v:unknown){const s=str(v,'Дата',40);if(!s)return'';if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw new StoreError('CONTENT_DATE','Проверьте дату и время.');const [year,month,day]=s.slice(0,10).split('-').map(Number);if(year!<1900||year!>2100||new Date(Date.UTC(year!,month!-1,day!)).toISOString().slice(0,10)!==s.slice(0,10))throw new StoreError('CONTENT_DATE','Проверьте дату и время.');return new Date(s).toISOString();}
export function normalizeContent(input:unknown):ContentData{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new StoreError('CONTENT_INPUT','Не удалось прочитать материал.');const d=input as Record<string,unknown>,body=str(d.body,'Текст',100000);
 for(const key of ['isDemo','isLegal','isDraftText'])if(typeof d[key]!=='boolean')throw new StoreError('CONTENT_INPUT','Проверьте признаки материала.');
 const sort=str(d.sort,'Порядок',8);if(!/^-?\d{1,6}$/.test(sort))throw new StoreError('CONTENT_INPUT','Порядок должен быть целым числом.');const duration=str(d.videoDuration,'Длительность видео',10);if(duration&&(!/^\d+$/.test(duration)||+duration<1||+duration>86400))throw new StoreError('CONTENT_VIDEO','Длительность видео — от 1 до 86400 секунд.');
 return{title:str(d.title,'Заголовок'),slug:str(d.slug,'Адрес',160),body:safeRichHtml(body),summary:str(d.summary,'Краткое описание',3000),seoTitle:str(d.seoTitle,'SEO-заголовок'),metaDescription:str(d.metaDescription,'Описание поиска',2000),categoryId:optionalId(d.categoryId),tagIds:ids(d.tagIds,30),productIds:ids(d.productIds,20),coverId:optionalId(d.coverId),videoUrl:str(d.videoUrl,'Ссылка на видео',2048),videoTitle:str(d.videoTitle,'Название видео'),videoDescription:str(d.videoDescription,'Описание видео',4000),videoThumbnailId:optionalId(d.videoThumbnailId),videoUploadedAt:date(d.videoUploadedAt),videoDuration:duration,publishedAt:date(d.publishedAt),isDemo:d.isDemo as boolean,isLegal:d.isLegal as boolean,isDraftText:d.isDraftText as boolean,sort};
}
const conflict=()=>new StoreError('CONTENT_CONFLICT','Материал изменён в другой вкладке или CMS. Загрузите сохранённое и сравните изменения; при необходимости сбросьте черновик.',409);
export async function liveContent(c:PoolClient,kind:ContentKind,id:string){
 const row=(await c.query(`SELECT * FROM ${table[kind]} WHERE id=$1`,[id])).rows[0];if(!row)return null;
 const tags=kind==='article'?(await c.query('SELECT tag_id FROM ar_article_tags WHERE article_id=$1 ORDER BY tag_id',[id])).rows:[],products=kind==='article'?(await c.query('SELECT product_id FROM ar_article_products WHERE article_id=$1 ORDER BY product_id',[id])).rows:[];
 const data:ContentData={...emptyContent(),title:row.title,slug:row.slug,body:contentHtml(row.body,row.body_format,kind),summary:kind==='page'?row.summary:row.excerpt,seoTitle:row.seo_title??'',metaDescription:row.meta_description??'',categoryId:row.category_id??'',tagIds:tags.map(x=>x.tag_id),productIds:products.map(x=>x.product_id),coverId:row.cover_file_id??'',videoUrl:row.video_url??'',videoTitle:row.video_title??'',videoDescription:row.video_description??'',videoThumbnailId:row.video_thumbnail_id??'',videoUploadedAt:row.video_uploaded_at?new Date(row.video_uploaded_at).toISOString():'',videoDuration:row.video_duration_seconds?String(row.video_duration_seconds):'',publishedAt:row.published_at?new Date(row.published_at).toISOString():'',isDemo:row.is_demo??false,isLegal:row.is_legal??false,isDraftText:row.is_draft_text??false,sort:String(row.sort??0)};
 return{row,data,hash:hash(JSON.stringify({row,tags,products}))};
}
export async function readContentEditor(kind:ContentKind,id:string):Promise<ContentState>{return transaction(async c=>{const current=await liveContent(c,kind,id),draft=(await c.query('SELECT * FROM ar_content_editor_drafts WHERE kind=$1 AND id=$2',[kind,id])).rows[0];return{kind,id,version:draft?.version??0,baseHash:draft?.payload?draft.base_hash:current?.hash??null,data:draft?.payload?normalizeContent(draft.payload):current?.data??emptyContent(),hasDraft:!!draft?.payload,live:!!current,status:current?.row.status??(draft?.archived_at?'archived':'new'),liveSlug:current?.row.slug??null};});}
export async function contentOptions(){return transaction(async c=>({categories:(await c.query('SELECT id,name,slug,status FROM ar_blog_categories ORDER BY sort,name,id')).rows,tags:(await c.query('SELECT id,name,slug FROM ar_blog_tags ORDER BY name,id')).rows,products:(await c.query("SELECT id,name,status FROM ar_products WHERE status<>'archived' ORDER BY name,id")).rows}));}
export async function listContent(kind:ContentKind){return transaction(async c=>(await c.query(`SELECT coalesce(t.id,d.id) id,coalesce(nullif(d.payload->>'title',''),t.title,'Без названия') title,coalesce(t.slug,'') slug,coalesce(t.status,CASE WHEN d.archived_at IS NOT NULL THEN 'archived' ELSE 'draft' END) status,d.payload IS NOT NULL "hasDraft",greatest(t.updated_at,d.updated_at) "updatedAt",${kind==='article'?'t.published_at':'NULL::timestamptz'} "publishedAt" FROM ${table[kind]} t FULL JOIN (SELECT * FROM ar_content_editor_drafts WHERE kind=$1) d ON d.id=t.id WHERE t.id IS NOT NULL OR d.payload IS NOT NULL OR d.archived_at IS NOT NULL ORDER BY greatest(t.updated_at,d.updated_at) DESC NULLS LAST,coalesce(t.id,d.id)`,[kind])).rows);}
async function validateReferences(c:PoolClient,kind:ContentKind,d:ContentData,publish:boolean,id:string){
 const images=[...new Set([...contentImageIds(d.body),...(kind==='article'?[d.coverId,d.videoThumbnailId].filter(Boolean):[])])];
 if(images.length>50)throw new StoreError('CONTENT_IMAGES','В одном материале может быть до 50 фотографий.');
 const available=(await c.query("SELECT id FROM directus_files f WHERE id=ANY($1::uuid[]) AND type IN ('image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml') AND NOT EXISTS(SELECT 1 FROM ar_product_image_trash t WHERE t.file_id=f.id)",[images])).rows;
 if(images.some(file=>!available.some(a=>a.id===file)))throw new StoreError('CONTENT_IMAGES','Некоторые фотографии удалены или недоступны. Восстановите их в библиотеке или уберите из материала.');
 if(!publish)return;
 if(!d.title||!d.body.replace(/<[^>]*>/g,'').replace(/&(?:nbsp|#160);/g,' ').trim()&&!images.length)throw new StoreError('CONTENT_FIELDS','Укажите заголовок и добавьте текст или фотографию.');
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)||kind==='page'&&d.slug==='account')throw new StoreError('CONTENT_SLUG','Укажите свободный адрес из латинских букв, цифр и дефисов.');
 const claimed=(await c.query('SELECT entity_id FROM ar_content_slugs WHERE entity_type=$1 AND slug=$2',[kind,d.slug])).rows[0];if(claimed&&claimed.entity_id!==id)throw new StoreError('CONTENT_SLUG','Этот адрес уже использован другим материалом.');
 if(kind==='article'){
  if(!d.categoryId||!(await c.query("SELECT 1 FROM ar_blog_categories WHERE id=$1 AND status='published'",[d.categoryId])).rowCount)throw new StoreError('CONTENT_CATEGORY','Выберите опубликованную категорию статьи.');
  if((await c.query('SELECT id FROM ar_blog_tags WHERE id=ANY($1::uuid[])',[d.tagIds])).rowCount!==d.tagIds.length)throw new StoreError('CONTENT_TAGS','Проверьте теги: один из них уже удалён.');
  if((await c.query("SELECT id FROM ar_products WHERE id=ANY($1::uuid[]) AND status<>'archived'",[d.productIds])).rowCount!==d.productIds.length)throw new StoreError('CONTENT_PRODUCTS','Проверьте связанные товары.');
  if(d.videoUrl&&!normalizeVideoUrl(d.videoUrl))throw new StoreError('CONTENT_VIDEO','Используйте ссылку на RUTUBE или разрешённую ссылку плеера VK Видео.');
 }
}
export async function previewContent(kind:ContentKind,input:unknown){const data=normalizeContent(input);return{html:previewContentHtml(data.body),title:data.title,summary:data.summary,coverUrl:kind==='article'&&data.coverId?'/api/manager/product-image?id='+data.coverId:null,video:normalizeVideoUrl(data.videoUrl)};}
export async function saveContentEditor(actor:{id:string},input:Record<string,unknown>){
 const kind=contentKind(input.kind),id=uuid(input.id),version=integer(input.version,'Версия',0),baseHash=input.baseHash===null?null:str(input.baseHash,'Версия материала',64),action=input.action;
 if(!['draft','publish','discard','archive','restore'].includes(String(action)))throw new StoreError('CONTENT_ACTION','Неизвестное действие.');
 const data=normalizeContent(input.data);
 try{return await transaction(c=>idempotent(c,`content-editor:${actor.id}`,input.idempotencyKey,{kind,id,version,baseHash,action,data},async()=>{
  await lockImageLibrary(c);await c.query("SELECT pg_advisory_xact_lock(hashtextextended('content-editor:'||$1||':'||$2,0))",[kind,id]);
  const prior=(await c.query('SELECT * FROM ar_content_editor_drafts WHERE kind=$1 AND id=$2 FOR UPDATE',[kind,id])).rows[0];if((prior?.version??0)!==version)throw conflict();
  if(action!=='draft'&&action!=='discard')await c.query('LOCK TABLE ar_pages,ar_articles,ar_article_tags,ar_article_products IN SHARE ROW EXCLUSIVE MODE');
  const current=await liveContent(c,kind,id);if(action!=='discard'&&((current?.hash??null)!==baseHash||prior?.payload&&prior.base_hash!==baseHash))throw conflict();
  const archived=current?current.row.status==='archived':!!prior?.archived_at;if(archived&&!['restore','discard'].includes(String(action)))throw new StoreError('CONTENT_ARCHIVED','Сначала восстановите материал в черновик.',409);
  if(['draft','publish'].includes(String(action)))await validateReferences(c,kind,data,action==='publish',id);
  let nextHash=baseHash,payload=action==='draft'?data:action==='archive'||action==='restore'?prior?.payload??null:null,archivedAt=prior?.archived_at??null;
  if(action==='publish'){
   if(kind==='page')await c.query(`INSERT INTO ar_pages(id,title,slug,body,body_format,summary,seo_title,meta_description,is_legal,is_draft_text,sort,status) VALUES($1,$2,$3,$4,'html',$5,$6,$7,$8,$9,$10,'published') ON CONFLICT(id) DO UPDATE SET title=excluded.title,slug=excluded.slug,body=excluded.body,body_format='html',summary=excluded.summary,seo_title=excluded.seo_title,meta_description=excluded.meta_description,is_legal=excluded.is_legal,is_draft_text=excluded.is_draft_text,sort=excluded.sort,status='published'`,[id,data.title,data.slug,data.body,data.summary,data.seoTitle||null,data.metaDescription||null,data.isLegal,data.isDraftText,Number(data.sort)]);
   else{
    await c.query(`INSERT INTO ar_articles(id,title,slug,body,body_format,excerpt,category_id,seo_title,meta_description,cover_file_id,video_url,video_title,video_description,video_thumbnail_id,video_uploaded_at,video_duration_seconds,is_demo,published_at,status) VALUES($1,$2,$3,$4,'html',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'published') ON CONFLICT(id) DO UPDATE SET title=excluded.title,slug=excluded.slug,body=excluded.body,body_format='html',excerpt=excluded.excerpt,category_id=excluded.category_id,seo_title=excluded.seo_title,meta_description=excluded.meta_description,cover_file_id=excluded.cover_file_id,video_url=excluded.video_url,video_title=excluded.video_title,video_description=excluded.video_description,video_thumbnail_id=excluded.video_thumbnail_id,video_uploaded_at=excluded.video_uploaded_at,video_duration_seconds=excluded.video_duration_seconds,is_demo=excluded.is_demo,published_at=excluded.published_at,status='published'`,[id,data.title,data.slug,data.body,data.summary,data.categoryId,data.seoTitle||null,data.metaDescription||null,data.coverId||null,data.videoUrl||null,data.videoTitle||null,data.videoDescription||null,data.videoThumbnailId||null,data.videoUploadedAt||null,data.videoDuration?Number(data.videoDuration):null,data.isDemo,data.publishedAt||current?.row.published_at||new Date().toISOString()]);
    await c.query('DELETE FROM ar_article_tags WHERE article_id=$1',[id]);for(const tag of data.tagIds)await c.query('INSERT INTO ar_article_tags(article_id,tag_id) VALUES($1,$2)',[id,tag]);
    await c.query('DELETE FROM ar_article_products WHERE article_id=$1',[id]);for(const product of data.productIds)await c.query('INSERT INTO ar_article_products(article_id,product_id) VALUES($1,$2)',[id,product]);
   }
   nextHash=(await liveContent(c,kind,id))!.hash;archivedAt=null;
  }else if(action==='discard')nextHash=current?.hash??null;
  else if(action==='archive'||action==='restore'){
   if(!current&&!prior?.payload)throw new StoreError('NOT_FOUND','Материал не найден.',404);
   if(current){await c.query(`UPDATE ${table[kind]} SET status=$2 WHERE id=$1`,[id,action==='archive'?'archived':'draft']);nextHash=(await liveContent(c,kind,id))!.hash;}else archivedAt=action==='archive'?new Date():null;
  }
  await c.query(`INSERT INTO ar_content_editor_drafts(kind,id,version,base_hash,payload,actor_id,archived_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,base_hash=excluded.base_hash,payload=excluded.payload,actor_id=excluded.actor_id,archived_at=excluded.archived_at,updated_at=now()`,[kind,id,version+1,nextHash,payload?JSON.stringify(payload):null,actor.id,archivedAt]);
  await c.query('INSERT INTO ar_content_editor_events(kind,content_id,actor_id,action) VALUES($1,$2,$3,$4)',[kind,id,actor.id,action]);return{kind,id,version:version+1,action};
 }),false);}catch(error){if(error instanceof StoreError)throw error;if(['23505','23503','23514','P0001'].includes((error as {code?:string}).code??''))throw new StoreError('CONTENT_RULE','Не удалось сохранить: проверьте адрес, связанные записи и поля материала.',409);throw error;}
}
export async function createContentTaxonomy(actor:{id:string},input:Record<string,unknown>){
 const kind=input.taxonomy;if(kind!=='category'&&kind!=='tag')throw new StoreError('CONTENT_KIND','Выберите категорию или тег.');const name=str(input.name,'Название',100),slug=str(input.slug,'Адрес',160);if(!name||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))throw new StoreError('CONTENT_FIELDS','Укажите название и адрес латиницей.');
 return transaction(c=>idempotent(c,`content-taxonomy:${actor.id}`,input.idempotencyKey,{kind,name,slug},async()=>{const id=randomUUID();try{await c.query(`INSERT INTO ${kind==='category'?'ar_blog_categories':'ar_blog_tags'}(id,name,slug${kind==='category'?',status':''}) VALUES($1,$2,$3${kind==='category'?",'published'":''})`,[id,name,slug]);}catch{throw new StoreError('CONTENT_SLUG','Категория или тег с таким адресом уже существует.');}await c.query('INSERT INTO ar_content_editor_events(kind,content_id,actor_id,action) VALUES($1,$2,$3,\'create\')',[kind==='category'?'blog_category':'blog_tag',id,actor.id]);return{id,name,slug};}),false);
}
