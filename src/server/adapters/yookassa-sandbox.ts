// Test-only protocol client; payment orchestration lives in yookassa-payments.ts.
import {rubles,compareRubles} from '../../lib/money.ts';
const API='https://api.yookassa.ru/v3';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class YooKassaError extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.name='YooKassaError';this.code=code;}
}
const reject=(code:string):never=>{throw new YooKassaError(code);};
type ObjectValue=Record<string,any>;
function object(value:unknown):ObjectValue {if(!value||typeof value!=='object'||Array.isArray(value))return reject('INVALID_PROVIDER_RESPONSE');return value as ObjectValue;}
export interface ExpectedPayment {orderId:string;internalPaymentId:string;amountRubles:string}
export interface SandboxPayment {id:string;status:'pending'|'waiting_for_capture'|'succeeded'|'canceled';paid:boolean;amountRubles:string;confirmationUrl:string|null;test:true}
export interface SandboxConfig {shopId:string;secretKey:string;returnOrigin:string}
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
function expected(value:ExpectedPayment){
 if(!uuid.test(value.orderId)||!uuid.test(value.internalPaymentId))reject('INVALID_PAYMENT_REFERENCE');
 if(typeof value.amountRubles!=='string'||!/^\d+\.\d{2}$/.test(value.amountRubles)||compareRubles(value.amountRubles,'0.00')<=0)reject('INVALID_PAYMENT_AMOUNT');
 return rubles(value.amountRubles);
}
export function createYooKassaSandbox(config:SandboxConfig,transport:Transport=fetch){
 if(!/^\d{1,20}$/.test(config.shopId)||config.secretKey.length<16||/[\r\n]/.test(config.secretKey))reject('SANDBOX_CREDENTIALS_REQUIRED');
 const origin=new URL(config.returnOrigin);
 if(origin.origin!==config.returnOrigin||!(origin.origin==='https://autoreelz.ru'||(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&['14322','14323','14330'].includes(origin.port))))reject('RETURN_ORIGIN_NOT_ALLOWED');
 async function request(path:string,method='GET',body?:unknown,key?:string){
  let response:Response;
  try{response=await transport(API+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Basic '+Buffer.from(config.shopId+':'+config.secretKey).toString('base64'),'Content-Type':'application/json',...(key?{'Idempotence-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{return reject(method==='POST'?'PAYMENT_OUTCOME_UNKNOWN':'PROVIDER_UNAVAILABLE');}
  if(!response.ok){if(method==='POST'&&(response.status>=500||response.status===429))reject('PAYMENT_OUTCOME_UNKNOWN');reject(response.status===401||response.status===403?'PROVIDER_AUTH_FAILED':'PROVIDER_REQUEST_REJECTED');}
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072){await reader.cancel();reject('INVALID_PROVIDER_RESPONSE');}chunks.push(part.value);}return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
  catch{return reject(method==='POST'?'PAYMENT_OUTCOME_UNKNOWN':'INVALID_PROVIDER_RESPONSE');}
 }
 async function checkShop(){
  const me=await request('/me');
  if(me.test!==true||me.account_id!==config.shopId)reject('NOT_EXPECTED_TEST_SHOP');
  if(me.status!=='enabled'||!Array.isArray(me.payment_methods)||!me.payment_methods.includes('bank_card'))reject('TEST_CARD_NOT_ENABLED');
  if(typeof me.fiscalization_enabled!=='boolean')reject('INVALID_PROVIDER_RESPONSE');
  return{test:true as const,cardAvailable:true,fiscalizationEnabled:me.fiscalization_enabled===true};
 }
 function normalize(raw:ObjectValue,wanted:ExpectedPayment,providerId?:string):SandboxPayment{
  const amount=expected(wanted);
  if(!uuid.test(raw.id)||providerId&&raw.id!==providerId||raw.test!==true||raw.recipient?.account_id!==config.shopId)reject('PAYMENT_IDENTITY_MISMATCH');
  if(raw.amount?.currency!=='RUB'||raw.amount?.value!==amount||raw.metadata?.autoreelz_order_id!==wanted.orderId||raw.metadata?.autoreelz_payment_id!==wanted.internalPaymentId)reject('PAYMENT_FACTS_MISMATCH');
  if(!['pending','waiting_for_capture','succeeded','canceled'].includes(raw.status)||typeof raw.paid!=='boolean'||raw.status==='succeeded'&&!raw.paid)reject('INVALID_PROVIDER_RESPONSE');
  let confirmationUrl=null;
  if(raw.confirmation?.confirmation_url){let url:URL;try{url=new URL(raw.confirmation.confirmation_url);}catch{return reject('UNSAFE_CONFIRMATION_URL');}if(url.protocol!=='https:'||url.username||url.password||url.port||!['yoomoney.ru','yookassa.ru'].includes(url.hostname))reject('UNSAFE_CONFIRMATION_URL');confirmationUrl=url.href;}
  if(raw.status==='pending'&&!confirmationUrl)reject('MISSING_CONFIRMATION_URL');
  return{id:raw.id,status:raw.status,paid:raw.paid,amountRubles:amount,confirmationUrl,test:true};
 }
 async function createPayment(input:ExpectedPayment&{idempotenceKey:string;returnUrl:string}){
  const amount=expected(input);if(!uuid.test(input.idempotenceKey))reject('IDEMPOTENCE_KEY_REQUIRED');
  const back=new URL(input.returnUrl);if(back.origin!==config.returnOrigin||back.username||back.password||back.pathname!==`/orders/${input.orderId}`||back.search||back.hash)reject('RETURN_URL_NOT_ALLOWED');
  const shop=await checkShop();if(shop.fiscalizationEnabled)reject('RECEIPT_SETUP_REQUIRED');
  const raw=await request('/payments','POST',{amount:{value:amount,currency:'RUB'},capture:true,payment_method_data:{type:'bank_card'},confirmation:{type:'redirect',return_url:back.href},description:'AUTO REELZ — тестовая операция',metadata:{autoreelz_order_id:input.orderId,autoreelz_payment_id:input.internalPaymentId}},input.idempotenceKey);
  return normalize(raw,input);
 }
 async function getPayment(id:string,wanted:ExpectedPayment){if(!uuid.test(id))reject('INVALID_PROVIDER_ID');expected(wanted);return normalize(await request('/payments/'+id),wanted,id);}
 async function verifyNotification(body:unknown,wanted:ExpectedPayment&{providerPaymentId:string}){
  const notice=object(body);if(notice.type!=='notification'||!['payment.succeeded','payment.canceled','payment.waiting_for_capture'].includes(notice.event)||notice.object?.id!==wanted.providerPaymentId)reject('UNEXPECTED_NOTIFICATION');
  // Never trust callback status/amount, redirects, or a made-up HMAC. Read provider state.
  return getPayment(wanted.providerPaymentId,wanted);
 }
 return{checkShop,createPayment,getPayment,verifyNotification};
}
