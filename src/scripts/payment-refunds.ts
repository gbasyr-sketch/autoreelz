import {commerceGet,commerceCommand,CommerceError} from './commerce';
import {refundLabels,type RefundWorkspace} from '../lib/payment-refunds';
import {formatRubles} from '../lib/money';
import '../styles/payment-refunds.css';
const api='/api/manager/payment-refunds';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
export async function appendPaymentRefunds(card:HTMLElement,orderId:string,onQueued:()=>Promise<void>){
 const section=node('section','','refund-panel');section.dataset.refunds='';section.append(node('h2','Возврат оплаты'));
 const feedback=node('p','','notice');feedback.setAttribute('role','status');feedback.hidden=true;const content=node('div','','refund-content');section.append(feedback,content);card.append(section);
 async function load(){
  const data=await commerceGet<RefundWorkspace>(api+'?orderId='+orderId);content.replaceChildren();
  content.append(node('p','Тестовая ЮKassa. Доступен полный возврат отдельного платежа, включая доставку. После запроса заказ останется на ручной проверке. Товар возвращается на склад отдельной операцией.','field-help'));
  for(const r of data.refunds){const item=node('div','','notice');item.append(node('strong',`${formatRubles(r.amountRubles)} · ${refundLabels[r.state]}`),node('p',r.reason));content.append(item);}
  if(!data.payments.length)content.append(node('p','Нет подтверждённых платежей ЮKassa для возврата.','field-help'));
  for(const p of data.payments.filter(p=>p.canRefund)){
   const form=node('form','','commerce-form');form.dataset.editForm='';
   form.append(node('h3','Полный возврат '+formatRubles(p.amountRubles)));
   const label=node('label','Причина возврата','field'),reason=node('textarea');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.rows=2;label.append(reason);
   const consent=node('label','','confirmation-choice'),check=node('input');check.type='checkbox';check.required=true;consent.append(check,node('span',`Подтверждаю возврат ${formatRubles(p.amountRubles)} и передачу заказа на ручную проверку.`));
   const submit=node('button','Вернуть тестовый платёж','button-secondary');submit.type='submit';form.append(label,consent,submit);content.append(form);
   form.addEventListener('submit',e=>{e.preventDefault();if(submit.disabled)return;submit.disabled=true;reason.readOnly=true;check.disabled=true;form.setAttribute('aria-busy','true');
    void commerceCommand(api,{orderId,paymentId:p.id,amountRubles:p.amountRubles,reason:reason.value.trim(),confirmed:true}).then(async()=>{feedback.textContent='Запрос сохранён. ЮKassa обработает возврат в фоне.';feedback.hidden=false;await onQueued();}).catch(e=>{feedback.textContent=e instanceof Error?e.message:'Не удалось получить результат. Повторите тот же запрос.';feedback.hidden=false;submit.disabled=false;submit.textContent='Повторить тот же запрос';if(e instanceof CommerceError&&e.status>0&&e.status<500){reason.readOnly=false;check.disabled=false;submit.textContent='Вернуть тестовый платёж';}}).finally(()=>form.removeAttribute('aria-busy'));
   });
  }
  const refresh=node('button','Обновить результат','button-secondary');refresh.type='button';refresh.addEventListener('click',()=>{refresh.disabled=true;void load().catch(showError).finally(()=>refresh.disabled=false);});content.append(refresh);
 }
 function showError(e:unknown){feedback.textContent=e instanceof Error?e.message:'Не удалось загрузить возвраты.';feedback.hidden=false;}
 await load().catch(showError);
}
