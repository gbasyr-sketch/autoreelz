import {productVideo} from '../lib/product-video';
export function productVideoDialog(dialog:HTMLDialogElement){
 const player=dialog.querySelector<HTMLElement>('[data-pv-player]')!,link=dialog.querySelector<HTMLAnchorElement>('[data-pv-link]')!;
 let origin:HTMLElement|null=null;
 function clear(){player.replaceChildren();link.removeAttribute('href');}
 function close(){clear();if(dialog.open)dialog.close();}
 function open(value:string,title:string,trigger?:HTMLElement){
  const video=productVideo(value);if(!video)return false;
  clear();origin=trigger??document.activeElement as HTMLElement|null;
  dialog.querySelector('[data-pv-title]')!.textContent=title||'Видео товара';link.href=video.watchUrl;link.textContent='Открыть на '+video.provider;
  const frame=document.createElement('iframe');frame.title=`${title||'Видео товара'} — ${video.provider}`;frame.src=video.embedUrl;frame.allow='fullscreen; encrypted-media; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');player.append(frame);
  if(!dialog.open)dialog.showModal();dialog.querySelector<HTMLButtonElement>('[data-pv-close]')!.focus();return true;
 }
 dialog.querySelector('[data-pv-close]')!.addEventListener('click',close);
 dialog.addEventListener('close',()=>{clear();origin?.focus({preventScroll:true});origin=null;});
 dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
 return{open,close};
}
