import{initShippingForm}from'./shipping-form';
import{russianValidation}from'./russian-validation';
import {formatRubles as money,parseRublesInput,type Rubles} from '../lib/money';
import type {ManagerOrderView} from '../lib/management-types';
import type {ShopSession,CartView,CartLineView,CheckoutInput,CheckoutQuote,CheckoutResult,OrderView,OrderLineSnapshot,QuoteGroup,DeliveryEstimate} from '../lib/commerce-types';

const root=document.querySelector<HTMLElement>('[data-commerce]');
const q=<T extends Element=HTMLElement>(selector:string,context:ParentNode=document)=>context.querySelector<T>(selector);
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;}
function link(text:string,href:string,className=''){const a=el('a',text,className);a.href=href;return a;}
function button(text:string,className='button-secondary'){const b=el('button',text,className);b.type='button';return b;}
function safePath(value:string,fallback='/catalog'){return value.startsWith('/')&&!value.startsWith('//')?value:fallback;}
function field(label:string,name:string,type='text',value=''){const node=el('label',label,'field');const input=el('input');input.name=name;input.type=type;input.value=value;node.append(input);return {node,input};}
function notice(text:string,kind=''){return el('p',text,`notice ${kind}`);}
const statusLabels:Record<string,string>={open:'Ожидает расчёта доставки',preorder_pending:'Ожидает подтверждения менеджера',awaiting_payment:'Ожидает оплаты',paid:'Оплачен',expired:'Срок оплаты истёк',cancelled:'Отменён',manual_review:'Требует проверки менеджером'};
const paymentLabels:Record<string,string>={unpaid:'Не оплачен',pending:'Ожидается подтверждение',paid:'Тестовая оплата получена',failed:'Оплата не прошла',review:'Платёж проверяется'};
const deliveryLabels:Record<string,string>={pending_quote:'Стоимость уточняется',quoted:'Стоимость рассчитана',packing:'Сборка',shipped:'Отправлен',delivered:'Получен'};
const kindLabel=(kind:string)=>kind==='preorder'?'Предзаказ':'Товары в наличии';
const deliveryLabel=(method:string)=>method==='courier'?'СДЭК — курьер':'СДЭК — пункт выдачи';

export class CommerceError extends Error{constructor(message:string,public status=0,public code='network'){super(message);}}
let sessionPromise:Promise<ShopSession>|null=null;
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(['/api/commerce/quote','/api/commerce/delivery-estimate'].includes(path)?40000:20000),...options});}catch{throw new CommerceError('Не удалось связаться с магазином. Проверьте соединение и повторите действие.');}
 const payload=await response.json().catch(()=>null);
 if(!response.ok)throw new CommerceError(payload?.error?.message??'Не удалось выполнить действие. Попробуйте ещё раз.',response.status,payload?.error?.code??'http');
 return payload as T;
}
export function getSession(fresh=false){if(fresh)sessionPromise=null;if(!sessionPromise)sessionPromise=request<ShopSession>('/api/commerce/session').catch(error=>{sessionPromise=null;throw error;});return sessionPromise;}
export async function commerceGet<T>(path:string){await getSession();return request<T>(path);}
// Keep the same key if the outcome is unknown, including an explicit retry after a network error.
const pendingCommands=new Map<string,string>();
export async function commerceCommand<T>(path:string,body:object):Promise<T>{
 const session=await getSession();const fingerprint=path+JSON.stringify(body);const idempotencyKey=pendingCommands.get(fingerprint)??crypto.randomUUID();pendingCommands.set(fingerprint,idempotencyKey);
 try{const result=await request<T>(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({...body,idempotencyKey})});pendingCommands.delete(fingerprint);return result;}
 catch(error){if(error instanceof CommerceError&&error.status>0&&error.status<500)pendingCommands.delete(fingerprint);throw error;}
}
let lastCartBadgeSnapshot:Pick<CartView,'version'|'csrfToken'>|undefined;
export function updateCartBadges(cart:CartView){if(lastCartBadgeSnapshot?.csrfToken===cart.csrfToken&&lastCartBadgeSnapshot.version>cart.version)return;lastCartBadgeSnapshot={version:cart.version,csrfToken:cart.csrfToken};const count=cart.lines.reduce((sum,line)=>sum+line.quantity,0);document.querySelectorAll('[data-cart-count]').forEach(node=>{node.textContent=String(count);node.closest('a')?.setAttribute('aria-label',`Корзина ${count}`);});document.dispatchEvent(new CustomEvent('autoreelz:cart-updated',{detail:cart}));}
function pageError(error:unknown){if(!root)return;const panel=q<HTMLElement>('[data-page-error]',root);if(!panel)return;panel.textContent=error instanceof Error?error.message:'Не удалось выполнить действие.';panel.hidden=false;panel.focus({preventScroll:true});panel.scrollIntoView({block:'nearest',behavior:'smooth'});}
function clearError(){const panel=q<HTMLElement>('[data-page-error]');if(panel){panel.hidden=true;panel.textContent='';}}
function loading(done=true){const node=q<HTMLElement>('[data-page-loading]');if(node)node.hidden=done;}
async function busy(control:HTMLElement,work:()=>Promise<void>){if(control.getAttribute('aria-busy')==='true')return;clearError();control.setAttribute('aria-busy','true');const controls=control instanceof HTMLButtonElement?[control]:[...control.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement|HTMLTextAreaElement>('input,button,select,textarea')];const previous=controls.map(node=>node.disabled);controls.forEach(node=>node.disabled=true);try{await work();}catch(error){pageError(error);}finally{control.removeAttribute('aria-busy');controls.forEach((node,index)=>node.disabled=previous[index]!);}}
function totalRow(label:string,value:string,isTotal=false){const row=el('div','',`commerce-total-row${isTotal?' total':''}`);row.append(el('span',label),el('span',value));return row;}
function totals(productTotal:Rubles,shipping:Rubles|null,total:Rubles|null){const box=el('div','','commerce-totals');box.append(totalRow('Товары',money(productTotal)),totalRow('Доставка',shipping===null?'Уточнит менеджер':money(shipping)),totalRow('Итого',total===null?'После расчёта доставки':money(total),true));if(shipping===null)box.children[1]?.lastElementChild?.classList.add('unknown-cost');return box;}
function snapshots(lines:OrderLineSnapshot[]){const list=el('ul','','snapshot-lines');for(const item of lines){const row=el('li','','snapshot-line');row.append(el('span',`${item.name} × ${item.quantity}`),el('strong',money(item.lineTotalRubles)),el('small',[item.article,item.variantLabel].filter(Boolean).join(' · ')));if(item.components.length>1){const details=el('details','','order-line-components');details.append(el('summary','Состав комплекта'));const content=el('ul');for(const component of item.components)content.append(el('li',`${component.name} · ${component.article} × ${component.quantity}`));details.append(content);row.append(details);}list.append(row);}return list;}
function empty(text:string,detail:string,href?:string){const box=el('div','','commerce-empty');box.append(el('h2',text),el('p',detail));if(href)box.append(link('В каталог',href,'button'));return box;}
function announce(message:string){const toast=q<HTMLElement>('#toast');if(toast){toast.textContent=message;toast.hidden=false;setTimeout(()=>toast.hidden=true,5000);}}

