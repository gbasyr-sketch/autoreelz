import {commerceGet,commerceCommand,CommerceError,updateCartBadges} from './commerce';
import type {CartView} from '../lib/commerce-types';
import {initFavorites} from './social-favorites';

document.documentElement.classList.add('has-js');
const $=<T extends Element=HTMLElement>(selector:string)=>document.querySelector<T>(selector);
const $$=<T extends Element=HTMLElement>(selector:string)=>[...document.querySelectorAll<T>(selector)];
let toastTimer:ReturnType<typeof setTimeout>;
export function notify(message:string){const toast=$('#toast');if(!toast)return;toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,6000);}
function openDialog(id:string){const dialog=$<HTMLDialogElement>(id);if(dialog&&!dialog.open)dialog.showModal();}
// One in-flight cart write per page; the server additionally checks the cart version.
let adding=false;
let pendingAdd:{signature:string;body:{productId:string;skuId:string|null;quantity:number;mode:'add';cartVersion:number}}|null=null;
let purchaseCart:CartView|undefined,quantityEdited=false;
const purchaseLabels=new WeakMap<HTMLButtonElement,string>();
function updatePurchaseButtons(cart:CartView){
 if(purchaseCart?.csrfToken===cart.csrfToken&&purchaseCart.version>cart.version)return;
 purchaseCart=cart;
 $$<HTMLButtonElement>('[data-add-product]').forEach(button=>{
  const label=button.querySelector<HTMLElement>('[data-add-label]');if(!label)return;
  if(!purchaseLabels.has(button))purchaseLabels.set(button,label.textContent??'В корзину');
  const inCart=!quantityEdited&&cart.lines.some(line=>line.productId===button.dataset.addProduct&&(line.skuId??'')===(button.dataset.skuId??''));
  button.dataset.inCart=String(inCart);button.classList.toggle('in-cart',inCart);
  label.textContent=inCart?'Перейти в корзину':purchaseLabels.get(button)!;
 });
}
document.addEventListener('autoreelz:cart-updated',event=>updatePurchaseButtons((event as CustomEvent<CartView>).detail));
const productQuantity=$<HTMLInputElement>('#product-quantity');
for(const event of ['input','change'])productQuantity?.addEventListener(event,()=>{quantityEdited=true;if(purchaseCart)updatePurchaseButtons(purchaseCart);});
async function add(button:HTMLButtonElement){
 if(button.dataset.inCart==='true'){if(!adding)window.location.assign('/cart');return;}
 if(adding)return;const productId=button.dataset.addProduct,skuId=button.dataset.skuId||null;if(!productId){notify('Не удалось определить товар. Обновите страницу.');return;}
 const input=$<HTMLInputElement>('#product-quantity'),quantity=input?Number(input.value):1;const error=$('#quantity-error');
 if(!Number.isInteger(quantity)||quantity<1||quantity>99){if(error){error.textContent='Укажите целое количество от 1 до 99.';error.hidden=false;}input?.focus();return;}if(error)error.hidden=true;
 adding=true;button.disabled=true;button.setAttribute('aria-busy','true');try{const signature=JSON.stringify({productId,skuId,quantity});if(!pendingAdd||pendingAdd.signature!==signature){const current=await commerceGet<CartView>('/api/commerce/cart');pendingAdd={signature,body:{productId,skuId,quantity,mode:'add',cartVersion:current.version}};}const cart=await commerceCommand<CartView>('/api/commerce/cart',pendingAdd.body);pendingAdd=null;quantityEdited=false;updateCartBadges(cart);const line=cart.lines.find(item=>item.productId===productId&&item.skuId===skuId);notify(line?.kind==='preorder'?'Добавлено в корзину как предзаказ. Условия подтвердит менеджер.':'Товар добавлен в корзину.');}catch(error){if(error instanceof CommerceError&&error.status>0&&error.status<500)pendingAdd=null;if(error instanceof CommerceError&&error.status===409){const cart=await commerceGet<CartView>('/api/commerce/cart').catch(()=>null);if(cart)updateCartBadges(cart);notify('Корзина изменилась. Проверьте её и повторите добавление.');}else notify(error instanceof Error?error.message:'Не удалось добавить товар. Попробуйте ещё раз.');}finally{adding=false;button.disabled=false;button.removeAttribute('aria-busy');}
}
document.addEventListener('click',event=>{if(!(event.target instanceof Element))return;const target=event.target.closest<HTMLElement>('a,button');if(!target)return;
 if(target.hasAttribute('data-open-menu')){event.preventDefault();openDialog('#menu-dialog');}
 if(target.hasAttribute('data-open-search')){event.preventDefault();openDialog('#search-dialog');}
 if(target.hasAttribute('data-close-dialog'))target.closest('dialog')?.close();
 if(target.dataset.addProduct&&target instanceof HTMLButtonElement)void add(target);
});
$$<HTMLDialogElement>('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
initFavorites(notify);
if(!$('[data-commerce="cart"]')&&!$('[data-commerce="checkout"]'))void commerceGet<CartView>('/api/commerce/cart').then(updateCartBadges).catch(()=>{const count=$('[data-cart-count]');if(count){count.textContent='—';count.setAttribute('aria-label','Корзина временно недоступна');}});

async function refreshPurchaseCart(){if(!productQuantity||adding)return;try{updateCartBadges(await commerceGet<CartView>('/api/commerce/cart'));}catch{/* Preserve the last confirmed state on a read failure. */}}
window.addEventListener('pageshow',event=>{if(event.persisted)void refreshPurchaseCart();});
window.addEventListener('focus',()=>void refreshPurchaseCart());
