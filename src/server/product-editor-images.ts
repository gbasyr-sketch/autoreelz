import {randomUUID} from 'node:crypto';
import {query,transaction} from './db.ts';
import {appConfig} from './config.ts';
import {StoreError,uuid} from './errors.ts';
import {processReviewPhoto,withReviewUpload,assertMultipartOrigin,MAX_PHOTO_BYTES} from './social-photos.ts';
import type {ShopSession} from '../lib/commerce-types.ts';

function cmsCookie(request:Request){const cfg=appConfig();return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cfg.cmsCookie+'='))??'';}
export async function uploadEditorImage(request:Request,session:ShopSession,actor:{id:string}){
 assertMultipartOrigin(request,session);
 const contentType=request.headers.get('Content-Type')??'';
 if(!/^multipart\/form-data\s*;/i.test(contentType)||contentType.length>300)throw new StoreError('CONTENT_TYPE','Ожидается фотография.',415);
 return withReviewUpload(async()=>{
  const limit=MAX_PHOTO_BYTES+65536,reader=request.body?.getReader(),parts:Uint8Array[]=[];let bytes=0;
  if(!reader)throw new StoreError('PHOTO_EMPTY','Выберите фотографию.');
  for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();throw new StoreError('PHOTO_SIZE','Фотография должна быть не больше 10 МБ.',413);}parts.push(value);}
  const form=await new Request(request.url,{method:'POST',headers:{'Content-Type':contentType},body:Buffer.concat(parts)}).formData();
  for(const key of ['id','key','file'])if(form.getAll(key).length!==1)throw new StoreError('PHOTO_FORM','Неверный формат загрузки.');
  const id=uuid(form.get('id')),key=uuid(form.get('key')),file=form.get('file');if(!file||typeof file==='string')throw new StoreError('PHOTO_EMPTY','Выберите фотографию.');
  const photo=await processReviewPhoto(file);
  const claim=await transaction(async c=>{
   await c.query('INSERT INTO ar_product_editor_uploads(file_id,draft_id,actor_id,request_key,digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor_id,request_key) DO NOTHING',[randomUUID(),id,actor.id,key,photo.digest]);
   const row=(await c.query('SELECT * FROM ar_product_editor_uploads WHERE actor_id=$1 AND request_key=$2',[actor.id,key])).rows[0];
   if(row.digest!==photo.digest||row.draft_id!==id)throw new StoreError('PHOTO_KEY','Загрузка уже использована для другого файла.',409);return row;
  },false);
  const cfg=appConfig(),headers={Cookie:cmsCookie(request)};
  // Deterministic CMS ID makes an uncertain upload recoverable without duplicates.
  const probe=await fetch(cfg.cmsBase+'/files/'+claim.file_id+'?fields=id',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!probe.ok){
   if(probe.status!==403&&probe.status!==404)throw new StoreError('PHOTO_CMS','Не удалось проверить фотографию в CMS. Повторите загрузку.',503);
   const body=new FormData();body.append('id',claim.file_id);body.append('title','Фото товара');body.append('file',new Blob([new Uint8Array(photo.data)],{type:'image/webp'}),'product.webp');
   const uploaded=await fetch(cfg.cmsBase+'/files',{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(25000)});
   if(!uploaded.ok){const after=await fetch(cfg.cmsBase+'/files/'+claim.file_id+'?fields=id',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!after.ok)throw new StoreError('PHOTO_CMS','Не удалось завершить загрузку. Повторите её с тем же файлом.',503);}
  }
  await query('UPDATE ar_product_editor_uploads SET ready=true WHERE file_id=$1',[claim.file_id]);return{id:claim.file_id,alt:''};
 });
}
export async function editorImage(request:Request,actor:{id:string},input:unknown){
 const id=uuid(input);
 const permitted=(await query(`SELECT 1 FROM ar_product_editor_uploads WHERE file_id=$1 AND actor_id=$2 AND ready UNION ALL SELECT 1 FROM ar_product_media WHERE file_id=$1 UNION ALL SELECT 1 FROM ar_sku_media WHERE file_id=$1 UNION ALL SELECT 1 FROM ar_product_editor_drafts d WHERE d.actor_id=$2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d.infographic->'photos','[]'::jsonb)) p WHERE p->>'sourceId'=$1::text OR p->>'cutoutId'=$1::text) LIMIT 1`,[id,actor.id])).rowCount;
 if(!permitted)throw new StoreError('PHOTO_NOT_FOUND','Фотография не найдена.',404);
 const response=await fetch(appConfig().cmsBase+'/assets/'+id,{headers:{Cookie:cmsCookie(request)},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new StoreError('PHOTO_NOT_FOUND','Фотография не найдена.',404);
 const type=response.headers.get('Content-Type')?.split(';')[0]??'';
 if(!['image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml'].includes(type))throw new StoreError('PHOTO_TYPE','Неизвестный формат.',415);
 return new Response(response.body,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
