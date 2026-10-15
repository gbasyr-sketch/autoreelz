import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.ts';
import {requireTestEnvironment} from './config.ts';
import {StoreError,uuid,multilineText,iso} from './errors.ts';
import {canonical,idempotent} from './security.ts';
import {orderRow,stockMove} from './orders.ts';
import {lockStock} from './pricing.ts';
import {returnEligibility,returnReference,receiveLines,inspectLines,physicalReturnBasis} from './return-intake-policy.ts';
import type {ReturnIntakeWorkspace,ReturnReceipt} from '../lib/return-intake.ts';
const scope='return-intake:';
async function basis(c:PoolClient,order:Record<string,any>){
 const id=order.id;
 const components=(await c.query('SELECT sku_id,quantity FROM ar_order_components WHERE order_id=$1 ORDER BY sku_id',[id])).rows;
 const issued=(await c.query("SELECT sku_id,greatest(0,-sum(stock_delta)) quantity FROM ar_stock_movements WHERE order_id=$1 AND operation_key NOT LIKE 'return-intake:%' GROUP BY sku_id",[id])).rows;
 const received=(await c.query('SELECT sku_id,sum(quantity) quantity FROM ar_return_receipt_lines WHERE order_id=$1 GROUP BY sku_id',[id])).rows;
 const inspected=(await c.query('SELECT sku_id,sum(restock_quantity) restocked,sum(held_quantity) held FROM ar_return_inspection_lines WHERE order_id=$1 GROUP BY sku_id',[id])).rows;
 return physicalReturnBasis(order,components,issued,received,inspected);
}
async function history(c:PoolClient,id:string):Promise<ReturnReceipt[]>{
 const receipts=(await c.query('SELECT * FROM ar_return_receipts WHERE order_id=$1 ORDER BY created_at,id',[id])).rows;
 const lines=(await c.query('SELECT * FROM ar_return_receipt_lines WHERE order_id=$1 ORDER BY sku_id',[id])).rows;
 const inspections=(await c.query('SELECT * FROM ar_return_inspections WHERE order_id=$1 ORDER BY created_at,id',[id])).rows;
 const results=(await c.query('SELECT * FROM ar_return_inspection_lines WHERE order_id=$1 ORDER BY sku_id',[id])).rows;
 return receipts.map(r=>{
  const inspection=inspections.find(i=>i.receipt_id===r.id);
  return{id:r.id,orderId:id,trackingNumber:r.tracking_number,note:r.note,actorId:r.actor_id,createdAt:iso(r.created_at)!,
   lines:lines.filter(l=>l.receipt_id===r.id).map(l=>({skuId:l.sku_id,quantity:l.quantity,name:l.name,article:l.article,sourceLabels:l.source_labels})),
   inspection:inspection?{id:inspection.id,note:inspection.note,actorId:inspection.actor_id,createdAt:iso(inspection.created_at)!,lines:results.filter(l=>l.inspection_id===inspection.id).map(l=>({skuId:l.sku_id,restockQuantity:l.restock_quantity,heldQuantity:l.held_quantity}))}:null};
 });
}
export async function returnIntakeWorkspace(orderId:string):Promise<ReturnIntakeWorkspace>{
 const id=uuid(orderId);return transaction(async c=>{
  const order=await orderRow(c,id);let enabled=true,reason=returnEligibility(order),lines:ReturnIntakeWorkspace['lines']=[];
  try{requireTestEnvironment();}catch{enabled=false;reason='Приёмка сейчас доступна только в тестовом режиме.';}
  try{lines=await basis(c,order);}catch(e){if(!(e instanceof StoreError))throw e;reason='Снимок состава или история склада требуют сверки. Новая приёмка пока недоступна.';}
  const canReceive=enabled&&!reason&&lines.some(l=>l.remainingQuantity>0);
  if(!reason&&!canReceive)reason='Все доступные к возврату товары уже зарегистрированы. Незавершённые проверки показаны ниже.';
  return{enabled,canReceive,reason,orderId:id,lines,receipts:await history(c,id)};
 });
}
function confirmed(body:Record<string,unknown>){if(body.confirmed!==true)throw new StoreError('RETURN_CONFIRMATION','Подтвердите фактическое количество и результат операции.');}
async function review(c:PoolClient,orderId:string){
 await c.query("UPDATE ar_orders SET status='manual_review',review_reason=coalesce(nullif(review_reason,''),'Получены возвращённые товары. Заказ находится на проверке.') WHERE id=$1",[orderId]);
}
export async function receiveReturn(actor:{id:string},body:Record<string,unknown>){
 requireTestEnvironment();confirmed(body);const orderId=uuid(body.orderId),trackingNumber=returnReference(body.trackingNumber),note=multilineText(body.note,'Примечание при приёмке',3,1000),lines=receiveLines(body.lines);
 return transaction(c=>idempotent(c,scope+'receive:'+actor.id,body.idempotencyKey,{orderId,trackingNumber:trackingNumber.toUpperCase(),note,lines,confirmed:true},async()=>{
  const order=await orderRow(c,orderId,undefined,true);
  const existing=(await c.query("SELECT id,note FROM ar_return_receipts WHERE order_id=$1 AND upper(regexp_replace(btrim(tracking_number),'[[:space:]]+',' ','g'))=upper($2)",[orderId,trackingNumber])).rows[0];
  if(existing){
   const original=(await c.query('SELECT sku_id,quantity FROM ar_return_receipt_lines WHERE receipt_id=$1 ORDER BY sku_id',[existing.id])).rows.map(l=>({skuId:l.sku_id,quantity:l.quantity}));
   if(existing.note===note&&canonical(original)===canonical(lines))return{id:existing.id};
   throw new StoreError('RETURN_RECEIPT_EXISTS','Эта посылка уже зарегистрирована с другим составом или примечанием. Проверьте её историю.',409);
  }
  const blocked=returnEligibility(order);if(blocked)throw new StoreError('RETURN_ORDER',blocked,409);
  const available=await basis(c,order);
  for(const line of lines){const current=available.find(l=>l.skuId===line.skuId);if(!current||line.quantity>current.remainingQuantity)throw new StoreError('RETURN_QUANTITY','Количество превышает оставшиеся отправленные товары этого SKU.',409);}
  if(Number((await c.query('SELECT count(*) n FROM ar_return_receipts WHERE order_id=$1',[orderId])).rows[0].n)>=100)throw new StoreError('RETURN_LIMIT','По заказу уже зарегистрировано100 посылок. Требуется отдельная сверка.',409);
  const id=randomUUID();await c.query('INSERT INTO ar_return_receipts(id,order_id,tracking_number,note,actor_id) VALUES($1,$2,$3,$4,$5)',[id,orderId,trackingNumber,note,actor.id]);
  for(const line of lines){const info=available.find(l=>l.skuId===line.skuId)!;await c.query('INSERT INTO ar_return_receipt_lines(receipt_id,order_id,sku_id,quantity,name,article,source_labels) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,orderId,line.skuId,line.quantity,info.name,info.article,JSON.stringify(info.sourceLabels)]);}
  await review(c,orderId);return{id};
 }),false);
}
export async function inspectReturn(actor:{id:string},body:Record<string,unknown>){
 requireTestEnvironment();confirmed(body);const orderId=uuid(body.orderId),receiptId=uuid(body.receiptId),note=multilineText(body.note,'Результат проверки',3,1000);
 return transaction(async c=>{
  // Order lock serializes receipts/inspections and all existing trade commands. No locks on immutable journal rows.
  const order=await orderRow(c,orderId,undefined,true);
  const receipt=(await c.query('SELECT id FROM ar_return_receipts WHERE id=$1 AND order_id=$2',[receiptId,orderId])).rows[0];if(!receipt)throw new StoreError('RETURN_NOT_FOUND','Посылка возврата не найдена.',404);
  const received=(await c.query('SELECT sku_id,quantity FROM ar_return_receipt_lines WHERE receipt_id=$1 ORDER BY sku_id',[receiptId])).rows.map(l=>({skuId:l.sku_id,quantity:l.quantity}));
  const lines=inspectLines(body.lines,received);
  return idempotent(c,scope+'inspect:'+actor.id,body.idempotencyKey,{orderId,receiptId,note,lines,confirmed:true},async()=>{
   const old=(await c.query('SELECT id,note FROM ar_return_inspections WHERE receipt_id=$1',[receiptId])).rows[0];
   if(old){const original=(await c.query('SELECT sku_id,restock_quantity,held_quantity FROM ar_return_inspection_lines WHERE inspection_id=$1 ORDER BY sku_id',[old.id])).rows.map(l=>({skuId:l.sku_id,restockQuantity:l.restock_quantity,heldQuantity:l.held_quantity}));if(old.note===note&&canonical(original)===canonical(lines))return{id:old.id};throw new StoreError('RETURN_INSPECTED','Проверка уже завершена. Её результат и приход зафиксированы в истории.',409);}
   if(order.allocation_state!=='settled')throw new StoreError('RETURN_ORDER','История выделения товаров изменилась. Сначала сверить склад, повторный приход недоступен.',409);
   await basis(c,order);
   const id=randomUUID();await c.query('INSERT INTO ar_return_inspections(id,receipt_id,order_id,note,actor_id) VALUES($1,$2,$3,$4,$5)',[id,receiptId,orderId,note,actor.id]);
   const approved=new Map(lines.filter(l=>l.restockQuantity>0).map(l=>[l.skuId,l.restockQuantity]));
   const stocks=await lockStock(c,approved);if(stocks.some(s=>s.on_hand+(approved.get(s.sku_id)??0)>1000000))throw new StoreError('STOCK_LIMIT','Приход превышает допустимый остаток SKU. Требуется сверка склада.',409);
   for(const line of lines)await c.query('INSERT INTO ar_return_inspection_lines(inspection_id,receipt_id,order_id,sku_id,restock_quantity,held_quantity) VALUES($1,$2,$3,$4,$5,$6)',[id,receiptId,orderId,line.skuId,line.restockQuantity,line.heldQuantity]);
   await stockMove(c,orderId,approved,scope+id,1,0,'Возврат после проверки: '+note,actor.id);
   await review(c,orderId);return{id};
  });
 },false);
}
