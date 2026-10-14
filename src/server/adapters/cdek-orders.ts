import {CdekError,type CdekTransport} from './cdek.ts';
export const cdekApi=(environment:'test'|'live')=>environment==='test'?'https://api.edu.cdek.ru/v2':'https://api.cdek.ru/v2';
const identifier=(s:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s))throw new CdekError('INVALID_ID');return s;};
export interface CdekReply {entity?:Record<string,any>;requests?:{type?:string;state?:string;errors?:{code?:string}[]}[]}
export function createCdekOrdersClient(config:{environment:'test'|'live';clientId:string;clientSecret:string},transport:CdekTransport=fetch){
 const base=cdekApi(config.environment);let token='',until=0;
 async function send(path:string,init:RequestInit){try{return await transport(base+path,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new CdekError('UNAVAILABLE');}}
 async function bytes(r:Response,max=2*1024*1024){const parts:Uint8Array[]=[];let size=0;const reader=r.body?.getReader();if(reader)for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>max){await reader.cancel();throw new CdekError('RESPONSE_TOO_LARGE');}parts.push(p.value);}return Buffer.concat(parts);}
 async function json(r:Response){try{return JSON.parse((await bytes(r)).toString());}catch(e){if(e instanceof CdekError)throw e;throw new CdekError('INVALID_RESPONSE');}}
 async function auth(){if(token&&until>Date.now())return token;const r=await send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret}).toString()});if(!r.ok)throw new CdekError('AUTH_FAILED');const d=await json(r);if(typeof d.access_token!=='string'||d.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(d.expires_in)||d.expires_in<60)throw new CdekError('INVALID_RESPONSE');token=d.access_token;until=Date.now()+Math.min(3600,d.expires_in-30)*1000;return token;}
 async function request(path:string,method='GET',body?:unknown):Promise<CdekReply>{
  const bearer=await auth();
  // Mutating requests are never retried, including 401 and timeouts.
  const r=await send(path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body,(key,value)=>['cost','value'].includes(key)&&typeof value==='string'&&/^\d+\.\d{2}$/.test(value)?(JSON as JSON & {rawJSON:(v:string)=>unknown}).rawJSON(value):value)}:{})});
  if(r.status===401){token='';throw new CdekError('AUTH_FAILED');}
  if(!r.ok){
   if(method==='GET'&&path.startsWith('/orders')&&r.status===400){const d=await json(r),codes=(d.requests??[]).flatMap((q:any)=>(q.errors??[]).map((e:any)=>e.code));if(codes.length&&codes.every((c:unknown)=>c==='v2_entity_not_found'||c==='v2_entity_not_found_im_number'))throw new CdekError('NOT_FOUND');}
   throw new CdekError(r.status===400?'PROVIDER_REJECTED':r.status===429?'RATE_LIMIT':'UNAVAILABLE');
  }
  const d=await json(r);if(!d||typeof d!=='object'||Array.isArray(d))throw new CdekError('INVALID_RESPONSE');return d;
 }
 return{
  create:(payload:unknown)=>request('/orders','POST',payload),
  get:(id:string)=>request('/orders/'+identifier(id)),
  find:(number:string)=>request('/orders?'+new URLSearchParams({im_number:number})),
  cancel:(id:string)=>request('/orders/'+identifier(id),'DELETE'),
  print:(id:string)=>request('/print/orders','POST',{orders:[{order_uuid:identifier(id)}],copy_count:1}),
  getPrint:(id:string)=>request('/print/orders/'+identifier(id)),
  async pdf(id:string){const r=await send('/print/orders/'+identifier(id)+'.pdf',{headers:{Authorization:'Bearer '+await auth()}});if(!r.ok)throw new CdekError('PDF_UNAVAILABLE');const data=await bytes(r,16*1024*1024);if(!data.subarray(0,5).equals(Buffer.from('%PDF-')))throw new CdekError('INVALID_PDF');return data;},
 };
}
export type CdekOrdersClient=ReturnType<typeof createCdekOrdersClient>;
export function cdekErrorMessage(error:unknown){
 const code=error instanceof CdekError?error.code:'';
 return ({AUTH_FAILED:'СДЭК не принял доступ к API. Проверьте настройки подключения.',RATE_LIMIT:'СДЭК временно ограничил запросы. Проверка продолжится позже.',PROVIDER_REJECTED:'СДЭК не принял запрос. Проверьте данные и состояние отправления.',NOT_FOUND:'СДЭК пока не нашёл отправление. Повторное создание заблокировано до выяснения результата.',PDF_UNAVAILABLE:'Накладная пока недоступна. Обновите состояние печати.',INVALID_PDF:'СДЭК вернул некорректный файл накладной.'} as Record<string,string>)[code]??'Не удалось получить подтверждение СДЭК. Результат будет проверен без повторного создания отправления.';
}
