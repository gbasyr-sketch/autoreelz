import {backgroundShapes,drawInfographicShape,type BackgroundShape} from '../lib/infographic-background';
import {node} from './manager-page';
import {CommerceError,getSession} from './commerce';
import {newInfographic,type InfographicRecipe,type InfographicPhoto} from '../lib/product-infographic';
import type {EditorData,EditorPhoto} from '../lib/product-editor';

type Asset={original:HTMLCanvasElement;image:HTMLCanvasElement;dirty:boolean;undo:ImageData[];pending?:{blob:Blob;key:string};bounds?:{x:number;y:number;w:number;h:number}|null};
type Hooks={data:()=>EditorData;changed:()=>void;upload:(file:File,key:string)=>Promise<EditorPhoto>;add:(photo:EditorPhoto)=>void;error:(e:unknown)=>void;busy:(value:boolean)=>void};
export function infographicStudio(dialog:HTMLDialogElement,hooks:Hooks){
 let initialized=false;let recipe:InfographicRecipe,assets=new Map<string,Asset>(),serial=0,loading=false,active=0,mode:'erase'|'restore'='erase',drawing=false,controller:AbortController|undefined;
 let pendingCard:{blob:Blob;key:string;fingerprint:string}|null=null;
 const requests=new Map<string,Promise<Asset>>();
 const q=<T extends HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 const card=q<HTMLCanvasElement>('[data-studio-card]'),mask=q<HTMLCanvasElement>('[data-studio-mask]'),status=q<HTMLElement>('[data-studio-status]');
 const fieldset=q<HTMLFieldSetElement>('[data-studio-fields]'),brush=q<HTMLInputElement>('[data-studio-brush]');
 const brushCursor=node('div','','pi-brush-cursor');brushCursor.hidden=true;brushCursor.setAttribute('aria-hidden','true');brushCursor.dataset.studioBrushCursor='';mask.parentElement!.append(brushCursor);
 let cursorVisible=false,pointerInside=false,pointerType='mouse',keyboardPoint={x:0,y:0},maskSource='';
 function hideBrushCursor(){cursorVisible=false;brushCursor.hidden=true;}
 function updateBrushCursor(){
  const rect=mask.getBoundingClientRect();
  if(!cursorVisible||loading||!dialog.open||q<HTMLElement>('[data-studio-mask-area]').hidden||!rect.width||!rect.height){brushCursor.hidden=true;return;}
  const sx=rect.width/mask.width,sy=rect.height/mask.height,r=Number(brush.value);
  brushCursor.style.width=2*r*sx+'px';brushCursor.style.height=2*r*sy+'px';
  brushCursor.style.left=mask.offsetLeft+keyboardPoint.x*sx+'px';brushCursor.style.top=mask.offsetTop+keyboardPoint.y*sy+'px';
  brushCursor.dataset.mode=mode;brushCursor.hidden=false;
 }
 new ResizeObserver(updateBrushCursor).observe(mask);
 brush.addEventListener('input',()=>{cursorVisible=true;updateBrushCursor();});
 brush.addEventListener('blur',()=>{if(!pointerInside)hideBrushCursor();});
 mask.addEventListener('focus',()=>{if(mask.matches(':focus-visible')){cursorVisible=true;updateBrushCursor();}});
 mask.addEventListener('blur',()=>{if(!pointerInside)hideBrushCursor();});
 const sourceUrl=(id:string)=>'/api/manager/product-image?id='+encodeURIComponent(id);
 function changed(){hooks.data().infographic=recipe;hooks.changed();pendingCard=null;}
 function message(text:string){status.textContent=text;}
 function busy(value:boolean){loading=value;if(value)hideBrushCursor();fieldset.disabled=value;dialog.setAttribute('aria-busy',String(value));hooks.busy(value);}
 function error(e:unknown){message(e instanceof Error?e.message:'Не удалось выполнить действие.');if(e instanceof CommerceError&&(e.status===401||e.status===403))hooks.error(e);}
 async function responseError(response:Response){let text='Не удалось загрузить фотографию.';try{text=(await response.json()).error?.message??text;}catch{}return new CommerceError(text,response.status);}
 async function image(url:string,signal?:AbortSignal){const response=await fetch(url,{signal});if(!response.ok)throw await responseError(response);const blob=await response.blob();if(blob.size>10*1024*1024)throw Error('Фотография слишком большая.');const objectUrl=URL.createObjectURL(blob),img=new Image();try{img.src=objectUrl;await img.decode();return img;}finally{URL.revokeObjectURL(objectUrl);}}
 function canvasImage(img:HTMLImageElement){const c=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d')!.drawImage(img,0,0,c.width,c.height);return c;}
 async function asset(photo:InfographicPhoto):Promise<Asset>{
  if(assets.has(photo.sourceId))return assets.get(photo.sourceId)!;
  if(requests.has(photo.sourceId))return requests.get(photo.sourceId)!;
  const version=serial,signal=controller?.signal;
  const promise=(async()=>{const original=canvasImage(await image(sourceUrl(photo.sourceId),signal)),working=document.createElement('canvas');working.width=original.width;working.height=original.height;const ctx=working.getContext('2d',{willReadFrequently:true})!;if(photo.cutoutId)ctx.drawImage(await image(sourceUrl(photo.cutoutId),signal),0,0,working.width,working.height);else ctx.drawImage(original,0,0);if(version!==serial)throw new DOMException('Cancelled','AbortError');const a:Asset={original,image:working,dirty:false,undo:[]};assets.set(photo.sourceId,a);return a;})();
  requests.set(photo.sourceId,promise);try{return await promise;}finally{if(requests.get(photo.sourceId)===promise)requests.delete(photo.sourceId);}
 }
 function round(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:string){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
 function draw(){
  if(!recipe)return;const c=card.getContext('2d')!,dark=recipe.style!=='light',ink=dark?'#ffffff':'#1d1d1b',muted=dark?'#c6c6c2':'#62625c';
  c.fillStyle=dark?'#222426':'#f5f4ef';c.fillRect(0,0,1500,1000);
  drawInfographicShape(c,recipe.shape??(recipe.style==='graphite'?'diagonal':'panel'),recipe.style==='accent'?recipe.accent:recipe.style==='graphite'?'#303236':'#e8e7e0');
  const text=(s:string,x:number,y:number,size:number,color:string,weight=500)=>{c.fillStyle=color;c.font=`${weight} ${size}px Manrope, sans-serif`;c.fillText(s,x,y);};
  text('AUTO REELZ',64,78,27,ink,700);
  function lines(value:string,y:number,size:number,maxLines:number,color:string){
   let words=value.split(/\s+/).filter(Boolean),rows:string[]=[];let tooLong=false;
   c.font=`700 ${size}px Manrope, sans-serif`;
   for(const word of words){if(c.measureText(word).width>515)tooLong=true;const i=rows.length-1;if(i>=0&&c.measureText(rows[i]+' '+word).width<=515)rows[i]+=' '+word;else rows.push(word);}
   if(rows.length>maxLines||tooLong){if(size>30)return lines(value,y,size-2,maxLines,color);tooLong=true;}
   rows.slice(0,maxLines).forEach((s,i)=>text(s,64,y+i*(size+12),size,color,700));return tooLong||rows.length>maxLines;
  }
  const overflow=lines(recipe.title||'Название товара',220,64,3,ink)||lines(recipe.subtitle,455,30,2,ink)||lines(recipe.detail,550,26,2,muted);
  round(c,64,395,62,6,3,recipe.accent);
  for(const [i,p]of recipe.photos.entries()){const a=assets.get(p.sourceId);if(!a)continue;const rect=i===0?{x:640,y:135,w:790,h:700}:{x:64,y:655,w:490,h:240};const im=a.image;
   // Crop only the transparent margins for layout; the stored source and mask stay intact.
   if(a.bounds===undefined){const pix=im.getContext('2d')!.getImageData(0,0,im.width,im.height).data;let minX=im.width,minY=im.height,maxX=-1,maxY=-1;
    for(let y=0;y<im.height;y+=2)for(let x=0;x<im.width;x+=2)if(pix[(y*im.width+x)*4+3]!>16){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    a.bounds=maxX<0?null:{x:Math.max(0,minX-2),y:Math.max(0,minY-2),w:Math.min(im.width-minX+2,maxX-minX+5),h:Math.min(im.height-minY+2,maxY-minY+5)};
   }
   const bounds=a.bounds;if(!bounds)continue;
   const scale=Math.min(rect.w/bounds.w,rect.h/bounds.h)*p.scale/100,w=bounds.w*scale,h=bounds.h*scale;
   c.save();c.beginPath();c.rect(rect.x-25,rect.y-35,rect.w+50,rect.h+70);c.clip();c.drawImage(im,bounds.x,bounds.y,bounds.w,bounds.h,rect.x+(rect.w-w)/2+p.x*3,rect.y+(rect.h-h)/2+p.y*3,w,h);c.restore();
  }
  text('AUTO REELZ',64,957,19,muted);text('01',1385,957,22,ink);
  q<HTMLButtonElement>('[data-studio-add]').disabled=overflow||!recipe.photos.length||!recipe.photos.every(p=>assets.has(p.sourceId))||loading;
  q<HTMLButtonElement>('[data-studio-download]').disabled=overflow||!recipe.photos.length||!recipe.photos.every(p=>assets.has(p.sourceId))||loading;
  q<HTMLElement>('[data-studio-overflow]').hidden=!overflow;
 }
 function drawMask(){const p=recipe?.photos[active],a=p&&assets.get(p.sourceId);mask.width=a?.image.width??600;mask.height=a?.image.height??400;if(a)mask.getContext('2d')!.drawImage(a.image,0,0);q<HTMLElement>('[data-studio-mask-area]').hidden=!a;if((p?.sourceId??'')!==maskSource){maskSource=p?.sourceId??'';keyboardPoint={x:mask.width/2,y:mask.height/2};hideBrushCursor();}updateBrushCursor();}
 function selectors(){const choices=[...new Map([...recipe.photos.map(p=>({id:p.sourceId,alt:'Исходное фото макета'})),...hooks.data().photos,...hooks.data().variants.flatMap(v=>v.photos)].map(p=>[p.id,p])).values()];
  dialog.querySelectorAll<HTMLSelectElement>('[data-studio-source]').forEach((select,i)=>{select.replaceChildren(new Option(i===0?'Выберите фото':'Без второго ракурса',''));choices.forEach((p,index)=>select.add(new Option(p.alt||`Фото ${index+1}`,p.id)));select.value=recipe.photos[i]?.sourceId??'';});
  q<HTMLSelectElement>('[data-studio-active]').replaceChildren(...recipe.photos.map((_,i)=>new Option(i===0?'Главное фото':'Второй ракурс',String(i))));active=Math.min(active,Math.max(0,recipe.photos.length-1));q<HTMLSelectElement>('[data-studio-active]').value=String(active);positionFields();
 }
 function positionFields(){const p=recipe.photos[active];for(const key of ['scale','x','y']as const)q<HTMLInputElement>(`[data-studio-${key}]`).value=String(p?.[key]??(key==='scale'?100:0));}
 async function load(){const version=serial;try{await Promise.all(recipe.photos.map(asset));if(version!==serial)return;draw();drawMask();}catch(e){if(version===serial)throw e;}}
 function inputs(){q<HTMLInputElement>('[data-studio-title]').value=recipe.title;q<HTMLInputElement>('[data-studio-subtitle]').value=recipe.subtitle;q<HTMLInputElement>('[data-studio-detail]').value=recipe.detail;q<HTMLInputElement>('[data-studio-color]').value=recipe.accent;q<HTMLSelectElement>('[data-studio-style]').value=recipe.style;q<HTMLSelectElement>('[data-studio-shape]').value=recipe.shape??(recipe.style==='graphite'?'diagonal':'panel');selectors();}
 function reset(){hideBrushCursor();initialized=false;serial++;controller?.abort();controller=new AbortController();assets.clear();requests.clear();pendingCard=null;recipe=hooks.data().infographic??newInfographic(hooks.data().name);if(dialog.open)dialog.close();}
 async function open(){if(loading)return;initialized=true;recipe=hooks.data().infographic??newInfographic(hooks.data().name);if(!recipe.photos.length&&hooks.data().photos[0])recipe.photos=[{sourceId:hooks.data().photos[0].id,cutoutId:'',scale:100,x:0,y:0}];inputs();message('Выберите фотографии и оформление. Результат появится на сайте только после публикации товара.');dialog.showModal();await document.fonts.load('700 64px Manrope');draw();try{await load();}catch(e){error(e);}}
 function blob(c:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Не удалось собрать изображение.')),'image/png'));}
 async function flush(){if(!initialized)return;const version=serial;for(const p of recipe?.photos??[]){const a=assets.get(p.sourceId);if(!a?.dirty)continue;a.pending??={blob:await blob(a.image),key:crypto.randomUUID()};const file=new File([a.pending.blob],'cutout.png',{type:'image/png'});const uploaded=await hooks.upload(file,a.pending.key);if(version!==serial)throw Error('Форма уже изменилась.');for(const related of recipe.photos)if(related.sourceId===p.sourceId)related.cutoutId=uploaded.id;a.dirty=false;a.pending=undefined;}if(recipe)hooks.data().infographic=recipe;}
 async function action(fn:()=>Promise<void>){if(loading)return;const version=serial;busy(true);try{await fn();}catch(e){if(version===serial)error(e);}finally{busy(false);draw();}}
 q<HTMLButtonElement>('[data-studio-close]').addEventListener('click',()=>dialog.close());
 dialog.querySelectorAll<HTMLInputElement>('[data-studio-text]').forEach(input=>input.addEventListener('input',()=>{recipe[input.dataset.studioText as 'title'|'subtitle'|'detail']=input.value;changed();draw();}));
 q<HTMLSelectElement>('[data-studio-shape]').replaceChildren(...backgroundShapes.map(s=>new Option(s.label,s.value)));
 q<HTMLSelectElement>('[data-studio-shape]').addEventListener('change',e=>{recipe.shape=(e.target as HTMLSelectElement).value as BackgroundShape;changed();draw();});
 q<HTMLSelectElement>('[data-studio-style]').addEventListener('change',e=>{recipe.style=(e.target as HTMLSelectElement).value as InfographicRecipe['style'];q<HTMLSelectElement>('[data-studio-shape]').value=recipe.shape??(recipe.style==='graphite'?'diagonal':'panel');changed();draw();});
 q<HTMLInputElement>('[data-studio-color]').addEventListener('input',e=>{recipe.accent=(e.target as HTMLInputElement).value;changed();draw();});
 dialog.querySelectorAll<HTMLSelectElement>('[data-studio-source]').forEach((select,i)=>select.addEventListener('change',()=>{if(i===0){recipe.photos=select.value?[{sourceId:select.value,cutoutId:'',scale:100,x:0,y:0},...recipe.photos.slice(1)]:[];}else{recipe.photos=recipe.photos.slice(0,1);if(select.value&&recipe.photos.length)recipe.photos.push({sourceId:select.value,cutoutId:'',scale:100,x:0,y:0});}changed();selectors();draw();void load().catch(error);}));
 q<HTMLSelectElement>('[data-studio-active]').addEventListener('change',e=>{active=Number((e.target as HTMLSelectElement).value);positionFields();drawMask();});
 for(const key of ['scale','x','y']as const)q<HTMLInputElement>(`[data-studio-${key}]`).addEventListener('input',e=>{const p=recipe.photos[active];if(p){p[key]=Number((e.target as HTMLInputElement).value);changed();draw();}});
 q<HTMLButtonElement>('[data-studio-remove]').addEventListener('click',()=>void action(async()=>{const p=recipe.photos[active];if(!p)throw Error('Сначала выберите фото.');const a=await asset(p),version=serial;message('Удаляем фон. При занятости обработчика фотография ждёт своей очереди…');const session=await getSession(),res=await fetch('/api/manager/product-background',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({imageId:p.sourceId}),signal:AbortSignal.any([controller!.signal,AbortSignal.timeout(50000)])});if(!res.ok)throw await responseError(res);const url=URL.createObjectURL(await res.blob()),im=new Image();try{im.src=url;await im.decode();if(version!==serial)return;const c=a.image.getContext('2d')!;a.undo=[c.getImageData(0,0,a.image.width,a.image.height)];c.clearRect(0,0,a.image.width,a.image.height);c.drawImage(im,0,0,a.image.width,a.image.height);a.dirty=true;a.pending=undefined;a.bounds=undefined;changed();drawMask();message('Фон удалён. Проверьте край; при необходимости используйте кисть.');}finally{URL.revokeObjectURL(url);}}));
 function paint(x:number,y:number){const p=recipe.photos[active],a=p&&assets.get(p.sourceId);if(!a||loading)return;const c=a.image.getContext('2d')!,r=Number(brush.value);c.save();c.beginPath();c.arc(x,y,r,0,Math.PI*2);if(mode==='erase'){c.globalCompositeOperation='destination-out';c.fill();}else{c.clip();c.clearRect(x-r,y-r,r*2,r*2);c.drawImage(a.original,0,0);}c.restore();a.dirty=true;a.pending=undefined;a.bounds=undefined;changed();drawMask();}
 function checkpoint(){const p=recipe.photos[active],a=p&&assets.get(p.sourceId);if(a){a.undo.push(a.image.getContext('2d')!.getImageData(0,0,a.image.width,a.image.height));a.undo=a.undo.slice(-3);}}
 let last:{x:number;y:number}|null=null;
 function point(e:PointerEvent){const r=mask.getBoundingClientRect();return{x:(e.clientX-r.left)*mask.width/r.width,y:(e.clientY-r.top)*mask.height/r.height};}
 function trackPointer(e:PointerEvent){pointerType=e.pointerType;const p=point(e);pointerInside=p.x>=0&&p.y>=0&&p.x<=mask.width&&p.y<=mask.height;if(pointerInside)keyboardPoint=p;cursorVisible=pointerInside;updateBrushCursor();}
 mask.addEventListener('pointerenter',e=>{if(!loading)trackPointer(e);});
 mask.addEventListener('pointerleave',()=>{pointerInside=false;hideBrushCursor();});
 mask.addEventListener('pointerdown',e=>{if(loading||e.button!==0)return;trackPointer(e);checkpoint();drawing=true;mask.setPointerCapture(e.pointerId);last=point(e);paint(last.x,last.y);});
 mask.addEventListener('pointermove',e=>{if(loading)return;trackPointer(e);if(!drawing||!last)return;const next=point(e),distance=Math.hypot(next.x-last.x,next.y-last.y),steps=Math.max(1,Math.ceil(distance/(Number(brush.value)/2)));for(let i=1;i<=steps;i++)paint(last.x+(next.x-last.x)*i/steps,last.y+(next.y-last.y)*i/steps);last=next;});
 mask.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key))return;e.preventDefault();if(loading)return;cursorVisible=true;const step=e.shiftKey?30:8;if(e.key===' '){checkpoint();paint(keyboardPoint.x,keyboardPoint.y);draw();}else{keyboardPoint.x=Math.max(0,Math.min(mask.width,keyboardPoint.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0)));keyboardPoint.y=Math.max(0,Math.min(mask.height,keyboardPoint.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)));}updateBrushCursor();});
 const end=()=>{drawing=false;last=null;if(pointerType==='touch'||!pointerInside)hideBrushCursor();draw();};mask.addEventListener('pointerup',end);mask.addEventListener('pointercancel',()=>{pointerInside=false;end();});mask.addEventListener('lostpointercapture',end);
 dialog.addEventListener('close',()=>{drawing=false;last=null;pointerInside=false;hideBrushCursor();});
 dialog.querySelectorAll<HTMLButtonElement>('[data-studio-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.studioMode as typeof mode;dialog.querySelectorAll('[data-studio-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));updateBrushCursor();}));
 q<HTMLButtonElement>('[data-studio-undo]').addEventListener('click',()=>{const a=assets.get(recipe.photos[active]?.sourceId??''),previous=a?.undo.pop();if(a&&previous){a.image.getContext('2d')!.putImageData(previous,0,0);a.dirty=true;a.pending=undefined;a.bounds=undefined;changed();drawMask();draw();}});
 q<HTMLButtonElement>('[data-studio-original]').addEventListener('click',()=>{const a=assets.get(recipe.photos[active]?.sourceId??'');if(a){checkpoint();const c=a.image.getContext('2d')!;c.clearRect(0,0,a.image.width,a.image.height);c.drawImage(a.original,0,0);a.dirty=true;a.pending=undefined;a.bounds=undefined;changed();drawMask();draw();}});
 q<HTMLButtonElement>('[data-studio-download]').addEventListener('click',()=>void action(async()=>{await load();draw();const url=URL.createObjectURL(await blob(card)),a=node('a');a.href=url;a.download='autoreelz-card.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('PNG подготовлен для скачивания.');}));
 q<HTMLButtonElement>('[data-studio-add]').addEventListener('click',()=>void action(async()=>{if(hooks.data().photos.length>=12)throw Error('В галерее уже 12 фото. Уберите одно перед добавлением карточки.');await load();await flush();draw();const fingerprint=JSON.stringify(recipe);if(pendingCard?.fingerprint!==fingerprint)pendingCard={blob:await blob(card),key:crypto.randomUUID(),fingerprint};const result=await hooks.upload(new File([pendingCard.blob],'infographic.png',{type:'image/png'}),pendingCard.key);hooks.add({...result,alt:recipe.title});changed();message('Карточка добавлена в форму. Нажмите «Сохранить черновик» или «Опубликовать» в редакторе товара.');dialog.close();}));
 return{open,reset,flush,lock(){hideBrushCursor();initialized=false;serial++;controller?.abort();assets.clear();requests.clear();recipe=undefined as unknown as InfographicRecipe;pendingCard=null;dialog.querySelectorAll<HTMLInputElement>('[data-studio-text]').forEach(el=>el.value='');dialog.querySelectorAll<HTMLSelectElement>('[data-studio-source],[data-studio-active]').forEach(el=>el.replaceChildren());status.textContent='';card.getContext('2d')!.clearRect(0,0,card.width,card.height);mask.getContext('2d')!.clearRect(0,0,mask.width,mask.height);if(dialog.open)dialog.close();}};
}
