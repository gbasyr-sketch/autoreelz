import type {PoolClient} from 'pg';
import type {ManagerOrderView} from '../lib/management-types.ts';
import {transaction} from './db.ts';
import {StoreError,uuid,text,multilineText,integer,iso} from './errors.ts';
import {idempotent,canonical,hash,equal,sign} from './security.ts';
import {orderRow,toOrder,event,releaseAllocation,expireLocked,stockMove} from './orders.ts';
import {lockStock} from './pricing.ts';
import {requireTestEnvironment} from './config.ts';

type Actor={id:string};
const states=['quoted','packing','shipped','delivered'];
export async function managerView(c:PoolClient,row:Record<string,any>):Promise<ManagerOrderView>{
 const order=await toOrder(c,row);
 const notes=(await c.query('SELECT id,body,actor_id,created_at FROM ar_order_notes WHERE order_id=$1 ORDER BY created_at,id',[row.id])).rows;
 const events=(await c.query('SELECT * FROM ar_delivery_events WHERE order_id=$1 ORDER BY created_at,id',[row.id])).rows;
 return{...order,notes:notes.map(n=>({id:n.id,body:n.body,actorId:n.actor_id,createdAt:iso(n.created_at)!})),deliveryEvents:events.map(e=>({id:e.id,status:e.status,source:e.source,occurredAt:iso(e.occurred_at)!,createdAt:iso(e.created_at)!,applied:e.applied,reason:e.reason}))};
}
export const managerOrder=(id:string)=>transaction(async c=>managerView(c,await orderRow(c,uuid(id))),false);
export async function managerOrders(){return transaction(async c=>{const rows=(await c.query('SELECT * FROM ar_orders ORDER BY created_at DESC LIMIT 100')).rows;const orders:ManagerOrderView[]=[];for(const row of rows)orders.push(await managerView(c,row));return orders;},false);}
export async function addNote(actor:Actor,body:Record<string,unknown>){
 const id=uuid(body.orderId),note=multilineText(body.note,'Заметка',2,2000);
 await transaction(c=>idempotent(c,`note:${actor.id}`,body.idempotencyKey,{id,note},async()=>{
  await orderRow(c,id,undefined,true);
  if(Number((await c.query('SELECT count(*) n FROM ar_order_notes WHERE order_id=$1',[id])).rows[0].n)>=250)throw new StoreError('NOTE_LIMIT','Достигнут лимит заметок заказа.');
  await c.query('INSERT INTO ar_order_notes(order_id,body,actor_id) VALUES($1,$2,$3)',[id,note,actor.id]);
  await event(c,id,'manager_note','Менеджер добавил внутреннюю заметку.',actor.id);return{id};
 }));return managerOrder(id);
}
export async function adjustStock(actor:Actor,body:Record<string,unknown>){
 const skuId=uuid(body.skuId),onHand=integer(body.onHand,'Физический остаток',0,1000000),reason=text(body.reason,'Причина корректировки',3,500);
 return transaction(c=>idempotent(c,`stock-adjust:${actor.id}`,body.idempotencyKey,{skuId,onHand,reason},async()=>{
  if(!(await c.query('SELECT 1 FROM ar_skus WHERE id=$1',[skuId])).rowCount)throw new StoreError('SKU_NOT_FOUND','Исполнение не найдено.',404);
  const rows=await lockStock(c,new Map([[skuId,0]])),row=rows[0];
  if(onHand<row.reserved)throw new StoreError('RESERVED_STOCK','Остаток не может быть меньше действующего резерва.',409);
  const delta=onHand-row.on_hand;
  if(delta!==0)await stockMove(c,null,new Map([[skuId,Math.abs(delta)]]),`adjust:${actor.id}:${body.idempotencyKey}`,Math.sign(delta),0,reason,actor.id);
  return{ok:true};
 }));
}
export async function cancelByManager(actor:Actor,body:Record<string,unknown>){
 const id=uuid(body.orderId),reason=text(body.reason,'Причина отмены',3,500);
 await transaction(c=>idempotent(c,`manager-cancel:${actor.id}`,body.idempotencyKey,{id,reason},async()=>{
  const row=await orderRow(c,id,undefined,true);await expireLocked(c,row);
  if(['cancelled','expired'].includes(row.status))return{id};
  if(!['open','preorder_pending','awaiting_payment'].includes(row.status)||['paid','review'].includes(row.payment_status))throw new StoreError('REFUND_REQUIRED','Оплаченный или спорный заказ требует отдельного решения по возврату.',409);
  await releaseAllocation(c,row,'Отмена менеджером: '+reason,actor.id);
  await c.query("UPDATE ar_orders SET status='cancelled' WHERE id=$1",[id]);
  await event(c,id,'cancelled','Заказ отменён менеджером.',actor.id);
  await c.query('INSERT INTO ar_order_notes(order_id,body,actor_id) VALUES($1,$2,$3)',[id,'Причина отмены: '+reason,actor.id]);return{id};
 }));return managerOrder(id);
}
function tracking(value:unknown,fallback:string|null){return value===undefined?fallback:value===null||value===''?null:text(value,'Трек-номер',3,120);}
function paid(row:Record<string,any>){if(row.status!=='paid'||row.payment_status!=='paid')throw new StoreError('PAYMENT_REQUIRED','Сборка и отправка доступны после оплаты заказа.',409);}
async function writeDelivery(c:PoolClient,id:string,status:string,source:'carrier'|'manager',override:boolean,track:string|null){
 await c.query(`UPDATE ar_orders SET delivery_status=$2,delivery_source=$3,delivery_override=$4,tracking_number=$5,
  delivery_updated_at=now(),delivered_at=CASE WHEN $2='delivered' THEN coalesce(delivered_at,now()) ELSE NULL END WHERE id=$1`,[id,status,source,override,track]);
}
async function managerDeliveryEvent(c:PoolClient,actor:Actor,id:string,status:string,reason:string,key:unknown,applied=true){
 const value={id,status,reason,actor:actor.id,key};
 await c.query(`INSERT INTO ar_delivery_events(order_id,provider_event_id,payload_hash,status,occurred_at,source,actor_id,reason,applied)
  VALUES($1,$2,$3,$4,now(),'manager',$5,$6,$7)`,[id,`manager:${actor.id}:${key}`,hash(canonical(value)),status,actor.id,reason,applied]);
}
export async function fulfill(actor:Actor,body:Record<string,unknown>){
 const id=uuid(body.orderId),status=text(body.status,'Статус',1,30),reason=text(body.reason,'Комментарий',2,500);
 if(!['packing','shipped','delivered'].includes(status))throw new StoreError('DELIVERY_STATE','Неизвестный статус доставки.');
 const requested=body.trackingNumber===undefined?undefined:tracking(body.trackingNumber,null);
 await transaction(c=>idempotent(c,`fulfillment:${actor.id}`,body.idempotencyKey,{id,status,reason,requested:requested??null},async()=>{
  const row=await orderRow(c,id,undefined,true);paid(row);const track=tracking(body.trackingNumber,row.tracking_number);
  if(row.delivery_status===status)return{id};
  if(states.indexOf(status)!==states.indexOf(row.delivery_status)+1)throw new StoreError('DELIVERY_SEQUENCE','Сначала завершите предыдущий этап доставки. Для исправления используйте ручную корректировку.',409);
  if(['shipped','delivered'].includes(status)&&!track)throw new StoreError('TRACKING_REQUIRED','Укажите трек-номер отправления.');
  await writeDelivery(c,id,status,'manager',true,track);
  await managerDeliveryEvent(c,actor,id,status,reason,body.idempotencyKey);
  await event(c,id,status,status==='packing'?'Заказ передан на сборку.':status==='shipped'?'Заказ отправлен.':'Получение заказа подтверждено.',actor.id);return{id};
 }));return managerOrder(id);
}
export async function overrideDelivery(actor:Actor,body:Record<string,unknown>){
 const id=uuid(body.orderId),status=body.status===null?null:text(body.status,'Статус',1,30),reason=text(body.reason,'Причина корректировки',3,500);
 if(status!==null&&!states.includes(status))throw new StoreError('DELIVERY_STATE','Неизвестный статус доставки.');
 const requested=body.trackingNumber===undefined?undefined:tracking(body.trackingNumber,null);
 await transaction(c=>idempotent(c,`delivery-override:${actor.id}`,body.idempotencyKey,{id,status,reason,requested:requested??null},async()=>{
  const row=await orderRow(c,id,undefined,true);paid(row);
  const next=status??row.carrier_status??row.delivery_status,track=tracking(body.trackingNumber,status===null?(row.carrier_tracking_number??row.tracking_number):row.tracking_number);
  if(['shipped','delivered'].includes(next)&&!track)throw new StoreError('TRACKING_REQUIRED','Укажите трек-номер отправления.');
  const source=status===null&&row.carrier_status?'carrier':'manager';
  await writeDelivery(c,id,next,source,status!==null,track);
  await managerDeliveryEvent(c,actor,id,next,(status===null?'Автоматическое обновление возобновлено. ':'Ручная корректировка. ')+reason,body.idempotencyKey);
  await event(c,id,'delivery_override',status===null?'Возобновлены статусы перевозчика.':'Менеджер уточнил статус доставки.',actor.id);
  if(next==='delivered'&&row.delivery_status!=='delivered')await event(c,id,'delivered','Получение заказа подтверждено.',actor.id);return{id};
 }));return managerOrder(id);
}
export interface CarrierEvent {eventId:string;orderId:string;status:'packing'|'shipped'|'delivered';occurredAt:string;trackingNumber?:string}
export async function applyCarrierEvent(input:CarrierEvent,signature:string){
 requireTestEnvironment();if(!equal(sign('delivery:'+canonical(input)),signature))throw new StoreError('DELIVERY_SIGNATURE','Подпись события неверна.',403);
 const id=uuid(input.orderId),eventId=text(input.eventId,'Событие',1,160),status=text(input.status,'Статус',1,30);
 if(!['packing','shipped','delivered'].includes(status))throw new StoreError('DELIVERY_STATE','Неизвестный статус перевозчика.');
 const at=new Date(input.occurredAt);if(!Number.isFinite(at.getTime())||at.getTime()>Date.now()+300000)throw new StoreError('EVENT_TIME','Некорректное время события.');
 const fingerprint=hash(canonical(input));
 return transaction(async c=>{
  const row=await orderRow(c,id,undefined,true);
  const old=(await c.query('SELECT payload_hash,applied FROM ar_delivery_events WHERE provider_event_id=$1',[eventId])).rows[0];
  if(old){if(old.payload_hash!==fingerprint)throw new StoreError('EVENT_REUSED','Событие с таким ID содержит другие данные.',409);return{orderId:id,applied:old.applied,duplicate:true};}
  let applied=false,reason='';
  const track=tracking(input.trackingNumber,row.tracking_number);
  if(row.status!=='paid'||row.payment_status!=='paid')reason='Событие не применено: заказ не оплачен или требует проверки.';
  else if(at.getTime()<new Date(row.created_at).getTime()||(row.carrier_updated_at&&at.getTime()<=new Date(row.carrier_updated_at).getTime())||states.indexOf(status)<states.indexOf(row.carrier_status??'quoted'))reason='Старое событие или возврат к предыдущему статусу проигнорирован.';
  else if(['shipped','delivered'].includes(status)&&!track)reason='Событие не применено: нет трек-номера.';
  else{
   await c.query('UPDATE ar_orders SET carrier_status=$2,carrier_updated_at=$3,carrier_tracking_number=$4 WHERE id=$1',[id,status,at,track]);
   if(row.delivery_override)reason='Событие сохранено; действует ручной статус.';
   else{
    await writeDelivery(c,id,status,'carrier',false,track);applied=true;reason='Статус обновлён перевозчиком.';
    await event(c,id,status,status==='delivered'?'Перевозчик подтвердил получение заказа.':status==='shipped'?'Перевозчик подтвердил отправление.':'Перевозчик принял заказ в обработку.');
   }
  }
  await c.query(`INSERT INTO ar_delivery_events(order_id,provider_event_id,payload_hash,status,occurred_at,source,reason,applied)
   VALUES($1,$2,$3,$4,$5,'carrier',$6,$7)`,[id,eventId,fingerprint,status,at,reason,applied]);
  return{orderId:id,applied,duplicate:false};
 });
}
export async function simulateCarrier(actor:Actor,body:Record<string,unknown>){
 requireTestEnvironment();const id=uuid(body.orderId);
 const input:CarrierEvent={eventId:'test-cdek:'+text(body.providerEventId,'ID события',1,100),orderId:id,status:String(body.status) as CarrierEvent['status'],occurredAt:text(body.occurredAt,'Время события',10,60),...(body.trackingNumber?{trackingNumber:tracking(body.trackingNumber,null)!}:{})};
 // The event itself is idempotent by provider ID. No external carrier is contacted.
 const prepared=await transaction(c=>idempotent(c,`carrier-test:${actor.id}`,body.idempotencyKey,input,async()=>input));
 await applyCarrierEvent(prepared,sign('delivery:'+canonical(prepared)));return managerOrder(id);
}
