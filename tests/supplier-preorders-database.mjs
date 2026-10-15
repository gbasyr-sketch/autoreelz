import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';

const qa=await createImageDatabase('ar_qa_ai_images_supplier_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/supplier-preorders/qa'),{MAIL_PROVIDER:'simulation',OWNER_NOTIFICATION_EMAIL:'owner@example.invalid',CDEK_SHIPMENTS_MODE:'disabled'});
// No provider adapter in this suite may access the network.
globalThis.fetch=async()=>{throw Error('External network is forbidden in supplier preorder QA');};
const {getPool,transaction}=await import('../src/server/db.ts');
const orders=await import('../src/server/orders.ts');
const {payOrder,initiatePayment,settlePayment}=await import('../src/server/payments.ts');
const management=await import('../src/server/management.ts');
const {shipmentPayload}=await import('../src/server/cdek-shipment-policy.ts');
const {moscowDate}=await import('../src/lib/delivery-deadline.ts');
const q=(s,v=[])=>qa.owner.query(s,v),actor={id:key()},checks=[];
const deadline=moscowDate(Date.now()+7*86400000),category=key();
const row=async id=>(await q('SELECT * FROM ar_orders WHERE id=$1',[id])).rows[0];
const moves=async id=>(await q('SELECT count(*)::int n FROM ar_stock_movements WHERE order_id=$1',[id])).rows[0].n;
const stock=async ids=>(await q('SELECT sku_id,on_hand,reserved FROM ar_stock WHERE sku_id=ANY($1::uuid[]) ORDER BY sku_id',[ids])).rows;
const confirmBody=id=>({orderId:id,terms:'QA supplier agreement',deliveryDeadline:deadline,supplierConfirmed:true,idempotencyKey:key()});
const allocate=id=>orders.allocateOrderStock(actor,{orderId:id,idempotencyKey:key()});
async function fixture(counts=[0,3],kind='preorder',shared){
 const id=key(),quote=key(),batch=key(),session={id:key(),email:null,csrfToken:key(),expiresAt:new Date(Date.now()+3600000).toISOString()},skus=shared??[];
 if(!shared)for(const count of counts){const product=key(),sku=key();await q("INSERT INTO ar_products(id,name,slug,category_id,status) VALUES($1,'QA supplier item',$2,$3,'published')",[product,'qa-'+product,category]);await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA variant','100.10','published')",[sku,product,'QA-'+sku]);await q('INSERT INTO ar_stock(sku_id,on_hand) VALUES($1,$2)',[sku,count]);skus.push(sku);}
 const lines=skus.map(sku=>({productId:sku,skuId:sku,name:'QA supplier item',article:'QA-'+sku,variantLabel:'QA',quantity:1,unitPriceRubles:'100.10',lineTotalRubles:'100.10',components:[{skuId:sku,quantity:1}]}));
 await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[session.id,key(),session.csrfToken]);await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','[]','qa',now()+interval '1 hour')",[quote,session.id]);await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,session.id,quote]);
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles,checkout_policy_version,delivery_deadline) VALUES($1,$2,$3,$4,$5,'quoted','none','QA','+70000000001','qa@example.invalid',$6,$7,$8,'390.00','2026-10-15',$9)",[id,batch,session.id,kind,kind==='preorder'?'preorder_pending':'open',{provider:'cdek',method:'pickup_point',city:'QA',cityCode:44,pointCode:'QA1',address:'QA'},JSON.stringify(lines),(skus.length*100.1).toFixed(2),deadline]);
 for(const sku of skus)await q('INSERT INTO ar_order_components(order_id,sku_id,quantity) VALUES($1,$2,1)',[id,sku]);return{id,session,skus};
}
async function pay(f){const view=await orders.getOrder(f.session,f.id);return payOrder(f.session,{orderId:f.id,shippingVersion:view.shippingVersion,method:'card',idempotencyKey:key()});}
async function check(label,fn){await fn();checks.push(label);}
try{
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA supplier category','qa-supplier','published')",[category]);
 const f=await fixture(),before=await stock(f.skus),body=confirmBody(f.id);
 await check('supplier confirmation opens one mixed order without warehouse movements',async()=>{
  await assert.rejects(orders.confirmPreorder(actor,{...body,supplierConfirmed:false}),{code:'INSUFFICIENT_STOCK'});
  await assert.rejects(orders.confirmPreorder(actor,{...body,deliveryDeadline:null}),{code:'DELIVERY_DEADLINE'});
  await assert.rejects(orders.confirmPreorder(actor,{...body,supplierConfirmed:'true'}),{code:'SUPPLIER_CONFIRMATION'});
  const view=await orders.confirmPreorder(actor,body);assert.equal(view.status,'awaiting_payment');assert.equal(view.allocationState,'supplier_pending');assert.equal(view.canPay,true);assert.ok(view.supplierConfirmedAt);assert.ok(Math.abs(Date.parse(view.expiresAt)-Date.now()-1800000)<5000);
  const again=await orders.confirmPreorder(actor,body);assert.equal(again.supplierConfirmedAt,view.supplierConfirmedAt);assert.equal((await row(f.id)).supplier_confirmed_by,actor.id);assert.deepEqual(await stock(f.skus),before);assert.equal(await moves(f.id),0);
  await assert.rejects(allocate(f.id),{code:'ORDER_STATE'});
  await assert.rejects(getPool().query('UPDATE ar_orders SET supplier_confirmed_at=now()+interval \'1 second\' WHERE id=$1',[f.id]),/immutable/);
 });
 await check('shipping can change before payment; payment version and deadline remain mandatory',async()=>{
  const view=await orders.quoteShipping(actor,{orderId:f.id,costRubles:'410.20',note:'QA updated delivery',deliveryDeadline:deadline,idempotencyKey:key()});assert.equal(view.allocationState,'supplier_pending');assert.equal(view.shippingCostRubles,'410.20');assert.equal(await moves(f.id),0);
  await assert.rejects(initiatePayment(f.session,{orderId:f.id,shippingVersion:view.shippingVersion-1,method:'card',idempotencyKey:key()}),{code:'TOTAL_CHANGED'});
 });
 await check('payment waits for physical arrival and blocks every dispatch entry point',async()=>{
  const view=await pay(f);assert.equal(view.status,'paid');assert.equal(view.allocationState,'supplier_paid');assert.equal(view.waitingForStock,true);assert.deepEqual(await stock(f.skus),before);assert.equal(await moves(f.id),0);
  await assert.rejects(allocate(f.id),{code:'INSUFFICIENT_STOCK'});
  await assert.rejects(management.fulfill(actor,{orderId:f.id,status:'packing',reason:'QA packing',idempotencyKey:key()}),{code:'STOCK_REQUIRED'});
  await assert.rejects(management.overrideDelivery(actor,{orderId:f.id,status:'shipped',reason:'QA override',trackingNumber:'QA-1',idempotencyKey:key()}),{code:'STOCK_REQUIRED'});
  assert.equal((await management.applyVerifiedCarrierEvent({orderId:f.id,eventId:key(),status:'shipped',trackingNumber:'QA-1',occurredAt:new Date().toISOString()})).applied,false);
  assert.throws(()=>shipmentPayload({status:'paid',payment_status:'paid',allocation_state:'supplier_paid'}, {}, {}),{code:'STOCK_REQUIRED'});
  await assert.rejects(management.cancelByManager(actor,{orderId:f.id,reason:'QA cancellation',idempotencyKey:key()}),{code:'REFUND_REQUIRED'});await assert.rejects(orders.cancelOrder(f.session,{orderId:f.id,idempotencyKey:key()}),{code:'ORDER_STATE'});
  await q("UPDATE ar_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[f.id]);await orders.expireDueOrders();assert.equal((await row(f.id)).allocation_state,'supplier_paid');assert.equal(await moves(f.id),0);
 });
 await check('arrival allocation is atomic for the whole order and idempotent under concurrency',async()=>{
  await orders.receiveStock(actor,{skuId:f.skus[0],quantity:1,reason:'QA physical receipt',idempotencyKey:key()});
  const request={orderId:f.id,idempotencyKey:key()};await Promise.all([orders.allocateOrderStock(actor,request),orders.allocateOrderStock(actor,request),allocate(f.id)]);assert.equal(await moves(f.id),2);assert.equal((await row(f.id)).allocation_state,'settled');
  await orders.allocateOrderStock(actor,request);await allocate(f.id);assert.equal(await moves(f.id),2);assert.deepEqual((await stock(f.skus)).map(s=>[s.on_hand,s.reserved]).sort(),[[0,0],[2,0]]);
  assert.equal((await orders.getOrder(f.session,f.id)).waitingForStock,false);
  const raw=await row(f.id);shipmentPayload(raw,{weightG:400,lengthMm:200,widthMm:100,heightMm:100,itemWeights:[100,100]},{environment:'test',fromPoint:'QA',accountHash:'qa'});
  assert.equal((await management.fulfill(actor,{orderId:f.id,status:'packing',reason:'QA packing',idempotencyKey:key()})).deliveryStatus,'packing');
 });
 await check('cancel and expiry never return supplier stock; late payment requires review',async()=>{
  for(const mode of ['customer','manager','expiry']){const a=await fixture(),snap=await stock(a.skus);await orders.confirmPreorder(actor,confirmBody(a.id));let payment;
   if(mode==='expiry')payment=await initiatePayment(a.session,{orderId:a.id,shippingVersion:(await row(a.id)).shipping_version,method:'card',idempotencyKey:key()});
   if(mode==='customer')await orders.cancelOrder(a.session,{orderId:a.id,idempotencyKey:key()});else if(mode==='manager')await management.cancelByManager(actor,{orderId:a.id,reason:'QA cancel',idempotencyKey:key()});else{await q("UPDATE ar_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);await orders.expireDueOrders();await orders.expireDueOrders();}
   assert.equal((await row(a.id)).allocation_state,'released');assert.equal(await moves(a.id),0);assert.deepEqual(await stock(a.skus),snap);
   if(payment){const event={eventId:key(),paymentId:payment.paymentId,amountRubles:payment.amountRubles,currency:'RUB',status:'succeeded'};const r=await transaction(c=>settlePayment(c,event,'simulation'));assert.equal(r.outcome,'review');assert.equal((await row(a.id)).status,'manual_review');assert.equal(await moves(a.id),0);assert.deepEqual(await stock(a.skus),snap);}
  }
 });
 await check('shared warehouse stock cannot be consumed by supplier and ordinary orders twice',async()=>{
  const a=await fixture([0]);await orders.confirmPreorder(actor,confirmBody(a.id));await pay(a);await orders.receiveStock(actor,{skuId:a.skus[0],quantity:1,reason:'QA physical receipt',idempotencyKey:key()});const ordinary=await fixture([], 'ordinary',a.skus);
  const r=await Promise.allSettled([allocate(a.id),orders.quoteShipping(actor,{orderId:ordinary.id,costRubles:'390.00',note:'QA ordinary shipping',deliveryDeadline:deadline,idempotencyKey:key()})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'INSUFFICIENT_STOCK');const s=(await stock(a.skus))[0];assert.ok(s.on_hand>=s.reserved);assert.equal(s.on_hand-s.reserved,0);
 });
 await check('pending and completed refunds prevent stock allocation even while the order is marked paid',async()=>{
  for(const state of ['pending','succeeded']){const a=await fixture([0]);await orders.confirmPreorder(actor,confirmBody(a.id));await pay(a);await orders.receiveStock(actor,{skuId:a.skus[0],quantity:1,reason:'QA physical receipt',idempotencyKey:key()});const payment=(await q('SELECT * FROM ar_payments WHERE order_id=$1',[a.id])).rows[0],snapshot=await stock(a.skus);
   const extended=(await q("SELECT 1 FROM information_schema.columns WHERE table_name='ar_yookassa_refunds' AND column_name='selection_snapshot'")).rowCount;
   const fields=extended?',payment_amount_rubles,selection_snapshot':'',values=extended?",$8,'{\"version\":1}'":'';
   await q("INSERT INTO ar_yookassa_refunds(id,order_id,payment_id,provider_payment_id,shop_id,amount_rubles,provider_key,reason,actor_id,state"+fields+") VALUES($1,$2,$3,$4,'qa','1.00',$5,'QA refund',$6,$7"+values+")",[key(),a.id,payment.id,key(),key(),actor.id,state,...(extended?[payment.amount_rubles]:[])]);
   await assert.rejects(allocate(a.id),{code:'ORDER_STATE'});assert.equal(await moves(a.id),0);assert.deepEqual(await stock(a.skus),snapshot);
  }
 });
 const report={passed:true,isolated:true,externalCalls:0,checks};await fs.mkdir('artifacts/supplier-preorders',{recursive:true});await fs.writeFile('artifacts/supplier-preorders/database.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await getPool().end();await qa.close(true);}
