import {recordReceipt} from './yookassa-receipts.ts';
import {randomUUID} from 'node:crypto';
import {query,transaction} from './db.ts';
import {StoreError,uuid,text,iso} from './errors.ts';
import {validatePaymentReceipt} from './yookassa-receipt-snapshot.ts';
import {paymentProvider,sandboxClient,sandboxConfig,isYooKassa,liveOperationsPaused,requirePaymentEnvironment} from './payment-policy.ts';
import {idempotent,canonical} from './security.ts';
import {refundBalance,planRefund,refundShipmentBlock,refundUnresolved} from './refund-plan.ts';
import {orderRow,event} from './orders.ts';
import type {RefundWorkspace} from '../lib/payment-refunds.ts';
import {YooKassaError,type ExpectedRefund,type SandboxRefund} from './adapters/yookassa-sandbox.ts';
const active=['queued','pending','uncertain'];
function enabled(){requirePaymentEnvironment();if(!isYooKassa())throw new StoreError('REFUND_DISABLED','Возвраты ЮKassa не включены.',503);}
export async function refundWorkspace(orderId:string):Promise<RefundWorkspace>{
 const id=uuid(orderId);return transaction(async c=>{
  const order=await orderRow(c,id);
  const payments=(await c.query(`SELECT * FROM ar_payments WHERE order_id=$1 AND provider='${paymentProvider()}' AND status IN('succeeded','review') AND provider_status='succeeded' AND provider_id IS NOT NULL ORDER BY created_at,id`,[id])).rows;
  const refunds=(await c.query('SELECT * FROM ar_yookassa_refunds WHERE order_id=$1 ORDER BY created_at,id',[id])).rows;
  const shipments=(await c.query('SELECT state,carrier_code,provider_uuid,carrier_at,environment FROM ar_cdek_shipments WHERE order_id=$1',[id])).rows;
  const carrierBlock=refundShipmentBlock(shipments);
  const closings=(await c.query('SELECT payment_id,state FROM ar_yookassa_closing_receipts WHERE order_id=$1',[id])).rows;
  let available=true;try{enabled();}catch{available=false;}
  return{enabled:available,payments:payments.map(p=>{
   const closing=closings.find(r=>r.payment_id===p.id),closingBlock=closing&&closing.state!=='succeeded'||paymentProvider()==='yookassa-live'&&(order.delivery_status==='delivered'||shipments.some(s=>s.environment==='live'&&s.state==='ready'&&s.provider_uuid&&s.carrier_at&&['DELIVERED','POSTOMAT_RECEIVED'].includes(s.carrier_code)))&&!closing;
   const balance=refundBalance(order,p,refunds),unresolved=refunds.some(r=>r.payment_id===p.id&&refundUnresolved(r.state));
   return{...balance,canRefund:available&&balance.canRefund&&!carrierBlock&&!closingBlock,
    blockReason:closingBlock?'Сначала зарегистрируйте или сверьте чек полного расчёта.':!available?'Возвраты ЮKassa не включены.':unresolved?'Предыдущий возврат ещё обрабатывается или требует сверки.':carrierBlock};
  }),refunds:refunds.map(r=>({id:r.id,paymentId:r.payment_id,amountRubles:r.amount_rubles,state:r.state,reason:r.reason,createdAt:iso(r.created_at)!,providerId:r.provider_id,selection:r.selection_snapshot}))};
 },false);
}
export async function queueRefund(actor:{id:string},body:Record<string,unknown>){
 enabled();const orderId=uuid(body.orderId),paymentId=uuid(body.paymentId),reason=text(body.reason,'Причина возврата',3,500);
 if(body.confirmed!==true)throw new StoreError('REFUND_CONFIRMATION','Подтвердите состав и сумму возврата.');
 const config=sandboxConfig();
 const legacy=body.mode===undefined&&body.lines===undefined&&body.shippingRubles===undefined;
 const command={orderId,paymentId,reason,amount:body.amountRubles,confirmed:true,...(legacy?{}:{mode:body.mode??'full',lines:body.lines??null,shipping:body.shippingRubles??null})};
 return transaction(c=>idempotent(c,`yookassa-refund:${actor.id}`,body.idempotencyKey,command,async()=>{
  const order=await orderRow(c,orderId,undefined,true);
  const p=(await c.query("SELECT * FROM ar_payments WHERE id=$1 AND order_id=$2 FOR UPDATE",[paymentId,orderId])).rows[0];
  if(!p||p.provider!==paymentProvider()||!['succeeded','review'].includes(p.status)||p.provider_status!=='succeeded'||!p.provider_id||p.provider_shop_id!==config.shopId)throw new StoreError('REFUND_PAYMENT','Подтверждённый платёж не найден.',409);
  const history=(await c.query('SELECT * FROM ar_yookassa_refunds WHERE payment_id=$1 ORDER BY created_at,id',[paymentId])).rows;
  const previous=history.find(r=>refundUnresolved(r.state));
  if(previous){
   // Different click keys may refer to the same still-open command, never to another refund.
   const plan=planRefund(order,p,history.filter(r=>r.id!==previous.id),body);
   if(previous.reason===reason&&previous.amount_rubles===plan.amountRubles&&(!previous.selection_snapshot||canonical(previous.selection_snapshot)===canonical(plan.selection)))return{id:previous.id};
   throw new StoreError('REFUND_BUSY','Предыдущий возврат ещё обрабатывается или требует сверки.',409);
  }
  const plan=planRefund(order,p,history,body);
  const deliveredShipments=(await c.query("SELECT 1 FROM ar_cdek_shipments WHERE order_id=$1 AND environment=$2 AND state='ready' AND provider_uuid IS NOT NULL AND carrier_at IS NOT NULL AND carrier_code IN('DELIVERED','POSTOMAT_RECEIVED')",[orderId,paymentProvider()==='yookassa-live'?'live':'test'])).rowCount;
  const closing=(await c.query('SELECT state FROM ar_yookassa_closing_receipts WHERE payment_id=$1',[p.id])).rows[0];
  if(closing&&closing.state!=='succeeded'||paymentProvider()==='yookassa-live'&&(order.delivery_status==='delivered'||deliveredShipments)&&!closing)throw new StoreError('REFUND_CLOSING_PENDING','Сначала зарегистрируйте или сверьте чек полного расчёта. Новый возврат пока не отправлен.',409);
  if(closing?.state==='succeeded'&&plan.receipt)plan.receipt=validatePaymentReceipt({...plan.receipt,items:plan.receipt.items.map(i=>({...i,payment_mode:'full_payment'}))},plan.amountRubles,'full_payment');
  const shipments=(await c.query("SELECT state,carrier_code,provider_uuid,carrier_at,environment FROM ar_cdek_shipments WHERE order_id=$1",[orderId])).rows;
  const blocked=refundShipmentBlock(shipments);if(blocked)throw new StoreError('REFUND_SHIPMENT',blocked,409);
  const id=randomUUID();await c.query(`INSERT INTO ar_yookassa_refunds(id,order_id,payment_id,provider_payment_id,shop_id,amount_rubles,provider_key,reason,actor_id,payment_amount_rubles,selection_snapshot,receipt_snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,orderId,paymentId,p.provider_id,config.shopId,plan.amountRubles,randomUUID(),reason,actor.id,plan.paymentAmountRubles,JSON.stringify(plan.selection),plan.receipt?JSON.stringify(plan.receipt):null]);
  await c.query("UPDATE ar_orders SET status='manual_review',payment_status='review',review_reason='Запрошен возврат платежа. Проверьте результат возврата и фактическое движение товара.' WHERE id=$1",[orderId]);
  await event(c,orderId,'refund_requested',`Запрошен ${paymentProvider()==='yookassa-sandbox'?'тестовый ':''}возврат ${plan.amountRubles} ₽. Причина: ${reason}`,actor.id);
  return{id};
 }));
}
export function createYooRefunds(makeClient=sandboxClient){
 async function process(refundId:string,force=false){
  enabled();const id=uuid(refundId),lease=randomUUID(),config=sandboxConfig();
  const initial=(await query('SELECT order_id FROM ar_yookassa_refunds WHERE id=$1',[id])).rows[0];if(!initial)return;
  const claim=await transaction(async c=>{
   await orderRow(c,initial.order_id,undefined,true);
   const r=(await c.query('SELECT r.*,p.provider AS payment_provider FROM ar_yookassa_refunds r JOIN ar_payments p ON p.id=r.payment_id WHERE r.id=$1 FOR UPDATE OF r',[id])).rows[0];
   if(r.payment_provider!==paymentProvider())return null;
   if(!active.includes(r.state)||r.lease_until&&new Date(r.lease_until).getTime()>Date.now()||!force&&new Date(r.next_check_at).getTime()>Date.now())return null;
   if(r.shop_id!==config.shopId||!r.provider_id&&r.requested_at&&Date.now()-new Date(r.requested_at).getTime()>=23*3600000){
    await c.query("UPDATE ar_yookassa_refunds SET state='attention',last_error=$2 WHERE id=$1",[id,r.shop_id!==config.shopId?'REFUND_CONFIG_CHANGED':'IDEMPOTENCE_WINDOW_EXPIRED']);
    await event(c,r.order_id,'refund_attention','Возврат требует ручной сверки в ЮKassa. Новый запрос автоматически не отправлен.');return null;
   }
   await c.query("UPDATE ar_yookassa_refunds SET lease_id=$2,lease_until=now()+interval '90 seconds',requested_at=CASE WHEN provider_id IS NULL THEN coalesce(requested_at,now()) ELSE requested_at END WHERE id=$1",[id,lease]);return r;
  });if(!claim)return;
  const original=(await query('SELECT provider,receipt_snapshot,amount_rubles FROM ar_payments WHERE id=$1',[claim.payment_id])).rows[0];
  const wanted:ExpectedRefund={orderId:claim.order_id,internalPaymentId:claim.payment_id,providerPaymentId:claim.provider_payment_id,internalRefundId:id,amountRubles:claim.amount_rubles,paymentAmountRubles:claim.payment_amount_rubles??original.amount_rubles};
  let result:SandboxRefund;
  try{const client=makeClient();result=claim.provider_id?await client.getRefund(claim.provider_id,wanted):await client.createRefund({...wanted,idempotenceKey:claim.provider_key,forceReceipt:claim.receipt_snapshot?.items?.[0]?.payment_mode==='full_payment',...((claim.receipt_snapshot??(!claim.selection_snapshot?original?.receipt_snapshot:null))?{receipt:claim.receipt_snapshot??original.receipt_snapshot}:{})});}
  catch(e){
   const code=e instanceof YooKassaError?e.code:'PROVIDER_UNAVAILABLE';
   const retry=['PAYMENT_OUTCOME_UNKNOWN','PROVIDER_UNAVAILABLE'].includes(code);
   await query("UPDATE ar_yookassa_refunds SET state=$3,last_error=$4,lease_id=NULL,lease_until=NULL,next_check_at=now()+interval '30 seconds' WHERE id=$1 AND lease_id=$2 AND state IN('queued','pending','uncertain')",[id,lease,retry?(claim.provider_id?'pending':'uncertain'):'attention',code]);return;
  }
  await transaction(async c=>{
   await orderRow(c,claim.order_id,undefined,true);
   const current=(await c.query('SELECT * FROM ar_yookassa_refunds WHERE id=$1 FOR UPDATE',[id])).rows[0];
   // A stale worker cannot overwrite a newer result or release its lease.
   if(current.lease_id!==lease||!active.includes(current.state))return;
   if(current.provider_id&&current.provider_id!==result.id)throw new StoreError('REFUND_IDENTITY','Возврат не совпадает.',409);
   await c.query("UPDATE ar_yookassa_refunds SET provider_id=$2,state=$3,checked_at=now(),last_error=NULL,lease_id=NULL,lease_until=NULL,next_check_at=now()+interval '30 seconds' WHERE id=$1",[id,result.id,result.status]);
   if(original?.receipt_snapshot)await recordReceipt(c,'refund',id,result.receiptRegistration);
   if(result.status!=='pending')await event(c,claim.order_id,'refund_'+result.status,result.status==='succeeded'?`ЮKassa подтвердила ${paymentProvider()==='yookassa-sandbox'?'тестовый ':''}возврат ${claim.amount_rubles} ₽. Возврат товара на склад оформляется отдельно.`:'ЮKassa отменила возврат. Требуется ручная проверка.');
  });
 }
 async function reconcile(){if(!isYooKassa()||liveOperationsPaused())return 0;
  const rows=(await query("SELECT r.id FROM ar_yookassa_refunds r JOIN ar_payments p ON p.id=r.payment_id WHERE p.provider=$1 AND r.state IN('queued','pending','uncertain') AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_check_at LIMIT 2",[paymentProvider()])).rows;
  await Promise.allSettled(rows.map(r=>process(r.id)));return rows.length;
 }
 async function webhook(body:unknown){
  enabled();const b=body as {type?:unknown;event?:unknown;object?:{id?:unknown}};
  if(b?.type!=='notification'||b.event!=='refund.succeeded')throw new StoreError('WEBHOOK_EVENT','Неподдерживаемое уведомление.');
  const providerId=uuid(b.object?.id),r=(await query('SELECT id,lease_until,state FROM ar_yookassa_refunds WHERE provider_id=$1',[providerId])).rows[0];
  if(r&&active.includes(r.state)){await process(r.id,true);const after=(await query('SELECT state FROM ar_yookassa_refunds WHERE id=$1',[r.id])).rows[0];if(active.includes(after.state))throw new StoreError('REFUND_CHECK_PENDING','Проверка возврата продолжается.',503);}
  return{ok:true};
 }
 return{process,reconcile,webhook};
}
export const yooRefunds=createYooRefunds();
