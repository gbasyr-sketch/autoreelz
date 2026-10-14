import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {query,transaction} from './db.ts';
import {email} from './errors.ts';
import {mailProvider,mailRecipientAllowed,ownerMailRecipient,mailMessageIsNew} from './mail-policy.ts';
import {createTimewebMail,mailError} from './adapters/timeweb-mail.ts';

export async function enqueueMail(c:PoolClient,input:{recipient:string;subject:string;body:string;key:string;kind?:'customer'|'login'|'owner'|'probe';expiresAt?:string;notificationId?:string;challengeId?:string}){
 const recipient=email(input.recipient),provider=mailProvider();
 const blocked=provider==='timeweb-smtp'&&!mailRecipientAllowed(recipient);
 const result=await c.query(`INSERT INTO ar_mail_outbox(recipient,subject,body,deduplication_key,provider,kind,expires_at,notification_id,status,last_error,challenge_id)
 VALUES($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now()+interval '1 day'),$8,$9,$10,$11) ON CONFLICT(deduplication_key) DO NOTHING RETURNING id`,
 [recipient,input.subject,input.body,input.key,provider,input.kind??'customer',input.expiresAt??null,input.notificationId??null,blocked?'blocked':'pending',blocked?'MAIL_RECIPIENT_BLOCKED':null,input.challengeId??null]);
 if(blocked&&input.notificationId)await c.query("UPDATE ar_owner_notifications SET status='failed',last_error='Адрес не разрешён для тестовой отправки.' WHERE id=$1",[input.notificationId]);
 return result.rows[0]?.id as string|undefined;
}
export async function enqueueOwnerMail(c:PoolClient,eventId:string,orderId:string,type:string){
 if(mailProvider()!=='timeweb-smtp')return;
 const recipient=ownerMailRecipient();
 const notices=(await c.query("SELECT id,subject FROM ar_owner_notifications WHERE event_key=$1 AND channel='email'",[eventId])).rows;
 for(const notice of notices){
  if(!recipient){await c.query("UPDATE ar_owner_notifications SET status='failed',last_error='Получатель email не настроен.' WHERE id=$1",[notice.id]);continue;}
  const titles:Record<string,string>={created:'Новый заказ',paid:'Тестовая оплата подтверждена',preorder_confirmed:'Предзаказ подтверждён',cancelled:'Заказ отменён',late_payment:'Поздняя оплата — нужна проверка',payment_review:'Оплата требует проверки',shipped:'Заказ отправлен',delivered:'Заказ получен'};
  await enqueueMail(c,{recipient,subject:notice.subject,body:`${titles[type]??'Событие заказа'}.\n\nТестовый магазин AUTO REELZ.\nПодробности: https://autoreelz.ru/manager/orders/${orderId}`,key:'owner:'+notice.id,kind:'owner',notificationId:notice.id});
 }
}
async function updateOwner(c:PoolClient,row:Record<string,any>,status:string,error:string|null=null){
 if(row.notification_id)await c.query(`UPDATE ar_owner_notifications SET status=$2,attempts=$3,last_error=$4,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END WHERE id=$1`,[row.notification_id,status==='delivered'?'delivered':status==='retry'?'pending':'failed',row.attempts,error]);
}
export function createMailWorker(makeClient=createTimewebMail){
 async function tick(){
  // An abandoned send is uncertain: SMTP has no idempotent delivery API.
  await transaction(async c=>{
   const stale=(await c.query("UPDATE ar_mail_outbox SET status='uncertain',last_error='SMTP_LEASE_EXPIRED',lease_id=NULL,lease_until=NULL WHERE provider='timeweb-smtp' AND status='sending' AND lease_until<=now() RETURNING *")).rows;
   for(const row of stale)await updateOwner(c,row,'uncertain','Исход SMTP неизвестен. Автоматического повтора нет.');
  });
  const simulated=await transaction(async c=>{const rows=(await c.query("SELECT id FROM ar_mail_outbox WHERE provider='simulation' AND status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100")).rows;for(const row of rows)await c.query("UPDATE ar_mail_outbox SET status='delivered',delivered_at=now() WHERE id=$1",[row.id]);return rows.length;});
  if(mailProvider()!=='timeweb-smtp')return simulated;
  let processed=0;
  for(let i=0;i<1;i++){
   const lease=randomUUID();
   const row=await transaction(async c=>{
    const item=(await c.query("SELECT * FROM ar_mail_outbox WHERE provider='timeweb-smtp' AND status IN('pending','retry') AND next_attempt_at<=now() ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!item)return null;
    if(!mailMessageIsNew(item.created_at)){
     await c.query("UPDATE ar_mail_outbox SET status='blocked',last_error='MAIL_BEFORE_ACTIVATION' WHERE id=$1",[item.id]);await updateOwner(c,item,'blocked','Письмо создано до включения отправки новых писем.');return{skip:true};
    }
    const oldCode=item.challenge_id&&(await c.query('SELECT consumed_at IS NOT NULL OR expires_at<=now() AS expired FROM ar_login_challenges WHERE id=$1',[item.challenge_id])).rows[0]?.expired;
    if(oldCode||new Date(item.expires_at).getTime()<=Date.now()||!mailRecipientAllowed(item.recipient)){
     const status=oldCode||new Date(item.expires_at).getTime()<=Date.now()?'expired':'blocked';
     await c.query('UPDATE ar_mail_outbox SET status=$2,last_error=$3 WHERE id=$1',[item.id,status,status==='expired'?'MAIL_EXPIRED':'MAIL_RECIPIENT_BLOCKED']);await updateOwner(c,item,status,'Письмо просрочено или адрес не разрешён.');return{skip:true};
    }
    return(await c.query("UPDATE ar_mail_outbox SET status='sending',attempts=attempts+1,lease_id=$2,lease_until=now()+interval '90 seconds' WHERE id=$1 RETURNING *",[item.id,lease])).rows[0];
   });
   if(!row)break;processed++;if(row.skip)continue;
   let status='delivered',error:string|null=null;
   try{await makeClient().send(row);}catch(e){const safe=mailError(e);status=safe.state==='retry'&&row.attempts>=3?'failed':safe.state;error=safe.code;}
   await transaction(async c=>{
    const saved=(await c.query(`UPDATE ar_mail_outbox SET status=$3,last_error=$4,lease_id=NULL,lease_until=NULL,
     next_attempt_at=now()+interval '1 minute' * attempts,
     delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END,
     smtp_accepted_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END
     WHERE id=$1 AND lease_id=$2 AND status='sending' RETURNING *`,[row.id,lease,status,error])).rows[0];
    if(saved)await updateOwner(c,saved,status,error);
   });
  }
  return simulated+processed;
 }
 return{tick};
}
export const mailWorker=createMailWorker();
export async function mailStatus(){
 return{provider:mailProvider(),counts:(await query("SELECT provider,status,count(*)::int count FROM ar_mail_outbox GROUP BY provider,status ORDER BY provider,status")).rows,
 recent:(await query("SELECT id,provider,kind,status,attempts,last_error,created_at,smtp_accepted_at FROM ar_mail_outbox WHERE provider='timeweb-smtp' ORDER BY created_at DESC LIMIT 30")).rows};
}

export async function enqueueDeliveryMail(c:PoolClient,orderId:string,eventId:string,type:string){
 const labels:Record<string,string>={shipped:'Заказ отправлен',delivered:'Получение заказа подтверждено',cancelled:'Заказ отменён'};
 if(!labels[type])return;
 const row=(await c.query('SELECT number,customer_email,tracking_number FROM ar_orders WHERE id=$1',[orderId])).rows[0];
 await enqueueMail(c,{recipient:row.customer_email,subject:`AUTO REELZ — ${labels[type]} ${row.number}`,body:`Тестовое уведомление AUTO REELZ. ${labels[type]}: ${row.number}.${type==='shipped'&&row.tracking_number?`\nТрек-номер: ${row.tracking_number}`:''}\n\nПодробности заказа: https://autoreelz.ru/orders/${orderId}`,key:`delivery:${eventId}`});
}
