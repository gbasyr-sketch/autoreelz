import Decimal from 'decimal.js';
import {setting} from '../config.ts';
import {aiFetch,OPENAI_GATEWAY} from './ai-gateway.ts';
import {TEXT_INSTRUCTIONS} from './ai-text-prompt.ts';
import type {AIProvider,AITextModel,AITextResult,AIUsage} from '../../lib/ai-text.ts';
export const TEXT_PROMPT_VERSION='2026-10-14.1',TEXT_MAX_OUTPUT=1800,TEXT_MAX_INPUT_BYTES=24000;
// OpenAI input bound includes the higher Standard cache-write price.
export const TEXT_PRICES={deepseek:{input:'0.30',output:'1.20',model:'deepseek-flash'},openai:{input:'0.125',output:'0.50',model:'gpt-6-luna'}} as const;
export {TEXT_INSTRUCTIONS} from './ai-text-prompt.ts';
export const TEXT_MODELS={
 'deepseek-flash':{provider:'deepseek',input:'0.30',output:'1.20',maxOutput:1800,reasoning:'none',label:'DeepSeek Flash'},
 'gpt-6-luna':{provider:'openai',input:'0.125',output:'0.50',maxOutput:1800,reasoning:'none',label:'GPT-6 Luna — быстрый'},
 'gpt-6.1-sol':{provider:'openai',input:'2.50',output:'10.00',maxOutput:4000,reasoning:'low',label:'GPT-6.1 Sol — редактор'},
} as const;
export function textProfile(provider:AIProvider,model:string=TEXT_PRICES[provider].model){
 const profile=TEXT_MODELS[model as AITextModel];
 if(!profile||profile.provider!==provider)throw new AIProviderError('AI_MODEL','Эта модель недоступна для выбранного сервиса.',true);
 return {...profile,model:model as AITextModel};
}
export class AIProviderError extends Error {code:string;definitelyNotCharged:boolean;constructor(code:string,message:string,definitelyNotCharged=false){super(message);this.code=code;this.definitelyNotCharged=definitelyNotCharged;}}
export function promptBody(facts:unknown){const input=JSON.stringify(facts);if(Buffer.byteLength(input,'utf8')>TEXT_MAX_INPUT_BYTES)throw new AIProviderError('AI_INPUT','Слишком много сведений для одного текста. Сократите примечания или число вариантов.',true);return input;}
export function tokenBound(facts:unknown){return Buffer.byteLength(TEXT_INSTRUCTIONS+promptBody(facts),'utf8')+2048;}
/** Peak, uncached price is an upper bound; output includes all billed output tokens. */
export function usageCost(provider:AIProvider,usage:AIUsage,model?:string){const p=textProfile(provider,model);return new Decimal(usage.inputTokens).times(p.input).plus(new Decimal(usage.outputTokens).times(p.output)).div(1000000).toDecimalPlaces(8,Decimal.ROUND_CEIL).toFixed(8);}
export const reservationCost=(provider:AIProvider,facts:unknown,model?:string)=>usageCost(provider,{inputTokens:tokenBound(facts),outputTokens:textProfile(provider,model).maxOutput},model);
export function parseAIText(content:unknown):AITextResult{
 if(typeof content!=='string')throw new AIProviderError('AI_FORMAT','Сервис не вернул готовый текст.');
 let value:any;try{value=JSON.parse(content);}catch{throw new AIProviderError('AI_FORMAT','Сервис вернул текст в неверном формате.');}
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!=='description,metaDescription')throw new AIProviderError('AI_FORMAT','Не удалось распознать два текстовых поля.');
 for(const[key,min,max]of [['description',10,10000],['metaDescription',10,320]] as const){const text=value[key];if(typeof text!=='string'||text.trim().length<min||text.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|<[^>]+>|https?:\/\//i.test(text))throw new AIProviderError('AI_FORMAT','Текст содержит недопустимые данные или превышает размер.');value[key]=text.trim();}
 return value;
}
/** A conservative lexical check, not a proof of factual correctness; owner review stays mandatory. */
export function checkTextFacts(result:AITextResult,facts:unknown):AITextResult{
 const clean=(s:string)=>s.toLocaleLowerCase('ru-RU').replaceAll('ё','е').replace(/[«»“”"'—–-]/g,' ').replace(/\s+/g,' ').trim();
 const input=facts as{name?:string;notes?:string;fitment?:{state:string}[];variants?:{fitment?:{state:string}[]}[];editorial?:unknown},safeFacts={...input,editorial:undefined},source=clean(JSON.stringify(safeFacts)),text=clean(result.description+' '+result.metaDescription),withoutName=input.name?text.split(clean(input.name)).join(' '):text;
 if(/wildberries|\bwb\b|вайлдбер|\bozon\b|озон|артикул/.test(text))throw new AIProviderError('AI_FACTS','Ответ содержит служебные данные вместо описания.');
 for(const stem of ['глян','матов','пластик','алюмини','металл','нержав','кожан','карбон','деревян','резинов','полиуретан','производител','изготовител','гарант','премиальн','оригинальн','долговеч','прочн','надежн','зелен','красн','черн','син','фиолет','бел'])if(text.includes(stem)&&!source.includes(stem))throw new AIProviderError('AI_FACTS','В ответе есть неподтверждённое свойство.');
 const assertions=withoutName.split(/[.!?]/).filter(s=>!/проверь|сверь|уточн|не подтвержд/.test(s)).join(' ');
 const rules=[...(input.fitment??[]),...(input.variants??[]).flatMap(v=>v.fitment??[])];
 if(/подход|совместим|предназнач/.test(assertions)&&(!rules.length||rules.some(r=>r.state!=='compatible')))throw new AIProviderError('AI_FACTS','Описание обещает совместимость без подтверждённых правил.');
 const notes=clean(input.notes??'');
 if(/устанавлив|монтаж|креплен|вырез/.test(assertions)&&!/установ|монтаж|креплен|вырез|шток/.test(source))throw new AIProviderError('AI_FACTS','Способ установки отсутствует в исходных сведениях.');
 if(/без доработ|без подгон|без вырез/.test(assertions)&&!/(?:без доработ|без подгон|без вырез)/.test(notes))throw new AIProviderError('AI_FACTS','Отсутствие доработок не подтверждено.');
 if(/(?:необходим|нужен|потребуется|требуется|необходима).{0,25}(?:вырез|доработ|подгон)/.test(notes)&&/без доработ|без подгон|без вырез/.test(assertions))throw new AIProviderError('AI_FACTS','Описание противоречит требуемой доработке.');
 if(/в названии|в описании (?:товара )?(?:заявлен|указан)|в примечании|указано для товара|цветовое исполнение/.test(text))throw new AIProviderError('AI_STYLE','Получился служебный пересказ вместо описания товара.');
 const sourceNumbers=new Set(source.match(/\d+(?:[.,]\d+)?/g)??[]);if((text.match(/\d+(?:[.,]\d+)?/g)??[]).some(n=>!sourceNumbers.has(n)))throw new AIProviderError('AI_FACTS','В ответе появились новые числовые характеристики.');
 const copy=result.description.split(/\r?\n\s*\r?\n/u).map(paragraph=>paragraph.split(/(?<=[.!?])\s+/u).filter(s=>!/в (переданных|предоставленных|исходных) (данных|сведениях)|другие характеристики.*не подтверждены|единственное подтвержд[её]нное отличие|других подтвержд[её]нных характеристик|применимость.*(провер|уточн)/i.test(s)).join(' ').trim()).filter(Boolean).join('\n\n');if(copy.length<10)throw new AIProviderError('AI_FACTS','Недостаточно полезного текста.');
 const description=copy;if(description.length>10000)throw new AIProviderError('AI_FORMAT','Описание слишком длинное.');return{...result,description};
}
function usage(provider:AIProvider,body:any):AIUsage{const inputTokens=provider==='deepseek'?body.usage?.prompt_tokens:body.usage?.input_tokens,outputTokens=provider==='deepseek'?body.usage?.completion_tokens:body.usage?.output_tokens;
 if(!Number.isSafeInteger(inputTokens)||inputTokens<0||!Number.isSafeInteger(outputTokens)||outputTokens<0)throw new AIProviderError('AI_USAGE','Не получена статистика расхода. Запрос учтён по верхней границе.');return{inputTokens,outputTokens};}
async function quotaError(r:Response){const parts:Uint8Array[]=[];let size=0;const reader=r.body?.getReader();if(!reader)return false;try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>16384){await reader.cancel();return false;}parts.push(p.value);}const data=JSON.parse(Buffer.concat(parts).toString('utf8'));return['insufficient_quota','insufficient_balance','billing_hard_limit_reached'].includes(data.error?.code);}catch{return false;}}
export async function requestAIText(provider:AIProvider,key:string,facts:unknown,fetcher:typeof fetch=aiFetch,selectedModel?:string):Promise<{result:AITextResult|null;usage:AIUsage;errorCode?:string;rejectedText?:string}>{
 const input=promptBody(facts),profile=textProfile(provider,selectedModel),model=profile.model;
 const body=provider==='deepseek'?{model,messages:[{role:'system',content:TEXT_INSTRUCTIONS},{role:'user',content:input}],thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:TEXT_MAX_OUTPUT,stream:false,temperature:0.4}:{model,instructions:TEXT_INSTRUCTIONS,input:'Product facts (JSON):\n'+input,reasoning:{effort:profile.reasoning},text:{format:{type:'json_object'}},max_output_tokens:profile.maxOutput,store:false,service_tier:'default'};
 let r:Response;
 const endpoint=provider==='deepseek'?'https://api.deepseek.com/chat/completions':setting('AI_TEXT_OPENAI_GATEWAY','false')==='true'?OPENAI_GATEWAY:'https://api.openai.com/v1/responses';
 try{r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(model==='gpt-6.1-sol'?95000:35000)});}catch{throw new AIProviderError('AI_UNCERTAIN','Ответ сервиса не получен. Автоматически повторять платный запрос не будем.');}
 if(!r.ok){const quota=await quotaError(r);const code=r.status===401||r.status===403?'AI_ACCESS':r.status===402||quota?'AI_BALANCE':r.status===429?'AI_RATE':'AI_PROVIDER';throw new AIProviderError(code,code==='AI_ACCESS'?'Сервис отклонил ключ или доступ к модели.':code==='AI_BALANCE'?'На счёте сервиса недостаточно средств.':code==='AI_RATE'?'Сервис ограничил частоту запросов. Повторите позже.':'Сервис не смог подготовить текст.',[400,401,402,403,404,422,429].includes(r.status));}
 let bytes=0;const chunks:Uint8Array[]=[];const reader=r.body?.getReader();if(!reader)throw new AIProviderError('AI_UNCERTAIN','Сервис вернул пустой ответ.');
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>131072){await reader.cancel();throw Error();}chunks.push(part.value);}}catch{throw new AIProviderError('AI_UNCERTAIN','Не удалось полностью получить ответ. Повтор не отправлен.');}
 let payload:any;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AIProviderError('AI_UNCERTAIN','Не удалось прочитать ответ. Запрос учтён по верхней границе.');}
 const stats=usage(provider,payload);
 if(provider==='openai'&&payload.service_tier&&payload.service_tier!=='default')throw new AIProviderError('AI_USAGE','Получен неожиданный тариф обработки. Нужна проверка расходов.');
 if(stats.inputTokens>tokenBound(facts)||stats.outputTokens>profile.maxOutput)throw new AIProviderError('AI_USAGE','Статистика расхода выходит за ожидаемые пределы. Нужна проверка интеграции.');
 const completed=provider==='deepseek'?payload.choices?.length===1&&payload.choices[0]?.finish_reason==='stop':payload.status==='completed';
 const content=provider==='deepseek'?payload.choices?.[0]?.message?.content:(payload.output??[]).filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content??[]).filter((part:any)=>part.type==='output_text').map((part:any)=>part.text).join('');
 if(!completed)return{result:null,usage:stats,errorCode:'AI_INCOMPLETE'};
 try{return{result:checkTextFacts(parseAIText(content),facts),usage:stats};}catch(e){return{result:null,usage:stats,errorCode:e instanceof AIProviderError?e.code:'AI_FORMAT',rejectedText:content.slice(0,16000)};}
}
