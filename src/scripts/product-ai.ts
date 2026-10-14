import {node} from './manager-page';
import {commerceGet,CommerceError,getSession} from './commerce';
import {aiSource,aiSourceSignature,type AITextRequest,type AITextStatus,type AIProvider,type AITextRevision} from '../lib/ai-text';
import type {EditorData} from '../lib/product-editor';

type Pending={body:Record<string,unknown>;source:string;texts:string};
type History={id:string;model:string;createdAt:string;sourceHash:string;result:{description:string;metaDescription:string}};
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>JSON.stringify(k)+':'+canonical(value)).join(',')+'}':JSON.stringify(v)??'null';
async function digest(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function productAIPanel(root:HTMLElement,hooks:{id:string;data:()=>EditorData;apply:(description:string,meta:string)=>void;error:(e:unknown)=>void}){
 root.append(node('summary','Помощник для описания'));
 const content=node('div','','pe-stack');root.append(content);
 let status:AITextStatus|null=null,result:AITextRequest|null=null,working=false,epoch=0,sourceAtStart='',textsAtStart='',pending:Pending|null=null;
 let storageKey='autoreelz.ai-text.v2.'+hooks.id;
 const button=(text:string,primary=false)=>{const b=node('button',text,'dash-button'+(primary?' dash-primary':''));b.type='button';return b;};
 const field=(title:string,rows:number,max:number)=>{const label=node('label','','dash-field pe-field'),input=node('textarea');input.rows=rows;input.maxLength=max;label.append(node('span',title),input);return{label,input};};
 const explain=node('p','Описание в стиле специалиста магазина: естественный язык и конкретные сведения о товаре. Проверьте факты перед применением.','dash-help');
 const budget=node('p','Проверяем подключение…','dash-help');budget.setAttribute('role','status');
 const providerLabel=node('label','','dash-field pe-field'),select=node('select');providerLabel.append(node('span','Модель'),select);
 const notesField=field('Дополнительные факты о товаре',4,1500),notes=notesField.input;notes.placeholder='Например: в комплекте шаблон и заглушка; для установки нужен вырез. Указывайте только проверенные сведения.';
 notesField.label.append(node('small','Сохраняются в истории запроса. Рекламный текст не подтверждает преимущества; факты одного исполнения не относятся ко всем.','dash-help'));
 const facts=node('details');facts.append(node('summary','Какие данные используются'),node('p','Название, категория, варианты, характеристики, совместимость и дополнительные факты. При правке также передаётся выбранный черновик. Фотографии, цены, остатки, SEO-заголовок и данные покупателей не используются.','dash-help'));
 const actions=node('div','','pe-inline-actions'),generate=button('Сгенерировать описание'),fresh=button('Сгенерировать другой вариант');fresh.hidden=true;actions.append(generate,fresh);
 const paid=node('p','Генерация другого варианта и переработка текста — новые платные запросы в пределах общего бюджета. Проверка уже отправленного запроса повторно не оплачивается.','dash-help');
 const message=node('p','','dash-help');message.setAttribute('role','status');
 const preview=node('div','','pe-ai-preview pe-stack');preview.hidden=true;
 const heading=node('h3','Предварительный просмотр');heading.tabIndex=-1;
 const stale=node('p','Данные товара или исходные тексты изменились. Создайте новый запрос, чтобы не затереть правки.','dash-message dash-error');stale.hidden=true;
 const descField=field('Описание товара',8,10000),description=descField.input,metaField=field('Текст для поиска (meta description)',3,320),meta=metaField.input;
 const review=node('p','Проверьте характеристики, комплектность и условия установки. Текст ещё не опубликован.','dash-help');
 const revisionField=field('Что изменить в этом варианте',3,1000),instruction=revisionField.input;instruction.placeholder='Например: сделай живее, убери повтор цветов, подробнее раскрой комплектацию.';
 const presets=node('div','','pe-inline-actions');for(const label of ['Живее','Короче','Больше конкретики']){const b=button(label);b.addEventListener('click',()=>{instruction.value=label==='Живее'?'Сделай язык живее и естественнее, сохрани факты.':label==='Короче'?'Сократи повторы, сохрани важные сведения.':'Раскрой полезные конкретные сведения из исходных фактов, без общих советов.';instruction.focus();});presets.append(b);}
 const revise=button('Переработать текст'),apply=button('Применить в черновик',true),close=button('Закрыть просмотр');
 const previewActions=node('div','','pe-inline-actions');previewActions.append(apply,close);
 preview.append(heading,review,stale,descField.label,metaField.label,revisionField.label,presets,revise,previewActions);
 const history=node('details'),historyList=node('div','','pe-stack');history.append(node('summary','Предыдущие варианты'),historyList);
 content.append(explain,budget,providerLabel,notesField.label,facts,actions,paid,message,preview,history);
 const texts=()=>JSON.stringify([hooks.data().description,hooks.data().metaDescription]);
 const signature=()=>aiSourceSignature(hooks.data(),notes.value);
 function remember(next:Pending|null){pending=next;try{if(next)sessionStorage.setItem(storageKey,JSON.stringify(next));else sessionStorage.removeItem(storageKey);}catch{/* In-memory pending request still prevents duplicate calls. */}}
 function changed(){
  if(!preview.hidden){stale.hidden=signature()===sourceAtStart&&texts()===textsAtStart;apply.disabled=!stale.hidden||working;}
  generate.disabled=working||!status?.enabled;fresh.disabled=generate.disabled;revise.disabled=working||!status?.enabled||!result;
  select.disabled=notes.disabled=instruction.disabled=description.disabled=meta.disabled=working;content.setAttribute('aria-busy',String(working));
  for(const b of presets.querySelectorAll('button'))b.disabled=working;
 }
 function renderBudget(next:AITextStatus){
  const first=!status,chosen=select.value;status=next;select.replaceChildren();
  const models=status.models??status.providers.map(p=>({provider:p,model:p==='openai'?'gpt-6-luna':'deepseek-flash',label:p==='openai'?'GPT-6 Luna':'DeepSeek Flash'}));
  for(const m of models){const option=node('option',m.label);option.value=m.model==='gpt-6.1-sol'?'openai-sol':m.provider;select.append(option);}
  const fallback=status.model==='gpt-6.1-sol'?'openai-sol':status.provider;select.value=!first&&[...select.options].some(o=>o.value===chosen)?chosen:fallback;
  budget.textContent=status.enabled?`Лимит: $${Number(status.limitUsd).toFixed(2)} за ${status.month}. Учтено до $${(Math.ceil(Number(status.usedUpperUsd)*10000)/10000).toFixed(4)}. Осталось $${(Math.floor(Number(status.remainingUsd)*10000)/10000).toFixed(4)}.${status.uncertainCount?' Неподтверждённые запросы учтены по верхней границе.':''}`:'Генерация пока не подключена. Описание можно заполнить вручную.';changed();
 }
 async function load(){const current=epoch;try{const next=await commerceGet<AITextStatus>('/api/manager/product-ai');if(current!==epoch)return;renderBudget(next);storageKey='autoreelz.ai-text.v2.'+hooks.id+'.'+(next.actorId??'local');
  if(!pending)try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.body?.productId===hooks.id&&typeof saved.body.idempotencyKey==='string'&&typeof saved.source==='string'&&typeof saved.texts==='string'){pending=saved;generate.textContent='Проверить результат запроса';fresh.hidden=false;message.textContent='Есть сохранённый запрос. Его результат можно проверить без новой генерации.';}}catch{/* Invalid local state is ignored. */}
 }catch(e){if(current===epoch){budget.textContent='Не удалось проверить генератор. Попробуйте обновить страницу.';if(e instanceof CommerceError&&(e.status===401||e.status===403))hooks.error(e);}}}
 function show(next:AITextRequest,source:string,previousTexts:string){result=next;sourceAtStart=source;textsAtStart=previousTexts;description.value=next.result!.description;meta.value=next.result!.metaDescription;instruction.value='';preview.hidden=false;heading.focus();changed();}
 async function run(forceNew=false,revision?:AITextRevision){
  if(working||!status?.enabled)return;const current=epoch;
  if(forceNew||!pending){const provider:AIProvider=select.value==='deepseek'?'deepseek':'openai';remember({body:{productId:hooks.id,provider,model:select.value==='openai-sol'?'gpt-6.1-sol':provider==='openai'?'gpt-6-luna':'deepseek-flash',data:structuredClone(hooks.data()),notes:notes.value,idempotencyKey:crypto.randomUUID(),...(revision?{revision}:{})},source:signature(),texts:texts()});}
  const sent=pending!;working=true;changed();message.textContent=revision?'Перерабатываем текст. Предыдущий вариант сохранён.':'Готовим описание и текст для поиска…';
  try{
   const session=await getSession();const r=await fetch('/api/manager/product-ai',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify(sent.body),signal:AbortSignal.timeout(110000)}),payload=await r.json();
   if(current!==epoch)return;if(!r.ok)throw new CommerceError(payload.error?.message??'Не удалось подготовить текст.',r.status,payload.error?.code);
   const next=payload as AITextRequest;renderBudget(next.status);message.textContent=next.message+(next.state==='uncertain'?' Не создавайте новый запрос до проверки расходов.':'');
   if(next.state==='completed'&&next.result){show(next,sent.source,sent.texts);generate.textContent='Показать этот результат';fresh.textContent='Сгенерировать другой вариант';fresh.hidden=false;}
   else{generate.textContent='Проверить результат запроса';fresh.textContent='Создать новый запрос';fresh.hidden=next.state==='running';}
  }catch(e){if(current!==epoch)return;message.textContent=e instanceof CommerceError?e.message:'Ответ не получен. Проверьте этот запрос: второй платный вызов не отправится.';generate.textContent='Проверить результат запроса';fresh.hidden=false;if(e instanceof CommerceError&&(e.status===401||e.status===403))hooks.error(e);}
  finally{if(current===epoch){working=false;changed();}}
 }
 generate.addEventListener('click',()=>void run());fresh.addEventListener('click',()=>void run(true));notes.addEventListener('input',changed);
 revise.addEventListener('click',()=>{if(!result||working)return;if(instruction.value.trim().length<3){message.textContent='Напишите, что изменить в тексте.';instruction.focus();return;}if(description.value.trim().length<10||meta.value.trim().length<10){message.textContent='Заполните оба текста перед переработкой.';return;}void run(true,{requestId:result.id,description:description.value,metaDescription:meta.value,instruction:instruction.value});});
 select.addEventListener('change',()=>{message.textContent='Выбранная модель используется для нового запроса. Проверка прежнего результата не меняет модель.';});
 apply.addEventListener('click',()=>{changed();if(apply.disabled)return;if(description.value.trim().length<10||meta.value.trim().length<10){message.textContent='Заполните оба текста перед применением.';return;}preview.hidden=true;hooks.apply(description.value.trim(),meta.value.trim());message.textContent='Тексты перенесены в форму. Сохраните черновик или опубликуйте товар после проверки.';});
 close.addEventListener('click',()=>{preview.hidden=true;generate.focus();});
 history.addEventListener('toggle',async()=>{if(!history.open)return;const current=epoch;historyList.replaceChildren(node('p','Загружаем варианты…','dash-help'));
  try{const rows=await commerceGet<History[]>('/api/manager/product-ai?history='+encodeURIComponent(hooks.id));if(current!==epoch)return;historyList.replaceChildren();if(!rows.length)historyList.append(node('p','Сохранённых вариантов пока нет.','dash-help'));
   for(const row of rows){const b=button(new Date(row.createdAt).toLocaleString('ru-RU')+' · '+row.model);b.addEventListener('click',async()=>{if(working||!status)return;const snapshot=signature(),hash=await digest(canonical(aiSource(hooks.data(),notes.value)));if(current!==epoch||working)return;show({...row,state:'completed',provider:row.model==='deepseek-flash'?'deepseek':'openai',costUpperUsd:'0',message:'',status},hash===row.sourceHash?snapshot:'history-source-changed',texts());message.textContent='Открыт сохранённый вариант. Переработка создаст новый платный запрос.';});historyList.append(b);}
  }catch{if(current===epoch)historyList.replaceChildren(node('p','Не удалось загрузить историю. Закройте и откройте её снова.','dash-help'));}
 });
 return{load,changed,lock(){epoch++;working=false;status=null;result=null;remember(null);notes.value=description.value=meta.value=instruction.value='';preview.hidden=true;history.open=false;historyList.replaceChildren();message.textContent='';budget.textContent='Войдите, чтобы использовать генератор.';changed();}};
}
