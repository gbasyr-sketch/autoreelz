import {commerceGet,commerceCommand} from './commerce';
import type {ManagerOrderView} from '../lib/management-types';
import {shipmentLabels,cdekStatusLabels,type ShipmentWorkspace,type ShipmentInput,type ShipmentPreview} from '../lib/cdek-shipments';
import {formatRubles} from '../lib/money';
import '../styles/cdek-shipments.css';
const api='/api/manager/cdek-shipments';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls=''){const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;}
function button(text:string){const b=node('button',text,'button-secondary');b.type='button';return b;}
const date=(s:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(s));
export async function appendCdekShipmentPanel(card:HTMLElement,order:ManagerOrderView){
 const section=node('section','','cdek-panel');section.dataset.cdekPanel='';section.append(node('h2','Отправление СДЭК'));
 const content=node('div','','cdek-content'),feedback=node('p','','notice');feedback.hidden=true;feedback.tabIndex=-1;feedback.setAttribute('role','status');section.append(feedback,content);card.append(section);
 let busy=false,dirty=false,workspace:ShipmentWorkspace;
 section.addEventListener('input',()=>{dirty=true;});
 function say(message:string,error=false){feedback.textContent=message;feedback.className=error?'notice warning':'notice';feedback.hidden=false;feedback.focus({preventScroll:true});}
 async function run(fn:()=>Promise<void>){if(busy)return;busy=true;section.setAttribute('aria-busy','true');const controls=Array.from(section.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button')),disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);try{await fn();}catch(e){say(e instanceof Error?e.message:'Не удалось выполнить действие.',true);}finally{busy=false;section.removeAttribute('aria-busy');controls.forEach((c,i)=>c.disabled=disabled[i]!);}}
 async function load(){dirty=false;workspace=await commerceGet<ShipmentWorkspace>(api+'?orderId='+order.id);render();}
 function render(){
  content.replaceChildren();
  if(!workspace.enabled){content.append(node('p',workspace.reason??'Отправления пока не подключены.','field-help'));if(!workspace.shipments.length)return;}
  if(workspace.enabled)content.append(node('p',workspace.mode==='test'?'Тестовая среда СДЭК · реальные отправления не создаются. Контакты получателя заменяются тестовыми.':'Рабочая среда СДЭК · создание накладной передаст сведения о заказе перевозчику.','notice'));
  const reload=button('Обновить статусы');reload.dataset.cdekRefresh='';reload.disabled=!workspace.enabled;reload.addEventListener('click',()=>void run(async()=>{if(dirty){say('Завершите редактирование посылки перед обновлением статусов.');return;}for(const s of workspace.shipments.filter(s=>!['cancelled','rejected'].includes(s.state)))await commerceCommand(api,{action:'refresh',shipmentId:s.id});await load();say('Состояние обновлено. Запрошена проверка в СДЭК; результат появится после обработки.');}));content.append(reload);
  for(const s of workspace.shipments){const box=node('article','','cdek-shipment');box.dataset.shipmentId=s.id;
   box.append(node('h3',shipmentLabels[s.state]??s.state),node('p',s.trackingNumber?'Номер СДЭК: '+s.trackingNumber:'Номер СДЭК ещё не получен','cdek-tracking'));
   if(s.carrierCode)box.append(node('p',cdekStatusLabels[s.carrierCode]??'Статус СДЭК: '+s.carrierCode));
   box.append(node('p','Обновлено '+date(s.updatedAt)+' · МСК','field-help'));if(s.error)box.append(node('p',s.error,'notice warning'));
   const actions=node('div','','cdek-actions');
   if(s.canPrint){const print=button(s.print?.state==='uncertain'?'Сформировать PDF заново':'Сформировать накладную PDF');print.dataset.cdekPrint='';print.disabled=!!s.print&&['queued','sending','pending'].includes(s.print.state);print.addEventListener('click',()=>void run(async()=>{await commerceCommand(api,{action:'print',shipmentId:s.id,retryUncertain:s.print?.state==='uncertain'});await load();say('Запрос PDF сохранён. Обновите статусы через несколько секунд.');}));actions.append(print);}
   if(s.print){if(s.print.state==='ready'&&s.canPrint){const download=node('a','Скачать накладную','button-secondary');download.href=api+'?printId='+s.print.id;download.download='cdek-waybill.pdf';download.dataset.cdekDownload='';actions.append(download);}else if(['queued','sending','pending'].includes(s.print.state))box.append(node('p','PDF формируется в СДЭК. Закрытие страницы не прервёт обработку.','field-help'));if(s.print.error)box.append(node('p',s.print.error,'notice warning'));}
   box.append(actions);
   if(s.canCancel){const details=node('details'),summary=node('summary','Отменить отправление');const form=node('form','','commerce-form');form.dataset.editForm='';const label=node('label','Причина отмены','field'),reason=node('input');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.name='cdekCancelReason';label.append(reason);const submit=button('Подтвердить отмену отправления');submit.type='submit';submit.dataset.cdekCancel='';form.append(node('p','Отменяется только накладная СДЭК. Заказ, оплата и остатки сохраняются.','field-help'),label,submit);form.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await commerceCommand(api,{action:'cancel',shipmentId:s.id,reason:reason.value.trim()});await load();say('Отмена запрошена. Дождитесь подтверждения СДЭК.');});});details.append(summary,form);box.append(details);}
   const history=node('details'),list=node('ol','','cdek-history');history.append(node('summary','История отправления'));for(const h of s.history)list.append(node('li',date(h.at)+' · '+h.message));history.append(list);box.append(history);content.append(box);
  }
  if(!workspace.enabled||workspace.shipments.some(s=>!['rejected','cancelled'].includes(s.state)))return;
  if(order.status!=='paid'||order.paymentStatus!=='paid'){content.append(node('p','Создание отправления станет доступно после оплаты заказа.','field-help'));return;}
  if(order.trackingNumber||!['quoted','packing'].includes(order.deliveryStatus)){content.append(node('p','У заказа уже отмечена отправка. Проверьте существующий трек-номер.','field-help'));return;}
  if(order.delivery.provider!=='cdek'){content.append(node('p','В этом заказе доставка уточнялась вручную. Оформите накладную в кабинете СДЭК и сохраните её трек-номер в управлении доставкой ниже.','field-help'));return;}
  const form=node('form','','commerce-form cdek-form');form.dataset.editForm='';form.dataset.cdekForm='';form.append(node('h3','Подготовьте посылку'),node('p','Одна коробка на заказ. Проверьте фактические размеры и вес вместе с упаковкой. Товары и стоимость берутся из оплаченного заказа.','field-help'));
  const grid=node('div','','cdek-fields'),fields:Record<string,HTMLInputElement>={};
  function field(name:string,label:string,value:number|undefined,max:number){const l=node('label',label,'field'),i=node('input');i.name=name;i.type='number';i.min='1';i.max=String(max);i.step='1';i.inputMode='numeric';i.required=true;i.value=value?String(value):'';l.append(i);fields[name]=i;return l;}
  for(const [key,label,max]of [['weightG','Вес посылки, г',200000],['lengthMm','Длина, мм',3000],['widthMm','Ширина, мм',3000],['heightMm','Высота, мм',3000]] as const)grid.append(field(key,label,workspace.package?.[key],max));form.append(grid);
  form.append(node('p','Укажите вес одной единицы каждой позиции. Для комплекта — вес всего комплекта без внешней коробки.','field-help'));
  const weights=node('div','','cdek-items');order.lines.forEach((l,index)=>weights.append(field('item-'+index,`${l.name} · ${l.quantity} шт. — вес одной, г`,undefined,200000)));form.append(weights);
  const previewButton=button('Проверить посылку');previewButton.type='submit';previewButton.dataset.cdekPreview='';const review=node('div','','cdek-review');review.hidden=true;form.append(previewButton,review);let preview:ShipmentPreview|null=null,input:ShipmentInput|null=null;
  form.addEventListener('input',()=>{preview=null;review.hidden=true;review.replaceChildren();});
  form.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
   input={weightG:Number(fields.weightG!.value),lengthMm:Number(fields.lengthMm!.value),widthMm:Number(fields.widthMm!.value),heightMm:Number(fields.heightMm!.value),itemWeights:order.lines.map((_,i)=>Number(fields['item-'+i]!.value))};
   preview=await commerceCommand<ShipmentPreview>(api,{action:'preview',orderId:order.id,...input});review.replaceChildren();review.hidden=false;
   review.append(node('h3','Проверьте перед созданием'),node('p',`${preview.recipient} · ${preview.phone}`),node('p',`${preview.origin} → ${preview.destination}`),node('p',`Тариф ${preview.tariff} · ${preview.parcel.weightG} г · ${Math.ceil(preview.parcel.lengthMm/10)} × ${Math.ceil(preview.parcel.widthMm/10)} × ${Math.ceil(preview.parcel.heightMm/10)} см`));
   const items=node('ul');for(const i of preview.items)items.append(node('li',`${i.name} · ${i.quantity} шт. · ${formatRubles(i.unitPrice)} за шт.`));review.append(items,node('p','Объявленная стоимость: '+formatRubles(preview.declaredValue)),node('p','Получателю к оплате в СДЭК: '+formatRubles(preview.collectionAmount)),node('p','Стоимость услуг СДЭК по договору может включать страховку от объявленной стоимости. Оплаченная покупателем сумма заказа не изменится.','field-help'));
   const create=button(preview.environment==='test'?'Создать тестовое отправление':'Создать отправление СДЭК');create.className='button';create.dataset.cdekCreate='';create.addEventListener('click',()=>void run(async()=>{if(!preview||!input)return;await commerceCommand(api,{action:'create',orderId:order.id,...input,previewToken:preview.token});await load();say('Запрос сохранён. Можно закрыть страницу: результат останется в заказе.');}));review.append(create);review.tabIndex=-1;review.focus();
  });});content.append(form);
 }
 const timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);return;}if(document.visibilityState==='visible'&&!busy&&!dirty&&!section.contains(document.activeElement)&&workspace?.shipments.some(s=>['queued','sending','uncertain','accepted','cancel_queued','cancelling','cancel_uncertain'].includes(s.state)||s.print&&['queued','sending','pending'].includes(s.print.state)))void run(load);},10000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});window.addEventListener('autoreelz:staff-exiting',()=>clearInterval(timer),{once:true});
 try{await load();}catch(e){say(e instanceof Error?e.message:'Не удалось загрузить отправления.',true);const retry=button('Повторить загрузку СДЭК');retry.addEventListener('click',()=>void run(load));content.append(retry);}
}
