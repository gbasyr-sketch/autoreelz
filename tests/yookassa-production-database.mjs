import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';

// Isolated schema and synthetic orders only. All provider HTTP is injected below.
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External HTTP is forbidden in production QA');};
const qa=await createImageDatabase('ar_qa_ai_images_yookassa_production_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/yookassa-production/qa'),{
 STORE_MODE:'production',APP_ORIGIN:'https://autoreelz.ru',PAYMENT_PROVIDER:'yookassa-live',
 YOOKASSA_LIVE_OPERATIONS_ENABLED:'true',YOOKASSA_LIVE_SHOP_ID:'1472823',YOOKASSA_LIVE_SECRET_KEY:'qa-production-secret-not-real',YOOKASSA_RECEIPTS_MODE:'yookassa',
 MAIL_PROVIDER:'timeweb-smtp',MAIL_RECIPIENT_POLICY:'all-new',MAIL_NEW_MESSAGES_FROM:'2026-10-14T23:37:31.373Z',MAIL_OWNER_RECIPIENT:'owner@example.invalid',CDEK_SHIPMENTS_MODE:'disabled',
});
const {getPool}=await import('../src/server/db.ts');
const {initiatePayment}=await import('../src/server/payments.ts');
const {changeCart,createQuote}=await import('../src/server/cart.ts');
const {checkout}=await import('../src/server/orders.ts');
const {receiveReturn,inspectReturn}=await import('../src/server/return-intake.ts');
const {returnResolutionWorkspace,closeReturnResolution}=await import('../src/server/return-resolution.ts');
const {testOrderTerms,productionOrderTerms}=await import('../src/lib/checkout-confirmations.ts');
const {createYooPayments}=await import('../src/server/yookassa-payments.ts');
const {createYooReceipts}=await import('../src/server/yookassa-receipts.ts');
const {queueRefund,createYooRefunds}=await import('../src/server/yookassa-refunds.ts');
const {queueClosingReceipt,createYooClosingReceipts}=await import('../src/server/yookassa-closing.ts');
const {createYooKassa}=await import('../src/server/adapters/yookassa-sandbox.ts');
const q=(sql,values=[])=>qa.owner.query(sql,values),actor={id:key()},checks=[],calls=[],posts=[];
const cfg={shopId:'1472823',secretKey:'qa-production-secret-not-real',returnOrigin:'https://autoreelz.ru',test:false};
const remotePayments=new Map(),remoteRefunds=new Map(),remoteReceipts=new Map();
let shopTest=false,paymentTest=false,losePath=null,holdPath=null,hold=null;
const factory=()=>createYooKassa(cfg,async(url,init)=>{
 assert.ok(url.startsWith('https://api.yookassa.ru/v3/'));assert.equal(init.redirect,'error');
 const path=new URL(url).pathname.slice(3);calls.push({path,method:init.method});
 if(path==='/me')return Response.json({test:shopTest,account_id:cfg.shopId,status:'enabled',payment_methods:['bank_card','sbp'],fiscalization_enabled:true});
 const collection=path.startsWith('/refunds')?remoteRefunds:path.startsWith('/receipts')?remoteReceipts:remotePayments;
 if(init.method==='POST'){
  const body=JSON.parse(init.body),requestKey=init.headers['Idempotence-Key'];posts.push({path,key:requestKey,body});
  if(!collection.has(requestKey))collection.set(requestKey,path==='/payments'?{
   id:key(),status:'pending',paid:false,test:paymentTest,recipient:{account_id:cfg.shopId},amount:body.amount,metadata:body.metadata,confirmation:{confirmation_url:'https://yoomoney.ru/qa-production'},receipt_registration:'pending',
  }:path==='/refunds'?{id:key(),payment_id:body.payment_id,amount:body.amount,status:'pending',receipt_registration:'pending'}:{...body,id:'rt-'+key(),status:'pending'});
  if(path===holdPath&&hold)await hold;
  if(path===losePath){losePath=null;throw Error('synthetic lost response');}
  return Response.json(collection.get(requestKey));
 }
 const raw=[...collection.values()].find(r=>r.id===path.split('/').at(-1));assert.ok(raw,'GET references an existing fake provider object: '+path);return Response.json(raw);
});
const payments=createYooPayments(factory),receipts=createYooReceipts(factory),refunds=createYooRefunds(factory),closing=createYooClosingReceipts(factory);
const paymentRow=async id=>(await q('SELECT * FROM ar_payments WHERE id=$1',[id])).rows[0];
const closingRow=async id=>(await q('SELECT * FROM ar_yookassa_closing_receipts WHERE id=$1',[id])).rows[0];
const refundRow=async id=>(await q('SELECT * FROM ar_yookassa_refunds WHERE id=$1',[id])).rows[0];
const duePayment=id=>q("UPDATE ar_payments SET provider_next_check_at=now()-interval '1 second',receipt_next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
const dueClosing=id=>q("UPDATE ar_yookassa_closing_receipts SET next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
const dueRefund=id=>q("UPDATE ar_yookassa_refunds SET next_check_at=now()-interval '1 second',receipt_next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
async function fixture(method='card',orderId=key()){
 const sessionId=key(),quote=key(),batch=key(),category=key(),product=key(),sku=key();
 await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[sessionId,key(),key()]);
 await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','{}','qa',now()+interval '1 hour')",[quote,sessionId]);
 await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,sessionId,quote]);
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA',$2,'published')",[category,'qa-'+category]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status) VALUES($1,'QA',$2,$3,'published')",[product,'qa-'+product,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA','100.01','published')",[sku,product,'QA-'+sku]);
 const lines=[{productId:product,skuId:sku,name:'QA деталь',variantLabel:'Чёрная',quantity:3,unitPriceRubles:'100.01',lineTotalRubles:'300.03',article:'QA-'+sku,image:'',components:[{skuId:sku,name:'QA деталь',article:'QA-'+sku,quantity:1,unitPriceRubles:'100.01'}]}];
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,payment_status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles,expires_at) VALUES($1,$2,$3,'ordinary','awaiting_payment','unpaid','quoted','reserved','QA','+79990000000','qa@example.invalid','{}',$4,'300.03','10.00',now()+interval '30 minutes')",[orderId,batch,sessionId,JSON.stringify(lines)]);
 await q('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,10,3)',[sku]);
 await q('INSERT INTO ar_order_components(order_id,sku_id,quantity) VALUES($1,$2,3)',[orderId,sku]);
 return{orderId,product,sku,session:{id:sessionId,email:null,csrfToken:'qa',expiresAt:new Date(Date.now()+3600000).toISOString()},body:{orderId,shippingVersion:0,method,idempotencyKey:key()}};
}
async function start(f){const result=await initiatePayment(f.session,f.body);f.paymentId=result.paymentId;await payments.process(f.paymentId);return f;}
async function paid(f){
 await start(f);const saved=await paymentRow(f.paymentId),raw=remotePayments.get(saved.provider_key);
 Object.assign(raw,{status:'succeeded',paid:true,captured_at:new Date().toISOString(),receipt_registration:'succeeded'});delete raw.confirmation;
 await duePayment(f.paymentId);await payments.process(f.paymentId);assert.equal((await paymentRow(f.paymentId)).status,'succeeded');return f;
}
const explicitReceive=f=>({orderId:f.orderId,received:true,reason:'QA получатель подтвердил получение товара',confirmed:true,idempotencyKey:key()});
async function delivered(f,source='manager'){
 await q("UPDATE ar_orders SET delivery_status='delivered',delivered_at=now(),delivery_source=$2,delivery_override=$3,tracking_number=$4 WHERE id=$1",[f.orderId,source,source==='manager','QA-'+f.orderId]);
}
async function closeReceipt(id){
 await closing.process(id);const row=await closingRow(id);assert.equal(row.state,'pending');remoteReceipts.get(row.provider_key).status='succeeded';await dueClosing(id);await closing.process(id);assert.equal((await closingRow(id)).state,'succeeded');
}
const partial=f=>({orderId:f.orderId,paymentId:f.paymentId,reason:'QA частичный возврат',confirmed:true,mode:'partial',lines:[{lineIndex:0,quantity:1}],shippingRubles:'0.00',amountRubles:'100.01',idempotencyKey:key()});
async function refundSettled(body,receiptRegistration='succeeded'){const id=(await queueRefund(actor,body)).id;await refunds.process(id);const row=await refundRow(id);Object.assign(remoteRefunds.get(row.provider_key),{status:'succeeded',receipt_registration:receiptRegistration});await dueRefund(id);await refunds.process(id);assert.equal((await refundRow(id)).state,'succeeded');return id;}
try{
 const blocked=await fixture(),beforeDisabled=calls.length;process.env.YOOKASSA_LIVE_OPERATIONS_ENABLED='false';
 await assert.rejects(initiatePayment(blocked.session,blocked.body),{code:'LIVE_PAYMENT_DISABLED'});await assert.rejects(payments.preflight(),{code:'LIVE_PAYMENT_DISABLED'});await assert.rejects(refunds.process(key()),{code:'LIVE_PAYMENT_DISABLED'});await assert.rejects(closing.process(key()),{code:'LIVE_PAYMENT_DISABLED'});for(const reconcile of [payments.reconcile,refunds.reconcile,receipts.reconcile,closing.reconcile,closing.discover])assert.equal(await reconcile(),0);assert.equal(calls.length,beforeDisabled);assert.equal((await q('SELECT count(*)::int n FROM ar_payments')).rows[0].n,0);process.env.YOOKASSA_LIVE_OPERATIONS_ENABLED='true';checks.push('live opt-in disabled blocks direct mutations before transport; paused background payment/refund/fiscal/discovery loops return zero');
 shopTest=true;const beforeWrongShop=posts.length;await assert.rejects(payments.preflight(),{code:'PAYMENT_SETUP'});assert.equal(posts.length,beforeWrongShop);shopTest=false;await payments.preflight();
 const smart=await fixture('smart'),smartCreated=await initiatePayment(smart.session,smart.body);smart.paymentId=smartCreated.paymentId;
 assert.deepEqual(await initiatePayment(smart.session,smart.body),smartCreated);
 const smartRow=await paymentRow(smart.paymentId);assert.equal(smartRow.method,'smart');
 await assert.rejects(q("UPDATE ar_payments SET method='card' WHERE id=$1",[smart.paymentId]),/immutable/);
 losePath='/payments';await assert.rejects(payments.process(smart.paymentId),{code:'PAYMENT_PENDING_CHECK'});await duePayment(smart.paymentId);await payments.process(smart.paymentId);
 const smartPosts=posts.filter(p=>p.key===smartRow.provider_key);assert.equal(smartPosts.length,2);assert.deepEqual(smartPosts[0],smartPosts[1]);assert.equal(Object.hasOwn(smartPosts[0].body,'payment_method_data'),false);assert.deepEqual(smartPosts[0].body.receipt,smartRow.receipt_snapshot);
 assert.equal((await initiatePayment(smart.session,{...smart.body,idempotencyKey:key()})).paymentId,smart.paymentId);assert.equal((await q('SELECT count(*)::int n FROM ar_payments WHERE order_id=$1',[smart.orderId])).rows[0].n,1);
 checks.push('smart attempt is immutable; same-key and fresh-key retries reuse one pending payment and identical provider payload/receipt after a lost response');
 const auto=await fixture();delete auto.body.method;auto.paymentId=(await initiatePayment(auto.session,auto.body)).paymentId;assert.equal((await paymentRow(auto.paymentId)).method,'smart');checks.push('omitted method defaults to smart for YooKassa');
 for(const method of ['card','sbp']){const old=await fixture(method);old.paymentId=(await initiatePayment(old.session,old.body)).paymentId;const oldRow=await paymentRow(old.paymentId);assert.equal((await initiatePayment(old.session,{...old.body,method:'smart',idempotencyKey:key()})).paymentId,old.paymentId);await payments.process(old.paymentId);const sent=posts.find(p=>p.key===oldRow.provider_key);assert.equal(sent.body.payment_method_data.type,method==='card'?'bank_card':'sbp');assert.deepEqual(await initiatePayment(old.session,old.body),{orderId:old.orderId,paymentId:old.paymentId,amountRubles:'310.03'});}
 checks.push('existing card/SBP attempts and original command keys keep their payment ID and request body when the new UI asks for smart');
 const smartPaid=await paid(await fixture('smart'));assert.equal((await paymentRow(smartPaid.paymentId)).receipt_registration,'succeeded');await delivered(smartPaid);await closeReceipt((await queueClosingReceipt(actor,explicitReceive(smartPaid))).id);const smartRefund=await refundSettled({orderId:smartPaid.orderId,paymentId:smartPaid.paymentId,reason:'QA smart refund after actual fixture delivery',confirmed:true,mode:'full',amountRubles:'310.03',idempotencyKey:key()});assert.equal((await refundRow(smartRefund)).receipt_registration,'succeeded');checks.push('smart payment completes prepayment, closing receipt and full refund receipt through the unchanged fiscal protocol');
 const wrong=await fixture();paymentTest=true;const bad=await initiatePayment(wrong.session,wrong.body);wrong.paymentId=bad.paymentId;await assert.rejects(payments.process(bad.paymentId),{code:'PAYMENT_PENDING_CHECK'});assert.equal((await paymentRow(bad.paymentId)).provider_id,null);assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[wrong.sku])).rows[0],{on_hand:10,reserved:3});paymentTest=false;checks.push('sandbox shop/payment response cannot settle a live order');
 const f=await paid(await fixture());assert.equal((await paymentRow(f.paymentId)).provider,'yookassa-live');
 await Promise.all([payments.process(f.paymentId),payments.process(f.paymentId)]);await receipts.reconcile();assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku])).rows[0],{on_hand:7,reserved:0});assert.equal((await q("SELECT count(*)::int n FROM ar_payment_events WHERE payment_id=$1 AND outcome='paid'",[f.paymentId])).rows[0].n,1);assert.equal((await paymentRow(f.paymentId)).receipt_registration,'succeeded');checks.push('live payment and fiscal receipt settle once; exact stock and one money event');

 const callback=await start(await fixture()),callbackSaved=await paymentRow(callback.paymentId),callbackRaw=remotePayments.get(callbackSaved.provider_key);
 await payments.webhook({type:'notification',event:'payment.succeeded',object:{id:callbackRaw.id,status:'succeeded',metadata:{autoreelz_payment_id:callback.paymentId}}});assert.equal((await paymentRow(callback.paymentId)).status,'pending');
 Object.assign(callbackRaw,{status:'succeeded',paid:true,captured_at:new Date().toISOString(),receipt_registration:'succeeded'});delete callbackRaw.confirmation;
 await payments.webhook({type:'notification',event:'payment.succeeded',object:{id:callbackRaw.id,metadata:{autoreelz_payment_id:callback.paymentId}}});await payments.webhook({type:'notification',event:'payment.succeeded',object:{id:callbackRaw.id}});assert.equal((await paymentRow(callback.paymentId)).status,'succeeded');assert.equal((await q("SELECT count(*)::int n FROM ar_payment_events WHERE payment_id=$1 AND outcome='paid'",[callback.paymentId])).rows[0].n,1);checks.push('live webhook treats callback as hint, verifies provider GET and settles only confirmed money exactly once');
 const sbp=await paid(await fixture('sbp'));const sbpRow=await paymentRow(sbp.paymentId);assert.equal(posts.find(p=>p.key===sbpRow.provider_key).body.payment_method_data.type,'sbp');checks.push('SBP is stored and sent through the actual live protocol');
 const lost=await fixture();lost.paymentId=(await initiatePayment(lost.session,lost.body)).paymentId;losePath='/payments';await assert.rejects(payments.process(lost.paymentId),{code:'PAYMENT_PENDING_CHECK'});await duePayment(lost.paymentId);await payments.process(lost.paymentId);const lostRow=await paymentRow(lost.paymentId),attempts=posts.filter(p=>p.key===lostRow.provider_key);assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);checks.push('unknown payment POST retries identical immutable body and idempotence key');
 await delivered(f);const beforeQueue=calls.length;await closing.discover();assert.equal((await q('SELECT count(*)::int n FROM ar_yookassa_closing_receipts WHERE order_id=$1',[f.orderId])).rows[0].n,0);checks.push('manager delivered status alone never automatically queues fiscal closing receipt');
 const command=explicitReceive(f),queued=await Promise.all([queueClosingReceipt(actor,command),queueClosingReceipt(actor,command),queueClosingReceipt(actor,{...command,idempotencyKey:key()})]);assert.equal(new Set(queued.map(r=>r.id)).size,1);const closingId=queued[0].id;assert.equal(calls.length,beforeQueue);const snapshot=await closingRow(closingId);assert.equal(snapshot.amount_rubles,'310.03');assert.equal(snapshot.receipt_snapshot.items[0].payment_mode,'full_payment');assert.deepEqual(snapshot.receipt_snapshot.settlements,[{type:'prepayment',amount:{value:'310.03',currency:'RUB'}}]);await assert.rejects(getPool().query("UPDATE ar_yookassa_closing_receipts SET receipt_snapshot='{}' WHERE id=$1",[closingId]),/immutable/);checks.push('explicit manager receipt confirmation queues once without network and freezes full-payment/prepayment snapshot');
 let release;holdPath='/receipts';hold=new Promise(r=>release=r);const countBefore=posts.length,work=closing.process(closingId);for(let n=0;posts.length===countBefore&&n<1000;n++)await new Promise(r=>setTimeout(r,5));assert.equal(posts.length,countBefore+1);await closing.process(closingId);assert.equal(posts.length,countBefore+1);release();await work;hold=null;holdPath=null;const posted=posts.at(-1);assert.equal(posted.path,'/receipts');assert.equal(posted.body.type,'payment');assert.equal(posted.body.send,true);assert.equal(posted.body.payment_id,(await paymentRow(f.paymentId)).provider_id);remoteReceipts.get(snapshot.provider_key).status='succeeded';await dueClosing(closingId);await Promise.all([closing.process(closingId),closing.process(closingId)]);assert.equal((await closingRow(closingId)).state,'succeeded');assert.equal(posts.filter(p=>p.key===snapshot.provider_key).length,1);checks.push('closing receipt dispatch lease excludes concurrent POST; GET reconciliation completes once');
 const remaining=await paid(await fixture());await refundSettled(partial(remaining));await delivered(remaining);const remainingId=(await queueClosingReceipt(actor,explicitReceive(remaining))).id;const remainingRow=await closingRow(remainingId);assert.equal(remainingRow.amount_rubles,'210.02');assert.equal(remainingRow.receipt_snapshot.items[0].quantity,'2');assert.equal(remainingRow.receipt_snapshot.settlements[0].amount.value,'210.02');await closeReceipt(remainingId);checks.push('closing receipt excludes previously refunded quantities and uses exact remaining payment');
 const afterClosing=(await queueRefund(actor,partial(f))).id;await refunds.process(afterClosing);const afterPost=posts.at(-1);assert.equal(afterPost.path,'/refunds');assert.ok(afterPost.body.receipt);assert.ok(afterPost.body.receipt.items.every(i=>i.payment_mode==='full_payment'));checks.push('post-closing partial refund transmits full_payment fiscal items');
 const whole=await paid(await fixture());await delivered(whole);const wholeClosing=(await queueClosingReceipt(actor,explicitReceive(whole))).id;await closeReceipt(wholeClosing);const wholeRefund=(await queueRefund(actor,{orderId:whole.orderId,paymentId:whole.paymentId,reason:'QA полный возврат после получения',confirmed:true,mode:'full',amountRubles:'310.03',idempotencyKey:key()})).id;await refunds.process(wholeRefund);assert.ok(posts.at(-1).body.receipt,'whole original refund must force an explicit full-payment receipt after closing');assert.ok(posts.at(-1).body.receipt.items.every(i=>i.payment_mode==='full_payment'));checks.push('whole post-closing refund forces explicit full_payment receipt');
 const unknown=await paid(await fixture());await delivered(unknown);const unknownId=(await queueClosingReceipt(actor,explicitReceive(unknown))).id;losePath='/receipts';await closing.process(unknownId);assert.equal((await closingRow(unknownId)).state,'uncertain');const unknownRow=await closingRow(unknownId);await dueClosing(unknownId);await closing.process(unknownId);const retryPosts=posts.filter(p=>p.key===unknownRow.provider_key);assert.equal(retryPosts.length,2);assert.deepEqual(retryPosts[0],retryPosts[1]);checks.push('unknown closing receipt retries same key/body before idempotence expiry');
 const old=await paid(await fixture());await delivered(old);const oldId=(await queueClosingReceipt(actor,explicitReceive(old))).id;await q("UPDATE ar_yookassa_closing_receipts SET requested_at=now()-interval '24 hours' WHERE id=$1",[oldId]);const beforeOld=posts.length;await closing.process(oldId);assert.equal((await closingRow(oldId)).state,'attention');assert.equal(posts.length,beforeOld);checks.push('expired unknown closing request becomes attention without unsafe new POST');

 async function verifiedDelivered(item){
  const shipmentId=key();await q("INSERT INTO ar_cdek_shipments(id,order_id,environment,account_hash,number,payload,fingerprint,actor_id,state,provider_uuid,carrier_code,carrier_at) VALUES($1,$2,'live','qa',$3,'{}','qa',$4,'ready',$5,'DELIVERED',now())",[shipmentId,item.orderId,key(),actor.id,key()]);return shipmentId;
 }
 const pendingFiscal=await paid(await fixture());const pendingFiscalRefund=await refundSettled(partial(pendingFiscal),'pending');await delivered(pendingFiscal);const pendingFiscalClosing=(await queueClosingReceipt(actor,explicitReceive(pendingFiscal))).id;const beforeFiscalWait=calls.length;await closing.process(pendingFiscalClosing);assert.equal((await closingRow(pendingFiscalClosing)).state,'queued');assert.equal((await closingRow(pendingFiscalClosing)).last_error,'REFUND_RECEIPT_NOT_REGISTERED');assert.equal(calls.length,beforeFiscalWait);
 const pendingFiscalRow=await refundRow(pendingFiscalRefund);remoteRefunds.get(pendingFiscalRow.provider_key).receipt_registration='succeeded';await dueRefund(pendingFiscalRefund);await receipts.reconcile();assert.equal((await refundRow(pendingFiscalRefund)).receipt_registration,'succeeded');await dueClosing(pendingFiscalClosing);await closeReceipt(pendingFiscalClosing);checks.push('closing waits without network for succeeded refund fiscal pending, then resumes after verified refund receipt');
 const canceledFiscal=await paid(await fixture());await refundSettled(partial(canceledFiscal),'canceled');await delivered(canceledFiscal);const canceledFiscalClosing=(await queueClosingReceipt(actor,explicitReceive(canceledFiscal))).id;const beforeCanceledFiscal=calls.length;await closing.process(canceledFiscalClosing);assert.equal((await closingRow(canceledFiscalClosing)).state,'attention');assert.equal((await closingRow(canceledFiscalClosing)).last_error,'REFUND_RECEIPT_CANCELED');assert.equal(calls.length,beforeCanceledFiscal);checks.push('failed refund fiscal receipt blocks closing and escalates to attention without dispatch');
 const overridden=await paid(await fixture());await verifiedDelivered(overridden);await q("UPDATE ar_orders SET delivery_status='shipped',delivery_source='manager',delivery_override=true WHERE id=$1",[overridden.orderId]);const beforeOverride=calls.length;await assert.rejects(queueRefund(actor,partial(overridden)),{code:'REFUND_CLOSING_PENDING'});assert.equal(calls.length,beforeOverride);await q("UPDATE ar_payments SET closing_discovery_at=now()+interval '1 day' WHERE id=$1",[overridden.paymentId]);checks.push('verified carrier delivery requires closing before refund even if manager overrides order back to shipped');
 const discoveryBlocked=[];
 for(let i=0;i<10;i++){
  const item=await paid(await fixture('card','00000000-0000-4000-8000-'+String(i+100).padStart(12,'0')));
  if(i<5)await refundSettled({orderId:item.orderId,paymentId:item.paymentId,reason:'QA полный возврат до выдачи',confirmed:true,mode:'full',amountRubles:'310.03',idempotencyKey:key()});
  else await queueRefund(actor,partial(item));
  await verifiedDelivered(item);discoveryBlocked.push(item);
 }
 const discoveryValid=await paid(await fixture('card','00000000-0000-4000-8000-000000000999'));await verifiedDelivered(discoveryValid);const beforeDiscovery=calls.length;
 assert.equal(await closing.discover(),10);assert.equal((await q('SELECT count(*)::int n FROM ar_yookassa_closing_receipts WHERE order_id=$1',[discoveryValid.orderId])).rows[0].n,0);
 const backedOff=(await q('SELECT closing_discovery_at>now() AS backed_off,closing_discovery_error FROM ar_payments WHERE id=ANY($1::uuid[]) ORDER BY order_id',[discoveryBlocked.map(x=>x.paymentId)])).rows;assert.equal(backedOff.length,10);assert.ok(backedOff.every(r=>r.backed_off));assert.ok(backedOff.slice(0,5).every(r=>r.closing_discovery_error===null));assert.ok(backedOff.slice(5).every(r=>r.closing_discovery_error==='CLOSING_REFUND_PENDING'));
 assert.equal(await closing.discover(),1);assert.equal((await q('SELECT count(*)::int n FROM ar_yookassa_closing_receipts WHERE order_id=$1',[discoveryValid.orderId])).rows[0].n,1);assert.equal(calls.length,beforeDiscovery);checks.push('discovery backs off ten full-refunded/blocked rows and queues eleventh valid carrier delivery without starvation');
 const checkoutFixture=await fixture();const cart=await changeCart(checkoutFixture.session,{productId:checkoutFixture.product,skuId:checkoutFixture.sku,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});
 const quoteInput={cartVersion:cart.version,customer:{name:'QA Покупатель',phone:'+79990000000',email:'checkout@example.invalid'},delivery:{method:'courier',city:'QA город',cityCode:77,address:'QA улица, дом 1'}};
 process.env.SHIPPING_PROVIDER='simulation';await assert.rejects(createQuote(checkoutFixture.session,quoteInput),{code:'SHIPPING_CONFIG'});process.env.SHIPPING_PROVIDER='cdek';process.env.CDEK_CLIENT_ID='';process.env.CDEK_CLIENT_SECRET='';const beforeCheckout=calls.length;
 const quote=await createQuote(checkoutFixture.session,quoteInput);assert.equal(quote.delivery.provider,'manual');assert.equal(quote.confirmation.version,productionOrderTerms.version);assert.doesNotMatch(quote.confirmation.title+quote.confirmation.body,/тестов/i);assert.equal(quote.groups[0].shipping.costRubles,null);
 await assert.rejects(checkout(checkoutFixture.session,{quoteId:quote.id,cartVersion:cart.version,confirmation:{accepted:true,version:testOrderTerms.version},idempotencyKey:key()}),{code:'CONFIRMATION_CHANGED'});
 const checkoutBody={quoteId:quote.id,cartVersion:cart.version,confirmation:{accepted:true,version:quote.confirmation.version},idempotencyKey:key()};const checkedOut=await checkout(checkoutFixture.session,checkoutBody);assert.equal(checkedOut.orderIds.length,1);assert.equal(checkedOut.orders[0].status,'open');assert.equal(checkedOut.orders[0].canPay,false);assert.equal(checkedOut.orders[0].confirmation.version,productionOrderTerms.version);assert.deepEqual((await checkout(checkoutFixture.session,checkoutBody)).orderIds,checkedOut.orderIds);assert.equal(calls.length,beforeCheckout);process.env.SHIPPING_PROVIDER='simulation';checks.push('production cart/createQuote/checkout forbids shipping simulation, falls back to manual without CDEK setup, freezes production offer and awaits agreed delivery before payment');
 const historical=await fixture();process.env.STORE_MODE='staging';process.env.PAYMENT_PROVIDER='yookassa-sandbox';process.env.YOOKASSA_SHOP_ID='1472823';process.env.YOOKASSA_SECRET_KEY='qa-sandbox-secret-not-real';const historicalPayment=await initiatePayment(historical.session,historical.body);process.env.STORE_MODE='production';process.env.PAYMENT_PROVIDER='yookassa-live';const beforeHistorical=calls.length;assert.equal(await payments.process(historicalPayment.paymentId),'closed');assert.equal(calls.length,beforeHistorical);checks.push('historical sandbox payment cannot dispatch through the live provider even with the same shop ID');
 // Stage two sandbox commands with the same account ID; they must remain inert in live mode.
 process.env.STORE_MODE='staging';process.env.PAYMENT_PROVIDER='yookassa-sandbox';
 async function historicalPaid(){
  const item=await fixture();item.paymentId=(await initiatePayment(item.session,item.body)).paymentId;
  await q("UPDATE ar_payments SET status='succeeded',provider_status='succeeded',provider_id=$2,receipt_registration='succeeded' WHERE id=$1",[item.paymentId,key()]);
  await q("UPDATE ar_orders SET status='paid',payment_status='paid',allocation_state='settled' WHERE id=$1",[item.orderId]);return item;
 }
 const historicalRefundFixture=await historicalPaid(),historicalRefundId=(await queueRefund(actor,partial(historicalRefundFixture))).id;
 const historicalClosingFixture=await historicalPaid();await delivered(historicalClosingFixture);const historicalClosingId=(await queueClosingReceipt(actor,explicitReceive(historicalClosingFixture))).id;
 process.env.STORE_MODE='production';process.env.PAYMENT_PROVIDER='yookassa-live';
 const beforeHistoricalJobs=calls.length;await refunds.process(historicalRefundId);await closing.process(historicalClosingId);assert.equal(calls.length,beforeHistoricalJobs);
 // Isolate reconciliation selection from the still-open synthetic live examples above.
 await q("UPDATE ar_payments SET provider_next_check_at=now()+interval '1 day',receipt_next_check_at=now()+interval '1 day' WHERE provider='yookassa-live'");
 await q("UPDATE ar_yookassa_refunds SET next_check_at=now()+interval '1 day',receipt_next_check_at=now()+interval '1 day' WHERE payment_id IN(SELECT id FROM ar_payments WHERE provider='yookassa-live')");
 await q("UPDATE ar_yookassa_closing_receipts SET next_check_at=now()+interval '1 day' WHERE provider='yookassa-live'");
 await payments.reconcile();await refunds.reconcile();await receipts.reconcile();await closing.reconcile();assert.equal(calls.length,beforeHistoricalJobs);
 assert.equal((await refundRow(historicalRefundId)).state,'queued');assert.equal((await closingRow(historicalClosingId)).state,'queued');assert.equal((await paymentRow(historicalPayment.paymentId)).provider_id,null);
 checks.push('live process and all reconciliation selectors skip historical sandbox payment/refund/closing queues without network');


 const resolvedLive=await paid(await fixture());await delivered(resolvedLive);const resolvedClosing=(await queueClosingReceipt(actor,explicitReceive(resolvedLive))).id;await closeReceipt(resolvedClosing);const resolvedRefund=await refundSettled(partial(resolvedLive));
 assert.equal((await refundRow(resolvedRefund)).receipt_registration,'succeeded');
 const receiveBody={orderId:resolvedLive.orderId,trackingNumber:'QA-RETURN-'+key(),note:'QA получена одна возвращённая деталь',confirmed:true,lines:[{skuId:resolvedLive.sku,quantity:1}],idempotencyKey:key()};const received=await receiveReturn(actor,receiveBody);
 assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[resolvedLive.sku])).rows[0],{on_hand:7,reserved:0});
 const inspectBody={orderId:resolvedLive.orderId,receiptId:received.id,note:'QA деталь проверена и пригодна к продаже',confirmed:true,lines:[{skuId:resolvedLive.sku,restockQuantity:1}],idempotencyKey:key()};const inspected=await inspectReturn(actor,inspectBody);
 assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[resolvedLive.sku])).rows[0],{on_hand:8,reserved:0});const resolution=await returnResolutionWorkspace(resolvedLive.orderId);assert.equal(resolution.canClose,true,resolution.reason);assert.equal(resolution.summary.kind,'partial');
 const resolutionBody={orderId:resolvedLive.orderId,revision:resolution.revision,note:'QA сверены возврат денег, чек и физическая приёмка',confirmed:true,idempotencyKey:key()};
 const effects=async()=>({stock:(await q('SELECT * FROM ar_stock WHERE sku_id=$1',[resolvedLive.sku])).rows,movements:(await q('SELECT * FROM ar_stock_movements WHERE order_id=$1 ORDER BY id',[resolvedLive.orderId])).rows,payments:(await q('SELECT * FROM ar_payments WHERE order_id=$1 ORDER BY id',[resolvedLive.orderId])).rows,refunds:(await q('SELECT * FROM ar_yookassa_refunds WHERE order_id=$1 ORDER BY id',[resolvedLive.orderId])).rows,mail:(await q('SELECT * FROM ar_mail_outbox ORDER BY id')).rows,providerCalls:calls.length});
 const beforeResolution=await effects(),closedLive=await closeReturnResolution(actor,resolutionBody);assert.equal((await closeReturnResolution(actor,resolutionBody)).id,closedLive.id);assert.equal((await receiveReturn(actor,receiveBody)).id,received.id);assert.equal((await inspectReturn(actor,inspectBody)).id,inspected.id);assert.deepEqual(await effects(),beforeResolution);
 const closedOrder=(await q('SELECT status,payment_status FROM ar_orders WHERE id=$1',[resolvedLive.orderId])).rows[0];assert.deepEqual(closedOrder,{status:'return_closed',payment_status:'partially_refunded'});assert.equal((await returnResolutionWorkspace(resolvedLive.orderId)).history.length,1);await assert.rejects(q("UPDATE ar_return_resolutions SET note='QA rewrite' WHERE id=$1",[closedLive.id]),/immutable/);checks.push('live payment, closing receipt, partial fiscal refund, physical receive/inspect and frozen resolution close end to end; retries add no stock, money, mail or network');
 assert.equal((await q("SELECT count(*)::int n FROM ar_mail_outbox WHERE status IN('delivered','sending')")).rows[0].n,0);checks.push('no SMTP worker, external message or real provider call executed');
 const report={passed:true,isolated:true,externalCalls:0,checks};await fs.mkdir('artifacts/yookassa-production',{recursive:true});await fs.writeFile(process.env.AR_PRODUCTION_REPORT||'artifacts/yookassa-production/database.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{globalThis.fetch=originalFetch;await getPool().end();await qa.close(true);}
