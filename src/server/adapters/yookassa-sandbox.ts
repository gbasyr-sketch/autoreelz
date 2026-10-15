import {validatePaymentReceipt,type PaymentReceipt,type ReceiptRegistration} from '../yookassa-receipt-snapshot.ts';
import {validateClosingReceipt,type ClosingReceipt} from '../yookassa-closing-snapshot.ts';
// Strict protocol client; payment orchestration and operational authorization live separately.
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
export interface YooKassaPayment<T extends boolean=boolean> {id:string;status:'pending'|'waiting_for_capture'|'succeeded'|'canceled';paid:boolean;amountRubles:string;confirmationUrl:string|null;paidAt?:string;test:T;receiptRegistration?:ReceiptRegistration}
export type SandboxPayment=YooKassaPayment<true>;
export interface SandboxConfig {shopId:string;secretKey:string;returnOrigin:string}
export interface ExpectedRefund extends ExpectedPayment {providerPaymentId:string;internalRefundId:string;paymentAmountRubles?:string}
export interface SandboxRefund {id:string;paymentId:string;status:'pending'|'succeeded'|'canceled';amountRubles:string;receiptRegistration?:ReceiptRegistration}
export interface YooKassaReceipt {id:string;paymentId:string;status:'pending'|'succeeded'|'canceled'}
export interface ExpectedClosingReceipt extends ExpectedPayment {providerPaymentId:string;paymentAmountRubles?:string;receipt:ClosingReceipt}
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
function registration(value:unknown):ReceiptRegistration|undefined {if(value===undefined)return undefined;if(typeof value!=='string'||!['pending','succeeded','canceled'].includes(value))return undefined;return value as ReceiptRegistration;}
function expected(value:ExpectedPayment){
 if(!uuid.test(value.orderId)||!uuid.test(value.internalPaymentId))reject('INVALID_PAYMENT_REFERENCE');
 if(typeof value.amountRubles!=='string'||!/^\d+\.\d{2}$/.test(value.amountRubles)||compareRubles(value.amountRubles,'0.00')<=0)reject('INVALID_PAYMENT_AMOUNT');
 return rubles(value.amountRubles);
}
export function createYooKassa<T extends boolean>(config:SandboxConfig&{test:T},transport:Transport=fetch){
 if(typeof config.test!=='boolean'||!/^\d{1,20}$/.test(config.shopId)||typeof config.secretKey!=='string'||config.secretKey.length<16||/[\r\n]/.test(config.secretKey)||!config.test&&config.secretKey.startsWith('test_'))reject(config.test?'SANDBOX_CREDENTIALS_REQUIRED':'LIVE_CREDENTIALS_REQUIRED');
 let origin:URL;try{origin=new URL(config.returnOrigin);}catch{return reject('RETURN_ORIGIN_NOT_ALLOWED');}
 if(origin.origin!==config.returnOrigin||!(origin.origin==='https://autoreelz.ru'||(config.test&&origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&['14322','14323','14330'].includes(origin.port))))reject('RETURN_ORIGIN_NOT_ALLOWED');
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
  if(me.test!==config.test||me.account_id!==config.shopId)reject(config.test?'NOT_EXPECTED_TEST_SHOP':'NOT_EXPECTED_LIVE_SHOP');
  if(me.status!=='enabled'||!Array.isArray(me.payment_methods)||me.payment_methods.some((m:unknown)=>typeof m!=='string'))reject(config.test?'TEST_CARD_NOT_ENABLED':'SHOP_NOT_ENABLED');
  if(typeof me.fiscalization_enabled!=='boolean')reject('INVALID_PROVIDER_RESPONSE');
  return{test:config.test,cardAvailable:me.payment_methods.includes('bank_card'),sbpAvailable:me.payment_methods.includes('sbp'),smartAvailable:me.payment_methods.some((method:string)=>!['b2b_sberbank','electronic_certificate'].includes(method)),fiscalizationEnabled:me.fiscalization_enabled===true};
 }
 function normalize(raw:ObjectValue,wanted:ExpectedPayment,providerId?:string):YooKassaPayment<T>{
  const amount=expected(wanted);
  if(!uuid.test(raw.id)||providerId&&raw.id!==providerId||raw.test!==config.test||raw.recipient?.account_id!==config.shopId)reject('PAYMENT_IDENTITY_MISMATCH');
  if(raw.amount?.currency!=='RUB'||raw.amount?.value!==amount||raw.metadata?.autoreelz_order_id!==wanted.orderId||raw.metadata?.autoreelz_payment_id!==wanted.internalPaymentId)reject('PAYMENT_FACTS_MISMATCH');
  if(!['pending','waiting_for_capture','succeeded','canceled'].includes(raw.status)||typeof raw.paid!=='boolean'||raw.status==='succeeded'&&!raw.paid)reject('INVALID_PROVIDER_RESPONSE');
  let confirmationUrl=null;
  if(raw.confirmation?.confirmation_url){let url:URL;try{url=new URL(raw.confirmation.confirmation_url);}catch{return reject('UNSAFE_CONFIRMATION_URL');}if(url.protocol!=='https:'||url.username||url.password||url.port||!['yoomoney.ru','yookassa.ru'].includes(url.hostname))reject('UNSAFE_CONFIRMATION_URL');confirmationUrl=url.href;}
  if(raw.status==='pending'&&!confirmationUrl)reject('MISSING_CONFIRMATION_URL');
  const receiptRegistration=registration(raw.receipt_registration);
  const captured=raw.captured_at;
  if(captured!==undefined&&(typeof captured!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(captured)||!Number.isFinite(Date.parse(captured))||Date.parse(captured)>Date.now()+60_000))reject('INVALID_PROVIDER_RESPONSE');
  return{id:raw.id,status:raw.status,paid:raw.paid,amountRubles:amount,confirmationUrl,...(receiptRegistration?{receiptRegistration}:{}),...(raw.status==='succeeded'&&captured?{paidAt:new Date(captured).toISOString()}:{}),test:config.test};
 }
 async function createPayment(input:ExpectedPayment&{idempotenceKey:string;returnUrl:string;receipt?:PaymentReceipt;method?:'card'|'sbp'|'smart'}){
  const amount=expected(input);if(input.method!==undefined&&!['card','sbp','smart'].includes(input.method))reject('PAYMENT_METHOD_NOT_ALLOWED');if(!uuid.test(input.idempotenceKey))reject('IDEMPOTENCE_KEY_REQUIRED');
  const back=new URL(input.returnUrl);if(back.origin!==config.returnOrigin||back.username||back.password||back.pathname!==`/orders/${input.orderId}`||back.search||back.hash)reject('RETURN_URL_NOT_ALLOWED');
  const receipt=input.receipt?validatePaymentReceipt(input.receipt,amount):undefined;
  const shop=await checkShop();if(shop.fiscalizationEnabled!==Boolean(receipt))reject('RECEIPT_SETUP_REQUIRED');
  if(input.method==='smart'?!shop.smartAvailable:(input.method??'card')==='card'?!shop.cardAvailable:!shop.sbpAvailable)reject(config.test&&(input.method??'card')==='card'?'TEST_CARD_NOT_ENABLED':'PAYMENT_METHOD_NOT_ENABLED');
  const raw=await request('/payments','POST',{amount:{value:amount,currency:'RUB'},capture:true,...(receipt?{receipt}:{}),...(input.method==='smart'?{}:{payment_method_data:{type:input.method==='sbp'?'sbp':'bank_card'}}),confirmation:{type:'redirect',return_url:back.href},description:config.test?'AUTO REELZ — тестовая операция':'AUTO REELZ — оплата заказа',metadata:{autoreelz_order_id:input.orderId,autoreelz_payment_id:input.internalPaymentId}},input.idempotenceKey);
  return normalize(raw,input);
 }
 async function getPayment(id:string,wanted:ExpectedPayment){if(!uuid.test(id))reject('INVALID_PROVIDER_ID');expected(wanted);return normalize(await request('/payments/'+id),wanted,id);}
 async function verifyNotification(body:unknown,wanted:ExpectedPayment&{providerPaymentId:string}){
  const notice=object(body);if(notice.type!=='notification'||!['payment.succeeded','payment.canceled','payment.waiting_for_capture'].includes(notice.event)||notice.object?.id!==wanted.providerPaymentId)reject('UNEXPECTED_NOTIFICATION');
  // Never trust callback status/amount, redirects, or a made-up HMAC. Read provider state.
  return getPayment(wanted.providerPaymentId,wanted);
 }
 function refundExpected(input:ExpectedRefund){
  expected(input);if(!uuid.test(input.providerPaymentId)||!uuid.test(input.internalRefundId))reject('INVALID_PAYMENT_REFERENCE');
  const total=input.paymentAmountRubles??input.amountRubles;expected({...input,amountRubles:total});
  if(compareRubles(input.amountRubles,total)>0||input.amountRubles!==total&&compareRubles(input.amountRubles,'1.00')<0)reject('INVALID_REFUND_AMOUNT');
 }
 const originalPayment=(input:ExpectedRefund)=>({...input,amountRubles:input.paymentAmountRubles??input.amountRubles});
 function normalizeRefund(raw:ObjectValue,input:ExpectedRefund,id?:string):SandboxRefund{
  if(!uuid.test(raw.id)||id&&raw.id!==id||raw.payment_id!==input.providerPaymentId)reject('REFUND_IDENTITY_MISMATCH');
  if(raw.amount?.currency!=='RUB'||raw.amount?.value!==input.amountRubles)reject('REFUND_FACTS_MISMATCH');
  if(!['pending','succeeded','canceled'].includes(raw.status))reject('INVALID_PROVIDER_RESPONSE');
  const receiptRegistration=registration(raw.receipt_registration);
  return{id:raw.id,paymentId:raw.payment_id,status:raw.status,amountRubles:raw.amount.value,...(receiptRegistration?{receiptRegistration}:{})};
 }
 async function createRefund(input:ExpectedRefund&{idempotenceKey:string;receipt?:PaymentReceipt;forceReceipt?:boolean}){
  refundExpected(input);if(!uuid.test(input.idempotenceKey))reject('IDEMPOTENCE_KEY_REQUIRED');
  const receipt=input.receipt?validatePaymentReceipt(input.receipt,input.amountRubles,input.receipt.items[0]?.payment_mode):undefined;
  const shop=await checkShop();if(shop.fiscalizationEnabled!==Boolean(receipt))reject('RECEIPT_SETUP_REQUIRED');
  const payment=await getPayment(input.providerPaymentId,originalPayment(input));
  if(payment.status!=='succeeded'||!payment.paid)reject('REFUND_PAYMENT_NOT_SUCCEEDED');
  // Full original refunds reuse the payment receipt; partial refunds send their immutable subset.
  const partial=input.amountRubles!==(input.paymentAmountRubles??input.amountRubles);
  return normalizeRefund(await request('/refunds','POST',{payment_id:input.providerPaymentId,amount:{value:input.amountRubles,currency:'RUB'},...((partial||input.forceReceipt)&&receipt?{receipt}:{}),description:'AUTO REELZ refund '+input.internalRefundId},input.idempotenceKey),input);
 }
 async function getRefund(id:string,input:ExpectedRefund){
  refundExpected(input);if(!uuid.test(id))reject('INVALID_PROVIDER_ID');
  // Refund objects have no test/account fields; verify the associated payment first.
  await getPayment(input.providerPaymentId,originalPayment(input));
  return normalizeRefund(await request('/refunds/'+id),input,id);
 }
 function closingExpected(input:ExpectedClosingReceipt){
  const amount=expected(input);if(!uuid.test(input.providerPaymentId))reject('INVALID_PAYMENT_REFERENCE');
  const total=input.paymentAmountRubles??amount;expected({...input,amountRubles:total});
  if(compareRubles(amount,total)>0)reject('INVALID_RECEIPT_AMOUNT');
  const receipt=validateClosingReceipt(input.receipt,amount);
  if(receipt.payment_id!==input.providerPaymentId)reject('RECEIPT_IDENTITY_MISMATCH');
  return receipt;
 }
 async function closingPayment(input:ExpectedClosingReceipt){
  const payment=await getPayment(input.providerPaymentId,{...input,amountRubles:input.paymentAmountRubles??input.amountRubles});
  if(payment.status!=='succeeded'||!payment.paid)reject('RECEIPT_PAYMENT_NOT_SUCCEEDED');
 }
 const receiptId=(value:unknown):value is string=>typeof value==='string'&&value.startsWith('rt-')&&uuid.test(value.slice(3));
 function normalizeReceipt(raw:ObjectValue,input:ExpectedClosingReceipt,receipt:ClosingReceipt,id?:string):YooKassaReceipt{
  if(!receiptId(raw.id)||id&&raw.id!==id||raw.type!=='payment'||raw.payment_id!==input.providerPaymentId)reject('RECEIPT_IDENTITY_MISMATCH');
  if(!['pending','succeeded','canceled'].includes(raw.status)||!Array.isArray(raw.items)||raw.items.length!==receipt.items.length)reject('INVALID_PROVIDER_RESPONSE');
  for(let n=0;n<receipt.items.length;n++){
   const actual=raw.items[n],wanted=receipt.items[n]!;
   // Provider serializes quantity as either a JSON number or a decimal string.
   const quantity=typeof actual?.quantity==='number'?String(actual.quantity):actual?.quantity;
   if(!actual||typeof quantity!=='string'||!/^\d+(?:\.0{1,3})?$/.test(quantity)||Number(quantity)!==Number(wanted.quantity)||actual.description!==wanted.description||actual.amount?.value!==wanted.amount.value||actual.amount?.currency!=='RUB'||actual.payment_mode!=='full_payment'||actual.payment_subject!==wanted.payment_subject||actual.vat_code!==wanted.vat_code||actual.measure!==undefined&&actual.measure!==wanted.measure)reject('RECEIPT_FACTS_MISMATCH');
  }
  if(raw.settlements!==undefined){
   if(!Array.isArray(raw.settlements)||raw.settlements.length!==1||!['prepayment','cashless'].includes(raw.settlements[0]?.type)||raw.settlements[0]?.amount?.currency!=='RUB'||raw.settlements[0]?.amount?.value!==input.amountRubles)reject('RECEIPT_FACTS_MISMATCH');
  }
  return{id:raw.id,paymentId:raw.payment_id,status:raw.status};
 }
 async function createReceipt(input:ExpectedClosingReceipt&{idempotenceKey:string}){
  const receipt=closingExpected(input);if(!uuid.test(input.idempotenceKey))reject('IDEMPOTENCE_KEY_REQUIRED');
  const shop=await checkShop();if(!shop.fiscalizationEnabled)reject('RECEIPT_SETUP_REQUIRED');
  await closingPayment(input);
  return normalizeReceipt(await request('/receipts','POST',receipt,input.idempotenceKey),input,receipt);
 }
 async function getReceipt(id:string,input:ExpectedClosingReceipt){
  const receipt=closingExpected(input);if(!receiptId(id))reject('INVALID_PROVIDER_ID');
  // Receipt objects have no test/account fields: bind them to the verified payment.
  await closingPayment(input);
  return normalizeReceipt(await request('/receipts/'+id),input,receipt,id);
 }
 return{checkShop,createPayment,getPayment,verifyNotification,createRefund,getRefund,createReceipt,getReceipt};
}

export function createYooKassaSandbox(config:SandboxConfig,transport:Transport=fetch){return createYooKassa({...config,test:true},transport);}
