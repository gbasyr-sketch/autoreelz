import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {setting} from './config.ts';
import {StoreError,uuid,multilineText} from './errors.ts';
import {canonical,hash} from './security.ts';
import {normalizeProduct,productEditorOptions} from './product-editor.ts';
import {aiSource,type AIProvider,type AITextStatus,type AITextRequest} from '../lib/ai-text.ts';
import type {EditorData,EditorOptions,EditorAttribute,EditorFitment} from '../lib/product-editor.ts';
import {TEXT_PRICES,TEXT_PROMPT_VERSION,AIProviderError,promptBody,reservationCost,usageCost,requestAIText} from './adapters/ai-text.ts';

export type AIConfig={provider:AIProvider;keys:Partial<Record<AIProvider,string>>;limitUsd:string;enabled:boolean};
export function aiConfig():AIConfig{
 const selected=setting('AI_TEXT_PROVIDER','disabled');let amount:Decimal;try{amount=new Decimal(setting('AI_TEXT_MONTHLY_BUDGET_USD','0'));}catch{amount=new Decimal(0);}
 const limitUsd=amount.isFinite()&&amount.gt(0)?Decimal.min(amount,5).toFixed(8):'0.00000000';
 const keys:AIConfig['keys']={};for(const p of ['deepseek','openai'] as const){const key=setting(p==='deepseek'?'DEEPSEEK_API_KEY':'OPENAI_API_KEY');if(key&&setting(p==='deepseek'?'AI_TEXT_ALLOW_DEEPSEEK':'AI_TEXT_ALLOW_OPENAI','false')==='true')keys[p]=key;}
 return{provider:selected==='openai'?'openai':'deepseek',keys,limitUsd,enabled:['deepseek','openai'].includes(selected)&&!!keys[selected as AIProvider]&&amount.gt(0)};
}
const monthSQL="date_trunc('month',now() AT TIME ZONE 'Europe/Moscow')::date";
const lockBudget=(c:PoolClient)=>c.query("SELECT pg_advisory_xact_lock(hashtextextended('autoreelz-ai-text-budget',0))");
async function budget(c:PoolClient,config:AIConfig):Promise<AITextStatus>{
 const row=(await c.query(`SELECT to_char(${monthSQL},'YYYY-MM') AS month_label,coalesce(sum(coalesce(charged_upper_usd,reserved_usd)) FILTER(WHERE period=${monthSQL} OR state IN ('running','uncertain')),0)::text used,count(*) FILTER(WHERE state='uncertain')::integer uncertain FROM ar_ai_text_requests`)).rows[0];
 return{enabled:config.enabled,provider:config.provider,model:TEXT_PRICES[config.provider].model,providers:Object.keys(config.keys) as AIProvider[],month:row.month_label,limitUsd:config.limitUsd,usedUpperUsd:new Decimal(row.used).toFixed(8),remainingUsd:Decimal.max(new Decimal(config.limitUsd).minus(row.used),0).toFixed(8),uncertainCount:row.uncertain};
}
export const getAIStatus=(config=aiConfig())=>transaction(c=>budget(c,config),false);
export function factsForAI(data:EditorData,options:EditorOptions,notes:string){
 if(data.name.length<2||!data.categoryId)throw new StoreError('AI_FACTS','Сначала укажите название товара и категорию.');
 const category=options.categories.find(c=>c.id===data.categoryId);if(!category)throw new StoreError('AI_FACTS','Выберите существующую категорию.');
 function attrs(rows:EditorAttribute[]){return rows.filter(a=>a.attributeId||a.value).map(a=>{const def=options.attributes.find(d=>d.id===a.attributeId);if(!def||!a.value)throw new StoreError('AI_FACTS','Заполните или удалите незавершённые характеристики перед генерацией.');let value=a.value;if(def.type==='select'){const option=def.values.find(v=>v.id===a.value);if(!option)throw new StoreError('AI_FACTS','Проверьте значение характеристики.');value=option.label;}else if(def.type==='boolean'){if(!['true','false'].includes(value))throw new StoreError('AI_FACTS','Проверьте значение характеристики.');value=value==='true'?'Да':'Нет';}else if(def.type==='number'&&!/^-?\d+(?:[.,]\d+)?$/.test(value))throw new StoreError('AI_FACTS','Проверьте числовую характеристику.');return{id:a.attributeId,name:def.name,value,unit:def.unit??''};}).filter(a=>!/wildberries|вайлдбер|\bwb\b|nmid|ozon|озон|артикул|код маркетплейс/i.test(a.name));}
 function fit(rows:EditorFitment[]){return rows.filter(f=>f.vehicleId).map(f=>{const car=options.vehicles.find(v=>v.id===f.vehicleId),version=f.versionId?car?.versions.find(v=>v.id===f.versionId):null;if(!car||f.versionId&&!version)throw new StoreError('AI_FACTS','Проверьте автомобиль и его модификацию.');for(const year of [f.yearFrom,f.yearTo])if(year&&(!/^\d{4}$/.test(year)||Number(year)<1970||Number(year)>2100))throw new StoreError('AI_FACTS','Проверьте годы совместимости.');if(f.yearFrom&&f.yearTo&&Number(f.yearFrom)>Number(f.yearTo))throw new StoreError('AI_FACTS','Проверьте диапазон лет.');return{vehicle:car.name,version:version?.name??null,yearFrom:f.yearFrom||null,yearTo:f.yearTo||null,airConditioning:f.ac,state:f.state,note:f.note};});}
 const common=attrs(data.attributes),commonFit=fit(data.fitment);const variants=data.variants.filter(v=>v.status!=='archived').map(v=>{const merged=new Map(common.map(a=>[a.id,a]));for(const a of attrs(v.attributes))merged.set(a.id,a);return{name:v.name,attributes:[...merged.values()].map(({id,...a})=>a),fitment:v.fitmentMode==='replace'?fit(v.fitment):commonFit};});
 if(!common.length&&!variants.some(v=>v.name.trim()||v.attributes.length)&&notes.length<10)throw new StoreError('AI_FACTS','Добавьте характеристики, название варианта или несколько проверенных фактов для описания.');
 return{name:data.name,category:category.name,isDemo:data.isDemo,attributes:common.map(({id,...a})=>a),fitment:commonFit,variants,notes};
}
const messages:Record<string,string>={AI_FACTS:'Ответ не прошёл проверку фактов. Добавьте точные характеристики и создайте новый запрос; тексты товара не изменены.',AI_ACCESS:'Сервис отклонил ключ или доступ к модели.',AI_BALANCE:'На счёте сервиса недостаточно средств.',AI_RATE:'Сервис ограничил частоту запросов. Попробуйте позже.',AI_PROVIDER:'Сервис не подготовил текст.',AI_FORMAT:'Ответ не прошёл проверку формата. Тексты товара не изменены.',AI_INCOMPLETE:'Ответ обрезан. Тексты товара не изменены.',AI_USAGE:'Расход требует проверки. Запрос учтён по верхней границе.',AI_UNCERTAIN:'Ответ не подтверждён. Повтор с тем же номером не отправит второй платный запрос.'};
async function view(c:PoolClient,row:Record<string,any>,config:AIConfig):Promise<AITextRequest>{return{id:row.id,state:row.state,provider:row.provider,model:row.model,sourceHash:row.source_hash,costUpperUsd:row.charged_upper_usd??row.reserved_usd,result:row.result,message:row.error_code?messages[row.error_code]??'Не удалось подготовить текст.':row.state==='running'?'Запрос ещё обрабатывается.':row.state==='completed'?'Тексты готовы к проверке.':'Тексты не изменены.',status:await budget(c,config)};}
export async function readAIRequest(actor:{id:string},input:unknown,config=aiConfig()){
 const id=uuid(input);return transaction(async c=>{
  await c.query("UPDATE ar_ai_text_requests SET state='uncertain',error_code='AI_UNCERTAIN',finished_at=now() WHERE id=$1 AND actor_id=$2 AND state='running' AND created_at<now()-interval '2 minutes'",[id,actor.id]);
  const row=(await c.query('SELECT * FROM ar_ai_text_requests WHERE id=$1 AND actor_id=$2',[id,actor.id])).rows[0];if(!row)throw new StoreError('NOT_FOUND','Запрос не найден.',404);return view(c,row,config);
 },false);
}
export async function generateProductText(actor:{id:string},body:Record<string,unknown>,deps:{config?:AIConfig;adapter?:typeof requestAIText;options?:EditorOptions}={}){
 const config=deps.config??aiConfig(),id=uuid(body.productId),requestKey=uuid(body.idempotencyKey),data=normalizeProduct(body.data),notes=multilineText(body.notes??'','Факты для описания',0,1500);
 const provider=body.provider===undefined?config.provider:body.provider;
 if(provider!=='deepseek'&&provider!=='openai')throw new StoreError('AI_PROVIDER','Неизвестный сервис генерации.');
 const facts=factsForAI(data,deps.options??await productEditorOptions(),notes);
 try{promptBody(facts);}catch(e){if(e instanceof AIProviderError)throw new StoreError(e.code,e.message);throw e;}
 const sourceHash=hash(canonical(aiSource(data,notes))),inputHash=hash(canonical({id,provider,sourceHash,facts,promptVersion:TEXT_PROMPT_VERSION}));
 const reserved=reservationCost(provider,facts);
 const claimed=await transaction(async c=>{
  await lockBudget(c);
  const old=(await c.query('SELECT * FROM ar_ai_text_requests WHERE actor_id=$1 AND request_key=$2 FOR UPDATE',[actor.id,requestKey])).rows[0];
  if(old){if(old.input_hash!==inputHash)throw new StoreError('KEY_REUSED','Исходные данные изменились. Создайте новый запрос.',409);return{created:false,id:old.id};}
  if(!config.enabled||!config.keys[provider])throw new StoreError('AI_DISABLED','Этот сервис генерации пока не подключён.',503);
  if((await c.query("SELECT 1 FROM ar_ai_text_requests WHERE error_code='AI_USAGE' AND state='uncertain' LIMIT 1")).rowCount)throw new StoreError('AI_AUDIT','Генерация приостановлена до проверки статистики расходов.',409);
  const spending=await budget(c,config);if(new Decimal(spending.remainingUsd).lt(reserved))throw new StoreError('AI_BUDGET','Месячный лимит генерации исчерпан с учётом ожидающих запросов.',409);
  const count=(await c.query("SELECT count(*)::integer n FROM ar_ai_text_requests WHERE actor_id=$1 AND created_at>now()-interval '1 hour'",[actor.id])).rows[0].n;if(count>=20)throw new StoreError('AI_RATE','Не более 20 новых генераций в час. Повтор готового запроса доступен.',429);
  const row=(await c.query(`INSERT INTO ar_ai_text_requests(actor_id,request_key,product_id,provider,model,prompt_version,input_hash,source_hash,source_facts,period,reserved_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,${monthSQL},$10) RETURNING id`,[actor.id,requestKey,id,provider,TEXT_PRICES[provider].model,TEXT_PROMPT_VERSION,inputHash,sourceHash,JSON.stringify(facts),reserved])).rows[0];return{created:true,id:row.id};
 },false);
 if(!claimed.created)return readAIRequest(actor,claimed.id,config);
 // No catalog/stock transaction or DB connection is held during the API call.
 let outcome:Awaited<ReturnType<typeof requestAIText>>|null=null,failure:AIProviderError|null=null;
 try{outcome=await(deps.adapter??requestAIText)(provider,config.keys[provider]!,facts);}catch(e){failure=e instanceof AIProviderError?e:new AIProviderError('AI_UNCERTAIN','Ответ не подтверждён.');}
 await transaction(async c=>{
  await lockBudget(c);
  const state=outcome?.result?'completed':outcome||failure?.definitelyNotCharged?'failed':'uncertain';
  const cost=outcome?usageCost(provider,outcome.usage):failure?.definitelyNotCharged?'0.00000000':null;
  await c.query(`UPDATE ar_ai_text_requests SET state=$2,result=$3::jsonb,usage=$4::jsonb,charged_upper_usd=$5,error_code=$6,finished_at=now(),period=${monthSQL} WHERE id=$1`,[claimed.id,state,outcome?.result?JSON.stringify(outcome.result):null,outcome?JSON.stringify(outcome.usage):null,cost,outcome?.errorCode??failure?.code??null]);
 },false);
 return readAIRequest(actor,claimed.id,config);
}
