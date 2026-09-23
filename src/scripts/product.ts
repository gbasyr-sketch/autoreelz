export {};
const quantity=document.querySelector<HTMLInputElement>('#product-quantity');
document.querySelectorAll<HTMLButtonElement>('[data-quantity]').forEach(button=>button.addEventListener('click',()=>{
  if(!quantity)return;
  const current=Number(quantity.value);
  quantity.value=String(Math.max(1,Math.min(99,(Number.isFinite(current)?Math.trunc(current):1)+Number(button.dataset.quantity))));
  document.querySelector<HTMLElement>('#quantity-error')?.setAttribute('hidden','');
}));
const image=document.querySelector<HTMLImageElement>('#product-image');
const stage=document.querySelector<HTMLElement>('.gallery-stage');
const dialog=document.querySelector<HTMLDialogElement>('#image-dialog');
const enlarged=dialog?.querySelector<HTMLImageElement>('[data-gallery-enlarged]');
const thumbs=[...document.querySelectorAll<HTMLButtonElement>('[data-gallery-src]')];
const status=document.querySelector<HTMLElement>('[data-gallery-status]');
let selected=0,requested=0,sequence=0;
async function selectPhoto(index:number){
  if(!image||!thumbs.length)return;
  requested=(index+thumbs.length)%thumbs.length;
  const next=requested,button=thumbs[next]!,src=button.dataset.gallerySrc!,alt=button.dataset.galleryAlt??'';
  const current=++sequence;stage?.setAttribute('aria-busy','true');
  if(status)status.textContent='Загружаем фотографию…';
  try{
    const preload=new Image();preload.src=src;await preload.decode();
    if(current!==sequence)return;
    image.src=src;image.alt=alt;
    if(enlarged){enlarged.src=src;enlarged.alt=alt;}
    selected=next;
    thumbs.forEach((thumb,i)=>thumb.setAttribute('aria-pressed',String(i===selected)));
    const count=`${String(selected+1).padStart(2,'0')} / ${String(thumbs.length).padStart(2,'0')}`;
    document.querySelectorAll('[data-gallery-index]').forEach(node=>node.textContent=count);
    if(status)status.textContent=`Фотография ${selected+1} из ${thumbs.length}.`;
  }catch{
    if(current===sequence){requested=selected;if(status)status.textContent='Не удалось загрузить фотографию. Нажмите на миниатюру, чтобы повторить.';}
  }finally{if(current===sequence)stage?.removeAttribute('aria-busy');}
}
thumbs.forEach((button,index)=>button.addEventListener('click',()=>void selectPhoto(index)));
document.querySelectorAll<HTMLButtonElement>('[data-gallery-step]').forEach(button=>button.addEventListener('click',()=>void selectPhoto(requested+Number(button.dataset.galleryStep))));
dialog?.addEventListener('keydown',event=>{
  if(thumbs.length>1&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();void selectPhoto(requested+(event.key==='ArrowLeft'?-1:1));}
});
const zoom=document.querySelector<HTMLButtonElement>('[data-zoom]');
function openPhoto(){if(dialog&&!dialog.open)dialog.showModal();}
zoom?.addEventListener('click',openPhoto);
image?.addEventListener('click',()=>{zoom?.focus({preventScroll:true});openPhoto();});
