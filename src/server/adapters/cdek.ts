import {rubles,compareRubles} from '../../lib/money.ts';
import type {ShippingPackage,CdekTariff} from '../../lib/commerce-types.ts';
const API='https://api.cdek.ru/v2';
export class CdekError extends Error {readonly code:string;constructor(code:string){super(code);this.code=code;this.name='CdekError';}}
const fail=(code:string):never=>{throw new CdekError(code);};
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail('INVALID_RESPONSE');
const positive=(v:any)=>Number.isInteger(v)&&v>0&&v<=2147483647?v:fail('INVALID_CODE');
const text=(v:any,max=300)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():fail('INVALID_RESPONSE');
const pointCode=(v:string)=>/^[A-Za-z0-9_-]{1,64}$/.test(v)?v:fail('INVALID_POINT');
export interface CdekCity {code:number;name:string;region:string;subRegion:string}
export interface CdekPoint {code:string;name:string;cityCode:number;city:string;address:string;workTime:string;reception:boolean;handout:boolean;latitude:number|null;longitude:number|null}
export type CdekTransport=(url:string,init:RequestInit)=>Promise<Response>;
export function cdekPackage(pack:ShippingPackage){
 const values=[pack.weightG,pack.lengthMm,pack.widthMm,pack.heightMm];if(values.some(v=>!Number.isSafeInteger(v)||v<=0))fail('INVALID_PACKAGE');
 return{weight:pack.weightG,length:Math.ceil(pack.lengthMm/10),width:Math.ceil(pack.widthMm/10),height:Math.ceil(pack.heightMm/10)};
}
export function createCdekClient(config:{clientId:string;clientSecret:string},transport:CdekTransport=fetch){
 if(!config.clientId||!config.clientSecret||/[\r\n]/.test(config.clientId+config.clientSecret))fail('CREDENTIALS_REQUIRED');
 let token:{value:string;until:number}|undefined,authenticating:Promise<string>|undefined;
 const cache=new Map<string,{until:number;value:any}>();const pending=new Map<string,Promise<any>>();
 async function read(response:Response){
  const reader=response.body?.getReader(),parts:Uint8Array[]=[];let size=0;
  try{if(reader)for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>4*1024*1024){await reader.cancel();fail('RESPONSE_TOO_LARGE');}parts.push(p.value);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch(e){if(e instanceof CdekError)throw e;return fail('INVALID_RESPONSE');}
 }
 async function send(path:string,init:RequestInit){let r:Response;try{r=await transport(API+path,{...init,redirect:'error',signal:AbortSignal.timeout(6000)});}catch{return fail('UNAVAILABLE');}return r;}
 async function authorize(){
  if(token&&token.until>Date.now())return token.value;if(authenticating)return authenticating;
  authenticating=(async()=>{const r=await send('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret}).toString()});if(!r.ok)fail('AUTH_FAILED');const data=object(await read(r));if(typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||typeof data.expires_in!=='number'||data.expires_in<60)fail('INVALID_RESPONSE');token={value:data.access_token,until:Date.now()+Math.min(data.expires_in-30,3600)*1000};return token.value;})();
  try{return await authenticating;}finally{authenticating=undefined;}
 }
 async function request(path:string,body?:unknown){
  for(let attempt=0;attempt<2;attempt++){const auth=await authorize();const r=await send(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.status===401&&attempt===0){token=undefined;continue;}if(!r.ok)fail(r.status===400?'NO_QUOTE':'UNAVAILABLE');const data=await read(r);if(data?.errors?.length)fail('NO_QUOTE');return data;}return fail('AUTH_FAILED');
 }
 async function directory(path:string){
  const old=cache.get(path);if(old&&old.until>Date.now())return old.value;if(pending.has(path))return pending.get(path)!;
  const promise=request(path).then(value=>{if(!Array.isArray(value)||value.length>1000)return fail('INVALID_RESPONSE');if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(path,{value,until:Date.now()+5*60_000});return value;});pending.set(path,promise);try{return await promise;}finally{pending.delete(path);}
 }
 function city(raw:any):CdekCity|null{if(raw?.country_code!=='RU')return null;return{code:positive(raw.code),name:text(raw.city,100),region:typeof raw.region==='string'?raw.region.slice(0,150):'',subRegion:typeof raw.sub_region==='string'?raw.sub_region.slice(0,150):''};}
 function point(raw:any):CdekPoint|null{if(raw?.type!=='PVZ'||raw?.location?.country_code!=='RU')return null;return{code:pointCode(text(raw.code,64)),name:text(raw.name??raw.code,200),cityCode:positive(raw.location.city_code),city:text(raw.location.city,100),address:text(raw.location.address,300),workTime:typeof raw.work_time==='string'?raw.work_time.slice(0,500):'',reception:raw.is_reception===true,handout:raw.is_handout===true,latitude:typeof raw.location.latitude==='number'&&Math.abs(raw.location.latitude)<=90?raw.location.latitude:null,longitude:typeof raw.location.longitude==='number'&&Math.abs(raw.location.longitude)<=180?raw.location.longitude:null};}
 async function cities(name:string){const q=new URLSearchParams({country_codes:'RU',city:text(name,100),size:'50',page:'0'});return(await directory('/location/cities?'+q)).map(city).filter((c:CdekCity|null):c is CdekCity=>Boolean(c));}
 async function getCity(code:number){const rows=await directory('/location/cities?'+new URLSearchParams({country_codes:'RU',code:String(positive(code)),size:'1'}));return rows.map(city).find((c:CdekCity|null)=>c?.code===code)??null;}
 async function offices(cityCode:number,page=0){if(!Number.isInteger(page)||page<0||page>100)fail('INVALID_PAGE');const rows=await directory('/deliverypoints?'+new URLSearchParams({country_code:'RU',city_code:String(positive(cityCode)),type:'PVZ',is_handout:'true',size:'500',page:String(page)}));return{items:rows.map(point).filter((p:CdekPoint|null):p is CdekPoint=>Boolean(p?.handout&&p.cityCode===cityCode)),hasMore:rows.length===500};}
 async function getPoint(code:string,pack?:ShippingPackage){const params=new URLSearchParams({code:pointCode(code),type:'PVZ',country_code:'RU'});if(pack){const p=cdekPackage(pack);for(const[k,v]of Object.entries({length:p.length,width:p.width,height:p.height}))params.set(k,String(v));}const rows=await directory('/deliverypoints?'+params);const raw=rows.find((p:any)=>p?.code===code);if(!raw)return null;if(pack&&((typeof raw.weight_min==='number'&&raw.weight_min*1000>pack.weightG)||(typeof raw.weight_max==='number'&&raw.weight_max*1000<pack.weightG)))return null;return point(raw);}
 async function quote(input:{fromCity:number;fromPoint:string;cityCode:number;pointCode?:string;address:string;method:'pickup_point'|'courier';pack:ShippingPackage}):Promise<CdekTariff>{
  const code=input.method==='pickup_point'?136:137;
  const raw=object(await request('/calculator/tariff',{type:1,currency:1,lang:'rus',tariff_code:code,shipment_point:pointCode(input.fromPoint),...(input.method==='pickup_point'?{delivery_point:pointCode(input.pointCode??'')}:{ }),from_location:{code:positive(input.fromCity)},to_location:{code:positive(input.cityCode),address:text(input.address,300)},packages:[cdekPackage(input.pack)]}));
  if(raw.currency!=='RUB'||raw.warnings?.length)fail('UNCONFIRMED_QUOTE');
  if(typeof raw.total_sum!=='number'&&typeof raw.total_sum!=='string')fail('INVALID_AMOUNT');
  let amount:string;try{amount=rubles(String(raw.total_sum));if(compareRubles(amount,'0.00')<=0||compareRubles(amount,'1000000.00')>0)fail('INVALID_AMOUNT');}catch{return fail('INVALID_AMOUNT');}
  const period=(v:any)=>Number.isInteger(v)&&v>=0&&v<=366?v:fail('INVALID_PERIOD');const min=period(raw.period_min),max=period(raw.period_max);if(max<min)fail('INVALID_PERIOD');
  return{provider:'cdek',tariffCode:code,tariffName:input.method==='pickup_point'?'Посылка склад–склад':'Посылка склад–дверь',costRubles:amount,currency:'RUB',periodMin:min,periodMax:max,quotedAt:new Date().toISOString(),originPointCode:input.fromPoint,originCityCode:input.fromCity};
 }
 return{cities,getCity,offices,getPoint,quote};
}
