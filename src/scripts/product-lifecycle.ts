import {commerceGet,commerceCommand} from './commerce';
import {node,link,managerDirty} from './manager-page';
import type {ProductLifecycle} from '../lib/product-lifecycle';
export function productLifecycle(root:HTMLElement,hooks:{done:(action:'archive'|'restore'|'purge')=>Promise<void>;error:(e:unknown)=>void;busy?:(value:boolean)=>void}){
 const dialog=node('dialog','','product-lifecycle-dialog'),heading=node('h2'),copy=node('p'),details=node('div'),message=node('p','','dash-message dash-error'),actions=node('div','','mgr-row-actions'),cancel=node('button','Отмена','dash-button'),submit=node('button','','dash-button dash-danger');
 copy.setAttribute('aria-live','polite');heading.id='product-lifecycle-title';dialog.setAttribute('aria-labelledby',heading.id);message.hidden=true;message.setAttribute('role','alert');cancel.type=submit.type='button';cancel.autofocus=true;actions.append(cancel,submit);dialog.append(heading,copy,details,message,actions);root.append(dialog);
 let view:ProductLifecycle|null=null,key='',action:'archive'|'restore'|'purge'='archive',busy=false,serial=0;
 function close(){if(busy)return;serial++;dialog.close();hooks.busy?.(false);}
 cancel.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 submit.addEventListener('click',async()=>{if(!view||busy)return;busy=true;hooks.busy?.(true);submit.disabled=cancel.disabled=true;message.hidden=true;
  try{await commerceCommand('/api/manager/product-lifecycle',{id:view.id,token:view.token,action,idempotencyKey:key});busy=false;dialog.close();managerDirty(false);await hooks.done(action);}
  catch(e){message.textContent=e instanceof Error?e.message:'Не удалось выполнить действие. Повторите запрос.';message.hidden=false;hooks.error(e);}
  finally{busy=false;submit.disabled=cancel.disabled=false;hooks.busy?.(false);}
 });
 root.addEventListener('autoreelz:manager-locked',()=>{serial++;view=null;copy.textContent='';details.replaceChildren();message.hidden=true;dialog.close();hooks.busy?.(false);});
 return{async open(id:string,nextAction:'archive'|'restore'|'purge'){
  if(busy)return;const turn=++serial;view=null;action=nextAction;key=crypto.randomUUID();heading.textContent=action==='archive'?'Удалить товар с сайта?':action==='purge'?'Удалить товар окончательно?':'Восстановить товар?';copy.textContent='Проверяем сведения…';details.replaceChildren();message.hidden=true;submit.textContent=action==='archive'?'Удалить с сайта':action==='purge'?'Удалить окончательно':'Восстановить в черновик';submit.disabled=true;cancel.disabled=false;dialog.showModal();
  try{const current=await commerceGet<ProductLifecycle>('/api/manager/product-lifecycle?id='+encodeURIComponent(id));if(turn!==serial||!dialog.open)return;view=current;
   copy.textContent=action==='purge'?`«${current.name}» будет удалён из рабочего каталога и раздела «Удалённые». Восстановить его через менеджер будет нельзя. Заказы, SKU, складской учёт и общие фотографии сохранятся.`:action==='archive'?`«${current.name}» исчезнет с витрины и попадёт в «Удалённые». Заказы, остатки, фотографии и сохранённый черновик сохранятся. Несохранённые изменения формы будут потеряны.`:`«${current.name}» вернётся в черновики. Проверьте карточку и опубликуйте её отдельно.`;
   if(current.hasLive)details.append(node('p',`Физический остаток: ${current.onHand}. В резерве: ${current.reserved}. Удаление не отменяет существующие заказы.`,'dash-help'));
   if(action==='archive'&&current.bundles.length){details.append(node('p','Сначала измените состав или уберите с сайта эти комплекты:','dash-help'));const cms=document.querySelector<HTMLElement>('[data-cms-url]')?.dataset.cmsUrl;for(const b of current.bundles)details.append(cms?link(b.name,`${cms}/content/ar_products/${b.id}`,'text-link'):node('p',b.name));return;}
   if(action==='purge'&&!current.archived){details.append(node('p','Товар уже восстановлен. Обновите список.','dash-help'));return;}
   submit.disabled=false;
  }catch(e){if(turn===serial){message.textContent=e instanceof Error?e.message:'Не удалось загрузить сведения.';message.hidden=false;hooks.error(e);}}
 }};
}
