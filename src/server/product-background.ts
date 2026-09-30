import sharp from 'sharp';
import {editorImage} from './product-editor-images.ts';
import {StoreError,uuid} from './errors.ts';

export async function boundedImage(response:Response,max=10*1024*1024){
 const reader=response.body?.getReader();if(!reader)throw new StoreError('PHOTO_EMPTY','Фотография недоступна.');
 let size=0;const parts:Uint8Array[]=[];
 try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new StoreError('PHOTO_SIZE','Фотография слишком большая.',413);parts.push(value);}return Buffer.concat(parts);}
 catch(e){await reader.cancel().catch(()=>{});throw e;}
}
let active=0;
export async function removeProductBackground(request:Request,actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.imageId),base=process.env.BACKGROUND_REMOVAL_URL;
 if(!base)throw new StoreError('BACKGROUND_DISABLED','Удаление фона пока недоступно.',503);
 if(active>=3)throw new StoreError('BACKGROUND_BUSY','Обрабатываются другие фотографии. Повторите через несколько секунд.',429);
 active++;
 try{
  const source=await editorImage(request,actor,id);
  if(!['image/png','image/jpeg','image/webp'].includes(source.headers.get('Content-Type')??''))throw new StoreError('PHOTO_TYPE','Для удаления фона выберите PNG, JPG или WebP.');
  const input=await boundedImage(source);
  const response=await fetch(new URL('/remove',base),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(input),signal:AbortSignal.timeout(45000),redirect:'error'});
  if(response.status===429)throw new StoreError('BACKGROUND_BUSY','Очередь обработки заполнена. Повторите через несколько секунд.',429);
  if(response.status===422||response.status===413)throw new StoreError('PHOTO_INVALID','Не удалось обработать фотографию. Выберите другой файл.');
  if(!response.ok||response.headers.get('Content-Type')!=='image/png')throw new Error('worker');
  const result=await boundedImage(response),meta=await sharp(result,{limitInputPixels:2560000}).metadata();
  if(meta.format!=='png'||!meta.hasAlpha||!meta.width||!meta.height||meta.width>1600||meta.height>1600)throw new Error('invalid worker output');
  return new Response(new Uint8Array(result),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){if(e instanceof StoreError)throw e;throw new StoreError('BACKGROUND_UNAVAILABLE','Обработка не завершилась. Исходное фото сохранено; попробуйте ещё раз.',503);}
 finally{active--;}
}
