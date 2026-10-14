import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_orderterms_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/order-terms-20261015/qa'),{APP_ORIGIN:'http://127.0.0.1:14323'});
const db=await import('../src/server/db.ts'),cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts');
const {getSession}=await import('../src/server/security.ts'),{testOrderTerms}=await import('../src/lib/checkout-confirmations.ts');
const q=(s,v=[])=>qa.owner.query(s,v),one=async(s,v=[])=>(await q(s,v)).rows[0],actor={id:key()},category=key(),checks=[];
const deadline='2099-12-31';
async function fixture({pack=false,stock=3}={}){
 const jar=new Map(),session=await getSession({cookies:{get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v)}});
 const product=key(),sku=key(),packageId=pack?key():null;
 if(pack)await q("INSERT INTO ar_packages(id,name,weight_g,length_mm,width_mm,height_mm) VALUES($1,'QA',500,200,100,50)",[packageId]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,'QA terms product',$2,$3,'published',true)",[product,'qa-'+product,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status,package_id) VALUES($1,$2,$3,'QA','100.01','published',$4)",[sku,product,'QA-'+sku,packageId]);
 await q('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,$2,0)',[sku,stock]);
 const c=await cart.changeCart(session,{productId:product,skuId:sku,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});
 const quote=await cart.createQuote(session,{cartVersion:c.version,customer:{name:'QA',phone:'+79990000000',email:'qa@example.invalid'},delivery:{method:'pickup_point',city:'QA City',address:'QA Address'}});
 const body={quoteId:quote.id,cartVersion:c.version,confirmation:{accepted:true,version:quote.confirmation.version},idempotencyKey:key()};
 const order=(await orders.checkout(session,body)).orders[0];return{session,order,sku,quote,body};
}
const ship=(f,more={})=>orders.quoteShipping(actor,{orderId:f.order.id,costRubles:'40.20',note:'QA agreed terms',deliveryDeadline:deadline,idempotencyKey:key(),...more});
const stock=id=>one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[id]);
try{
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA','qa-terms','published')",[category]);
 const a=await fixture({pack:true});assert.equal(a.order.status,'awaiting_payment');assert.ok(a.order.deliveryDeadline);assert.equal(a.order.deliveryDeadline,a.quote.groups[0].deliveryDeadline);assert.equal(a.order.confirmation.offer.body,testOrderTerms.offer.body);assert.equal(a.order.confirmation.offer.sha256,testOrderTerms.offer.sha256);assert.deepEqual(await stock(a.sku),{on_hand:3,reserved:1});
 assert.equal((await orders.checkout(a.session,a.body)).orders[0].id,a.order.id);await assert.rejects(q("UPDATE ar_checkout_batches SET confirmation='{}' WHERE id=(SELECT batch_id FROM ar_orders WHERE id=$1)",[a.order.id]),/immutable/);checks.push('auto deadline and full immutable offer snapshot; checkout retry without another reserve');
 const m=await fixture();assert.equal(m.order.status,'open');assert.equal(m.order.expiresAt,null);assert.equal(m.order.canPay,false);assert.deepEqual(await stock(m.sku),{on_hand:3,reserved:0});
await orders.expireDueOrders();
 await assert.rejects(ship(m,{deliveryDeadline:null}),{code:'DELIVERY_DEADLINE'});await assert.rejects(ship(m,{deliveryDeadline:'2026-02-30'}),{code:'DELIVERY_DEADLINE'});await assert.rejects(ship(m,{deliveryDeadline:'2020-01-01'}),{code:'DELIVERY_DEADLINE'});
 const k=key(),before=Date.now(),ready=await ship(m,{idempotencyKey:k});assert.equal(ready.deliveryDeadline,deadline);assert.ok(new Date(ready.expiresAt).getTime()-before>=1799000);assert.deepEqual(await stock(m.sku),{on_hand:3,reserved:1});assert.equal((await ship(m,{idempotencyKey:k})).expiresAt,ready.expiresAt);checks.push('manual quote waits without reserve; validated date starts full window once');
 const scarce=await fixture({stock:1});await q('UPDATE ar_stock SET on_hand=0 WHERE sku_id=$1',[scarce.sku]);await assert.rejects(ship(scarce),{code:'INSUFFICIENT_STOCK'});assert.equal((await orders.getOrder(scarce.session,scarce.order.id)).expiresAt,null);checks.push('stock checked atomically when manual payment opens');
 const pre=await fixture({stock:0});await ship(pre);await orders.receiveStock(actor,{skuId:pre.sku,quantity:1,reason:'QA receive',idempotencyKey:key()});await assert.rejects(orders.confirmPreorder(actor,{orderId:pre.order.id,terms:'QA',idempotencyKey:key(),deliveryDeadline:null}));
 const po=await orders.confirmPreorder(actor,{orderId:pre.order.id,terms:'QA delivery agreed',deliveryDeadline:deadline,idempotencyKey:key()});assert.equal(po.deliveryDeadline,deadline);assert.equal(po.canPay,true);assert.deepEqual(await stock(pre.sku),{on_hand:0,reserved:0});checks.push('preorder requires explicit date before stock debit and payment');
 const paid=await payments.payOrder(m.session,{orderId:ready.id,shippingVersion:ready.shippingVersion,method:'card',idempotencyKey:key()});assert.equal(paid.status,'paid');await assert.rejects(q("UPDATE ar_orders SET delivery_deadline='2099-12-30' WHERE id=$1",[paid.id]),/locked/);assert.deepEqual(await stock(m.sku),{on_hand:2,reserved:0});checks.push('payment requires date/version; paid deadline cannot be changed');
 const cancelled=await fixture({pack:true});await Promise.all([orders.cancelOrder(cancelled.session,{orderId:cancelled.order.id,idempotencyKey:key()}),orders.cancelOrder(cancelled.session,{orderId:cancelled.order.id,idempotencyKey:key()})]);assert.deepEqual(await stock(cancelled.sku),{on_hand:3,reserved:0});assert.equal((await one("SELECT count(*)::int n FROM ar_stock_movements WHERE order_id=$1 AND operation_key LIKE 'release:%'",[cancelled.order.id])).n,1);checks.push('concurrent cancellation releases reservation once');
 const exp=await fixture({pack:true});await q("UPDATE ar_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[exp.order.id]);await Promise.all([orders.expireDueOrders(),orders.expireDueOrders()]);assert.deepEqual(await stock(exp.sku),{on_hand:3,reserved:0});checks.push('concurrent expiration releases reservation once');
 process.env.PAYMENT_PROVIDER='yookassa-sandbox';process.env.YOOKASSA_SHOP_ID='123456';process.env.YOOKASSA_SECRET_KEY='qa-secret-not-real-00000';
 const {createYooPayments}=await import('../src/server/yookassa-payments.ts');
 const remote=new Map(),service=createYooPayments(()=>({getPayment:async id=>remote.get(id)}));
 async function timed(released=false){const f=await fixture();const o=await ship(f);const p=await payments.initiatePayment(f.session,{orderId:o.id,shippingVersion:o.shippingVersion,method:'card',idempotencyKey:key()});const providerId=key();await q('UPDATE ar_payments SET provider_id=$2 WHERE id=$1',[p.paymentId,providerId]);await q("UPDATE ar_orders SET expires_at=now()+interval '30 seconds' WHERE id=$1",[o.id]);const realNow=Date.now;const base=realNow();remote.set(providerId,{id:providerId,status:'succeeded',paid:true,amountRubles:'140.21',confirmationUrl:null,test:true,paidAt:new Date(base+10000).toISOString()});try{Date.now=()=>base+120000;if(released)await db.transaction(async c=>orders.expireLocked(c,await orders.orderRow(c,o.id,undefined,true)));await service.process(p.paymentId);}finally{Date.now=realNow;}return{...f,p,providerId};}

 const t=await timed();assert.equal((await orders.getOrder(t.session,t.order.id)).status,'paid');assert.deepEqual(await stock(t.sku),{on_hand:2,reserved:0});assert.ok((await one('SELECT provider_paid_at FROM ar_payments WHERE id=$1',[t.p.paymentId])).provider_paid_at);
 const r=await timed(true),review=await orders.getOrder(r.session,r.order.id);assert.equal(review.status,'manual_review');assert.match(review.reviewReason,/совершён в срок/);assert.deepEqual(await stock(r.sku),{on_hand:3,reserved:0});checks.push('verified timely payment survives delayed callback; released stock requires honest manual review');
 process.env.STORE_MODE='production';await assert.rejects(payments.initiatePayment(r.session,{orderId:r.order.id,shippingVersion:0,method:'card',idempotencyKey:key()}));checks.push('real-money mode remains closed');
 await fs.mkdir('artifacts/order-terms',{recursive:true});await fs.writeFile('artifacts/order-terms/database.json',JSON.stringify({passed:true,externalCalls:0,isolated:true,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{await db.getPool().end();await qa.close(true);}
