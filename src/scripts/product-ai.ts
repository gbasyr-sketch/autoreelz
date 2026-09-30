import {node} from './manager-page';
import {commerceGet,CommerceError,getSession} from './commerce';
import {aiSourceSignature,type AITextRequest,type AITextStatus,type AIProvider} from '../lib/ai-text';
import type {EditorData} from '../lib/product-editor';

export function productAIPanel(root:HTMLElement,hooks:{id:string;data:()=>EditorData;apply:(description:string,meta:string)=>void;error:(e:unknown)=>void}){
 const summary=node('summary','Помощник для описания');root.append(summary);
 const content=node('div','','pe-stack');root.append(content);
 let status:AITextStatus|null=null,result:AITextRequest|null=null,working=false,epoch=0,sourceAtStart='',textsAtStart='',lastFingerprint='',activeKey='',storageKey='autoreelz.ai-text.'+hooks.id;
 const explain=node('p','Подготовим описание и текст для поиска по данным этой формы. Проверьте результат перед применением. SEO-заголовок остаётся ручным.','dash-help');
 const budget=node('p','Проверяем подключение…','dash-help');budget.setAttribute('role','status');
 const providerLabel=node('label','','dash-field pe-field'),select=node('select');providerLabel.append(node('span','Сервис генерации'),select);
 const notesLabel=node('label','','dash-field pe-field'),notes=node('textarea');notes.rows=3;notes.maxLength=1500;notes.placeholder='Например, что входит в поставку или особенности установки, которые вы проверили.';notesLabel.append(node('span','Дополнительные факты для этого текста'),notes,node('small','Необязательно. Эти заметки отправятся выбранному сервису; сами по себе они не публикуются.','dash-help'));
 const facts=node('details');facts.append(node('summary','Какие данные используются'),node('p','Название, категория, варианты, характеристики, правила совместимости и дополнительные факты. Цены, остатки, фотографии, артикулы и коды маркетплейсов, SEO-заголовок и сведения покупателей не передаются.','dash-help'));
 const actions=node('div','','pe-inline-actions'),generate=node('button','Сгенерировать описание','dash-button'),fresh=node('button','Создать новый запрос','dash-button');generate.type=fresh.type='button';fresh.hidden=true;actions.append(generate,fresh);
 const message=node('p','','dash-help');message.setAttribute('role','status');const preview=node('div','','pe-ai-preview pe-stack');preview.hidden=true;
 const heading=node('h3','Предварительный просмотр');heading.tabIndex=-1;
 const stale=node('p','Данные товара или исходные тексты изменились. Создайте новый запрос, чтобы не затереть правки.','dash-message dash-error');stale.hidden=true;
 const descLabel=node('label','','dash-field pe-field'),description=node('textarea');description.rows=8;description.maxLength=10000;descLabel.append(node('span','Описание товара'),description);
 const metaLabel=node('label','','dash-field pe-field'),meta=node('textarea');meta.rows=3;meta.maxLength=320;metaLabel.append(node('span','Текст для поиска (meta description)'),meta);
 const review=node('p','Проверьте факты и совместимость. ИИ может ошибаться; тексты ещё не применены и не опубликованы.','dash-help');
 const apply=node('button','Применить в черновик','dash-button dash-primary');apply.type='button';const close=node('button','Закрыть просмотр','dash-button');close.type='button';const previewActions=node('div','','pe-inline-actions');previewActions.append(apply,close);preview.append(heading,review,stale,descLabel,metaLabel,previewActions);
 content.append(explain,budget,providerLabel,notesLabel,facts,actions,message,preview);
 function texts(){const d=hooks.data();return JSON.stringify([d.description,d.metaDescription]);}
 function signature(){return aiSourceSignature(hooks.data(),notes.value);}
 function changed(){if(!preview.hidden){stale.hidden=signature()===sourceAtStart&&texts()===textsAtStart;apply.disabled=!stale.hidden||working;}generate.disabled=working||!status?.enabled;select.disabled=working;notes.disabled=working;fresh.disabled=working;}
 function renderBudget(next:AITextStatus){status=next;const chosen=select.value;select.replaceChildren();for(const p of status.providers){const option=node('option',p==='deepseek'?'DeepSeek Flash':'OpenAI GPT-6 Luna');option.value=p;select.append(option);}select.value=status.providers.includes(chosen as AIProvider)?chosen:status.provider;budget.textContent=status.enabled?`Общий лимит: $${Number(status.limitUsd).toFixed(2)} за ${status.month}. Учтено до $${(Math.ceil(Number(status.usedUpperUsd)*10000)/10000).toFixed(4)}. Доступно $${(Math.floor(Number(status.remainingUsd)*10000)/10000).toFixed(4)}.${status.uncertainCount?' Неподтверждённые запросы зарезервированы по верхней границе.':''}`:'Настоящая генерация пока не подключена. Описание можно заполнить вручную.';changed();}
 async function load(){const current=epoch;try{const value=await commerceGet<AITextStatus>('/api/manager/product-ai');if(current===epoch)renderBudget(value);}catch(e){if(current===epoch){budget.textContent='Не удалось проверить генератор. Обновите сохранённые данные, чтобы повторить.';if(e instanceof CommerceError&&(e.status===401||e.status===403))hooks.error(e);}}}
 async function fingerprint(){const raw=hooks.id+'|'+select.value+'|'+signature();const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function remember(key:string,fp:string){activeKey=key;lastFingerprint=fp;try{sessionStorage.setItem(storageKey,JSON.stringify({key,fingerprint:fp}));}catch{/* The in-memory key still protects retries in this page. */}}
 async function run(forceNew=false){if(working||!status?.enabled)return;const current=epoch;working=true;changed();message.textContent='Готовим два текста…';fresh.hidden=true;
  const sentSource=signature(),sentTexts=texts(),data=structuredClone(hooks.data()),sentNotes=notes.value,provider=select.value;
  try{
   const fp=await fingerprint();if(current!==epoch)return;
   if(!activeKey)try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved&&typeof saved.key==='string'){activeKey=saved.key;lastFingerprint=saved.fingerprint;}}catch{/* No reusable request. */}
   if(forceNew||!activeKey||lastFingerprint!==fp)remember(crypto.randomUUID(),fp);
   const session=await getSession();const r=await fetch('/api/manager/product-ai',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({productId:hooks.id,provider,data,notes:sentNotes,idempotencyKey:activeKey}),signal:AbortSignal.timeout(45000)}),payload=await r.json();
   if(current!==epoch)return;if(!r.ok)throw new CommerceError(payload.error?.message??'Не удалось подготовить текст.',r.status,payload.error?.code);
   result=payload as AITextRequest;renderBudget(result.status);message.textContent=result.message+(result.state==='uncertain'?' Новый запрос может оплачиваться отдельно.':'');
   if(result.state==='completed'&&result.result){sourceAtStart=sentSource;textsAtStart=sentTexts;description.value=result.result.description;meta.value=result.result.metaDescription;preview.hidden=false;generate.textContent='Показать этот результат';fresh.textContent='Сгенерировать другой вариант';fresh.hidden=false;heading.focus();}
   else{preview.hidden=true;generate.textContent='Проверить результат запроса';fresh.textContent='Создать новый запрос';fresh.hidden=result.state==='running';}
  }catch(e){if(current!==epoch)return;message.textContent=e instanceof CommerceError?e.message:'Ответ не получен. Нажмите «Проверить результат запроса»: повтор не создаст второй платный запрос.';generate.textContent='Проверить результат запроса';if(e instanceof CommerceError){if(e.status===401||e.status===403)hooks.error(e);if(e.code==='KEY_REUSED')fresh.hidden=false;}}
  finally{if(current===epoch){working=false;changed();}}
 }
 generate.addEventListener('click',()=>void run(false));fresh.addEventListener('click',()=>void run(true));notes.addEventListener('input',changed);select.addEventListener('change',()=>{if(result)message.textContent='Выбран другой сервис. Новый запрос будет учтён в общем лимите.';});
 apply.addEventListener('click',()=>{changed();if(apply.disabled)return;if(description.value.trim().length<10||meta.value.trim().length<10){message.textContent='Заполните оба текста перед применением.';return;}preview.hidden=true;hooks.apply(description.value.trim(),meta.value.trim());message.textContent='Тексты перенесены в форму. Сохраните черновик или опубликуйте товар после проверки.';});
 close.addEventListener('click',()=>{preview.hidden=true;generate.focus();});
 return{load,changed,lock(){epoch++;working=false;status=null;result=null;activeKey='';lastFingerprint='';notes.value='';description.value='';meta.value='';preview.hidden=true;message.textContent='';budget.textContent='Войдите, чтобы использовать генератор.';changed();}};
}
