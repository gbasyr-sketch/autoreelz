import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {requireTestEnvironment} from './config.ts';
import {receiptMode} from './payment-policy.ts';
import {StoreError,uuid,multilineText,iso} from './errors.ts';
import {idempotent} from './security.ts';
import {orderRow} from './orders.ts';
import {returnPhysicalBasis,returnIntakeHistory} from './return-intake.ts';
import {resolutionPlan} from './return-resolution-policy.ts';
import type {ReturnResolutionWorkspace,ReturnResolutionSummary} from '../lib/return-resolution.ts';
async function history(c:PoolClient,id:string):Promise<ReturnResolutionWorkspace['history']>{return(await c.query('SELECT id,note,actor_id,created_at,summary FROM ar_return_resolutions WHERE order_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>({id:r.id,note:r.note,actorId:r.actor_id,createdAt:iso(r.created_at)!,summary:r.summary}));}
async function current(c:PoolClient,order:Record<string,any>){
 const id=order.id;
 const {snapshot,revision}=(await c.query("SELECT s snapshot,encode(sha256(convert_to(s::text,'UTF8')),'hex') revision FROM (SELECT ar_return_resolution_snapshot($1) s) q",[id])).rows[0];
 let summary:ReturnResolutionSummary|null=null,reason:string|null=null;
 try{
  const payments=(await c.query('SELECT * FROM ar_payments WHERE order_id=$1 ORDER BY id',[id])).rows;
  const refunds=(await c.query('SELECT * FROM ar_yookassa_refunds WHERE order_id=$1 ORDER BY id',[id])).rows;
  const shipments=(await c.query('SELECT * FROM ar_cdek_shipments WHERE order_id=$1 ORDER BY id',[id])).rows;
  summary=resolutionPlan(order,payments,refunds,await returnPhysicalBasis(c,order),await returnIntakeHistory(c,id),shipments,receiptMode()!=='disabled');
 }catch(e){if(!(e instanceof StoreError))throw e;reason=e.message;}
 return{snapshot,revision,summary,reason};
}
export async function returnResolutionWorkspace(orderId:string):Promise<ReturnResolutionWorkspace>{
 const id=uuid(orderId);return transaction(async c=>{
  const order=await orderRow(c,id),state=await current(c,order),records=await history(c,id);let enabled=true;
  try{requireTestEnvironment();}catch{enabled=false;}
  const closed=order.status==='return_closed'&&records.some(r=>r.id)&&!!(await c.query('SELECT 1 FROM ar_return_resolutions WHERE order_id=$1 AND revision=$2',[id,state.revision])).rowCount;
  return{orderId:id,enabled,canClose:enabled&&!closed&&!state.reason,reason:!enabled?'Завершение разбора доступно только в тестовом режиме.':closed?'Текущий разбор завершён. Новые посылки и возвраты денег потребуют новой сверки.':state.reason,revision:state.revision,summary:state.summary,history:records};
 });
}
export async function closeReturnResolution(actor:{id:string},body:Record<string,unknown>){
 requireTestEnvironment();const orderId=uuid(body.orderId),note=multilineText(body.note,'Итог разбора',3,1000),revision=body.revision;
 if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw new StoreError('RETURN_RESOLUTION_REVISION','Обновите данные разбора перед закрытием.');
 if(body.confirmed!==true)throw new StoreError('RETURN_RESOLUTION_CONFIRMATION','Подтвердите проверку товара, результат возврата денег и учёт товаров вне продажи.');
 // Order is locked before command journal: same ordering as inspection and refund worker.
 return transaction(async c=>{
  const order=await orderRow(c,orderId,undefined,true);
  return idempotent(c,'return-resolution:'+actor.id,body.idempotencyKey,{orderId,revision,note,confirmed:true},async()=>{
   const state=await current(c,order);
   if(state.revision!==revision)throw new StoreError('RETURN_RESOLUTION_STALE','Данные разбора изменились. Обновите заказ и заново проверьте итог.',409);
   const old=(await c.query('SELECT id FROM ar_return_resolutions WHERE order_id=$1 AND revision=$2',[orderId,revision])).rows[0];
   if(old&&order.status==='return_closed')return{id:old.id};
   if(state.reason||!state.summary)throw new StoreError('RETURN_RESOLUTION_BLOCKED',state.reason??'Требуется сверка возврата.',409);
   // Never silently clear an unrelated new review without new reconciled facts.
   if(old)throw new StoreError('RETURN_RESOLUTION_BLOCKED','Этот состав уже закрыт. Новый разбор требует отдельной сверки причин.',409);
   const id=randomUUID();await c.query('INSERT INTO ar_return_resolutions(id,order_id,revision,note,actor_id,summary,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,orderId,revision,note,actor.id,JSON.stringify(state.summary),JSON.stringify(state.snapshot)]);
   await c.query("UPDATE ar_orders SET status='return_closed',payment_status=$2,review_reason=NULL WHERE id=$1",[orderId,state.summary.kind==='full'?'refunded':'partially_refunded']);
   return{id};
  });
 },false);
}
