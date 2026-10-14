import type {PoolClient} from 'pg';
import {query,transaction} from './db.ts';
import {paymentProvider,sandboxClient,sandboxConfig} from './payment-policy.ts';
import {requireTestEnvironment} from './config.ts';
import {orderRow,event} from './orders.ts';
import type {ReceiptRegistration} from './yookassa-receipt-snapshot.ts';

type Source='payment'|'refund';
const table=(source:Source)=>source==='payment'?'ar_payments':'ar_yookassa_refunds';
// The payment/refund result is never inferred from its fiscal status.
export async function recordReceipt(c:PoolClient,source:Source,id:string,status:ReceiptRegistration|undefined){
 const name=table(source),r=(await c.query(`SELECT * FROM ${name} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
 if(!r||['succeeded','canceled'].includes(r.receipt_registration))return;
 const previous=r.receipt_registration,overdue=(!status||status==='pending')&&Date.now()-new Date(r.created_at).getTime()>=3*86400000;
 const error=overdue?'RECEIPT_OVERDUE':status===undefined?'RECEIPT_STATUS_MISSING':null;
 if(overdue&&r.receipt_last_error!=='RECEIPT_OVERDUE')await event(c,r.order_id,'receipt_attention','Чек не подтверждён в течение трёх дней. Обратитесь в поддержку ЮKassa; новый платёж не создавайте.');
 await c.query(`UPDATE ${name} SET receipt_registration=$2,receipt_checked_at=now(),receipt_last_error=$3,receipt_next_check_at=now()+CASE WHEN $4 THEN interval '1 day' ELSE interval '1 minute' END WHERE id=$1`,[id,status??previous,error,overdue]);
 if(status&&status!==previous)await event(c,r.order_id,`receipt_${source}_${status}`,status==='succeeded'?'ЮKassa подтвердила регистрацию чека.':status==='canceled'?'ЮKassa не зарегистрировала чек. Требуется ручная проверка в кабинете.':'ЮKassa регистрирует чек.');
}

export function createYooReceipts(makeClient=sandboxClient){
 async function reconcile(){
  if(paymentProvider()!=='yookassa-sandbox')return 0;
  requireTestEnvironment();const cfg=sandboxConfig();
  const rows=(await query(`
   SELECT 'payment' AS source,p.id,p.order_id,p.id AS payment_id,p.provider_id,p.provider_shop_id AS shop_id,p.amount_rubles,p.created_at
    FROM ar_payments p WHERE p.receipt_snapshot IS NOT NULL AND p.provider_id IS NOT NULL AND p.provider_status IN('succeeded','canceled')
    AND p.receipt_next_check_at<=now() AND (p.receipt_registration IS NULL OR p.receipt_registration='pending')
   UNION ALL
   SELECT 'refund',r.id,r.order_id,r.payment_id,r.provider_id::text,r.shop_id,r.amount_rubles,r.created_at
    FROM ar_yookassa_refunds r JOIN ar_payments p ON p.id=r.payment_id
    WHERE p.receipt_snapshot IS NOT NULL AND r.provider_id IS NOT NULL AND r.state IN('succeeded','canceled')
    AND r.receipt_next_check_at<=now() AND (r.receipt_registration IS NULL OR r.receipt_registration='pending')
   ORDER BY created_at LIMIT 4`)).rows;
  for(const row of rows){
   const source=row.source as Source,name=table(source);
   // Known-ID GETs only, including after money settlement. Never re-create a payment for a missing receipt.
   if(row.shop_id!==cfg.shopId){await query(`UPDATE ${name} SET receipt_last_error='RECEIPT_CONFIG_CHANGED',receipt_next_check_at=now()+interval '1 hour' WHERE id=$1`,[row.id]);continue;}
   try{
    const client=makeClient(),wanted={orderId:row.order_id,internalPaymentId:row.payment_id,amountRubles:row.amount_rubles};
    let status:ReceiptRegistration|undefined;
    if(source==='payment')status=(await client.getPayment(row.provider_id,wanted)).receiptRegistration;
    else{
     const p=(await query('SELECT provider_id FROM ar_payments WHERE id=$1',[row.payment_id])).rows[0];
     status=(await client.getRefund(row.provider_id,{...wanted,providerPaymentId:p.provider_id,internalRefundId:row.id})).receiptRegistration;
    }
    await transaction(async c=>{await orderRow(c,row.order_id,undefined,true);await recordReceipt(c,source,row.id,status);});
   }catch{
    await query(`UPDATE ${name} SET receipt_last_error='RECEIPT_CHECK_UNAVAILABLE',receipt_next_check_at=now()+interval '1 minute' WHERE id=$1 AND (receipt_registration IS NULL OR receipt_registration='pending')`,[row.id]);
   }
  }
  return rows.length;
 }
 return{reconcile};
}
export const yooReceipts=createYooReceipts();
