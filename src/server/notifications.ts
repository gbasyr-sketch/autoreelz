import{sendLocalOwnerNotification}from'./adapters/owner-notification.ts';
import type {OwnerNotification} from '../lib/management-types.ts';
import {transaction,query} from './db.ts';
import {requireLocalTest} from './config.ts';
import {StoreError,uuid,iso} from './errors.ts';
import {idempotent} from './security.ts';
export async function ownerNotifications():Promise<OwnerNotification[]>{
 const rows=(await query('SELECT * FROM ar_owner_notifications ORDER BY created_at DESC LIMIT 200')).rows;
 return rows.map(r=>({id:r.id,orderId:r.order_id,channel:r.channel,subject:r.subject,body:r.body,status:r.status,attempts:r.attempts,lastError:r.last_error,createdAt:iso(r.created_at)!,deliveredAt:iso(r.delivered_at)}));
}
export async function deliverOwnerNotifications(fail=false){
 requireLocalTest();return transaction(async c=>{
  const rows=(await c.query("SELECT id,channel,subject,body FROM ar_owner_notifications WHERE status='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100")).rows;
  for(const row of rows){
   // Local outbox only. Real MAX/email adapters require separately configured recipients and approval.
   let failed=false;try{await sendLocalOwnerNotification(row,fail);}catch{failed=true;}
   await c.query(`UPDATE ar_owner_notifications SET status=$2,attempts=attempts+1,last_error=$3,
    delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END WHERE id=$1`,[row.id,failed?'failed':'delivered',failed?'Имитированный сбой доставки уведомления.':null]);
  }
  return rows.length;
 });
}
export async function retryNotification(actor:{id:string},body:Record<string,unknown>){
 requireLocalTest();const id=uuid(body.notificationId);
 return transaction(c=>idempotent(c,`notification-retry:${actor.id}`,body.idempotencyKey,{id},async()=>{
  const row=(await c.query('SELECT * FROM ar_owner_notifications WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new StoreError('NOT_FOUND','Уведомление не найдено.',404);
  if(row.status!=='failed')return{ok:true};
  if(row.attempts>=3)throw new StoreError('RETRY_LIMIT','Три попытки исчерпаны. Требуется проверить адаптер.',409);
  await c.query("UPDATE ar_owner_notifications SET status='pending',last_error=NULL WHERE id=$1",[id]);return{ok:true};
 }));
}
