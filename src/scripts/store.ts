import { products, offerFor, money, productHref } from '../lib/demo';

document.documentElement.classList.add('has-js');
const CART_KEY='autoreelz-new-demo-cart-v1';
const FAVORITES_KEY='autoreelz-new-demo-favorites-v1';
type CartLine={productId:string;skuId:string|null;quantity:number};
const $=<T extends Element=HTMLElement>(s:string)=>document.querySelector<T>(s);
const $$=<T extends Element=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)];
let toastTimer:ReturnType<typeof setTimeout>;
export function notify(message:string){const toast=$('#toast');if(!toast)return;toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},5000);}
function read(key:string):unknown{try{return JSON.parse(localStorage.getItem(key)??'[]');}catch{return [];}}
function write(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{notify('Не удалось сохранить в браузере. Проверьте доступ к локальному хранилищу и попробуйте ещё раз.');return false;}}
function validLine(value:unknown):value is CartLine{if(!value||typeof value!=='object')return false;const l=value as CartLine;const p=products.find(p=>p.id===l.productId);return Boolean(p&&Number.isInteger(l.quantity)&&l.quantity>0&&l.quantity<=99&&(l.skuId===null||typeof l.skuId==='string')&&offerFor(p,l.skuId));}
function cart(){const value=read(CART_KEY);return Array.isArray(value)?value.filter(validLine):[];}
function favorites(){const value=read(FAVORITES_KEY);return new Set<string>(Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&products.some(p=>p.id===id)):[]);}
function refresh(){
 const ids=favorites(),lines=cart();const count=lines.reduce((n,l)=>n+l.quantity,0);
 $$('[data-cart-count]').forEach(el=>el.textContent=String(count));
 $$<HTMLButtonElement>('[data-favorite]').forEach(el=>{const selected=ids.has(el.dataset.favorite!);el.setAttribute('aria-pressed',String(selected));const name=products.find(p=>p.id===el.dataset.favorite)?.name??'товар';el.setAttribute('aria-label',`${selected?'Убрать из избранного':'В избранное'}: ${name}`);});
 if($('[data-favorites-page]')){
  $$('[data-product-id]').forEach(card=>card.hidden=!ids.has(card.dataset.productId!));
  const empty=$('[data-favorites-empty]');if(empty)empty.hidden=ids.size>0;
  const count=$('[data-favorites-count]');if(count)count.textContent=`Сохранено товаров: ${ids.size}`;
 }
 renderCart(lines);
}
function text(tag:string,content:string,className=''){const el=document.createElement(tag);el.textContent=content;el.className=className;return el;}
function renderCart(lines:CartLine[]){
 const list=$('[data-demo-cart-list]');if(!list)return;list.replaceChildren();let total=0;
 for(const line of lines){const p=products.find(p=>p.id===line.productId)!;const offer=offerFor(p,line.skuId)!;total+=offer.priceKopecks*line.quantity;
  const row=document.createElement('article');row.className='cart-line';
  const img=document.createElement('img');img.src=p.image;img.alt=`Изображение-заглушка: ${p.name}`;img.width=100;img.height=67;row.append(img);
  const copy=document.createElement('div');const title=document.createElement('h2');const link=document.createElement('a');link.href=productHref(p,offer.variant);link.textContent=p.name;title.append(link);copy.append(title);
  copy.append(text('p',`${offer.variant?.label??'Фиксированный состав'} · ${line.quantity} шт.`));
  const preorder=offer.available<line.quantity;copy.append(text('p',preorder?'Предзаказ · пример, без немедленной оплаты':'В наличии · пример'));row.append(copy);
  const actions=document.createElement('div');actions.append(text('strong',money(offer.priceKopecks*line.quantity)));
  const remove=document.createElement('button');remove.type='button';remove.className='button-secondary';remove.dataset.removeLine=`${line.productId}:${line.skuId??''}`;remove.textContent='Убрать';remove.style.marginLeft='14px';actions.append(remove);row.append(actions);list.append(row);
 }
 const empty=$('[data-cart-empty]');if(empty)empty.hidden=lines.length>0;
 const summary=$('[data-cart-summary]');if(summary)summary.hidden=lines.length===0;
 const sum=$('[data-cart-total]');if(sum)sum.textContent=money(total);
}
function openDialog(id:string){const d=$<HTMLDialogElement>(id);if(d&&!d.open)d.showModal();}
document.addEventListener('click',event=>{
 if(!(event.target instanceof Element))return;
 const target=event.target.closest<HTMLElement>('a,button');if(!target)return;
 if(target.hasAttribute('data-open-menu')){event.preventDefault();openDialog('#menu-dialog');}
 if(target.hasAttribute('data-open-search')){event.preventDefault();openDialog('#search-dialog');}
 if(target.hasAttribute('data-close-dialog'))target.closest('dialog')?.close();
 if(target.dataset.favorite){const ids=favorites();const id=target.dataset.favorite;if(!products.some(p=>p.id===id))return;if(ids.has(id))ids.delete(id);else ids.add(id);if(write(FAVORITES_KEY,[...ids])){refresh();notify(ids.has(id)?'Сохранено в избранном этого браузера.':'Товар удалён из избранного.');}}
 if(target.dataset.addProduct){
  const p=products.find(p=>p.id===target.dataset.addProduct);const skuId=target.dataset.skuId||null;const offer=p?offerFor(p,skuId):null;
  if(!p||!offer){notify('Не удалось определить исполнение. Обновите страницу.');return;}
  const quantityInput=$<HTMLInputElement>('#product-quantity');const quantity=quantityInput?Number(quantityInput.value):1;
  if(!Number.isInteger(quantity)||quantity<1||quantity>99){const error=$('#quantity-error');if(error){error.textContent='Укажите целое количество от 1 до 99.';error.hidden=false;}quantityInput?.focus();return;}
  const error=$('#quantity-error');if(error)error.hidden=true;
  const lines=cart();const existing=lines.find(l=>l.productId===p.id&&l.skuId===skuId);
  if(existing&&existing.quantity+quantity>99){notify('В демонстрации можно добавить не больше 99 единиц одной позиции.');return;}
  if(existing)existing.quantity+=quantity;else lines.push({productId:p.id,skuId,quantity});
  if(write(CART_KEY,lines)){refresh();notify(offer.available<(existing?.quantity??quantity)?'Добавлено как демо-предзаказ. Реальный заказ не создан.':'Добавлено в демо-корзину. Реальный заказ не создан.');}
 }
 if(target.dataset.removeLine){const lines=cart().filter(l=>`${l.productId}:${l.skuId??''}`!==target.dataset.removeLine);if(write(CART_KEY,lines)){refresh();notify('Товар убран из демо-корзины.');}}
 if(target.hasAttribute('data-clear-cart')){if(write(CART_KEY,[])){refresh();notify('Демо-корзина очищена.');}}
});
$$<HTMLDialogElement>('dialog').forEach(dialog=>{dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});});
window.addEventListener('storage',refresh);refresh();
