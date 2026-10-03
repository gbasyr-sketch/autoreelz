import {commerceGet,commerceCommand,CommerceError} from './commerce';
import {node} from './manager-page';
import type {EditorPhoto} from '../lib/product-editor';
type Photo={id:string;title:string;width:number|null;height:number|null;used:boolean};
type Result={items:Photo[];total:number;page:number;pages:number};
export function productImageLibrary(dialog:HTMLDialogElement,config:{used:()=>Set<string>;busy:(v:boolean)=>void;error:(e:unknown)=>void}){
 const $=<T extends HTMLElement=HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
 const grid=$('[data-pl-grid]'),status=$('[data-pl-status]'),error=$('[data-pl-error]'),search=$<HTMLFormElement>('[data-pl-search]'),input=search.elements.namedItem('q') as HTMLInputElement,add=$<HTMLButtonElement>('[data-pl-add]');
 let scope='active',page=1,pages=1,serial=0,controller:AbortController|undefined,mutating=false,loading=false;
 let target:EditorPhoto[]=[],apply:(photos:EditorPhoto[])=>void=()=>{},opener:HTMLElement|null=null;
 const selected=new Map<string,Photo>();
 function selection(){const remaining=Math.max(0,12-target.length);$('[data-pl-selection]').textContent=`Выбрано: ${selected.size} · Можно добавить: ${remaining}`;add.disabled=!selected.size||mutating||loading;add.hidden=scope==='trash';}
 function controls(){selection();$<HTMLButtonElement>('[data-pl-prev]').disabled=page<=1||loading||mutating;$<HTMLButtonElement>('[data-pl-next]').disabled=page>=pages||loading||mutating;dialog.querySelectorAll<HTMLButtonElement>('[data-pl-close],[data-pl-cancel],[data-pl-scope],.pl-search button').forEach(b=>b.disabled=mutating);input.disabled=mutating;}
 function close(){if(!mutating)dialog.close();}
 function reset(){serial++;mutating=false;loading=false;controller?.abort();selected.clear();last=[];grid.replaceChildren();target=[];apply=()=>{};config.busy(false);}
 dialog.addEventListener('close',()=>{reset();if(opener?.isConnected)opener.focus();});
 dialog.addEventListener('cancel',e=>{if(mutating)e.preventDefault();});
 $('[data-pl-close]').addEventListener('click',close);$('[data-pl-cancel]').addEventListener('click',close);
 function fail(e:unknown){error.textContent=e instanceof Error?e.message:'Не удалось загрузить фотографии. Повторите поиск.';error.hidden=false;if(e instanceof CommerceError&&(e.status===401||e.status===403))config.error(e);}
 async function change(photo:Photo){
  if(mutating||loading)return;
  if(scope==='active'&&(photo.used||config.used().has(photo.id)||selected.has(photo.id)))return;
  const action=scope==='trash'?'restore':'trash';
  if(action==='trash'&&!confirm(`Переместить «${photo.title}» в удалённые? Файл можно будет восстановить.`))return;
  const current=serial;mutating=true;error.hidden=true;controls();grid.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{await commerceCommand('/api/manager/product-image-library',{id:photo.id,action});if(current!==serial)return;selected.delete(photo.id);mutating=false;await load();}
  catch(e){if(current===serial){fail(e);if(current!==serial)return;mutating=false;draw(last);}}
  finally{if(current===serial){mutating=false;controls();}}
 }
 let last:Photo[]=[];
 function draw(items:Photo[]){last=items;grid.replaceChildren();const used=config.used();
  for(const photo of items){const card=node('article','','pl-card'),pick=node('button','','pl-pick');pick.type='button';pick.setAttribute('aria-label',photo.title);pick.setAttribute('aria-pressed',String(selected.has(photo.id)));const already=target.some(p=>p.id===photo.id);pick.disabled=scope==='trash'||already;
   const img=node('img');img.src='/api/manager/product-image?id='+encodeURIComponent(photo.id)+'&thumbnail=1';img.alt='';img.loading='lazy';img.width=192;img.height=192;
   const name=node('span',photo.title,'pl-name'),badge=node('span',already?'Уже в галерее':selected.has(photo.id)?'Выбрано':'Выбрать','pl-badge');pick.append(img,name,badge);
   img.addEventListener('error',()=>{img.hidden=true;badge.textContent='Фото недоступно';});
   pick.addEventListener('click',()=>{if(mutating||loading)return;error.hidden=true;if(selected.has(photo.id))selected.delete(photo.id);else{if(selected.size>=12-target.length){error.textContent='Достигнут предел: 12 фотографий в галерее.';error.hidden=false;return;}selected.set(photo.id,photo);}pick.setAttribute('aria-pressed',String(selected.has(photo.id)));badge.textContent=selected.has(photo.id)?'Выбрано':'Выбрать';remove.disabled=selected.has(photo.id)||photo.used||config.used().has(photo.id);selection();});
   const inUse=photo.used||used.has(photo.id)||selected.has(photo.id),remove=node('button',scope==='trash'?'Восстановить':'Удалить','dash-button pl-remove');remove.type='button';remove.disabled=scope!=='trash'&&inUse;remove.setAttribute('aria-label',(scope==='trash'?'Восстановить: ':'Удалить: ')+photo.title);remove.addEventListener('click',()=>void change(photo));
   card.append(pick,node('small',photo.used?'Используется':used.has(photo.id)?'В текущей форме':scope==='trash'?'Можно восстановить':'Не используется','dash-help'),remove);grid.append(card);
  }
 }
 async function load(){controller?.abort();controller=new AbortController();const current=++serial;loading=true;error.hidden=true;grid.replaceChildren();status.textContent='Загружаем фотографии…';controls();
  try{const result=await commerceGet<Result>('/api/manager/product-image-library?'+new URLSearchParams({q:input.value.trim(),page:String(page),scope}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});if(current!==serial||!dialog.open)return;pages=result.pages;if(page>pages){page=pages;void load();return;}draw(result.items);status.textContent=result.total?`Найдено: ${result.total}. ${scope==='trash'?'Восстановите фото, чтобы снова выбрать его.':'Выбранные фото добавятся в конце галереи.'}`:scope==='trash'?'Удалённых фотографий нет.':'Фотографии не найдены. Измените поиск или загрузите новый файл.';$('[data-pl-page]').textContent=`${page} / ${pages}`;}
  catch(e){if(current===serial){status.textContent='Загрузка не завершилась. Нажмите «Найти», чтобы повторить.';fail(e);}}
  finally{if(current===serial){loading=false;controls();}}
 }
 search.addEventListener('submit',e=>{e.preventDefault();if(mutating)return;page=1;void load();});
 dialog.querySelectorAll<HTMLButtonElement>('[data-pl-scope]').forEach(b=>b.addEventListener('click',()=>{scope=b.dataset.plScope!;page=1;dialog.querySelectorAll<HTMLButtonElement>('[data-pl-scope]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));void load();}));
 $('[data-pl-prev]').addEventListener('click',()=>{page--;void load();});$('[data-pl-next]').addEventListener('click',()=>{page++;void load();});
 add.addEventListener('click',()=>{if(mutating||loading)return;const photos=[...selected.values()].filter(p=>!target.some(t=>t.id===p.id)).map(p=>({id:p.id,alt:p.title==='Фото товара'?'':p.title}));if(target.length+photos.length>12)return;apply(photos);dialog.close();});
 return{open(items:EditorPhoto[],onApply:(photos:EditorPhoto[])=>void){target=items;apply=onApply;selected.clear();scope='active';page=1;input.value='';opener=document.activeElement as HTMLElement;dialog.querySelectorAll<HTMLButtonElement>('[data-pl-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.plScope===scope)));config.busy(true);dialog.showModal();input.focus();void load();},lock(){reset();dialog.close();}};
}
