import {commerceGet,commerceCommand,CommerceError,updateCartBadges} from './commerce';
import type {CartView} from '../lib/commerce-types';

document.documentElement.classList.add('has-js');
const FAVORITES_KEY='autoreelz-new-demo-favorites-v1';
const $=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector);
const $$=<T extends Element=HTMLElement>(selector:string)=>[...document.querySelectorAll<T>(selector)];
let toastTimer:ReturnType<typeof setTimeout>;
export function notify(message:string){const toast=$('#toast');if(!toast)return;toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,6000);}
function favorites(){try{const value=JSON.parse(localStorage.getItem(FAVORITES_KEY)??'[]');return new Set<string>(Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)):[]);}catch{return new Set<string>();}}
function saveFavorites(ids:Set<string>){try{localStorage.setItem(FAVORITES_KEY,JSON.stringify([...ids]));return true;}catch{notify('Не удалось сохранить избранное. Проверьте доступ к хранилищу браузера.');return false;}}
function refreshFavorites(){
 const ids=favorites();$$<HTMLButtonElement>('[data-favorite]').forEach(button=>{const selected=ids.has(button.dataset.favorite!);button.setAttribute('aria-pressed',String(selected));const name=button.closest('[data-product-id]')?.querySelector('.card-title')?.textContent??document.querySelector('h1')?.textContent??'товар';button.setAttribute('aria-label',`${selected?'Убрать из избранного':'В избранное'}: ${name.trim()}`);});
 if($('[data-favorites-page]')){let count=0;$$('[data-product-id]').forEach(card=>{const selected=ids.has(card.dataset.productId!);card.hidden=!selected;if(selected)count++;});const empty=$('[data-favorites-empty]');if(empty)empty.hidden=count>0;const label=$('[data-favorites-count]');if(label)label.textContent=`Сохранено товаров: ${count}`;}
}
function openDialog(id:string){const dialog=$<HTMLDialogElement>(id);if(dialog&&!dialog.open)dialog.showModal();}
// One in-flight cart write per page; the server additionally checks the cart version.
let adding=false;
let pendingAdd:{signature:string;body:{productId:string;skuId:string|null;quantity:number;mode:'add';cartVersion:number}}|null=null;
async function add(button:HTMLButtonElement){
 if(adding)return;const productId=button.dataset.addProduct,skuId=button.dataset.skuId||null;if(!productId){notify('Не удалось определить товар. Обновите страницу.');return;}
 const input=$<HTMLInputElement>('#product-quantity'),quantity=input?Number(input.value):1;const error=$('#quantity-error');
 if(!Number.isInteger(quantity)||quantity<1||quantity>99){if(error){error.textContent='Укажите целое количество от 1 до 99.';error.hidden=false;}input?.focus();return;}if(error)error.hidden=true;
 adding=true;button.disabled=true;button.setAttribute('aria-busy','true');try{const signature=JSON.stringify({productId,skuId,quantity});if(!pendingAdd||pendingAdd.signature!==signature){const current=await commerceGet<CartView>('/api/commerce/cart');pendingAdd={signature,body:{productId,skuId,quantity,mode:'add',cartVersion:current.version}};}const cart=await commerceCommand<CartView>('/api/commerce/cart',pendingAdd.body);pendingAdd=null;updateCartBadges(cart);const line=cart.lines.find(item=>item.productId===productId&&item.skuId===skuId);notify(line?.kind==='preorder'?'Добавлено в корзину как предзаказ. Условия подтвердит менеджер.':'Товар добавлен в корзину.');}catch(error){if(error instanceof CommerceError&&error.status>0&&error.status<500)pendingAdd=null;if(error instanceof CommerceError&&error.status===409){const cart=await commerceGet<CartView>('/api/commerce/cart').catch(()=>null);if(cart)updateCartBadges(cart);notify('Корзина изменилась. Проверьте её и повторите добавление.');}else notify(error instanceof Error?error.message:'Не удалось добавить товар. Попробуйте ещё раз.');}finally{adding=false;button.disabled=false;button.removeAttribute('aria-busy');}
}
document.addEventListener('click',event=>{if(!(event.target instanceof Element))return;const target=event.target.closest<HTMLElement>('a,button');if(!target)return;
 if(target.hasAttribute('data-open-menu')){event.preventDefault();openDialog('#menu-dialog');}
 if(target.hasAttribute('data-open-search')){event.preventDefault();openDialog('#search-dialog');}
 if(target.hasAttribute('data-close-dialog'))target.closest('dialog')?.close();
 if(target.dataset.favorite){const id=target.dataset.favorite;if(!/^[a-f0-9-]{36}$/i.test(id))return;const ids=favorites();if(ids.has(id))ids.delete(id);else ids.add(id);if(saveFavorites(ids)){refreshFavorites();notify(ids.has(id)?'Сохранено в избранном этого браузера.':'Товар удалён из избранного.');}}
 if(target.dataset.addProduct&&target instanceof HTMLButtonElement)void add(target);
});
$$<HTMLDialogElement>('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
window.addEventListener('storage',refreshFavorites);refreshFavorites();
if(!$('[data-commerce="cart"]')&&!$('[data-commerce="checkout"]'))void commerceGet<CartView>('/api/commerce/cart').then(updateCartBadges).catch(()=>{const count=$('[data-cart-count]');if(count){count.textContent='—';count.setAttribute('aria-label','Корзина временно недоступна');}});
