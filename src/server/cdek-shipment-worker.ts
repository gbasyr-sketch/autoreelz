import {randomUUID} from 'node:crypto';
import {transaction,query} from './db.ts';
import {hash,canonical} from './security.ts';
import {shipmentConfig,type ShipmentConfig} from './cdek-shipment-policy.ts';
import {shipmentHistory} from './cdek-shipments.ts';
import {createCdekOrdersClient,cdekErrorMessage,type CdekOrdersClient,type CdekReply} from './adapters/cdek-orders.ts';
import {CdekError} from './adapters/cdek.ts';
import {applyVerifiedCarrierEvent} from './management.ts';
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const shipped=new Set(['RECEIVED_AT_SHIPMENT_WAREHOUSE','READY_FOR_SHIPMENT_IN_SENDER_CITY','TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY','SENT_TO_RECIPIENT_CITY','ACCEPTED_IN_RECIPIENT_CITY','ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE','TAKEN_BY_COURIER','ACCEPTED_AT_PICK_UP_POINT','ACCEPTED_AT_TRANSIT_WAREHOUSE','RETURNED_TO_SENDER_CITY_WAREHOUSE','RETURNED_TO_TRANSIT_WAREHOUSE','RETURNED_TO_RECIPIENT_CITY_WAREHOUSE','READY_FOR_SHIPMENT_IN_TRANSIT_CITY','TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY','SENT_TO_TRANSIT_CITY','ACCEPTED_IN_TRANSIT_CITY','SENT_TO_SENDER_CITY','ACCEPTED_IN_SENDER_CITY','ENTERED_TO_TRANSIT_WAREHOUSE','ENTERED_TO_RECIPIENT_CITY_WAREHOUSE','ENTERED_TO_PICK_UP_POINT','POSTOMAT_POSTED']);
export const deliveryState=(code:string)=>code==='DELIVERED'||code==='POSTOMAT_RECEIVED'?'delivered':shipped.has(code)?'shipped':code==='CREATED'?'packing':null;
export function providerStatuses(reply:CdekReply){
 const statuses=reply.entity?.statuses;if(!Array.isArray(statuses))return[];
 return statuses.filter(s=>s&&typeof s.code==='string'&&/^[A-Z_]{1,80}$/.test(s.code)&&typeof s.date_time==='string'&&/([zZ]|[+-]\d{2}:?\d{2})$/.test(s.date_time)&&Number.isFinite(Date.parse(s.date_time))&&Date.parse(s.date_time)<=Date.now()+300000).sort((a,b)=>Date.parse(a.date_time)-Date.parse(b.date_time));
}
function matchIdentity(s:any,r:CdekReply,complete=false){
 const e=r.entity;if(!e||typeof e.uuid!=='string'||!idPattern.test(e.uuid)||(s.provider_uuid&&e.uuid!==s.provider_uuid))throw new CdekError('INVALID_RESPONSE');
 if(complete&&e.number!==s.number)throw new CdekError('IDENTITY_MISMATCH');
 if(complete&&(e.is_return===true||e.is_reverse===true||e.is_client_return===true))throw new CdekError('IDENTITY_MISMATCH');
 return e.uuid;
}
async function claim(config:ShipmentConfig){return transaction(async c=>{
 const s=(await c.query("SELECT * FROM ar_cdek_shipments WHERE environment=$1 AND account_hash=$2 AND state NOT IN ('cancelled','rejected') AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[config.environment,config.accountHash])).rows[0];if(!s)return null;
 const lease=randomUUID();let action='get',state=s.state;
 if(s.state==='queued'){
  const o=(await c.query('SELECT status,payment_status,delivery_status,tracking_number FROM ar_orders WHERE id=$1',[s.order_id])).rows[0];
  if(o.status!=='paid'||o.payment_status!=='paid'||!['quoted','packing'].includes(o.delivery_status)||o.tracking_number){await c.query("UPDATE ar_cdek_shipments SET state='rejected',last_error='Заказ изменился до отправки запроса. Проверьте оплату и доставку.',updated_at=now() WHERE id=$1",[s.id]);return null;}
  action='create';state='sending';
 }else if(s.state==='sending')state='uncertain';
 else if(s.state==='cancel_queued'){action='cancel';state='cancelling';}
 else if(s.state==='cancelling')state='cancel_uncertain';
 await c.query("UPDATE ar_cdek_shipments SET state=$2,lease_id=$3,lease_until=now()+interval '90 seconds' WHERE id=$1",[s.id,state,lease]);
 if(action!=='get')await shipmentHistory(c,s.id,action+':dispatch:'+s.id,action,{message:action==='create'?'Запрос создания передаётся СДЭК.':'Запрос отмены передаётся СДЭК.'});
 return{...s,state,lease_id:lease,action};
 });}
async function finish(s:any,reply:CdekReply,complete:boolean){
 const providerId=matchIdentity(s,reply,complete),statuses=providerStatuses(reply);
 const e=reply.entity!,track=typeof e.cdek_number==='string'&&/^\d{3,30}$/.test(e.cdek_number)?e.cdek_number:s.tracking_number;
 const latest=statuses.at(-1),code=latest?.code??s.carrier_code;
 const rank=(value:string)=>(({packing:1,shipped:2,delivered:3} as Record<string,number>)[deliveryState(value)??'']??0);
 const older=!!latest&&((s.carrier_at&&Date.parse(latest.date_time)<new Date(s.carrier_at).getTime())||(s.carrier_code==='DELIVERED'&&latest.code!=='DELIVERED')||(rank(latest.code)>0&&rank(latest.code)<rank(s.carrier_code)));
 const currentCode=older?s.carrier_code:code;
 const invalid=(reply.requests??[]).some(r=>r.type==='CREATE'&&r.state==='INVALID');
 const cancelAcknowledged=s.action==='cancel'&&(reply.requests??[]).some(r=>r.type==='DELETE'&&['ACCEPTED','SUCCESSFUL'].includes(r.state??'')&&!r.errors?.length);
 let state=s.state;
 if(currentCode==='REMOVED')state='cancelled';else if(currentCode==='INVALID'||invalid)state='rejected';
 else if(['cancel_queued','cancelling','cancel_uncertain'].includes(s.state)){
  const rejected=(reply.requests??[]).some(r=>r.type==='DELETE'&&r.state==='INVALID');
  state=rejected?'ready':'cancel_uncertain';
 }else if(currentCode==='NOT_DELIVERED'||currentCode&&!deliveryState(currentCode)&&currentCode!=='ACCEPTED')state='attention';
 else if(track&&currentCode&&deliveryState(currentCode))state='ready';else state='accepted';
 const message=state==='rejected'?'СДЭК отклонил данные отправления. Проверьте состав, адрес и упаковку.':currentCode==='NOT_DELIVERED'?'Посылка не вручена. Согласуйте дальнейшие действия со СДЭК.':state==='attention'?'Получен нестандартный статус СДЭК. Требуется проверка.':s.state.startsWith('cancel')&&state==='ready'?'СДЭК не подтвердил отмену: проверьте движение посылки.':null;
 const saved=await transaction(async c=>{
  const updated=await c.query("UPDATE ar_cdek_shipments SET provider_uuid=$3,tracking_number=$4,carrier_code=$5,carrier_at=$6,state=$7,last_error=$8,cancel_acknowledged_at=CASE WHEN $9 THEN coalesce(cancel_acknowledged_at,now()) ELSE cancel_acknowledged_at END,lease_id=NULL,lease_until=NULL,updated_at=now(),next_check_at=now()+CASE WHEN $7 IN ('accepted','cancel_uncertain') THEN interval '1 minute' WHEN $5 IN ('DELIVERED','POSTOMAT_RECEIVED','NOT_DELIVERED') THEN interval '1 day' ELSE interval '15 minutes' END WHERE id=$1 AND lease_id=$2 RETURNING id",[s.id,s.lease_id,providerId,track,currentCode,older?s.carrier_at:latest?.date_time??s.carrier_at,state,message,cancelAcknowledged]);
  if(!updated.rowCount)return false;
  if(cancelAcknowledged)await shipmentHistory(c,s.id,'cancel-accepted:'+s.id,'cancel_accepted',{message:'СДЭК принял запрос отмены; проверяем результат.'});
  if(state==='cancelled'&&s.environment==='live')await c.query("UPDATE ar_orders SET tracking_number=NULL,carrier_tracking_number=NULL,carrier_status=NULL,carrier_updated_at=now() WHERE id=$1 AND delivery_status='packing' AND delivery_source='carrier' AND delivery_override=false AND tracking_number=$2",[s.order_id,track]);
  for(const st of statuses)await shipmentHistory(c,s.id,'status:'+s.id+':'+hash(canonical(st)),'status',{message:'Статус СДЭК: '+st.code,code:st.code,at:st.date_time});
  await shipmentHistory(c,s.id,'result:'+s.id+':'+hash(canonical({state,providerId,track,currentCode,message})),'result',{message:message??(state==='cancelled'?'СДЭК подтвердил отмену.':state==='ready'?'Регистрация отправления подтверждена.':'СДЭК принял запрос; проверка продолжается.')});
  return true;
 });
 // Test shipments are separate and must never mark a real shop order delivered.
 if(saved&&s.environment==='live'&&complete&&track){for(const st of statuses){const status=deliveryState(st.code);if(status)await applyVerifiedCarrierEvent({eventId:'cdek:'+s.id+':'+hash(canonical(st)),orderId:s.order_id,status,occurredAt:st.date_time,trackingNumber:track});}}
}
async function runShipment(config:ShipmentConfig,client:CdekOrdersClient){
 const s=await claim(config);if(!s)return false;
 try{
  if(s.action==='create')await finish(s,await client.create(s.payload),false);
  else if(s.action==='cancel'){
   const current=await client.get(s.provider_uuid);matchIdentity(s,current,true);
   if(providerStatuses(current).at(-1)?.code!=='CREATED'){await finish({...s,state:'ready'},current,true);}
   else await finish(s,await client.cancel(s.provider_uuid),false);
  }else await finish(s,s.provider_uuid?await client.get(s.provider_uuid):await client.find(s.number),true);
 }catch(e){
  // CDEK may remove the entity entirely after DELETE. A normal missing lookup is
  // insufficient: require our persisted DELETE acknowledgement and a second key.
  if(e instanceof CdekError&&e.code==='NOT_FOUND'&&s.action==='get'&&s.state==='cancel_uncertain'&&s.cancel_acknowledged_at&&Date.now()-new Date(s.cancel_acknowledged_at).getTime()>=30000){
   try{await client.find(s.number);}catch(lookup){if(lookup instanceof CdekError&&lookup.code==='NOT_FOUND'){
    await transaction(async c=>{const done=await c.query("UPDATE ar_cdek_shipments SET state='cancelled',carrier_code=NULL,last_error=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2 RETURNING id",[s.id,s.lease_id]);if(done.rowCount){await shipmentHistory(c,s.id,'cancel-missing:'+s.id,'cancel_confirmed',{message:'После принятой отмены СДЭК подтвердил отсутствие накладной по UUID и номеру магазина.'});if(s.environment==='live')await c.query("UPDATE ar_orders SET tracking_number=NULL,carrier_tracking_number=NULL,carrier_status=NULL,carrier_updated_at=now() WHERE id=$1 AND delivery_status='packing' AND delivery_source='carrier' AND delivery_override=false AND tracking_number=$2",[s.order_id,s.tracking_number]);}});return true;
   }}
  }
  const state=s.action==='create'?'uncertain':s.action==='cancel'?'cancel_uncertain':s.state;
  await transaction(async c=>{const r=await c.query("UPDATE ar_cdek_shipments SET state=$3,last_error=$4,lease_id=NULL,lease_until=NULL,next_check_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1 AND lease_id=$2 RETURNING id",[s.id,s.lease_id,state,cdekErrorMessage(e)]);if(r.rowCount)await shipmentHistory(c,s.id,'error:'+s.id+':'+hash(state+':'+cdekErrorMessage(e)),'error',{message:cdekErrorMessage(e)});});
 }
 return true;
}
async function runPrint(config:ShipmentConfig,client:CdekOrdersClient){
 const p=await transaction(async c=>{const row=(await c.query("SELECT p.*,s.provider_uuid order_uuid,s.account_hash,s.environment FROM ar_cdek_prints p JOIN ar_cdek_shipments s ON s.id=p.shipment_id WHERE s.environment=$1 AND s.account_hash=$2 AND p.state IN ('queued','sending','pending') AND p.next_check_at<=now() AND (p.lease_until IS NULL OR p.lease_until<now()) ORDER BY p.next_check_at FOR UPDATE OF p SKIP LOCKED LIMIT 1",[config.environment,config.accountHash])).rows[0];if(!row)return null;
  if(row.state==='sending'){await c.query("UPDATE ar_cdek_prints SET state='uncertain',last_error='Результат формирования неизвестен. Создание отправления повторяться не будет.',updated_at=now(),lease_id=NULL,lease_until=NULL WHERE id=$1",[row.id]);return null;}
  const lease=randomUUID();await c.query("UPDATE ar_cdek_prints SET state=$2,lease_id=$3,lease_until=now()+interval '90 seconds' WHERE id=$1",[row.id,row.state==='queued'?'sending':row.state,lease]);return{...row,lease_id:lease};
 });if(!p)return false;
 try{
  const result=p.state==='queued'?await client.print(p.order_uuid):await client.getPrint(p.provider_uuid),id=result.entity?.uuid;
  if(typeof id!=='string'||!idPattern.test(id)||(p.provider_uuid&&id!==p.provider_uuid))throw new CdekError('INVALID_RESPONSE');
  const status=providerStatuses(result).at(-1)?.code;const state=status==='READY'?'ready':status==='REMOVED'?'expired':status==='INVALID'?'failed':'pending';
  await query("UPDATE ar_cdek_prints SET state=$3,provider_uuid=$4,last_error=$5,lease_id=NULL,lease_until=NULL,updated_at=now(),next_check_at=now()+interval '30 seconds',expires_at=CASE WHEN $3='ready' THEN now()+interval '50 minutes' ELSE NULL END WHERE id=$1 AND lease_id=$2",[p.id,p.lease_id,state,id,state==='failed'?'СДЭК не смог сформировать накладную.':null]);
 }catch(e){await query("UPDATE ar_cdek_prints SET state=$3,last_error=$4,lease_id=NULL,lease_until=NULL,updated_at=now(),next_check_at=now()+interval '5 minutes' WHERE id=$1 AND lease_id=$2",[p.id,p.lease_id,p.state==='queued'?'uncertain':'pending',cdekErrorMessage(e)]);}
 return true;
}
export async function cdekShipmentTick(clientOverride?:CdekOrdersClient){
 const config=shipmentConfig();if(!config)return{shipments:0,prints:0};const client=clientOverride??createCdekOrdersClient(config);
 const shipment=await runShipment(config,client),print=await runPrint(config,client);
 return{shipments:Number(shipment),prints:Number(print)};
}
