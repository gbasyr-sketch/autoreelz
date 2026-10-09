import type {EditorData,EditorPhoto} from '../lib/product-editor';
import type {MainPhotoTarget} from '../lib/product-main-photo';
type Hooks={data:()=>EditorData;busy:(value:boolean)=>void;apply:(photo:EditorPhoto,target:MainPhotoTarget)=>void;restoreFocus:()=>void};

export function productMainPhoto(dialog:HTMLDialogElement,hooks:Hooks){
 const q=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
 const image=q<HTMLImageElement>('[data-pm-image]'),scope=q<HTMLFieldSetElement>('[data-pm-scope]'),select=q<HTMLSelectElement>('[data-pm-variant]'),error=q<HTMLElement>('[data-pm-error]');
 const all=q<HTMLInputElement>('input[value=all]'),one=q<HTMLInputElement>('input[value=variant]');
 let photo:EditorPhoto|null=null;
 function update(){
  error.hidden=true;q('[data-pm-variant-label]').hidden=!one.checked;
  const data=hooks.data(),v=data.variants.find(v=>v.id===select.value);
  q('[data-pm-impact]').textContent=one.checked
   ?`Главное фото изменится только у «${v?.name||v?.article||'Вариант'}». ${v?.mediaMode==='inherit'?'Его общие фотографии будут сохранены в отдельной галерее.':''}`
   :data.variants.length?`Общая обложка и главное фото всех ${data.variants.length} вариантов будут обновлены. Индивидуальные снимки останутся после обложки.`:'Фото станет первым в галерее товара.';
 }
 function lock(){photo=null;image.removeAttribute('src');if(dialog.open)dialog.close();hooks.busy(false);}
 function open(selected:EditorPhoto,variantId?:string){
  if(dialog.open)return;photo={...selected};image.src='/api/manager/product-image?id='+encodeURIComponent(photo.id);
  const data=hooks.data();select.replaceChildren();data.variants.forEach((v,i)=>select.add(new Option(v.name||v.article||`Вариант ${i+1}`,v.id)));
  scope.hidden=data.kind==='bundle'||!data.variants.length;all.checked=!variantId||scope.hidden;one.checked=!all.checked;if(variantId)select.value=variantId;
  update();hooks.busy(true);dialog.showModal();q<HTMLButtonElement>('[data-pm-close]').focus();
 }
 scope.addEventListener('change',update);select.addEventListener('change',update);
 q('[data-pm-close]').addEventListener('click',()=>dialog.close());q('[data-pm-cancel]').addEventListener('click',()=>dialog.close());
 q('[data-pm-apply]').addEventListener('click',()=>{
  if(!photo)return;
  try{hooks.apply(photo,one.checked?{variantId:select.value}:'all');dialog.close();}
  catch(e){error.textContent=e instanceof Error?e.message:'Не удалось изменить главное фото.';error.hidden=false;}
 });
 dialog.addEventListener('close',()=>{photo=null;image.removeAttribute('src');hooks.busy(false);hooks.restoreFocus();});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
 return{open,lock};
}
