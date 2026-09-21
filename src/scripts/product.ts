const quantity=document.querySelector<HTMLInputElement>('#product-quantity');
document.querySelectorAll<HTMLButtonElement>('[data-quantity]').forEach(button=>button.addEventListener('click',()=>{
  if(!quantity)return;
  const current=Number(quantity.value);
  quantity.value=String(Math.max(1,Math.min(99,(Number.isFinite(current)?Math.trunc(current):1)+Number(button.dataset.quantity))));
  document.querySelector<HTMLElement>('#quantity-error')?.setAttribute('hidden','');
}));
document.querySelectorAll<HTMLButtonElement>('[data-gallery]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-gallery]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  const image=document.querySelector<HTMLImageElement>('#product-image');
  if(image)image.style.transform=button.dataset.gallery==='2'?'scale(1.25)':button.dataset.gallery==='3'?'scale(1.55) translateY(8%)':'';
  const index=document.querySelector('[data-gallery-index]');if(index)index.textContent=`0${button.dataset.gallery} / 03`;
}));
document.querySelector('[data-zoom]')?.addEventListener('click',()=>document.querySelector<HTMLDialogElement>('#image-dialog')?.showModal());
