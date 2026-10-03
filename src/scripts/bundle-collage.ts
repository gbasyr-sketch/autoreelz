import {collageLayout,containImage} from '../lib/bundle-collage';
import type {EditorData,EditorOptions,EditorPhoto} from '../lib/product-editor';
import {CommerceError} from './commerce';
type Hooks={data:()=>EditorData;busy:(value:boolean)=>void;upload:(file:File,key:string)=>Promise<EditorPhoto>;apply:(photo:EditorPhoto)=>void;error:(error:unknown)=>void};
export function bundleCollage(dialog:HTMLDialogElement,hooks:Hooks){
 const q=<T extends HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const canvas=q<HTMLCanvasElement>('[data-collage-canvas]'),status=q<HTMLElement>('[data-collage-status]'),apply=q<HTMLButtonElement>('[data-collage-apply]'),retry=q<HTMLButtonElement>('[data-collage-retry]'),close=q<HTMLButtonElement>('[data-collage-close]');
 let controller:AbortController|null=null,serial=0,working=false,pending:{fingerprint:string;blob:Blob;key:string;photo?:EditorPhoto}|null=null;
 function reset(){serial++;controller?.abort();controller=null;canvas.width=canvas.height=1;canvas.hidden=true;status.textContent='';apply.disabled=true;retry.hidden=true;working=false;hooks.busy(false);}
 function lock(){if(dialog.open)dialog.close();reset();pending=null;}
 function failure(error:unknown){status.textContent=error instanceof Error?error.message:'Не удалось собрать коллаж. Повторите попытку.';if(error instanceof CommerceError&&(error.status===401||error.status===403)){lock();hooks.error(error);}}
 async function response(url:string,signal:AbortSignal){const result=await fetch(url,{signal});if(!result.ok){let message='Не удалось загрузить фотографии. Повторите сборку.';try{message=(await result.json()).error?.message??message;}catch{}throw new CommerceError(message,result.status);}return result;}
 async function build(){
  reset();const run=serial,abort=new AbortController();controller=abort;const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(90000)]);working=true;hooks.busy(true);status.textContent='Загружаем главные фотографии…';
  try{
   const data=hooks.data(),components=data.components??[];if(data.kind!=='bundle'||!components.length)throw Error('Сначала добавьте товары в состав комплекта.');
   const options=await(await response('/api/manager/product-editor?options=1',signal)).json() as EditorOptions;
   if(run!==serial)return;
   const sources=components.map(item=>{const sku=options.bundleSkus?.find(s=>s.id===item.skuId);if(!sku?.imageId)throw Error(`Нет главного фото: ${sku?sku.productName+' · '+sku.name:'одно из выбранных исполнений'}. Добавьте фотографию в его карточку и повторите сборку.`);return{skuId:item.skuId,imageId:sku.imageId};});
   const layout=collageLayout(sources.length);canvas.width=layout.width;canvas.height=layout.height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   for(const [index,source] of sources.entries()){
    if(run!==serial)return;status.textContent=`Собираем коллаж: ${index+1} из ${sources.length}…`;
    const blob=await(await response('/api/manager/product-image?id='+encodeURIComponent(source.imageId),signal)).blob();
    let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(blob);}catch{throw Error(`Не удалось прочитать фото ${index+1}. Проверьте изображение в карточке товара.`);}
    try{if(run!==serial)return;const rect=containImage(bitmap.width,bitmap.height,layout.cells[index]!);ctx.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height);}finally{bitmap.close();}
   }
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Не удалось подготовить изображение.')),'image/png'));
   if(run!==serial)return;if(blob.size>10*1024*1024)throw Error('Коллаж получился слишком большим для загрузки.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
   if(run!==serial)return;const fingerprint=JSON.stringify([sources,digest]);
   // Retain a byte-identical upload and its key after an uncertain network response.
   if(pending?.fingerprint!==fingerprint)pending={fingerprint,blob,key:crypto.randomUUID()};
   canvas.hidden=false;apply.disabled=false;status.textContent=`Готово: ${sources.length} фото · ${canvas.width} × ${canvas.height} пикселей. Проверьте коллаж перед добавлением.`;
  }catch(error){if(run!==serial)return;canvas.hidden=true;retry.hidden=false;failure(error);}
  finally{if(run===serial){working=false;hooks.busy(false);}}
 }
 async function add(){
  if(working||!pending)return;const item=pending,run=serial,data=hooks.data();
  if(data.photos.length>=12&&!data.photos.some(p=>p.id===item.photo?.id)){status.textContent='В галерее уже 12 фото. Уберите одно изображение и повторите добавление коллажа.';return;}
  working=true;hooks.busy(true);apply.disabled=true;close.disabled=true;status.textContent='Добавляем коллаж в галерею…';
  try{if(!item.photo)item.photo=await hooks.upload(new File([item.blob],'autoreelz-bundle-collage.png',{type:'image/png'}),item.key);if(run!==serial)return;hooks.apply({...item.photo,alt:'Комплект: '+(data.name||'коллаж товаров')});dialog.close();}
  catch(error){if(run===serial){failure(error);apply.disabled=false;}}
  finally{close.disabled=false;if(run===serial){working=false;hooks.busy(false);}}
 }
 function open(){if(dialog.open||working)return;dialog.showModal();void build();}
 close.addEventListener('click',()=>dialog.close());retry.addEventListener('click',()=>void build());apply.addEventListener('click',()=>void add());
 dialog.addEventListener('cancel',event=>{if(close.disabled)event.preventDefault();});dialog.addEventListener('close',reset);
 return{open,lock};
}
