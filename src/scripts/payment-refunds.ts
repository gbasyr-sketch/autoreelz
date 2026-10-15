import {commerceGet,commerceCommand,CommerceError} from './commerce';
import {refundLabels,type RefundPayment,type RefundWorkspace} from '../lib/payment-refunds';
import {compareRubles,formatRubles,multiplyRubles,parseRublesInput,sumRubles} from '../lib/money';
import '../styles/payment-refunds.css';
const api='/api/manager/payment-refunds';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
type SavedIntent={payload:RefundIntent;key:string};
type RefundIntent={orderId:string;paymentId:string;amountRubles:string;reason:string;confirmed:true;mode:'full'|'partial';lines:{lineIndex:number;quantity:number}[];shippingRubles:string};
export async function appendPaymentRefunds(card:HTMLElement,orderId:string,onQueued:()=>Promise<void>,live=false){
 const section=node('section','','refund-panel');section.dataset.refunds='';section.append(node('h2','Возврат оплаты'));
 const feedback=node('p','','notice');feedback.setAttribute('role','status');feedback.hidden=true;const content=node('div','','refund-content');section.append(feedback,content);card.append(section);
 let pending=false,uncertain=false,dataEnabled=false;
 const storageKey='autoreelz:refund-intent:'+orderId;let saved:SavedIntent|null=null,storageAvailable=true;
 try{const raw=sessionStorage.getItem(storageKey);if(raw){const value=JSON.parse(raw) as SavedIntent;if(value.payload.orderId!==orderId||!value.payload.paymentId||!Array.isArray(value.payload.lines)||!['full','partial'].includes(value.payload.mode)||typeof value.payload.reason!=='string'||!/^[a-f0-9-]{36}$/i.test(value.key))throw Error('Не удалось восстановить незавершённый возврат.');parseRublesInput(value.payload.amountRubles);parseRublesInput(value.payload.shippingRubles);if(value.payload.confirmed!==true||!value.payload.lines.every(line=>Number.isSafeInteger(line.lineIndex)&&line.lineIndex>=0&&Number.isSafeInteger(line.quantity)&&line.quantity>0))throw Error('Не удалось восстановить состав незавершённого возврата.');saved=value;}}catch(error){storageAvailable=false;showError(error);}
 function clearSaved(){try{sessionStorage.removeItem(storageKey);saved=null;return true;}catch{return false;}}
 function showError(e:unknown){feedback.textContent=e instanceof Error?e.message:'Не удалось загрузить возвраты.';feedback.hidden=false;}
 async function load(){
  if(pending||uncertain)return;
  const data=await commerceGet<RefundWorkspace>(api+'?orderId='+orderId);dataEnabled=data.enabled;content.replaceChildren();
  content.append(node('p',(live?'ЮKassa: возврат реальных денежных средств. ':'Тестовая ЮKassa: реальные деньги не возвращаются. ')+'Можно вернуть весь доступный остаток или выбранные товары и доставку. После запроса заказ остаётся на ручной проверке. Приёмка товара и приход на склад выполняются отдельно.','field-help'));
  for(const r of data.refunds){
   const item=node('div','','notice refund-history');item.append(node('strong',`${formatRubles(r.amountRubles)} · ${refundLabels[r.state]}`),node('p',r.reason));
   if(r.selection){const selection=r.selection,payment=data.payments.find(p=>p.id===r.paymentId);item.append(node('p',selection.mode==='full'?'Весь доступный остаток платежа':'Частичный возврат','field-help'));
    if(selection.opaque)item.append(node('p','Состав возврата недоступен: сохранена только сумма.','field-help'));
    else{const lines=node('ul');for(const selected of selection.lines){const product=payment?.lines.find(line=>line.lineIndex===selected.lineIndex);lines.append(node('li',`${product?.name??`Позиция ${selected.lineIndex+1}`} × ${selected.quantity} · ${formatRubles(multiplyRubles(selected.unitPriceRubles,selected.quantity))}`));}if(compareRubles(selection.shippingRubles,'0.00')>0)lines.append(node('li','Доставка · '+formatRubles(selection.shippingRubles)));if(lines.children.length)item.append(lines);}
   }content.append(item);
  }
  if(!data.payments.length)content.append(node('p','Нет подтверждённых платежей ЮKassa для возврата.','field-help'));
  for(const payment of data.payments)renderPayment(payment);
  const refresh=node('button','Обновить результат','button-secondary');refresh.type='button';refresh.dataset.refundRefresh='';refresh.addEventListener('click',()=>{if(pending||uncertain)return;refresh.disabled=true;void load().catch(showError).finally(()=>{if(!pending&&!uncertain)refresh.disabled=false;});});refresh.disabled=uncertain||pending;content.append(refresh);if(uncertain){const active=content.querySelector<HTMLFormElement>('form:has([data-refund-retry])');if(active)lockOtherForms(active,true);}if(saved&&!content.querySelector('[data-refund-retry]')){uncertain=true;refresh.disabled=true;content.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement|HTMLTextAreaElement>('form input,form button,form select,form textarea').forEach(control=>control.disabled=true);showError(new Error('Сохранён незавершённый запрос возврата. Не создавайте новый: для сверки результата требуется исходный платёж.'));}
 }
 function lockOtherForms(active:HTMLFormElement,locked:boolean){
  content.querySelectorAll<HTMLButtonElement>('[data-refund-refresh]').forEach(button=>button.disabled=locked);
  content.querySelectorAll<HTMLFormElement>('form').forEach(form=>{if(form!==active){form.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLTextAreaElement|HTMLSelectElement>('input,button,textarea,select').forEach(control=>control.disabled=locked);if(!locked)form.dispatchEvent(new Event('refund-unlock'));}});
 }
 function renderPayment(p:RefundPayment){
  const payment=node('div','','refund-payment');payment.dataset.refundPayment=p.id;
  payment.append(node('h3',live?'Платёж ЮKassa':'Тестовый платёж'));
  const summary=node('dl','','refund-balances');for(const[label,value]of [['Оплачено',p.amountRubles],['Возвращено',p.refundedRubles],['В обработке',p.reservedRubles],['Доступно к возврату',p.remainingRubles]]){const row=node('div');row.append(node('dt',label!),node('dd',formatRubles(value!)));summary.append(row);}payment.append(summary);
  if(p.blockReason)payment.append(node('p',p.blockReason,'notice warning'));
  content.append(payment);if(!dataEnabled||(!p.canRefund&&saved?.payload.paymentId!==p.id))return;
  const form=node('form','','commerce-form');form.dataset.editForm='';form.dataset.refundForm='';
  const modeLabel=node('label','Состав возврата','field'),mode=node('select');mode.name='refundMode';const full=node('option','Весь доступный остаток');full.value='full';mode.append(full);if(p.partialAvailable||saved?.payload.paymentId===p.id&&saved.payload.mode==='partial'){const partial=node('option','Выбранные товары и доставка');partial.value='partial';mode.append(partial);}modeLabel.append(mode);
  const composition=node('fieldset','','refund-composition');composition.hidden=true;composition.append(node('legend','Что вернуть'));
  const quantities=new Map<number,HTMLInputElement>();for(const line of p.lines){const label=node('label','','refund-line');label.append(node('span',line.name,'refund-line-name'),node('span',[line.variantLabel,formatRubles(line.unitPriceRubles)+' за шт.',`доступно ${line.remainingQuantity} из ${line.quantity}`].filter(Boolean).join(' · '),'field-help'));const quantity=node('input');quantity.type='number';quantity.name='refundQuantity-'+line.lineIndex;quantity.min='0';quantity.max=String(line.remainingQuantity);quantity.step='1';quantity.value='0';quantity.inputMode='numeric';quantity.setAttribute('aria-label','Вернуть штук: '+line.name);label.append(quantity);composition.append(label);quantities.set(line.lineIndex,quantity);}
  const shippingLabel=node('label','','confirmation-choice'),shipping=node('input');shipping.type='checkbox';shipping.name='refundShipping';shipping.disabled=compareRubles(p.shippingRemainingRubles,'0.00')===0;shippingLabel.append(shipping,node('span','Вернуть доставку: '+formatRubles(p.shippingRemainingRubles)));composition.append(shippingLabel);
  const total=node('p','','refund-total');total.setAttribute('aria-live','polite');const validation=node('p','','field-help');validation.setAttribute('role','status');
  const label=node('label','Причина возврата','field'),reason=node('textarea');reason.name='refundReason';reason.required=true;reason.minLength=3;reason.maxLength=500;reason.rows=2;label.append(reason);
  const consent=node('label','','confirmation-choice'),check=node('input'),consentText=node('span');check.type='checkbox';check.required=true;check.name='refundConfirmed';consent.append(check,consentText);
  const submit=node('button',live?'Вернуть платёж':'Вернуть тестовый платёж','button-secondary');submit.type='submit';form.append(modeLabel,composition,total,validation,label,consent,submit);payment.append(form);
  let intent:RefundIntent|null=null,intentKey:string|undefined,valid=false;
  function selection(){
   const selected:{lineIndex:number;quantity:number}[]=[];let shippingRubles='0.00',amountRubles=p.remainingRubles;
   if(mode.value==='partial'){
    for(const line of p.lines){const input=quantities.get(line.lineIndex)!,quantity=Number(input.value);if(input.value.trim()===''||!Number.isSafeInteger(quantity)||quantity<0||quantity>line.remainingQuantity)throw Error('Укажите целое количество в пределах доступного остатка.');if(quantity)selected.push({lineIndex:line.lineIndex,quantity});}
    shippingRubles=shipping.checked?p.shippingRemainingRubles:'0.00';
    amountRubles=sumRubles([...selected.map(line=>multiplyRubles(p.lines.find(item=>item.lineIndex===line.lineIndex)!.unitPriceRubles,line.quantity)),shippingRubles]);
   }
   if(compareRubles(amountRubles,'1.00')<0&&!(mode.value==='full'&&compareRubles(amountRubles,p.amountRubles)===0))throw Error('Минимальная сумма возврата — 1 ₽.');
   if(compareRubles(amountRubles,p.remainingRubles)>0)throw Error('Сумма превышает доступный остаток платежа.');
   // Compare exact decimals without converting rubles to binary floating point.
   if(compareRubles(amountRubles,p.remainingRubles)<0&&compareRubles(sumRubles([amountRubles,'1.00']),p.remainingRubles)>0)throw Error('После частичного возврата должен остаться 0 ₽ или не менее 1 ₽.');
   return{amountRubles,lines:selected,shippingRubles,mode:mode.value as 'full'|'partial'};
  }
  function update(reset=false){
   if(reset)check.checked=false;
   composition.hidden=mode.value!=='partial';composition.disabled=mode.value!=='partial';
   try{const selected=selection();total.textContent='К возврату: '+formatRubles(selected.amountRubles);consentText.textContent=`Подтверждаю возврат ${formatRubles(selected.amountRubles)} и передачу заказа на ручную проверку.`;validation.textContent='';valid=true;}catch(error){total.textContent='К возврату: выберите состав';consentText.textContent='Подтверждаю сумму возврата и передачу заказа на ручную проверку.';validation.textContent=error instanceof Error?error.message:'Проверьте состав возврата.';valid=false;check.checked=false;}
   check.disabled=!valid;submit.disabled=!storageAvailable||!valid||!check.checked||reason.value.trim().length<3;
  }
  mode.addEventListener('change',()=>update(true));quantities.forEach(input=>input.addEventListener('input',()=>update(true)));shipping.addEventListener('change',()=>update(true));reason.addEventListener('input',()=>update(true));check.addEventListener('change',()=>update());form.addEventListener('refund-unlock',()=>update(true));update();
  function freeze(locked:boolean){mode.disabled=locked;reason.readOnly=locked;check.disabled=locked||!valid;composition.disabled=locked||mode.value!=='partial';lockOtherForms(form,locked);}
  if(saved?.payload.paymentId===p.id){intent=saved.payload;intentKey=saved.key;mode.value=intent.mode;reason.value=intent.reason;shipping.checked=compareRubles(intent.shippingRubles,'0.00')>0;intent.lines.forEach(line=>{const input=quantities.get(line.lineIndex);if(input)input.value=String(line.quantity);});composition.hidden=intent.mode!=='partial';valid=true;check.checked=true;total.textContent='К возврату: '+formatRubles(intent.amountRubles);consentText.textContent='Зафиксирован запрос на '+formatRubles(intent.amountRubles)+'. Повтор будет с тем же ключом.';validation.textContent='Результат предыдущего запроса уточняется.';uncertain=true;section.dataset.refundUncertain='';freeze(true);submit.disabled=false;submit.dataset.refundRetry='';submit.textContent='Повторить тот же запрос';}
  form.addEventListener('submit',event=>{event.preventDefault();if(pending||submit.disabled)return;
   if(!intent){if(!valid||!check.checked||!form.reportValidity())return;intent={orderId,paymentId:p.id,...selection(),reason:reason.value.trim(),confirmed:true};intentKey=crypto.randomUUID();try{sessionStorage.setItem(storageKey,JSON.stringify({payload:intent,key:intentKey}));saved={payload:intent,key:intentKey};}catch{intent=null;storageAvailable=false;submit.disabled=true;showError(new Error('Браузер не сохраняет данные незавершённого запроса. Разрешите хранилище для сайта перед возвратом.'));return;}}
   pending=true;freeze(true);submit.disabled=true;form.setAttribute('aria-busy','true');feedback.hidden=true;
   void(async()=>{
    try{await commerceCommand(api,intent!,intentKey);}catch(error){
     pending=false;const definite=error instanceof CommerceError&&error.status>0&&error.status<500;uncertain=!definite;showError(error);
     if(definite&&clearSaved()){intent=null;delete section.dataset.refundUncertain;freeze(false);update(true);submit.textContent=live?'Вернуть платёж':'Вернуть тестовый платёж';}
     else{uncertain=true;section.dataset.refundUncertain='';submit.disabled=false;submit.textContent='Повторить тот же запрос';feedback.textContent+=definite?' Браузер не смог очистить локальную запись запроса. Поля зафиксированы: повторите тот же запрос; новый возврат пока недоступен.':' Поля зафиксированы. Повторите тот же запрос, чтобы уточнить результат; новый возврат пока недоступен.';}
     form.removeAttribute('aria-busy');return;
    }
    if(!clearSaved()){pending=false;uncertain=true;section.dataset.refundUncertain='';submit.disabled=false;submit.textContent='Повторить тот же запрос';form.removeAttribute('aria-busy');feedback.textContent='Запрос сохранён. Браузер не смог очистить локальную запись: повторите тот же запрос с сохранённым ключом для безопасной сверки. Новый возврат пока недоступен.';feedback.hidden=false;return;}
    uncertain=false;delete section.dataset.refundUncertain;feedback.textContent='Запрос сохранён. ЮKassa обработает возврат в фоне. Складской остаток не меняется.';feedback.hidden=false;submit.textContent='Запрос сохранён';form.removeAttribute('aria-busy');
    // Once accepted, a failed refresh must never turn into a second refund request.
    try{await onQueued();pending=false;if(section.isConnected)await load();}catch(error){pending=false;showError(error);content.querySelector<HTMLButtonElement>('[data-refund-refresh]')!.disabled=false;}
   })();
  });
 }
 await load().catch(showError);
}
