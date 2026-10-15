import {commerceGet,commerceCommand,CommerceError} from './commerce';
import {formatRubles} from '../lib/money';
const api='/api/manager/closing-receipt';
const labels={queued:'Ожидает отправки',pending:'ЮKassa формирует чек',uncertain:'Результат запроса уточняется',succeeded:'Чек полного расчёта сформирован',canceled:'Формирование чека отменено',attention:'Требуется ручная сверка'};
type Job={id:string;paymentId:string;state:keyof typeof labels;amountRubles:string;createdAt:string;checkedAt:string|null;error:string|null;providerId:string|null};
type Workspace={enabled:boolean;canConfirm:boolean;jobs:Job[]};
type Intent={orderId:string;received:true;confirmed:true;reason:string};
type Saved={payload:Intent;key:string};
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
export async function appendClosingReceipts(card:HTMLElement,orderId:string,onQueued:()=>Promise<void>){
 const section=node('section','','refund-panel');section.dataset.closingReceipts='';section.append(node('h2','Получение и чек полного расчёта'));
 section.append(node('p','Статус оплаты и статус чека учитываются отдельно. После подтверждённой выдачи СДЭК чек формируется автоматически. При ручном изменении статуса доставки подтвердите фактическое получение здесь.','field-help'));
 const feedback=node('p','','notice');feedback.hidden=true;feedback.setAttribute('role','status');feedback.tabIndex=-1;
 const content=node('div','','refund-content');section.append(feedback,content);card.append(section);
 const storageKey='autoreelz:closing-receipt-intent:'+orderId;let saved:Saved|null=null,storageAvailable=true,pending=false,uncertain=false;
 function showError(error:unknown){feedback.textContent=error instanceof Error?error.message:'Не удалось обновить чек.';feedback.hidden=false;}
 try{const raw=sessionStorage.getItem(storageKey);if(raw){const data=JSON.parse(raw) as Saved;if(data.payload?.orderId!==orderId||data.payload.received!==true||data.payload.confirmed!==true||typeof data.payload.reason!=='string'||data.payload.reason.trim().length<3||data.payload.reason.length>500||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.key))throw Error('Не удалось восстановить незавершённый запрос чека. Требуется ручная сверка.');saved=data;uncertain=true;}}catch(error){storageAvailable=false;showError(error);}
 function clearSaved(){try{sessionStorage.removeItem(storageKey);saved=null;uncertain=false;return true;}catch{return false;}}
 async function load(){
  const data=await commerceGet<Workspace>(api+'?orderId='+encodeURIComponent(orderId));pending=false;content.replaceChildren();
  for(const job of data.jobs){
   const item=node('div','','notice refund-history');item.dataset.closingReceiptJob=job.id;item.append(node('strong',formatRubles(job.amountRubles)+' · '+(labels[job.state]??'Требуется ручная сверка')));
   if(job.error)item.append(node('p',job.error,'field-help'));
   if(job.checkedAt)item.append(node('p','Последняя проверка: '+new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(job.checkedAt)),'field-help'));
   if(job.providerId&&job.state!=='succeeded'){
    const check=node('button','Проверить чек в ЮKassa','button-secondary');check.type='button';check.dataset.checkClosingReceipt=job.id;check.disabled=uncertain||pending;
    check.addEventListener('click',()=>{if(pending||uncertain)return;pending=true;check.disabled=true;check.setAttribute('aria-busy','true');void commerceCommand(api,{action:'check',orderId,id:job.id}).then(async()=>{feedback.textContent='Статус чека обновлён.';feedback.hidden=false;await load();}).catch(showError).finally(()=>{pending=false;check.disabled=false;check.removeAttribute('aria-busy');});});item.append(check);
   }
   content.append(item);
  }
  if(!data.jobs.length)content.append(node('p','Чек полного расчёта ещё не сформирован.','field-help'));
  if(!data.enabled)content.append(node('p','Формирование чеков сейчас отключено настройками магазина.','notice warning'));
  else if(!data.canConfirm&&!data.jobs.length)content.append(node('p','Подтверждение доступно после получения заказа и проверки оплаты и возвратов.','field-help'));
  if((data.enabled&&data.canConfirm||saved)&&storageAvailable)renderForm();
  const refresh=node('button','Обновить состояние чеков','button-secondary');refresh.type='button';refresh.dataset.closingReceiptRefresh='';refresh.disabled=pending||uncertain;
  refresh.addEventListener('click',()=>{if(pending||uncertain)return;pending=true;refresh.disabled=true;void load().catch(showError).finally(()=>{pending=false;refresh.disabled=false;});});content.append(refresh);
 }
 function renderForm(){
  const form=node('form','','commerce-form');form.dataset.editForm='';form.dataset.closingReceiptForm='';
  const reasonLabel=node('label','Основание подтверждения получения','field'),reason=node('textarea');reason.name='closingReceiptReason';reason.rows=2;reason.required=true;reason.minLength=3;reason.maxLength=500;reasonLabel.append(reason);
  const consent=node('label','','confirmation-choice'),received=node('input');received.type='checkbox';received.name='closingReceiptReceived';received.required=true;consent.append(received,node('span','Подтверждаю, что покупатель фактически получил заказ. Сформировать чек полного расчёта.'));
  const submit=node('button','Подтвердить получение и сформировать чек','button-secondary');submit.type='submit';form.append(reasonLabel,consent,submit);content.append(form);
  function update(){submit.disabled=!storageAvailable||pending||!received.checked||reason.value.trim().length<3;}
  function freeze(){reason.readOnly=true;received.disabled=true;content.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);}
  if(saved){reason.value=saved.payload.reason;received.checked=true;freeze();submit.textContent='Повторить тот же запрос чека';submit.dataset.closingReceiptRetry='';submit.disabled=false;feedback.textContent='Сохранён незавершённый запрос. Повтор использует прежний ключ; новый чек пока недоступен.';feedback.hidden=false;}else update();
  reason.addEventListener('input',()=>{if(!saved){received.checked=false;update();}});received.addEventListener('change',update);
  form.addEventListener('submit',event=>{
   event.preventDefault();if(pending||submit.disabled)return;
   if(!saved){if(!received.checked||!form.reportValidity())return;const payload:Intent={orderId,received:true,confirmed:true,reason:reason.value.trim()};const intent={payload,key:crypto.randomUUID()};try{sessionStorage.setItem(storageKey,JSON.stringify(intent));saved=intent;}catch{storageAvailable=false;submit.disabled=true;showError(new Error('Браузер не сохраняет незавершённый запрос. Разрешите хранилище для сайта перед подтверждением получения.'));return;}}
   pending=true;freeze();form.setAttribute('aria-busy','true');feedback.hidden=true;
   void(async()=>{
    let result:{id:string|null;state?:string};
    try{result=await commerceCommand<{id:string|null;state?:string}>(api,{...saved!.payload,idempotencyKey:saved!.key},saved!.key);}catch(error){
     pending=false;const definite=error instanceof CommerceError&&error.status>0&&error.status<500;showError(error);
     if(definite&&clearSaved()){reason.readOnly=false;received.disabled=false;received.checked=false;submit.textContent='Подтвердить получение и сформировать чек';update();content.querySelectorAll<HTMLButtonElement>('[data-closing-receipt-refresh],[data-check-closing-receipt]').forEach(b=>b.disabled=false);}
     else{uncertain=true;submit.disabled=false;submit.textContent='Повторить тот же запрос чека';feedback.textContent+=' Поля зафиксированы. Повторите тот же запрос, чтобы уточнить результат.';}
     form.removeAttribute('aria-busy');return;
    }
    pending=false;
    if(!clearSaved()){uncertain=true;submit.disabled=false;submit.textContent='Повторить тот же запрос чека';feedback.textContent='Запрос сохранён, но браузер не смог удалить локальную запись. Повторите тот же запрос для сверки.';feedback.hidden=false;form.removeAttribute('aria-busy');return;}
    feedback.textContent=result.state==='not_required'?'Оплата полностью возвращена; закрывающий чек не требуется.':'Получение подтверждено. Чек полного расчёта поставлен в очередь; статус оплаты не меняется.';feedback.hidden=false;submit.textContent='Запрос сохранён';form.removeAttribute('aria-busy');
    try{await onQueued();if(section.isConnected)await load();}catch(error){showError(error);content.querySelectorAll<HTMLButtonElement>('[data-closing-receipt-refresh]').forEach(b=>b.disabled=false);}
   })();
  });
 }
 await load().catch(showError);
}
