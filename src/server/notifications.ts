import{sendLocalOwnerNotification}from'./adapters/owner-notification.ts';
import type {OwnerNotification} from '../lib/management-types.ts';
import {transaction,query} from './db.ts';
import {requireCommerceEnvironment,requireTestEnvironment} from './config.ts';
import {StoreError,uuid,iso} from './errors.ts';
import {idempotent} from './security.ts';
export async function ownerNotifications():Promise<OwnerNotification[]>{
 const rows=(await query('SELECT * FROM ar_owner_notifications ORDER BY created_at DESC LIMIT 200')).rows;
 return rows.map(r=>({id:r.id,orderId:r.order_id,channel:r.channel,subject:r.subject,body:r.body,status:r.status,attempts:r.attempts,lastError:r.last_error,createdAt:iso(r.created_at)!,deliveredAt:iso(r.delivered_at)}));
}
export async function deliverOwnerNotifications(fail=false){
 requireTestEnvironment();return transaction(async c=>{
  const rows=(await c.query("SELECT id,channel,subject,body FROM ar_owner_notifications WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM ar_mail_outbox m WHERE m.notification_id=ar_owner_notifications.id) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100")).rows;
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
 requireCommerceEnvironment();const id=uuid(body.notificationId);
 return transaction(c=>idempotent(c,`notification-retry:${actor.id}`,body.idempotencyKey,{id},async()=>{
  const row=(await c.query('SELECT * FROM ar_owner_notifications WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new StoreError('NOT_FOUND','Уведомление не найдено.',404);
  if(row.status!=='failed')return{ok:true};
  const mail=(await c.query("SELECT id,provider,status,attempts,expires_at FROM ar_mail_outbox WHERE notification_id=$1 FOR UPDATE",[id])).rows[0];
  if(!mail||mail.provider!=='timeweb-smtp')requireTestEnvironment();
  if(mail){
   if(mail.status==='uncertain')throw new StoreError('MAIL_REVIEW','Исход отправки неизвестен. Сначала проверьте письмо в почтовом кабинете.',409);
   if(mail.status!=='failed'||mail.attempts>=3||new Date(mail.expires_at).getTime()<=Date.now())throw new StoreError('MAIL_RETRY_CLOSED','Повторная отправка недоступна. Требуется ручная проверка.',409);
   await c.query("UPDATE ar_mail_outbox SET status='retry',next_attempt_at=now(),last_error=NULL WHERE id=$1",[mail.id]);
  }
  if(row.attempts>=3)throw new StoreError('RETRY_LIMIT','Три попытки исчерпаны. Требуется проверить адаптер.',409);
  await c.query("UPDATE ar_owner_notifications SET status='pending',last_error=NULL WHERE id=$1",[id]);return{ok:true};
 }));
}
