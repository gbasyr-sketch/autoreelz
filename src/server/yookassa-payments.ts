import {randomUUID} from 'node:crypto';
import {query,transaction} from './db.ts';
import {StoreError,uuid} from './errors.ts';
import {requireTestEnvironment} from './config.ts';
import {paymentProvider,sandboxClient,sandboxConfig} from './payment-policy.ts';
import {orderRow,getOrder,expireLocked} from './orders.ts';
import {settlePayment} from './payments.ts';
import type {ShopSession} from '../lib/commerce-types.ts';
import type {SandboxPayment,createYooKassaSandbox} from './adapters/yookassa-sandbox.ts';
import {YooKassaError} from './adapters/yookassa-sandbox.ts';
type Client=ReturnType<typeof createYooKassaSandbox>;
const terminal=(status:string)=>status==='succeeded'||status==='canceled';
const allowedErrors=new Set(['PAYMENT_OUTCOME_UNKNOWN','PROVIDER_UNAVAILABLE','INVALID_PROVIDER_RESPONSE','PROVIDER_AUTH_FAILED','PROVIDER_REQUEST_REJECTED','NOT_EXPECTED_TEST_SHOP','TEST_CARD_NOT_ENABLED','RECEIPT_SETUP_REQUIRED','PAYMENT_IDENTITY_MISMATCH','PAYMENT_FACTS_MISMATCH','UNSAFE_CONFIRMATION_URL','MISSING_CONFIRMATION_URL']);
export function createYooPayments(makeClient:()=>Client=sandboxClient){
 function enabled(){requireTestEnvironment();if(paymentProvider()!=='yookassa-sandbox')throw new StoreError('PAYMENT_DISABLED','Тестовая ЮKassa не включена.',503);}
 async function preflight(){enabled();const client=makeClient();try{const shop=await client.checkShop();if(shop.fiscalizationEnabled)throw new YooKassaError('RECEIPT_SETUP_REQUIRED');}catch{throw new StoreError('PAYMENT_SETUP','Тестовый магазин ЮKassa пока недоступен. Обратитесь к менеджеру.',503);}}
 async function process(id:string,observedProviderId?:string):Promise<'done'|'waiting'|'closed'|'busy'>{
  enabled();id=uuid(id);if(observedProviderId)observedProviderId=uuid(observedProviderId);
  const initial=(await query('SELECT order_id FROM ar_payments WHERE id=$1 AND provider=\'yookassa-sandbox\'',[id])).rows[0];if(!initial)return'closed';
  const lease=randomUUID(),config=sandboxConfig();
  const claim=await transaction(async c=>{
   const order=await orderRow(c,initial.order_id,undefined,true);
   const payment=(await c.query('SELECT * FROM ar_payments WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(['succeeded','review'].includes(payment.status)||payment.status==='failed'&&!observedProviderId)return{state:'done' as const};
   if(payment.provider_shop_id!==config.shopId){await c.query("UPDATE ar_payments SET provider_last_error='PAYMENT_CONFIG_CHANGED',provider_next_check_at=now()+interval '30 seconds' WHERE id=$1",[id]);return{state:'closed' as const};}
   if(observedProviderId&&payment.provider_id&&payment.provider_id!==observedProviderId)throw new StoreError('PAYMENT_IDENTITY_MISMATCH','Платёж не совпадает.',409);
   if(payment.provider_lease_until&&new Date(payment.provider_lease_until).getTime()>Date.now())return{state:'busy' as const};
   if(!observedProviderId&&new Date(payment.provider_next_check_at).getTime()>Date.now())return{state:'waiting' as const};
   const providerId=payment.provider_id??observedProviderId;
   if(!providerId){
    await expireLocked(c,order);
    const closed=order.status!=='awaiting_payment'||!['reserved','debited'].includes(order.allocation_state);
    const tooOld=payment.provider_requested_at&&Date.now()-new Date(payment.provider_requested_at).getTime()>=23*3600_000;
    if(closed||tooOld){await c.query("UPDATE ar_payments SET provider_last_error=$2,provider_next_check_at=now()+interval '1 day' WHERE id=$1",[id,closed?'ORDER_CLOSED':'IDEMPOTENCE_WINDOW_EXPIRED']);return{state:'closed' as const};}
   }
   const row=(await c.query(`UPDATE ar_payments SET provider_lease_id=$2,provider_lease_until=now()+interval '90 seconds',
    provider_requested_at=CASE WHEN $3::boolean THEN coalesce(provider_requested_at,now()) ELSE provider_requested_at END
    WHERE id=$1 RETURNING *`,[id,lease,!providerId])).rows[0];
   return{state:'claimed' as const,payment:row,providerId};
  });
  if(claim.state!=='claimed')return claim.state;
  const payment=claim.payment,wanted={orderId:payment.order_id,internalPaymentId:id,amountRubles:payment.amount_rubles};
  let result:SandboxPayment;
  try{
   const client=makeClient();
   result=claim.providerId?await client.getPayment(claim.providerId,wanted):await client.createPayment({...wanted,idempotenceKey:payment.provider_key,returnUrl:payment.provider_return_url});
  }catch(error){
   const code=error instanceof YooKassaError&&allowedErrors.has(error.code)?error.code:'PROVIDER_UNAVAILABLE';
   await query("UPDATE ar_payments SET provider_last_error=$3,provider_lease_id=NULL,provider_lease_until=NULL,provider_next_check_at=now()+interval '30 seconds' WHERE id=$1 AND provider_lease_id=$2",[id,lease,code]);
   throw new StoreError('PAYMENT_PENDING_CHECK','Результат оплаты пока не получен. Статус будет проверен повторно; новый платёж не создавайте.',503);
  }
  await transaction(async c=>{
   await orderRow(c,payment.order_id,undefined,true);
   const current=(await c.query('SELECT * FROM ar_payments WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(current.provider_id&&current.provider_id!==result.id)throw new StoreError('PAYMENT_IDENTITY_MISMATCH','Платёж не совпадает.',409);
   if(['succeeded','review'].includes(current.status))return;
   // An older pending response must never regress a terminal payment.
   const status=terminal(current.provider_status)&&!terminal(result.status)?current.provider_status:result.status;
   await c.query(`UPDATE ar_payments SET provider_id=$2,provider_status=$3,
    provider_confirmation_url=CASE WHEN $4::boolean THEN NULL ELSE $5 END,provider_checked_at=now(),provider_last_error=NULL,
    provider_next_check_at=now()+interval '15 seconds',
    provider_lease_id=CASE WHEN provider_lease_id=$6 THEN NULL ELSE provider_lease_id END,
    provider_lease_until=CASE WHEN provider_lease_id=$6 THEN NULL ELSE provider_lease_until END WHERE id=$1`,
   [id,result.id,status,terminal(status),result.confirmationUrl,lease]);
   if(terminal(result.status))await settlePayment(c,{eventId:`yookassa:${result.id}:${result.status}`,paymentId:id,amountRubles:result.amountRubles,currency:'RUB',status:result.status==='succeeded'?'succeeded':'failed'},'yookassa-sandbox');
  });
  return'done';
 }
 async function refresh(session:ShopSession,orderId:string){
  enabled();await getOrder(session,uuid(orderId));
  const row=(await query("SELECT id FROM ar_payments WHERE order_id=$1 AND provider='yookassa-sandbox' AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1",[orderId])).rows[0];
  if(row)await process(row.id);return getOrder(session,orderId);
 }
 async function webhook(body:unknown){
  enabled();const data=body as {type?:unknown;event?:unknown;object?:{id?:unknown;metadata?:{autoreelz_payment_id?:unknown}}};
  if(data?.type!=='notification'||!['payment.succeeded','payment.canceled','payment.waiting_for_capture'].includes(String(data.event)))throw new StoreError('WEBHOOK_EVENT','Неподдерживаемое уведомление.');
  const providerId=uuid(data.object?.id);let row=(await query("SELECT id FROM ar_payments WHERE provider='yookassa-sandbox' AND provider_id=$1",[providerId])).rows[0];
  if(!row&&typeof data.object?.metadata?.autoreelz_payment_id==='string'){
   let hint;try{hint=uuid(data.object.metadata.autoreelz_payment_id);}catch{return{ok:true};}
   row=(await query("SELECT id FROM ar_payments WHERE id=$1 AND provider='yookassa-sandbox' AND provider_id IS NULL",[hint])).rows[0];
  }
  if(row){const result=await process(row.id,providerId);if(result==='busy')throw new StoreError('PAYMENT_BUSY','Проверка выполняется. Повторите уведомление.',503);}
  return{ok:true};
 }
 async function reconcile(){
  if(paymentProvider()!=='yookassa-sandbox')return 0;
  const rows=(await query(`SELECT id FROM ar_payments WHERE provider='yookassa-sandbox' AND status='pending'
   AND provider_next_check_at<=now() AND (provider_lease_until IS NULL OR provider_lease_until<=now()) ORDER BY provider_next_check_at LIMIT 2`)).rows;
  await Promise.allSettled(rows.map(r=>process(r.id)));return rows.length;
 }
 return{preflight,process,refresh,webhook,reconcile};
}
export const yooPayments=createYooPayments();
