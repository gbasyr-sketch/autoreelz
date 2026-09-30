import {RECENT_KEY,recentProducts,rememberProduct} from '../lib/product-discovery';
const carousels=[...document.querySelectorAll<HTMLElement>('[data-product-carousel]')];
for(const root of carousels){
 const rail=root.querySelector<HTMLElement>('[data-product-rail]')!,buttons=[...root.querySelectorAll<HTMLButtonElement>('[data-carousel-step]')];
 const refresh=()=>{const end=rail.scrollWidth-rail.clientWidth;for(const button of buttons)button.disabled=Number(button.dataset.carouselStep)<0?rail.scrollLeft<=1:rail.scrollLeft>=end-1;};
 for(const button of buttons)button.addEventListener('click',()=>rail.scrollBy({left:Number(button.dataset.carouselStep)*rail.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
 rail.addEventListener('scroll',refresh,{passive:true});new ResizeObserver(refresh).observe(rail);root.addEventListener('autoreelz:rail-updated',refresh);refresh();
}
const current=document.querySelector<HTMLElement>('[data-viewed-product]'),root=document.querySelector<HTMLElement>('[data-recent-section]');
if(current&&root){
 const productId=current.dataset.viewedProduct!,skuId=current.dataset.viewedSku||null,rail=root.querySelector<HTMLElement>('[data-product-rail]')!;
 let sequence=0,controller:AbortController|undefined;
 function read(){try{const raw=localStorage.getItem(RECENT_KEY)??'[]';return raw.length<=8192?recentProducts(JSON.parse(raw)):[];}catch{return[];}}
 async function load(){const turn=++sequence;controller?.abort();const entries=read().filter(row=>row.productId!==productId);if(!entries.length){root!.hidden=true;rail.replaceChildren();return;}controller=new AbortController();
  try{const url=new URL('/api/catalog/recent',location.origin);url.searchParams.set('exclude',productId);url.searchParams.set('items',JSON.stringify(entries.map(({productId,skuId})=>({productId,skuId}))));const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();const html=await response.text();if(turn!==sequence)return;
   const doc=new DOMParser().parseFromString(html,'text/html'),cards=[...doc.querySelectorAll('article.product-card')];rail.replaceChildren(...cards);root!.hidden=!cards.length;root!.dispatchEvent(new Event('autoreelz:rail-updated'));window.dispatchEvent(new Event('autoreelz:catalog-cards'));
  }catch{if(turn===sequence){root!.hidden=true;rail.replaceChildren();}}
 }
 try{localStorage.setItem(RECENT_KEY,JSON.stringify(rememberProduct(read(),productId,skuId)));}catch{/* A blocked browser store leaves the history hidden. */}
 root.querySelector('[data-recent-clear]')?.addEventListener('click',()=>{sequence++;controller?.abort();try{localStorage.removeItem(RECENT_KEY);}catch{}rail.replaceChildren();root!.hidden=true;const target=document.querySelector<HTMLElement>('#product-suggestions-title')??document.querySelector<HTMLElement>('#reviews-title');if(target){target.tabIndex=-1;target.focus();}});
 window.addEventListener('storage',event=>{if(event.key===RECENT_KEY||event.key===null)void load();});
 window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
 void load();
}
