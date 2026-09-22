import sharp from 'sharp';
import {createHash} from 'node:crypto';
import type {ShopSession} from '../lib/commerce-types.ts';
import {appConfig} from './config.ts';
import {equal} from './security.ts';
import {StoreError} from './errors.ts';

sharp.concurrency(1);
sharp.cache({memory:32,items:32,files:0});

export const MAX_PHOTO_BYTES=10*1024*1024,MAX_UPLOAD_BYTES=51*1024*1024,MAX_PHOTO_PIXELS=24000000;
export interface ReviewPhoto {data:Buffer;width:number;height:number;digest:string}
let activeUploads=0;
export async function withReviewUpload<T>(fn:()=>Promise<T>):Promise<T>{
 if(activeUploads>=2)throw new StoreError('UPLOAD_BUSY','Сейчас обрабатываются другие фотографии. Повторите отправку чуть позже.',429);
 activeUploads++;try{return await fn();}finally{activeUploads--;}
}
export function assertMultipartOrigin(request:Request,session:ShopSession){
 if(request.headers.get('Origin')!==appConfig().origin||new URL(request.url).host!==new URL(appConfig().origin).host)throw new StoreError('ORIGIN','Источник запроса не разрешён.',403);
 if(!equal(request.headers.get('X-CSRF-Token')??'',session.csrfToken))throw new StoreError('CSRF','Сессия обновилась. Обновите страницу и повторите действие.',403);
}
export async function readReviewMultipart(request:Request,session:ShopSession){
 assertMultipartOrigin(request,session);
 const contentType=request.headers.get('Content-Type')??'';
 if(!/^multipart\/form-data\s*;/i.test(contentType)||contentType.length>300)throw new StoreError('CONTENT_TYPE','Ожидается форма отзыва с фотографиями.',415);
 const size=request.headers.get('Content-Length');
 if(size&&(!/^\d+$/.test(size)||Number(size)>MAX_UPLOAD_BYTES))throw new StoreError('UPLOAD_SIZE','Общий размер отправки превышает 51 МБ.',413);
 const reader=request.body?.getReader();if(!reader)throw new StoreError('EMPTY_REVIEW','Форма отзыва пуста.');
 let length=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_UPLOAD_BYTES){await reader.cancel();throw new StoreError('UPLOAD_SIZE','Общий размер отправки превышает 51 МБ.',413);}chunks.push(value);}
 let form:FormData;
 try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':contentType},body:Buffer.concat(chunks)}).formData();}
 catch{throw new StoreError('INVALID_FORM','Не удалось прочитать форму. Выберите фотографии заново.');}
 const permitted=new Set(['productId','orderId','authorName','body','idempotencyKey','files']);
 for(const key of form.keys())if(!permitted.has(key))throw new StoreError('INVALID_FORM','В форме есть неподдерживаемые поля.');
 const fields:Record<string,string>={};
 for(const key of ['productId','orderId','authorName','body','idempotencyKey']){const values=form.getAll(key);if(values.length!==1||typeof values[0]!=='string')throw new StoreError('INVALID_FORM','Заполните все поля отзыва.');fields[key]=values[0];}
 const files=form.getAll('files').filter(file=>!(typeof file!=='string'&&file.name===''&&file.size===0));
 if(files.length>5||files.some(file=>typeof file==='string'))throw new StoreError('PHOTO_COUNT','Можно приложить не более пяти фотографий.');
 return{fields,files:files as File[]};
}
function hasAnimation(data:Buffer,format:string){
 if(format==='png'){
  for(let pos=8;pos+12<=data.length;){const length=data.readUInt32BE(pos);if(pos+12+length>data.length)break;if(data.toString('ascii',pos+4,pos+8)==='acTL')return true;pos+=12+length;}
 }
 if(format==='webp'){
  for(let pos=12;pos+8<=data.length;){const length=data.readUInt32LE(pos+4),kind=data.toString('ascii',pos,pos+4);if(kind==='ANIM'||kind==='ANMF'||(kind==='VP8X'&&length>0&&Boolean(data[pos+8]!&2)))return true;if(pos+8+length>data.length)break;pos+=8+length+(length%2);}
 }
 return false;
}
export async function processReviewPhoto(file:File):Promise<ReviewPhoto>{
 if(file.size<1||file.size>MAX_PHOTO_BYTES)throw new StoreError('PHOTO_SIZE','Каждая фотография должна быть не больше 10 МБ и не быть пустой.');
 const mimeToFormat:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
 const expected=mimeToFormat[file.type];if(!expected)throw new StoreError('PHOTO_TYPE','Разрешены только фотографии JPEG, PNG и WebP.');
 const input=Buffer.from(await file.arrayBuffer());
 const signature=input.length>=12&&(expected==='jpeg'?input[0]===255&&input[1]===216&&input[2]===255:expected==='png'?input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP');
 if(!signature)throw new StoreError('PHOTO_TYPE','Содержимое фотографии не соответствует её формату.');
 if(hasAnimation(input,expected))throw new StoreError('PHOTO_ANIMATION','Анимированные изображения не принимаются. Выберите обычную фотографию.');
 try{
  const source=sharp(input,{failOn:'warning',limitInputPixels:MAX_PHOTO_PIXELS}).timeout({seconds:10});
  const metadata=await source.metadata();
  if(metadata.format!==expected)throw new StoreError('PHOTO_TYPE','Содержимое фотографии не соответствует её формату.');
  if((metadata.pages??1)>1||metadata.delay?.length)throw new StoreError('PHOTO_ANIMATION','Анимированные изображения не принимаются.');
  if(!metadata.width||!metadata.height||metadata.width*metadata.height>MAX_PHOTO_PIXELS)throw new StoreError('PHOTO_PIXELS','Разрешены фотографии до 24 мегапикселей.');
  // Sharp removes EXIF, GPS, ICC and other metadata by default. Never retain originals.
  const output=await source.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:3}).toBuffer({resolveWithObject:true});
  if(output.data.length>2*1024*1024)throw new StoreError('PHOTO_SIZE','Фотография слишком сложная для сохранения. Уменьшите её размер.');
  return{data:output.data,width:output.info.width,height:output.info.height,digest:createHash('sha256').update(input).digest('hex')};
 }catch(error){if(error instanceof StoreError)throw error;throw new StoreError('PHOTO_INVALID','Не удалось прочитать фотографию: файл повреждён, слишком большой или превышен срок обработки.');}
}
