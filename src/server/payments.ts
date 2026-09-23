import type{PoolClient}from'pg';
import{paymentProvider,sandboxConfig,type PaymentProvider}from'./payment-policy.ts';
import{sumRubles}from'./pricing.ts';
import type{ShopSession}from'../lib/commerce-types.ts';
import{transaction}from'./db.ts';
import{StoreError,uuid,integer,text}from'./errors.ts';
import{idempotent,canonical,hash,sign,equal}from'./security.ts';
import{requireTestEnvironment}from'./config.ts';
import{testPaymentAdapter,type PaymentEvent}from'./adapters/payment.ts';
import{orderRow,getOrder,expireLocked,componentNeeds,stockMove,event as orderEvent,outbox}from'./orders.ts';
import{safeMoney,lockStock}from'./pricing.ts';

export async function applyPaymentEvent(input:PaymentEvent,signature:string){
 requireTestEnvironment();
 if(!equal(sign(canonical(input)),signature))throw new StoreError('PAYMENT_SIGNATURE','Подпись платёжного события неверна.',403);
 return transaction(c=>settlePayment(c,input,'simulation'));
}

// Internal settlement boundary: callers must authenticate/verify the source before entry.
export async function settlePayment(c:PoolClient,input:PaymentEvent,provider:PaymentProvider){
 const paymentId=uuid(input.paymentId),eventId=text(input.eventId,'Событие',1,160),amount=safeMoney(input.amountRubles);
 if(!['succeeded','failed'].includes(input.status)||typeof input.currency!=='string')throw new StoreError('PAYMENT_EVENT','Некорректное событие оплаты.');
 const payloadHash=hash(canonical(input));
  const payment=(await c.query('SELECT * FROM ar_payments WHERE id=$1',[paymentId])).rows[0];
  if(!payment)throw new StoreError('PAYMENT_NOT_FOUND','Платёж не найден.',404);
  if(payment.provider!==provider)throw new StoreError('PAYMENT_PROVIDER_MISMATCH','Источник оплаты не совпадает.',403);
  const order=await orderRow(c,payment.order_id,undefined,true);
  const previous=(await c.query('SELECT * FROM ar_payment_events WHERE provider_event_id=$1',[eventId])).rows[0];
  if(previous){if(previous.payload_hash!==payloadHash)throw new StoreError('PAYMENT_EVENT_REUSED','Событие оплаты содержит другие данные.',409);return{orderId:order.id,outcome:previous.outcome};}
  const current=(await c.query('SELECT * FROM ar_payments WHERE id=$1 FOR UPDATE',[paymentId])).rows[0];
  let outcome:string;
  if(current.status==='succeeded'||current.status==='review'||(current.status==='failed'&&input.status==='failed'))outcome='duplicate';
  else if(input.status==='failed'){
   await c.query("UPDATE ar_payments SET status='failed' WHERE id=$1",[paymentId]);
   const anotherPending=(await c.query("SELECT 1 FROM ar_payments WHERE order_id=$1 AND id<>$2 AND status='pending'",[order.id,paymentId])).rowCount;
   if(order.status!=='paid'&&order.status!=='manual_review'&&!anotherPending)await c.query("UPDATE ar_orders SET payment_status='failed' WHERE id=$1",[order.id]);
   await orderEvent(c,order.id,'payment_failed','Тестовая оплата не прошла.');outcome='failed';
  }else if(input.currency!=='RUB'||amount!==safeMoney(current.amount_rubles)||amount!==sumRubles([order.product_total_rubles,order.shipping_cost_rubles??'0.00'])||order.shipping_version!==current.shipping_version){
   await c.query("UPDATE ar_payments SET status='review' WHERE id=$1",[paymentId]);
   await c.query("UPDATE ar_orders SET status='manual_review',payment_status='review',review_reason='Сумма, валюта или версия доставки не совпадает с заказом.' WHERE id=$1",[order.id]);
   await orderEvent(c,order.id,'payment_review','Параметры оплаты требуют ручной проверки.');outcome='review';
  }else{
   const need=await componentNeeds(c,order.id);await lockStock(c,need);
   await expireLocked(c,order);
   if(order.status==='paid'||order.status!=='awaiting_payment'||!['reserved','debited'].includes(order.allocation_state)){
    await c.query("UPDATE ar_payments SET status='review' WHERE id=$1",[paymentId]);
    await c.query("UPDATE ar_orders SET status='manual_review',payment_status='review',review_reason='Оплата пришла после истечения срока, отмены или другой оплаты. Требуется ручная проверка.' WHERE id=$1",[order.id]);
    await orderEvent(c,order.id,'late_payment','Запоздалая или повторная оплата: автоматического списания и отправки нет.');outcome='review';
   }else{
    if(order.allocation_state==='reserved')await stockMove(c,order.id,need,`paid:${order.id}`,-1,-1,'Оплата обычного заказа');
    await c.query("UPDATE ar_payments SET status='succeeded' WHERE id=$1",[paymentId]);
    await c.query("UPDATE ar_orders SET status='paid',payment_status='paid',allocation_state='settled' WHERE id=$1",[order.id]);
    await orderEvent(c,order.id,'paid','Тестовая оплата получена. Повторного списания компонентов нет.');
    await outbox(c,order.customer_email,`AUTO REELZ — оплата ${order.number}`,`Тестовая оплата заказа ${order.number} прошла. Реальные деньги не списывались.`,`order:${order.id}:paid`);outcome='paid';
   }
  }
  await c.query('INSERT INTO ar_payment_events(provider_event_id,payment_id,payload_hash,outcome) VALUES($1,$2,$3,$4)',[eventId,paymentId,payloadHash,outcome]);
  return{orderId:order.id,outcome};
}
export async function initiatePayment(session:ShopSession,body:Record<string,unknown>){
 requireTestEnvironment();const id=uuid(body.orderId),version=integer(body.shippingVersion,'Версия доставки');
 const method=String(body.method);if(!['card','sbp'].includes(method))throw new StoreError('PAYMENT_METHOD','Выберите карту или СБП.');
 const selected=paymentProvider(),config=selected==='yookassa-sandbox'?sandboxConfig():null;
 if(selected==='yookassa-sandbox'&&method!=='card')throw new StoreError('PAYMENT_METHOD','В тестовом магазине ЮKassa доступна банковская карта.');
 const result=await transaction(c=>idempotent(c,`pay:${session.id}`,body.idempotencyKey,{id,version,method},async()=>{
  const order=await orderRow(c,id,session,true);
  if(await expireLocked(c,order))return{orderId:id,expired:true};
  if(order.status==='paid')return{orderId:id};
  if(order.delivery_status!=='quoted'||order.shipping_cost_rubles===null)throw new StoreError('DELIVERY_PENDING','Сначала менеджер должен уточнить доставку.',409);
  if(order.shipping_version!==version)throw new StoreError('TOTAL_CHANGED','Итоговая сумма изменилась. Просмотрите её заново.',409);
  if(order.status!=='awaiting_payment'||!order.expires_at||!['reserved','debited'].includes(order.allocation_state))throw new StoreError('PAYMENT_CLOSED','Оплата этого заказа сейчас недоступна.',409);
  const existing=(await c.query("SELECT * FROM ar_payments WHERE order_id=$1 AND status='pending'",[id])).rows[0];
  if(existing){if(existing.provider!==selected)throw new StoreError('PAYMENT_PROVIDER_CHANGED','Провайдер оплаты изменён. Обратитесь к менеджеру.',409);return{orderId:id,paymentId:existing.id,amountRubles:safeMoney(existing.amount_rubles)};}
  const amount=sumRubles([order.product_total_rubles,order.shipping_cost_rubles]);
  const payment=(await c.query('INSERT INTO ar_payments(order_id,amount_rubles,method,shipping_version,provider,provider_shop_id,provider_return_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[id,amount,method,version,selected,config?.shopId??null,config?config.returnOrigin+'/orders/'+id:null])).rows[0];
  await c.query("UPDATE ar_orders SET payment_status='pending' WHERE id=$1",[id]);return{orderId:id,paymentId:payment.id,amountRubles:amount};
 }));
 if('expired'in result&&result.expired)throw new StoreError('EXPIRED','Срок оплаты истёк. Остатки освобождены.',409);
 return result;
}
export async function payOrder(session:ShopSession,body:Record<string,unknown>){
 if(paymentProvider()==='yookassa-sandbox'){await getOrder(session,uuid(body.orderId));const {yooPayments}=await import('./yookassa-payments.ts');await yooPayments.preflight();}
 const payment=await initiatePayment(session,body);
 if('paymentId'in payment&&payment.paymentId){
  if(paymentProvider()==='yookassa-sandbox'){const {yooPayments}=await import('./yookassa-payments.ts');await yooPayments.process(payment.paymentId);return getOrder(session,payment.orderId);}
  const{event,signature}=testPaymentAdapter.event({id:payment.paymentId,amountRubles:payment.amountRubles!});await applyPaymentEvent(event,signature);}
 return getOrder(session,payment.orderId);
}
