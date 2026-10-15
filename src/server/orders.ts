import {enqueueMail,enqueueOwnerMail,enqueueDeliveryMail,enqueueOrderMail} from './mail.ts';
import {validDate,moscowDate,PAYMENT_WINDOW_MS} from '../lib/delivery-deadline.ts';
import {verifyCheckoutConfirmation} from './confirmations.ts';
import{paymentProvider}from'./payment-policy.ts';
import{sumRubles}from'./pricing.ts';
import{compareRubles}from'../lib/money.ts';
import type{PoolClient}from'pg';
import type{ShopSession,OrderView,CheckoutInput,QuoteGroup}from'../lib/commerce-types.ts';
import{query,transaction}from'./db.ts';
import{StoreError,uuid,integer,text,iso}from'./errors.ts';
import{idempotent}from'./security.ts';
import{cartRecord,completeLines}from'./cart.ts';
import{requirements,quoteGroups,quoteFingerprint,lockStock,safeMoney}from'./pricing.ts';

export async function orderRow(c:PoolClient,id:string,session?:ShopSession,lock=false){
 const row=(await c.query(`SELECT *,delivery_deadline::text AS delivery_deadline FROM ar_orders WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];
 if(!row)throw new StoreError('ORDER_NOT_FOUND','Заказ не найден.',404);
 if(session&&row.session_id!==session.id&&(!session.email||session.email!==row.customer_email))throw new StoreError('FORBIDDEN','Нет доступа к этому заказу.',403);
 return row;
}
export async function toOrder(c:PoolClient,row:Record<string,any>):Promise<OrderView>{
 const confirmation=(await c.query('SELECT confirmation FROM ar_checkout_batches WHERE id=$1',[row.batch_id])).rows[0]?.confirmation??null;
 const events=(await c.query('SELECT event_type,note,created_at FROM ar_order_events WHERE order_id=$1 ORDER BY created_at,id',[row.id])).rows;
 const payment=(await c.query('SELECT provider,status,provider_id,provider_confirmation_url,provider_last_error FROM ar_payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[row.id])).rows[0];
 const provider=payment&&['pending','succeeded','review'].includes(payment.status)?payment.provider:paymentProvider();
 const pending=payment?.provider==='yookassa-sandbox'&&payment.status==='pending';
 const payable=row.status==='awaiting_payment'&&row.delivery_status==='quoted'&&row.expires_at&&new Date(row.expires_at).getTime()>Date.now();
 const paymentAction={provider,pending:Boolean(pending),confirmationUrl:pending&&payable?payment.provider_confirmation_url:null,canCheck:Boolean(pending&&(payment.provider_id||payable)),message:pending?(payment.provider_last_error?'Статус оплаты требует повторной проверки. Новый платёж не создавайте.':'Ожидаем подтверждение тестовой оплаты ЮKassa.'):null};
 const shippingCostRubles=row.shipping_cost_rubles===null?null:safeMoney(row.shipping_cost_rubles),productTotalRubles=safeMoney(row.product_total_rubles);
 return{deliveryDeadline:row.delivery_deadline??null,checkoutPolicyVersion:row.checkout_policy_version??null,confirmation,paymentAction,id:row.id,number:row.number,kind:row.kind,status:row.status,paymentStatus:row.payment_status,deliveryStatus:row.delivery_status,createdAt:iso(row.created_at)!,expiresAt:iso(row.expires_at),customer:{name:row.customer_name,phone:row.customer_phone,email:row.customer_email},delivery:row.delivery_snapshot,lines:row.items_snapshot,productTotalRubles,shippingCostRubles,totalRubles:shippingCostRubles===null?null:sumRubles([productTotalRubles,shippingCostRubles]),shippingReason:row.shipping_reason,shippingVersion:row.shipping_version,terms:row.terms,canPay:Boolean(row.status==='awaiting_payment'&&row.delivery_status==='quoted'&&row.expires_at&&new Date(row.expires_at).getTime()>Date.now()),canCancel:['open','preorder_pending','awaiting_payment'].includes(row.status),reviewReason:row.review_reason,trackingNumber:row.tracking_number??null,deliverySource:row.delivery_source??'checkout',deliveryOverride:row.delivery_override??false,deliveredAt:iso(row.delivered_at),events:events.map(e=>({type:e.event_type,at:iso(e.created_at)!,note:e.note}))};
}
export const getOrder=(session:ShopSession,id:string)=>transaction(async c=>toOrder(c,await orderRow(c,uuid(id),session)),false);
export async function listOrders(session?:ShopSession){return transaction(async c=>{const rows=await c.query(`SELECT *,delivery_deadline::text AS delivery_deadline FROM ar_orders ${session?'WHERE session_id=$1 OR ($2::text IS NOT NULL AND customer_email=$2)':''} ORDER BY created_at DESC LIMIT 100`,session?[session.id,session.email]:[]);const orders:OrderView[]=[];for(const r of rows.rows)orders.push(await toOrder(c,r));return orders;},false);}
export async function event(c:PoolClient,orderId:string,type:string,note:string,actorId:string|null=null){const result=await c.query('INSERT INTO ar_order_events(order_id,event_type,note,actor_id) VALUES($1,$2,$3,$4) RETURNING id',[orderId,type,note,actorId]);await enqueueOwnerMail(c,result.rows[0].id,orderId,type);await enqueueDeliveryMail(c,orderId,result.rows[0].id,type);}
export async function outbox(c:PoolClient,email:string,subject:string,body:string,key:string){await enqueueMail(c,{recipient:email,subject,body,key});}
export async function componentNeeds(c:PoolClient,orderId:string){const rows=(await c.query('SELECT sku_id,quantity FROM ar_order_components WHERE order_id=$1 ORDER BY sku_id',[orderId])).rows;return new Map<string,number>(rows.map(r=>[r.sku_id,r.quantity]));}
export async function stockMove(c:PoolClient,orderId:string|null,need:Map<string,number>,operation:string,stockFactor:number,reserveFactor:number,reason:string,actor:string|null=null){
 for(const[id,qty]of [...need].sort(([a],[b])=>a.localeCompare(b))){
  await c.query('UPDATE ar_stock SET on_hand=on_hand+$2,reserved=reserved+$3 WHERE sku_id=$1',[id,qty*stockFactor,qty*reserveFactor]);
  await c.query('INSERT INTO ar_stock_movements(sku_id,order_id,operation_key,stock_delta,reserved_delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,orderId,operation,qty*stockFactor,qty*reserveFactor,reason,actor]);
 }
}
export async function releaseAllocation(c:PoolClient,row:Record<string,any>,reason:string,actor:string|null=null){
 if(!['reserved','debited'].includes(row.allocation_state))return;
 const need=await componentNeeds(c,row.id);await lockStock(c,need);
 await stockMove(c,row.id,need,`release:${row.id}`,row.allocation_state==='debited'?1:0,row.allocation_state==='reserved'?-1:0,reason,actor);
 await c.query("UPDATE ar_orders SET allocation_state='released' WHERE id=$1",[row.id]);row.allocation_state='released';
}
export async function expireLocked(c:PoolClient,row:Record<string,any>){
 if(!row.expires_at||new Date(row.expires_at).getTime()>Date.now()||!['reserved','debited'].includes(row.allocation_state))return false;
 await releaseAllocation(c,row,'Истёк срок оплаты');
 const status=row.status==='manual_review'?'manual_review':'expired';
 await c.query('UPDATE ar_orders SET status=$2 WHERE id=$1',[row.id,status]);row.status=status;
 await event(c,row.id,'expired','Срок оплаты истёк. Остаток освобождён один раз.');return true;
}
export async function checkout(session:ShopSession,body:Record<string,unknown>){
 const quoteId=uuid(body.quoteId),version=integer(body.cartVersion,'Версия корзины'),confirmation=verifyCheckoutConfirmation(body.confirmation);
 const result=await transaction(c=>idempotent(c,`checkout:${session.id}`,body.idempotencyKey,{quoteId,version,confirmation},async()=>{
  const quote=(await c.query('SELECT * FROM ar_cart_quotes WHERE id=$1 AND session_id=$2 FOR UPDATE',[quoteId,session.id])).rows[0];
  if(!quote)throw new StoreError('QUOTE_NOT_FOUND','Сначала проверьте состав и доставку заказа.',404);
  const existing=(await c.query('SELECT id FROM ar_checkout_batches WHERE quote_id=$1',[quoteId])).rows[0];
  if(existing)return{orderIds:(await c.query('SELECT id FROM ar_orders WHERE batch_id=$1 ORDER BY kind',[existing.id])).rows.map(r=>r.id)};
  if(new Date(quote.expires_at).getTime()<=Date.now())throw new StoreError('QUOTE_EXPIRED','Расчёт устарел. Повторно проверьте заказ.',409);
  const cart=await cartRecord(c,session,true);if(cart.version!==version||quote.cart_version!==version)throw new StoreError('CART_CHANGED','Корзина изменилась. Проверьте заказ снова.',409);
  const lines=await completeLines(c,cart.id);const input=quote.input as CheckoutInput;
  const current=await quoteGroups(c,lines,input,true);
  if(quoteFingerprint(current)!==quote.fingerprint)throw new StoreError('QUOTE_CHANGED','Цена, состав, наличие или упаковка изменились. Обновите расчёт и подтвердите его снова.',409);
  const groups:QuoteGroup[]=quote.snapshot;
  if(groups.length!==1)throw new StoreError('QUOTE_CHANGED','Обновите расчёт: все товары теперь оформляются одним заказом.',409);
  const batch=(await c.query("INSERT INTO ar_checkout_batches(session_id,quote_id,confirmation) VALUES($1,$2,$3::jsonb || jsonb_build_object('acceptedAt',now())) RETURNING id",[session.id,quoteId,confirmation])).rows[0];const orderIds:string[]=[];
  for(const group of groups){
   const ordinary=group.kind==='ordinary',quoted=group.shipping.status==='quoted',ready=ordinary&&quoted&&validDate(group.deliveryDeadline);
   if(ready&&group.deliveryDeadline!<moscowDate(Date.now()+PAYMENT_WINDOW_MS))throw new StoreError('DELIVERY_DEADLINE','Повторите расчёт срока доставки.',409);
   const order=(await c.query(`INSERT INTO ar_orders(batch_id,session_id,kind,status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles,shipping_reason,shipping_package,expires_at,checkout_policy_version,delivery_deadline)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $16 THEN now()+interval '30 minutes' ELSE NULL END,'2026-10-15',$17) RETURNING *`,[batch.id,session.id,group.kind,ordinary?(ready?'awaiting_payment':'open'):'preorder_pending',group.shipping.status,ready?'reserved':'none',input.customer.name,input.customer.phone,input.customer.email,{...input.delivery,...(group.shipping.carrier?{carrier:group.shipping.carrier}:{})},JSON.stringify(group.lines),group.productTotalRubles,group.shipping.costRubles,group.shipping.reason,group.shipping.packageSnapshot,ready,group.deliveryDeadline??null])).rows[0];
   const need=requirements(group.lines);for(const[id,quantity]of need)await c.query('INSERT INTO ar_order_components(order_id,sku_id,quantity) VALUES($1,$2,$3)',[order.id,id,quantity]);
   if(ready)await stockMove(c,order.id,need,`reserve:${order.id}`,0,1,'Резерв обычного заказа');
   await event(c,order.id,'created',ready?'Обычный заказ: резерв и оплата на 30 минут.':ordinary?'Сумма или дата получения уточняются. До согласования товары не резервируются.':'В заказе есть предзаказ: весь состав ожидает подтверждения менеджером, компоненты не резервируются до подтверждения.');
   await enqueueOrderMail(c,order.id,'created',`order:${order.id}:created`);
   orderIds.push(order.id);
  }
  await c.query('DELETE FROM ar_cart_lines WHERE cart_id=$1',[cart.id]);await c.query('UPDATE ar_carts SET version=version+1 WHERE id=$1',[cart.id]);return{orderIds};
 }));
 return{...result,orders:await Promise.all(result.orderIds.map((id:string)=>getOrder(session,id)))};
}
export async function cancelOrder(session:ShopSession,body:Record<string,unknown>){
 const id=uuid(body.orderId);await transaction(c=>idempotent(c,`cancel:${session.id}`,body.idempotencyKey,{id},async()=>{
  const row=await orderRow(c,id,session,true);await expireLocked(c,row);
  if(row.status==='cancelled'||row.status==='expired')return{id};
  if(!['open','preorder_pending','awaiting_payment'].includes(row.status))throw new StoreError('ORDER_STATE','Этот заказ нельзя отменить автоматически.',409);
  await releaseAllocation(c,row,'Отмена покупателем');await c.query("UPDATE ar_orders SET status='cancelled' WHERE id=$1",[id]);await event(c,id,'cancelled','Покупатель отменил заказ.');return{id};
 }));return getOrder(session,id);
}
export async function quoteShipping(actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.orderId),cost=safeMoney(body.costRubles),note=text(body.note,'Комментарий к доставке',2,500),deadline=body.deliveryDeadline??null;
 if(compareRubles(cost,'1000000.00')>0)throw new StoreError('PRICE_RANGE','Стоимость доставки превышает допустимую сумму.');
 const result=await transaction(c=>idempotent(c,`shipping:${actor.id}`,body.idempotencyKey,{id,cost,note,deadline},async()=>{
  const row=await orderRow(c,id,undefined,true);const expired=await expireLocked(c,row);
  if(expired)return{id,expired:true};
  const pendingPayment=(await c.query("SELECT 1 FROM ar_payments WHERE order_id=$1 AND status='pending'",[id])).rowCount;
  if(!['open','preorder_pending','awaiting_payment'].includes(row.status)||row.payment_status==='pending'||pendingPayment)throw new StoreError('ORDER_STATE','Доставку этого заказа сейчас нельзя изменить.',409);
  const agreedDeadline=row.checkout_policy_version?checkedDeadline(deadline):null;
  if(row.kind==='ordinary'&&row.allocation_state==='none'){
   const need=await componentNeeds(c,id),stocks=await lockStock(c,need);
   if(stocks.length!==need.size||stocks.some(s=>s.on_hand-s.reserved<(need.get(s.sku_id)??0)))throw new StoreError('INSUFFICIENT_STOCK','Для открытия оплаты нужны все товары в наличии.',409);
   await stockMove(c,id,need,`reserve:${id}`,0,1,'Резерв после согласования доставки',actor.id);
  }
  await c.query("UPDATE ar_orders SET shipping_cost_rubles=$2,shipping_reason=$3,shipping_version=shipping_version+1,delivery_status='quoted',delivery_deadline=$4,status=CASE WHEN kind='ordinary' THEN 'awaiting_payment' ELSE status END,allocation_state=CASE WHEN kind='ordinary' AND allocation_state='none' THEN 'reserved' ELSE allocation_state END,expires_at=CASE WHEN kind='ordinary' THEN now()+interval '30 minutes' ELSE expires_at END WHERE id=$1",[id,cost,note,agreedDeadline]);
  await event(c,id,'shipping_quoted','Доставка согласована. '+(agreedDeadline?'Получение не позднее '+agreedDeadline+'. ':'')+note,actor.id);
  if(row.kind==='ordinary')await enqueueOrderMail(c,id,'ready',`order:${id}:shipping:${row.shipping_version+1}`);return{id};
 }));
 if('expired'in result&&result.expired)throw new StoreError('EXPIRED','Срок резерва истёк. Покупателю нужно оформить заказ заново.',409);
 return transaction(async c=>toOrder(c,await orderRow(c,id)),false);
}
export async function confirmPreorder(actor:{id:string},body:Record<string,unknown>){
 const id=uuid(body.orderId),terms=text(body.terms,'Срок и условия',3,1000),deadline=body.deliveryDeadline??null;
 await transaction(c=>idempotent(c,`confirm:${actor.id}`,body.idempotencyKey,{id,terms,deadline},async()=>{
  const row=await orderRow(c,id,undefined,true);
  if(row.kind!=='preorder'||row.status!=='preorder_pending')throw new StoreError('ORDER_STATE','Этот предзаказ уже обработан.',409);
  if(row.delivery_status!=='quoted'||row.shipping_cost_rubles===null)throw new StoreError('DELIVERY_PENDING','Сначала уточните стоимость доставки.',409);
  const agreedDeadline=row.checkout_policy_version?checkedDeadline(deadline):null;
  const need=await componentNeeds(c,id),stocks=await lockStock(c,need);
  if(stocks.some(s=>s.on_hand-s.reserved<(need.get(s.sku_id)??0))||stocks.length!==need.size)throw new StoreError('INSUFFICIENT_STOCK','Для подтверждения нужны все составляющие в необходимом количестве.',409);
  await stockMove(c,id,need,`confirm:${id}`,-1,0,'Подтверждение предзаказа',actor.id);
  await c.query("UPDATE ar_orders SET allocation_state='debited',status='awaiting_payment',terms=$2,delivery_deadline=$3,shipping_version=shipping_version+1,expires_at=now()+interval '30 minutes' WHERE id=$1",[id,terms,agreedDeadline]);
  await event(c,id,'preorder_confirmed','Менеджер подтвердил срок и условия. Оплата доступна 30 минут. '+(agreedDeadline?'Получение не позднее '+agreedDeadline+'. ':'')+terms,actor.id);
  await enqueueOrderMail(c,id,'ready',`order:${id}:confirmed`);
  return{id};
 }));return transaction(async c=>toOrder(c,await orderRow(c,id)),false);
}
export async function receiveStock(actor:{id:string},body:Record<string,unknown>){
 const skuId=uuid(body.skuId),quantity=integer(body.quantity,'Количество',1,100000),reason=text(body.reason,'Причина прихода',3,500);
 return transaction(c=>idempotent(c,`stock:${actor.id}`,body.idempotencyKey,{skuId,quantity,reason},async()=>{
  if(!(await c.query('SELECT 1 FROM ar_skus WHERE id=$1',[skuId])).rowCount)throw new StoreError('SKU_NOT_FOUND','Исполнение не найдено.',404);
  const need=new Map([[skuId,quantity]]);await lockStock(c,need);await stockMove(c,null,need,`receipt:${actor.id}:${body.idempotencyKey}`,1,0,reason,actor.id);return{ok:true};
 }));
}
export async function stockList(){return{items:(await query('SELECT s.id,s.article,s.name,coalesce(st.on_hand,0) on_hand,coalesce(st.reserved,0) reserved FROM ar_skus s LEFT JOIN ar_stock st ON st.sku_id=s.id ORDER BY s.article')).rows.map(r=>({skuId:r.id,article:r.article,name:r.name,onHand:r.on_hand,reserved:r.reserved,available:r.on_hand-r.reserved}))};}
export async function expireDueOrders(){const rows=(await query("SELECT id FROM ar_orders WHERE expires_at<=now() AND allocation_state IN('reserved','debited') ORDER BY expires_at LIMIT 200")).rows;let count=0;for(const r of rows){const expired=await transaction(async c=>expireLocked(c,await orderRow(c,r.id,undefined,true)));if(expired)count++;}return count;}

function checkedDeadline(value:unknown){if(!validDate(value)||value<moscowDate(Date.now()+PAYMENT_WINDOW_MS))throw new StoreError('DELIVERY_DEADLINE','Укажите согласованную дату получения не раньше окончания срока оплаты.');return value;}
