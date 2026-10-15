import {randomUUID} from 'node:crypto';
import {transaction,query} from './db.ts';
import {orderRow,event} from './orders.ts';
import {StoreError,uuid,text,iso} from './errors.ts';
import {idempotent} from './security.ts';
import {paymentProvider,receiptMode,isYooKassa,liveOperationsPaused,sandboxConfig,sandboxClient,requirePaymentEnvironment} from './payment-policy.ts';
import {buildClosingReceipt} from './yookassa-closing-snapshot.ts';
import {YooKassaError} from './adapters/yookassa-sandbox.ts';
import type {PoolClient} from 'pg';
const active=['queued','pending','uncertain'];
const enabled=()=>{requirePaymentEnvironment();if(!isYooKassa()||receiptMode()!=='yookassa')throw new StoreError('CLOSING_DISABLED','Закрывающие чеки пока не включены.',503);};
async function carrierProof(c:PoolClient,id:string){
 const environment=paymentProvider()==='yookassa-live'?'live':'test';
 const row=(await c.query("SELECT id,provider_uuid,carrier_code,carrier_at FROM ar_cdek_shipments WHERE order_id=$1 AND environment=$2 AND state='ready' AND provider_uuid IS NOT NULL AND carrier_at IS NOT NULL AND carrier_code IN('DELIVERED','POSTOMAT_RECEIVED') ORDER BY carrier_at,id LIMIT 1",[id,environment])).rows[0];
 return row?{source:'carrier',shipmentId:row.id,providerId:row.provider_uuid,code:row.carrier_code,at:iso(row.carrier_at)}:null;
}
async function queueLocked(c:PoolClient,order:any,proof:Record<string,unknown>){
 const cfg=sandboxConfig(),payments=(await c.query("SELECT * FROM ar_payments WHERE order_id=$1 AND provider=$2 AND provider_status='succeeded' AND status IN('succeeded','review') ORDER BY created_at,id FOR UPDATE",[order.id,paymentProvider()])).rows;
 if(payments.length!==1)throw new StoreError('CLOSING_PAYMENT','Для закрытия нужен один проверенный платёж заказа. Несколько оплат требуют сверки.',409);
 const p=payments[0];if(p.provider_shop_id!==cfg.shopId||!p.provider_id||!p.receipt_snapshot)throw new StoreError('CLOSING_PAYMENT','Исходный платёж или его чек не подтверждён.',409);
 const old=(await c.query('SELECT id,state FROM ar_yookassa_closing_receipts WHERE payment_id=$1',[p.id])).rows[0];if(old)return{id:old.id,state:old.state};
 const refunds=(await c.query('SELECT * FROM ar_yookassa_refunds WHERE payment_id=$1 ORDER BY created_at,id',[p.id])).rows;
 const plan=buildClosingReceipt(order,p,refunds);if(!plan){await c.query("UPDATE ar_payments SET closing_discovery_at=now()+interval '1 day',closing_discovery_error=NULL WHERE id=$1",[p.id]);return{id:null,state:'not_required'};}
 const job=(await c.query(`INSERT INTO ar_yookassa_closing_receipts(order_id,payment_id,provider,shop_id,provider_payment_id,amount_rubles,receipt_snapshot,delivery_proof)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,state`,[order.id,p.id,p.provider,p.provider_shop_id,p.provider_id,plan.amountRubles,JSON.stringify(plan.receipt),JSON.stringify(proof)])).rows[0];
 await event(c,order.id,'closing_receipt_queued','Подтверждено получение товара. Чек полного расчёта поставлен в очередь.');return job;
}
export async function queueClosingReceipt(actor:{id:string},body:Record<string,unknown>){
 enabled();const orderId=uuid(body.orderId),reason=text(body.reason,'Подтверждение получения',3,500);
 if(body.received!==true||body.confirmed!==true)throw new StoreError('CLOSING_CONFIRMATION','Подтвердите фактическое получение товара покупателем.',409);
 return transaction(c=>idempotent(c,`closing-receipt:${actor.id}`,body.idempotencyKey,{orderId,reason,received:true,confirmed:true},async()=>{
  const order=await orderRow(c,orderId,undefined,true);
  if(order.delivery_status!=='delivered'||!order.delivered_at||['supplier_pending','supplier_paid'].includes(order.allocation_state))throw new StoreError('CLOSING_DELIVERY','Сначала подтвердите фактическое получение заказа и выделение товаров.',409);
  return queueLocked(c,order,{source:'manager',actorId:actor.id,reason,at:new Date().toISOString(),deliveryAt:iso(order.delivered_at)});
 }),false);
}
export async function closingReceiptWorkspace(input:string){
 const id=uuid(input);return transaction(async c=>{
  const order=await orderRow(c,id);
  const jobs=(await c.query('SELECT id,payment_id,state,amount_rubles,created_at,checked_at,last_error,provider_id FROM ar_yookassa_closing_receipts WHERE order_id=$1 ORDER BY created_at,id',[id])).rows;
  let available=true;try{enabled();}catch{available=false;}
  return{enabled:available,canConfirm:available&&order.delivery_status==='delivered'&&!!order.delivered_at&&!jobs.length,jobs:jobs.map(r=>({id:r.id,paymentId:r.payment_id,state:r.state,amountRubles:r.amount_rubles,createdAt:iso(r.created_at),checkedAt:iso(r.checked_at),error:r.last_error,providerId:r.provider_id}))};
 });
}
export function createYooClosingReceipts(makeClient=sandboxClient){
 async function discover(){
  if(!isYooKassa()||liveOperationsPaused()||receiptMode()!=='yookassa')return 0;enabled();
  // Only a verified terminal carrier status queues automatically. Manual delivered needs an explicit staff confirmation.
  const rows=(await query(`SELECT DISTINCT o.id FROM ar_orders o JOIN ar_cdek_shipments s ON s.order_id=o.id JOIN ar_payments p ON p.order_id=o.id
 WHERE s.environment=$1 AND s.state='ready' AND s.provider_uuid IS NOT NULL AND s.carrier_at IS NOT NULL AND s.carrier_code IN('DELIVERED','POSTOMAT_RECEIVED')
 AND p.provider=$2 AND p.closing_discovery_at<=now() AND p.provider_status='succeeded' AND p.receipt_snapshot IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM ar_yookassa_closing_receipts r WHERE r.payment_id=p.id) ORDER BY o.id LIMIT 10`,[paymentProvider()==='yookassa-live'?'live':'test',paymentProvider()])).rows;
  for(const row of rows)try{await transaction(async c=>{const order=await orderRow(c,row.id,undefined,true);const proof=await carrierProof(c,row.id);if(proof&&!['supplier_pending','supplier_paid'].includes(order.allocation_state))await queueLocked(c,order,proof);},false);}catch(error){if(!(error instanceof StoreError))throw error;await query("UPDATE ar_payments SET closing_discovery_at=now()+interval '30 minutes',closing_discovery_error=$2 WHERE order_id=$1 AND provider=$3",[row.id,error.code,paymentProvider()]);}
  return rows.length;
 }
 async function process(input:string,force=false){
  enabled();const id=uuid(input),cfg=sandboxConfig(),lease=randomUUID();
  const initial=(await query('SELECT order_id FROM ar_yookassa_closing_receipts WHERE id=$1 AND provider=$2',[id,paymentProvider()])).rows[0];if(!initial)return;
  const claim=await transaction(async c=>{
   await orderRow(c,initial.order_id,undefined,true);
   const r=(await c.query('SELECT * FROM ar_yookassa_closing_receipts WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!(active.includes(r.state)||force&&r.state==='attention'&&r.provider_id)||r.lease_until&&new Date(r.lease_until).getTime()>Date.now()||!force&&new Date(r.next_check_at).getTime()>Date.now())return null;
   if(r.shop_id!==cfg.shopId||!r.provider_id&&r.requested_at&&Date.now()-new Date(r.requested_at).getTime()>=23*3600000){
    await c.query("UPDATE ar_yookassa_closing_receipts SET state='attention',last_error=$2 WHERE id=$1",[id,r.shop_id!==cfg.shopId?'CLOSING_CONFIG_CHANGED':'IDEMPOTENCE_WINDOW_EXPIRED']);await event(c,r.order_id,'closing_receipt_attention','Чек полного расчёта требует сверки в ЮKassa. Новый чек автоматически не создаётся.');return null;
   }
   const payment=(await c.query('SELECT * FROM ar_payments WHERE id=$1 FOR UPDATE',[r.payment_id])).rows[0];
   if(payment.receipt_registration==='canceled'){
    await c.query("UPDATE ar_yookassa_closing_receipts SET state='attention',last_error='PAYMENT_RECEIPT_CANCELED' WHERE id=$1",[id]);
    await event(c,r.order_id,'closing_receipt_attention','Исходный чек предоплаты не зарегистрирован. Нужна сверка в ЮKassa.');return null;
   }
   if(payment.receipt_registration!=='succeeded'){
    await c.query("UPDATE ar_yookassa_closing_receipts SET last_error='PAYMENT_RECEIPT_NOT_REGISTERED',next_check_at=now()+interval '1 minute' WHERE id=$1",[id]);return null;
   }
   if((await c.query("SELECT 1 FROM ar_yookassa_refunds WHERE payment_id=$1 AND state IN('queued','pending','uncertain','attention')",[r.payment_id])).rowCount){await c.query("UPDATE ar_yookassa_closing_receipts SET next_check_at=now()+interval '1 minute',last_error='REFUND_PENDING' WHERE id=$1",[id]);return null;}
   const unregistered=(await c.query("SELECT receipt_registration FROM ar_yookassa_refunds WHERE payment_id=$1 AND state='succeeded' AND receipt_registration IS DISTINCT FROM 'succeeded'",[r.payment_id])).rows;
   if(unregistered.length){
    const canceled=unregistered.some(x=>x.receipt_registration==='canceled');
    await c.query("UPDATE ar_yookassa_closing_receipts SET state=CASE WHEN $2 THEN 'attention' ELSE state END,last_error=$3,next_check_at=now()+interval '1 minute' WHERE id=$1",[id,canceled,canceled?'REFUND_RECEIPT_CANCELED':'REFUND_RECEIPT_NOT_REGISTERED']);
    if(canceled)await event(c,r.order_id,'closing_receipt_attention','Чек возврата предоплаты не зарегистрирован. Нужна сверка в ЮKassa.');return null;
   }
   await c.query("UPDATE ar_yookassa_closing_receipts SET lease_id=$2,lease_until=now()+interval '90 seconds',requested_at=coalesce(requested_at,now()) WHERE id=$1",[id,lease]);return{...r,paymentAmount:payment.amount_rubles};
  },false);if(!claim)return;
  const wanted={orderId:claim.order_id,internalPaymentId:claim.payment_id,providerPaymentId:claim.provider_payment_id,amountRubles:claim.amount_rubles,paymentAmountRubles:claim.paymentAmount,receipt:claim.receipt_snapshot};
  try{
   const client=makeClient(),reply=claim.provider_id?await client.getReceipt(claim.provider_id,wanted):await client.createReceipt({...wanted,idempotenceKey:claim.provider_key});
   await transaction(async c=>{
    await orderRow(c,claim.order_id,undefined,true);const row=(await c.query('SELECT * FROM ar_yookassa_closing_receipts WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.lease_id!==lease||!(active.includes(row.state)||force&&row.state==='attention'&&row.provider_id))return;
    if(row.provider_id&&row.provider_id!==reply.id)throw new StoreError('CLOSING_IDENTITY','Чек не совпадает.',409);
    await c.query("UPDATE ar_yookassa_closing_receipts SET provider_id=$2,state=$3,checked_at=now(),next_check_at=now()+interval '1 minute',lease_id=NULL,lease_until=NULL,last_error=NULL WHERE id=$1",[id,reply.id,reply.status]);
    if(reply.status==='succeeded'||reply.status==='canceled')await event(c,row.order_id,'closing_receipt_'+reply.status,reply.status==='succeeded'?'ЮKassa зарегистрировала чек полного расчёта.':'ЮKassa не зарегистрировала чек полного расчёта. Требуется ручная сверка.');
   },false);
  }catch(error){
   const code=error instanceof YooKassaError?error.code:'PROVIDER_UNAVAILABLE';
   const retry=['PAYMENT_OUTCOME_UNKNOWN','PROVIDER_UNAVAILABLE'].includes(code);
   await query("UPDATE ar_yookassa_closing_receipts SET state=$3,last_error=$4,next_check_at=now()+interval '1 minute',lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2 AND state IN('queued','pending','uncertain','attention')",[id,lease,retry?(claim.provider_id?'pending':'uncertain'):'attention',code]);
  }
 }
 async function reconcile(){
  if(!isYooKassa()||liveOperationsPaused()||receiptMode()!=='yookassa')return 0;enabled();await discover();
  const rows=(await query("SELECT id FROM ar_yookassa_closing_receipts WHERE provider=$1 AND state IN('queued','pending','uncertain') AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_check_at,id LIMIT 2",[paymentProvider()])).rows;
  await Promise.allSettled(rows.map(r=>process(r.id)));return rows.length;
 }
 return{process,reconcile,discover};
}
export const yooClosingReceipts=createYooClosingReceipts();