async function initCart(){
 const content=q<HTMLElement>('[data-cart-content]')!;let cart:CartView;
 type Intent={quantity:string;mode:'set'|'remove';ready:boolean};
 const pending=new Map<string,Intent>(),timers=new Map<string,ReturnType<typeof setTimeout>>();
 const rows=new Map<string,{row:HTMLElement;input:HTMLInputElement;remove:HTMLButtonElement;price:HTMLElement;unit:HTMLElement;kind:HTMLElement;message:HTMLElement;status:HTMLElement;form:HTMLFormElement}>();
 let running=false,failed=false,navigate=false;
 const grid=el('div','','commerce-grid'),list=el('div','','commerce-lines'),summary=el('aside','','commerce-panel commerce-summary');
 grid.append(list,summary);
 const retry=button('Повторить сохранение');retry.hidden=true;retry.addEventListener('click',()=>{failed=false;clearError();if(pending.size)void pump();else void load().catch(error=>{failed=true;pageError(error);render();});});
 const cost=el('div','','commerce-totals'),saveHint=el('p','','field-help'),preorderNote=notice('Предзаказ оформляется отдельно и оплачивается после подтверждения менеджером.','warning'),blockedNote=notice('Удалите недоступные товары, чтобы продолжить.','error'),checkoutLink=link('Перейти к оформлению','/checkout','button');
 summary.append(el('h2','Ваш заказ'),cost,saveHint,preorderNote,blockedNote,checkoutLink,retry,el('p','Доставку рассчитаем на следующем шаге. Тестовый режим: реальные деньги не списываются.','field-help'));
 checkoutLink.addEventListener('click',event=>{
  if(!pending.size&&!failed)return;event.preventDefault();
  if(failed){pageError(new Error('Сначала повторите сохранение изменений корзины.'));return;}
  for(const[id,intent]of pending){if(!valid(intent)){rows.get(id)?.form.requestSubmit();return;}clearTimeout(timers.get(id));intent.ready=true;}
  navigate=true;void pump();
 });
 async function load(){cart=await commerceGet<CartView>('/api/commerce/cart');updateCartBadges(cart);render();}
 function valid(intent:Intent){const n=Number(intent.quantity);return intent.mode==='remove'||intent.quantity.trim()!==''&&Number.isInteger(n)&&n>=1&&n<=99;}
 function schedule(line:CartLineView,value:string,mode:'set'|'remove'='set',immediate=false){
  if(mode==='set'&&!pending.has(line.id)&&value.trim()!==''&&Number(value)===cart.lines.find(item=>item.id===line.id)?.quantity)return;
  clearTimeout(timers.get(line.id));
  pending.set(line.id,{quantity:value,mode,ready:immediate});
  navigate=false;render();
  if(immediate)void pump();else timers.set(line.id,setTimeout(()=>{const intent=pending.get(line.id);if(intent){intent.ready=true;void pump();}},400));
 }
 async function pump(){
  if(running||failed)return;
  const next=[...pending].find(([,intent])=>intent.ready&&valid(intent));
  if(!next){if(navigate&&!pending.size){navigate=false;location.assign('/checkout');}return;}
  const[id,intent]=next,line=cart.lines.find(line=>line.id===id);if(!line){pending.delete(id);void pump();return;}
  running=true;clearError();render();
  try{
   cart=await commerceCommand<CartView>('/api/commerce/cart',{productId:line.productId,skuId:line.skuId,quantity:intent.mode==='remove'?0:Number(intent.quantity),mode:intent.mode,cartVersion:cart.version});
   if(pending.get(id)===intent)pending.delete(id);
   updateCartBadges(cart);announce(intent.mode==='remove'?'Товар удалён из корзины.':'Количество и сумма обновлены.');
  }catch(error){
   navigate=false;
   if(error instanceof CommerceError&&error.status===409){
    // A different tab or a previous uncertain request changed this version.
    // Show the authoritative cart; never overwrite it with an obsolete draft.
    pending.clear();timers.forEach(clearTimeout);timers.clear();
    try{await load();}catch{failed=true;}
    pageError(new Error('Корзина изменилась. Проверьте актуальные количество и сумму, затем повторите действие.'));
   }else{failed=true;pageError(error);}
  }finally{running=false;render();}
  if(!failed)void pump();
 }
 function render(){
  retry.hidden=!failed;
  if(!cart.lines.length){content.replaceChildren(empty('Корзина пока пуста','Выберите детали и нужные исполнения в каталоге.','/catalog'));return;}
  if(!grid.isConnected)content.replaceChildren(grid);
  for(const[id,view]of rows)if(!cart.lines.some(line=>line.id===id)){view.row.remove();rows.delete(id);pending.delete(id);clearTimeout(timers.get(id));}
  for(const line of cart.lines){
   let view=rows.get(line.id);
   if(!view){
    const row=el('article','','commerce-line');row.dataset.cartLine=line.id;
    const img=el('img');img.src=safePath(line.image,'/brand/favicon.svg');img.alt=line.name;img.width=100;img.height=77;
    const copy=el('div'),heading=el('h2');heading.append(link(line.name,safePath(line.url)));
    const kind=el('span'),message=el('p'),price=el('strong','','line-price'),unit=el('p');
    copy.append(heading,el('p',[line.article,line.variantLabel].filter(Boolean).join(' · ')),unit,kind,message);row.append(img,copy,price);
    const actions=el('div','','line-actions'),form=el('form','','quantity-form'),amount=field('Количество','quantity','number',String(line.quantity));
    amount.input.min='1';amount.input.max='99';amount.input.step='1';amount.input.required=true;amount.input.setAttribute('aria-label',`Количество: ${line.name}`);
    form.append(amount.node);const validation=russianValidation(form);
    amount.input.addEventListener('input',()=>schedule(line,amount.input.value));
    amount.input.addEventListener('change',()=>schedule(line,amount.input.value,'set',true));
    form.addEventListener('submit',event=>{event.preventDefault();if(validation.report())schedule(line,amount.input.value,'set',true);});
    const remove=button('Удалить');remove.setAttribute('aria-label',`Удалить: ${line.name}`);remove.addEventListener('click',()=>schedule(line,'0','remove',true));
    const status=el('p','','cart-save-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    actions.append(form,remove,status);row.append(actions);list.append(row);
    view={row,input:amount.input,remove,price,unit,kind,message,status,form};rows.set(line.id,view);
   }
   const intent=pending.get(line.id);
   if(!intent&&document.activeElement!==view.input)view.input.value=String(line.quantity);
   if(!intent&&document.activeElement===view.input&&Number(view.input.value)!==line.quantity)view.input.value=String(line.quantity);
   view.unit.textContent=`${money(line.unitPriceRubles)} / шт.`;view.price.textContent=money(line.lineTotalRubles);view.kind.textContent=line.blocked?'Товар недоступен':kindLabel(line.kind);view.kind.className=`commerce-kind ${line.kind}`;
   view.message.textContent=line.message??'';view.message.hidden=!line.message;view.message.className=line.blocked?'line-error':'';
   view.remove.disabled=intent?.mode==='remove';view.input.disabled=intent?.mode==='remove';
   view.status.textContent=intent?(!valid(intent)?'Укажите целое количество от 1 до 99.':failed?'Изменения не сохранены.':intent.mode==='remove'?'Удаляем…':'Сохраняем количество…'):'';
  }
  cost.replaceChildren(totalRow('Товары',money(cart.productTotalRubles),true));saveHint.textContent=pending.size?'Сумма обновится после сохранения количества.':'Количество и сумма сохраняются автоматически.';
  preorderNote.hidden=!cart.lines.some(line=>line.kind==='preorder');blockedNote.hidden=!cart.lines.some(line=>line.blocked);checkoutLink.hidden=!blockedNote.hidden;checkoutLink.setAttribute('aria-busy',String(pending.size>0));
 }
 try{await load();}catch(error){pageError(error);const reload=button('Повторить загрузку');reload.addEventListener('click',()=>void busy(reload,async()=>{await load();reload.remove();}));content.append(reload);}finally{loading();}
}

async function initCheckout(){
 const form=q<HTMLFormElement>('#checkout-form')!,content=q<HTMLElement>('[data-checkout-content]')!,review=q<HTMLElement>('[data-quote-review]')!,confirm=q<HTMLButtonElement>('[data-confirm-checkout]')!;let cart:CartView;let quote:CheckoutQuote|null=null;let confirmationInput:HTMLInputElement|undefined;
 const input=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement;
 function showForm(){quote=null;review.hidden=true;content.hidden=false;q('[data-step-contact]')?.setAttribute('aria-current','step');q('[data-step-review]')?.removeAttribute('aria-current');}
 let estimateSequence=0,estimateTimer:ReturnType<typeof setTimeout>|undefined,estimateExpires:ReturnType<typeof setTimeout>|undefined,estimateRequest:AbortController|undefined;
 const summaryLines=el('div'),totalsBox=el('div','','commerce-totals'),estimateStatus=el('p','','field-help'),estimateRetry=button('Повторить расчёт доставки');estimateRetry.hidden=true;estimateStatus.setAttribute('role','status');estimateStatus.setAttribute('aria-live','polite');
 function renderSummaryLines(lines:Pick<CartLineView,'name'|'quantity'|'lineTotalRubles'>[]){summaryLines.replaceChildren();for(const line of lines){const p=el('p',`${line.name} × ${line.quantity}`);p.append(el('span',` · ${money(line.lineTotalRubles)}`,'muted'));summaryLines.append(p);}}
 function estimateView(message:string,value?:DeliveryEstimate){
  if(value){cart.productTotalRubles=value.productTotalRubles;renderSummaryLines(value.groups.flatMap(g=>g.lines));}
  totalsBox.replaceChildren(totalRow('Товары',money(value?.productTotalRubles??cart.productTotalRubles)),totalRow('Доставка',value?(value.shippingCostRubles===null?'Уточнит менеджер':money(value.shippingCostRubles)):message),totalRow('Итого',value?.totalRubles?money(value.totalRubles):'После расчёта доставки',true));
  totalsBox.dataset.deliveryTotal=value?.shippingCostRubles??'';estimateStatus.textContent=value?(value.shippingCostRubles===null?'До уточнения стоимости доставки оплата недоступна.':'Предварительный расчёт. Окончательный итог проверьте перед оформлением.'):'';
  const cost=value?(value.shippingCostRubles===null?'Доставка: стоимость уточнит менеджер.':`Доставка ${money(value.shippingCostRubles)} · Итого ${money(value.totalRubles!)}.`):message;
  form.querySelectorAll<HTMLElement>('[data-delivery-cost-preview]').forEach(n=>n.textContent=cost);
  if(value?.groups.length&&value.groups.length>1)estimateStatus.textContent=value.groups.map(g=>`${kindLabel(g.kind)}: ${g.shipping.costRubles===null?'стоимость уточнит менеджер':money(g.shipping.costRubles)}.`).join(' ');
 }
 function cancelEstimate(){estimateSequence++;clearTimeout(estimateTimer);clearTimeout(estimateExpires);estimateRequest?.abort();estimateRequest=undefined;}
 const validation=russianValidation(form);
 const deliveryInput=initShippingForm(form,()=>{validation.refresh();scheduleEstimate();});
 function scheduleEstimate(){
  cancelEstimate();if(!cart)return;estimateRetry.hidden=true;
  if((form.elements.namedItem('manualDelivery') as HTMLInputElement|null)?.checked){estimateView('Уточнит менеджер');return;}
  let delivery:ReturnType<typeof deliveryInput>;try{delivery=deliveryInput();if(delivery.city.length<2||delivery.address.length<3)throw Error();}catch{estimateView('Выберите ПВЗ или укажите адрес');return;}
  const sequence=estimateSequence;estimateView('Рассчитываем…');
  estimateTimer=setTimeout(()=>void(async()=>{
   const controller=new AbortController();estimateRequest=controller;const timeout=setTimeout(()=>controller.abort(),40000);
   try{const session=await getSession();const value=await request<DeliveryEstimate>('/api/commerce/delivery-estimate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({delivery,cartVersion:cart.version}),signal:controller.signal});if(sequence!==estimateSequence)return;estimateView('',value);estimateRetry.hidden=value.shippingCostRubles!==null;
    estimateExpires=setTimeout(()=>{if(sequence===estimateSequence){estimateView('Расчёт устарел');estimateRetry.hidden=false;}},Math.max(0,new Date(value.expiresAt).getTime()-Date.now()));
   }catch(e){if(sequence!==estimateSequence)return;estimateView('Уточнит менеджер');estimateStatus.textContent=e instanceof CommerceError&&e.status===409?'Корзина изменилась. Обновите её перед расчётом.':'Расчёт временно недоступен. Можно повторить его или оформить заказ для уточнения доставки.';estimateRetry.hidden=false;}finally{clearTimeout(timeout);if(estimateRequest===controller)estimateRequest=undefined;}
  })(),400);
 }
 estimateRetry.addEventListener('click',()=>void busy(estimateRetry,async()=>{await load();scheduleEstimate();}));
 async function load(){cart=await commerceGet<CartView>('/api/commerce/cart');updateCartBadges(cart);q<HTMLElement>('[data-checkout-empty]')!.hidden=cart.lines.length>0;content.hidden=!cart.lines.length;const box=q<HTMLElement>('[data-checkout-summary]')!;box.replaceChildren();renderSummaryLines(cart.lines);box.append(summaryLines,totalsBox,estimateStatus,estimateRetry);estimateView('Выберите ПВЗ или укажите адрес');}
 form.addEventListener('submit',event=>{event.preventDefault();cancelEstimate();void busy(form,async()=>{const data:CheckoutInput={customer:{name:input('name').value.trim(),phone:input('phone').value.trim(),email:input('email').value.trim()},delivery:deliveryInput(),cartVersion:cart.version};try{quote=await commerceCommand<CheckoutQuote>('/api/commerce/quote',data);}catch(error){if(error instanceof CommerceError&&error.status===409){await load();throw new Error('Состав, цены или наличие изменились. Корзина обновлена — проверьте её и повторите расчёт.');}throw error;}
   q<HTMLElement>('[data-quote-contact]')!.textContent=`${quote.customer.name} · ${quote.customer.phone} · ${quote.customer.email}. ${deliveryLabel(quote.delivery.method)}: ${quote.delivery.city}, ${quote.delivery.address}${quote.delivery.pointCode?` · ПВЗ ${quote.delivery.pointCode}`:''}.`;
   const confirmations=q<HTMLElement>('[data-checkout-confirmations]')!,details=el('details'),terms=quote.confirmation;
   details.append(el('summary',terms.title),el('p',terms.body));
   const label=el('label','','confirmation-choice');confirmationInput=el('input');confirmationInput.type='checkbox';confirmationInput.required=true;confirmationInput.dataset.acceptCheckout='';
   const confirmError=el('p','Подтвердите условия оформления заказа.','line-error');confirmError.hidden=true;confirmError.id='checkout-confirmation-error';confirmError.setAttribute('role','alert');confirmationInput.setAttribute('aria-describedby',confirmError.id);
   confirmationInput.addEventListener('change',()=>{confirmError.hidden=confirmationInput!.checked;confirmationInput!.setAttribute('aria-invalid',String(!confirmationInput!.checked));});
   label.append(confirmationInput,el('span',terms.label));confirmations.replaceChildren(details,label,confirmError);
   const groups=q<HTMLElement>('[data-quote-groups]')!;groups.replaceChildren();for(const group of quote.groups)groups.append(quoteGroup(group));content.hidden=true;review.hidden=false;q('[data-step-contact]')?.removeAttribute('aria-current');q('[data-step-review]')?.setAttribute('aria-current','step');q<HTMLElement>('[data-quote-validity]')!.textContent=`Расчёт действует до ${date(quote.expiresAt)}. После этого потребуется проверить стоимость снова.`;confirm.textContent=quote.groups.length>1?'Оформить 2 тестовых заказа':'Оформить тестовый заказ';q<HTMLElement>('#review-title')!.focus();
  });});
 q<HTMLButtonElement>('[data-edit-checkout]')!.addEventListener('click',()=>{showForm();scheduleEstimate();input('name').focus();});
 confirm.addEventListener('click',()=>{if(!confirmationInput?.checked){q<HTMLElement>('#checkout-confirmation-error')!.hidden=false;confirmationInput?.setAttribute('aria-invalid','true');confirmationInput?.focus();return;}void busy(confirm,async()=>{if(!quote)return;try{const result=await commerceCommand<CheckoutResult>('/api/commerce/checkout',{quoteId:quote.id,cartVersion:quote.cartVersion,confirmation:{accepted:true,version:quote.confirmation.version}});if(!result.orderIds.length)throw new Error('Заказ не подтверждён. Обновите корзину и попробуйте ещё раз.');window.location.assign(`/orders/${encodeURIComponent(result.orderIds[0]!)}${result.orderIds.length>1?`?related=${result.orderIds.map(encodeURIComponent).join(',')}`:''}`);}catch(error){if(error instanceof CommerceError&&error.status===409){showForm();await load();throw new Error('За время оформления изменились цены, наличие или состав. Повторите расчёт и проверьте обновлённый заказ.');}throw error;}});});
 try{await load();const session=await getSession();if(session.email)input('email').value=session.email;}catch(error){pageError(error);}finally{loading();}
}
function quoteGroup(group:QuoteGroup){const box=el('article','','commerce-panel');box.append(el('h2',kindLabel(group.kind)),snapshots(group.lines),totals(group.productTotalRubles,group.shipping.costRubles,group.totalRubles));if(group.shipping.costRubles===null)box.append(notice(group.shipping.reason??'Стоимость доставки уточнит менеджер. До расчёта доставка не включена в итог и оплата недоступна.','warning'));else box.append(el('p',group.shipping.carrier?`${group.shipping.label}. Ориентир СДЭК: ${group.shipping.carrier.periodMin===group.shipping.carrier.periodMax?group.shipping.carrier.periodMin:group.shipping.carrier.periodMin+'–'+group.shipping.carrier.periodMax} дн. после передачи посылки.`:`${group.shipping.label}. Расчёт в тестовом режиме.`,'field-help'));if(group.kind==='preorder')box.append(el('p','Менеджер согласует срок и условия. Оплата будет доступна после подтверждения.','field-help'));else box.append(el('p','После оформления товары резервируются на 30 минут. Если доставка требует уточнения, дождитесь расчёта менеджера.','field-help'));return box;}

function orderCard(order:OrderView,manager=false){const card=el('article','','order-card');const top=el('div','','order-card-top');const name=el('div');name.append(el('h3',`Заказ ${order.number}`),el('p',date(order.createdAt)));top.append(name,el('span',kindLabel(order.kind),`commerce-kind ${order.kind}`));card.append(top,el('span',statusLabels[order.status]??order.status,`status-pill ${order.status}`),el('p',order.lines.map(line=>`${line.name} × ${line.quantity}`).join(', ')),el('p',order.totalRubles===null?`Товары ${money(order.productTotalRubles)} · доставка уточняется`:`Итого ${money(order.totalRubles)}`));if(!manager){card.append(el('p',`Доставка: ${deliveryLabels[order.deliveryStatus]??order.deliveryStatus}`));if(order.trackingNumber)card.append(el('p',`Трек-номер: ${order.trackingNumber}`));card.append(link('Посмотреть заказ',`/orders/${encodeURIComponent(order.id)}`,'button-secondary'));}return card;}
function orderHistory(order:OrderView){const details=el('details','','order-history');details.append(el('summary','История заказа'));const list=el('ol');for(const event of order.events){const li=el('li',event.note||'Статус заказа обновлён');const time=el('time',date(event.at));time.dateTime=event.at;li.append(time);list.append(li);}details.append(list);return details;}
function orderMeta(order:OrderView){const meta=el('div','','order-meta');const customer=el('section');customer.append(el('h3','Получатель'),el('p',order.customer.name),el('p',order.customer.phone),el('p',order.customer.email));const delivery=el('section');delivery.append(el('h3','Доставка'),el('p',deliveryLabel(order.delivery.method)),el('p',`${order.delivery.city}, ${order.delivery.address}`),el('p',deliveryLabels[order.deliveryStatus]??order.deliveryStatus));if(order.delivery.pointCode)delivery.append(el('p',`ПВЗ: ${order.delivery.pointCode}`));if(order.delivery.carrier)delivery.append(el('p',`Расчёт СДЭК: ${order.delivery.carrier.tariffName}, ориентир ${order.delivery.carrier.periodMin===order.delivery.carrier.periodMax?order.delivery.carrier.periodMin:order.delivery.carrier.periodMin+'–'+order.delivery.carrier.periodMax} дн. после передачи.`));if(order.trackingNumber)delivery.append(el('p',`Трек-номер: ${order.trackingNumber}`));if(order.deliveredAt)delivery.append(el('p',`Получен: ${date(order.deliveredAt)}`));meta.append(customer,delivery);if(order.confirmation){const proof=el('details','','order-history');proof.append(el('summary','Подтверждение оформления'),el('p',`Принято ${date(order.confirmation.acceptedAt)} · ${order.confirmation.version}`),el('p',order.confirmation.label),el('p',order.confirmation.body));meta.append(proof);}return meta;}
async function initOrder(){
 const id=root!.dataset.orderId??'',content=q<HTMLElement>('[data-order-content]')!,reload=q<HTMLButtonElement>('[data-reload-order]')!;let order:OrderView;let deadlineTimer:ReturnType<typeof setTimeout>|undefined;
 async function load(){order=await commerceGet<OrderView>(`/api/commerce/order?id=${encodeURIComponent(id)}`);render();}
 function render(){if(deadlineTimer)clearTimeout(deadlineTimer);q<HTMLElement>('[data-order-title]')!.textContent=`Заказ ${order.number}`;content.replaceChildren();const grid=el('div','','commerce-grid'),main=el('section','','commerce-panel');const status=el('div','','order-status');status.append(el('span',statusLabels[order.status]??order.status,`status-pill ${order.status}`),el('span',kindLabel(order.kind),`commerce-kind ${order.kind}`));main.append(status,el('h2','Состав заказа'),snapshots(order.lines),orderMeta(order));if(order.terms)main.append(notice(`Условия предзаказа: ${order.terms}`));if(order.reviewReason)main.append(notice(order.reviewReason,'warning'));main.append(orderHistory(order));
  const side=el('aside','','commerce-panel commerce-summary');side.append(el('h2','Оплата и итог'),totals(order.productTotalRubles,order.shippingCostRubles,order.totalRubles));const actions=el('div','','order-actions');actions.append(el('p',paymentLabels[order.paymentStatus]??order.paymentStatus,'muted'));
  if(order.shippingCostRubles===null)actions.append(notice(order.shippingReason??'Менеджер уточнит стоимость доставки. До расчёта оплата недоступна.','warning'));
  if(order.kind==='preorder'&&order.status==='preorder_pending')actions.append(notice('Предзаказ принят. Менеджер согласует срок и условия, затем откроет оплату.'));
  if(order.expiresAt&&['open','awaiting_payment'].includes(order.status)){const remaining=new Date(order.expiresAt).getTime()-Date.now();actions.append(notice(remaining>0?`Оплатите до ${date(order.expiresAt)}. После истечения 30 минут заказ закрывается, товары возвращаются в продажу.`:'Срок оплаты истёк. Статус заказа обновится автоматически.','warning'));if(remaining>0)deadlineTimer=setTimeout(()=>void load().catch(pageError),Math.min(remaining+1500,2_000_000));}
  const payment=order.paymentAction;
  if(payment?.provider==='yookassa-sandbox'&&payment.pending){
   const state=notice(payment.message??'Ожидаем подтверждение тестовой оплаты.','warning');state.dataset.paymentStatus='';state.tabIndex=-1;actions.append(state);
   if(payment.confirmationUrl&&order.canPay)actions.append(link('Продолжить тестовую оплату',payment.confirmationUrl,'button'));
   if(payment.canCheck){const refresh=button('Проверить оплату');refresh.dataset.refreshPayment='';refresh.addEventListener('click',()=>void busy(refresh,async()=>{try{order=await commerceCommand<OrderView>('/api/commerce/payment-status',{orderId:order.id});render();q<HTMLElement>('[data-payment-status]',content)?.focus({preventScroll:true});announce('Статус оплаты обновлён.');}catch(error){await load();throw error;}}));actions.append(refresh);}
  }
  if(order.canPay&&!payment?.pending){
   const external=payment?.provider==='yookassa-sandbox',form=el('form','','payment-form'),methods=el('fieldset','','payment-methods');methods.append(el('legend',external?'Тестовая оплата ЮKassa':'Тестовый способ оплаты'));
   for(const [value,label]of (external?[['card','Банковская карта']]:[['card','Банковская карта'],['sbp','СБП']])){const row=el('label'),radio=el('input');radio.type='radio';radio.name='method';radio.value=value!;radio.checked=value==='card';row.append(radio,el('span',label));methods.append(row);}
   const pay=button(external?'Перейти к тестовой оплате':'Оплатить тестово','button');pay.type='submit';form.append(methods,pay,el('p',external?'На странице ЮKassa используйте тестовую карту. Реальные деньги не списываются.':'Это имитация оплаты. Данные карты не нужны, деньги не списываются.','field-help'));
   form.addEventListener('submit',event=>{event.preventDefault();const method=q<HTMLInputElement>('input:checked',form)?.value??'card';void busy(form,async()=>{try{order=await commerceCommand<OrderView>('/api/commerce/pay',{orderId:order.id,shippingVersion:order.shippingVersion,method});const redirect=order.paymentAction?.confirmationUrl;if(redirect){const url=new URL(redirect);if(url.protocol!=='https:'||!['yoomoney.ru','yookassa.ru'].includes(url.hostname)||url.username||url.password||url.port)throw Error('Не удалось открыть страницу оплаты.');window.location.assign(url.href);return;}render();announce('Статус тестовой оплаты обновлён.');}catch(error){await load();throw error;}});});actions.append(form);
  }
  if(order.canCancel){const cancel=button('Отменить заказ');cancel.addEventListener('click',()=>{const confirmBox=el('div','','notice warning');confirmBox.append(el('p','Отменить этот заказ? Зарезервированные товары вернутся в продажу.'));const confirm=button('Да, отменить'),back=button('Сохранить заказ');confirm.addEventListener('click',()=>void busy(confirm,async()=>{order=await commerceCommand<OrderView>('/api/commerce/cancel',{orderId:order.id});render();announce('Заказ отменён.');}));back.addEventListener('click',()=>{confirmBox.remove();cancel.hidden=false;cancel.focus();});confirmBox.append(confirm,back);cancel.hidden=true;actions.append(confirmBox);confirm.focus();});actions.append(cancel);}
  if(['expired','cancelled'].includes(order.status))actions.append(link('Вернуться в каталог','/catalog','button-secondary'));side.append(actions);grid.append(main,side);content.append(grid);
 }
 const related=(new URLSearchParams(location.search).get('related')??'').split(',').filter(value=>/^[a-f0-9-]{36}$/i.test(value));if(related.length>1){const nav=q<HTMLElement>('[data-related-orders]')!;nav.hidden=false;nav.append(el('span','Заказы этой покупки:'));related.slice(0,2).forEach((value,index)=>{const a=link(`Заказ ${index+1}`,`/orders/${value}?related=${related.join(',')}`);if(value===id)a.setAttribute('aria-current','page');nav.append(a);});}
 reload.addEventListener('click',()=>void busy(reload,load));try{await load();const poll=setInterval(async()=>{if(document.visibilityState!=='visible'||content.querySelector('[aria-busy=true]')||content.contains(document.activeElement)||!['open','preorder_pending','awaiting_payment','manual_review'].includes(order.status))return;try{const fresh=await commerceGet<OrderView>(`/api/commerce/order?id=${encodeURIComponent(id)}`);if(JSON.stringify(fresh)!==JSON.stringify(order)){order=fresh;render();}}catch{/* Manual refresh remains available if the background request fails. */}},15000);window.addEventListener('pagehide',()=>{clearInterval(poll);if(deadlineTimer)clearTimeout(deadlineTimer);},{once:true});}catch(error){pageError(error);content.append(notice('Заказ доступен в браузере, где он оформлен, или после подтверждения email покупателя.'));content.append(link('Войти по email','/account','button-secondary'));}finally{loading();}
}

async function initAccount(){
 let challengeId='',requestedEmail='';let resendAt=0;let resendTimer:ReturnType<typeof setInterval>|undefined;const resend=q<HTMLButtonElement>('[data-resend-code]')!;const requestForm=q<HTMLFormElement>('#request-code-form')!,verifyForm=q<HTMLFormElement>('#verify-code-form')!;
 async function load(){const session=await getSession(true);q<HTMLElement>('[data-account-content]')!.hidden=false;q<HTMLElement>('[data-account-login]')!.hidden=!!session.email;q<HTMLElement>('[data-account-identity]')!.hidden=!session.email;q<HTMLElement>('[data-account-email]')!.textContent=session.email??'';q<HTMLElement>('[data-guest-orders-note]')!.hidden=!!session.email;const result=await commerceGet<{orders:OrderView[]}>('/api/commerce/orders');const list=q<HTMLElement>('[data-account-orders]')!;list.replaceChildren();if(!result.orders.length)list.append(empty('Заказов пока нет',session.email?'Здесь появятся ваши заказы и предзаказы.':'Оформите заказ в этом браузере или войдите, чтобы открыть свою историю.','/catalog'));else for(const order of result.orders)list.append(orderCard(order));}
 function countdown(){const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));resend.disabled=seconds>0||resend.getAttribute('aria-busy')==='true'||verifyForm.getAttribute('aria-busy')==='true';resend.textContent=seconds?`Повторить отправку через ${seconds} с`:'Отправить новый код';if(!seconds&&resendTimer){clearInterval(resendTimer);resendTimer=undefined;}}
 async function sendCode(email:string){const result=await commerceCommand<{challengeId:string;expiresAt:string}>('/api/auth/request',{email});challengeId=result.challengeId;requestedEmail=email;resendAt=Date.now()+60000;countdown();if(resendTimer)clearInterval(resendTimer);resendTimer=setInterval(countdown,1000);requestForm.hidden=true;verifyForm.hidden=false;verifyForm.reset();q<HTMLElement>('[data-code-notice]')!.textContent=`Тестовое письмо для ${email} создано. Код действует до ${date(result.expiresAt)}.`;(verifyForm.elements.namedItem('code') as HTMLInputElement).focus();}
 requestForm.addEventListener('submit',event=>{event.preventDefault();const email=(requestForm.elements.namedItem('email') as HTMLInputElement).value.trim();void busy(requestForm,()=>sendCode(email));});
 resend.addEventListener('click',()=>void busy(resend,async()=>{await sendCode(requestedEmail);setTimeout(countdown,0);}));
 verifyForm.addEventListener('submit',event=>{event.preventDefault();const code=(verifyForm.elements.namedItem('code') as HTMLInputElement).value.trim();void busy(verifyForm,async()=>{await commerceCommand('/api/auth/verify',{challengeId,code});await getSession(true);await load();if(resendTimer)clearInterval(resendTimer);announce('Email подтверждён. Вы вошли в кабинет.');});});
 q<HTMLButtonElement>('[data-change-email]')!.addEventListener('click',()=>{challengeId='';verifyForm.reset();verifyForm.hidden=true;requestForm.hidden=false;(requestForm.elements.namedItem('email') as HTMLInputElement).focus();clearError();});
 const logout=q<HTMLButtonElement>('[data-logout]')!;logout.addEventListener('click',()=>void busy(logout,async()=>{await commerceCommand('/api/auth/logout',{});await getSession(true);requestForm.hidden=false;verifyForm.hidden=true;verifyForm.reset();await load();announce('Вы вышли из кабинета.');}));
 const reload=q<HTMLButtonElement>('[data-reload-account]')!;reload.addEventListener('click',()=>void busy(reload,load));try{await load();}catch(error){pageError(error);}finally{loading();}
}

type StockItem={skuId:string;article:string;name:string;onHand:number;reserved:number;available:number};
async function initManager(){
 const {appendOwnerOrderTools,bindOwnerExtras}=await import('./owner-tools');
 const extras=bindOwnerExtras({refresh:load,error:pageError,notify:announce});
 const content=q<HTMLElement>('[data-manager-content]')!,login=q<HTMLElement>('[data-manager-login]')!,loginForm=q<HTMLFormElement>('#manager-login-form')!,list=q<HTMLElement>('[data-manager-orders]')!;let orders:ManagerOrderView[]=[];
 async function stock(){const result=await commerceGet<{items:StockItem[]}>('/api/manager/stock');const select=q<HTMLSelectElement>('[data-stock-select]')!;const selected=select.value;select.replaceChildren(new Option('Выберите исполнение',''));for(const item of result.items)select.append(new Option(`${item.article} · ${item.name} · свободно ${item.available} (резерв ${item.reserved})`,item.skuId));select.value=selected;extras.stock(result.items);}
 async function load(){try{const result=await commerceGet<{orders:ManagerOrderView[]}>('/api/manager/orders');orders=result.orders;content.hidden=false;login.hidden=true;render();await stock();}catch(error){if(error instanceof CommerceError&&(error.status===401||error.status===403)){content.hidden=true;login.hidden=false;if(error.status===403)pageError(new Error('У этого аккаунта нет прав на управление заказами и складом. Войдите как администратор новой CMS.'));return;}throw error;}}
 async function update(_order:OrderView){await load();}
 function render(){q<HTMLElement>('[data-manager-count]')!.textContent=`Всего: ${orders.length}`;list.replaceChildren();if(!orders.length){list.append(empty('Пока нет заказов','Оформите тестовую покупку в магазине.'));return;}for(const order of orders){const card=orderCard(order,true);card.dataset.managerOrder=order.id;card.append(snapshots(order.lines),orderMeta(order),totals(order.productTotalRubles,order.shippingCostRubles,order.totalRubles));if(order.expiresAt)card.append(el('p',`Срок оплаты: ${date(order.expiresAt)}`));if(order.terms)card.append(notice(`Условия: ${order.terms}`));if(order.reviewReason)card.append(notice(order.reviewReason,'warning'));
   const actions=el('div','','manager-order-actions');
   if(['open','preorder_pending','awaiting_payment'].includes(order.status)){const form=el('form','','commerce-form');form.append(el('h4','Расчёт доставки'));const cost=field('Стоимость, ₽','cost','text',order.shippingCostRubles??'');cost.input.inputMode='decimal';cost.input.pattern='[0-9]+([.,][0-9]{1,2})?';cost.input.required=true;const reason=field('Основание расчёта','note');reason.input.required=true;reason.input.minLength=3;reason.input.maxLength=500;const save=button('Сохранить доставку','button');save.type='submit';form.append(cost.node,reason.node,save);form.addEventListener('submit',event=>{event.preventDefault();let amount:Rubles;try{amount=parseRublesInput(cost.input.value);}catch(error){pageError(error);cost.input.focus();return;}void busy(card,async()=>{await update(await commerceCommand<OrderView>('/api/manager/shipping',{orderId:order.id,costRubles:amount,note:reason.input.value.trim()}));announce('Стоимость доставки сохранена.');});});actions.append(form);}
   if(order.kind==='preorder'&&order.status==='preorder_pending'){const form=el('form','','commerce-form');form.append(el('h4','Подтверждение предзаказа'));const label=el('label','Согласованные срок и условия','field');const terms=el('textarea');terms.name='terms';terms.required=true;terms.minLength=5;terms.maxLength=2000;terms.rows=3;label.append(terms);const submit=button('Подтвердить и открыть оплату','button');submit.type='submit';if(order.shippingCostRubles===null)submit.disabled=true;form.append(label,el('p',order.shippingCostRubles===null?'Сначала рассчитайте доставку.':'Все составляющие должны быть на складе. Подтверждение спишет их и откроет оплату на 30 минут.','field-help'),submit);form.addEventListener('submit',event=>{event.preventDefault();void busy(card,async()=>{await update(await commerceCommand<OrderView>('/api/manager/confirm',{orderId:order.id,terms:terms.value.trim()}));announce('Предзаказ подтверждён, оплата открыта.');});});actions.append(form);}
   if(actions.children.length)card.append(actions);appendOwnerOrderTools(card,order,{refresh:load,error:pageError,notify:announce});card.append(orderHistory(order));list.append(card);
  }}
 loginForm.addEventListener('submit',event=>{event.preventDefault();const email=(loginForm.elements.namedItem('email') as HTMLInputElement).value.trim(),password=(loginForm.elements.namedItem('password') as HTMLInputElement).value;void busy(loginForm,async()=>{await commerceCommand('/api/manager/login',{email,password});(loginForm.elements.namedItem('password') as HTMLInputElement).value='';await load();});});
 const reload=q<HTMLButtonElement>('[data-reload-manager]')!;reload.addEventListener('click',()=>void busy(reload,load));
 const stockForm=q<HTMLFormElement>('#manager-stock-form')!;stockForm.addEventListener('submit',event=>{event.preventDefault();const skuId=(stockForm.elements.namedItem('skuId') as HTMLSelectElement).value,quantity=Number((stockForm.elements.namedItem('quantity') as HTMLInputElement).value),reason=(stockForm.elements.namedItem('reason') as HTMLInputElement).value.trim();void busy(stockForm,async()=>{await commerceCommand('/api/manager/stock',{skuId,quantity,reason});const result=q<HTMLElement>('[data-stock-result]')!;result.hidden=false;result.textContent=`Принято на склад: ${quantity} шт.`;stockForm.reset();await stock();announce('Приход проведён.');});});
 const mail=q<HTMLButtonElement>('[data-load-mail]')!;mail.addEventListener('click',()=>void busy(mail,async()=>{const result=await commerceGet<{messages:{id:string;to:string;subject:string;body:string;createdAt:string}[]}>('/api/manager/mail');const box=q<HTMLElement>('[data-manager-mail]')!;box.replaceChildren();if(!result.messages.length)box.append(notice('Тестовых писем пока нет.'));for(const message of result.messages){const card=el('article','','mail-message');card.append(el('h3',message.subject),el('p',`Кому: ${message.to} · ${date(message.createdAt)}`),el('pre',message.body));box.append(card);}mail.textContent='Обновить письма';}));
 try{await load();}catch(error){pageError(error);}finally{loading();}
}

if(root){const initialize:Record<string,()=>Promise<void>>={cart:initCart,checkout:initCheckout,order:initOrder,account:initAccount,manager:initManager};const run=initialize[root.dataset.commerce??''];if(run)void run().catch(error=>{loading();pageError(error);});}
