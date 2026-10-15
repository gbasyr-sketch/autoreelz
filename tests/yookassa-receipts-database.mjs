import path from 'node:path';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
globalThis.fetch=async()=>{throw Error('External network forbidden in receipts QA');};
const qa=await createImageDatabase('ar_qa_ai_images_receipts_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/yookassa-receipts/qa'),{APP_ORIGIN:'http://127.0.0.1:14323',PAYMENT_PROVIDER:'yookassa-sandbox',YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'qa-secret-not-real-00000',YOOKASSA_RECEIPTS_MODE:'yookassa'});
const {getPool}=await import('../src/server/db.ts'),{initiatePayment}=await import('../src/server/payments.ts'),{createYooPayments}=await import('../src/server/yookassa-payments.ts'),{createYooReceipts}=await import('../src/server/yookassa-receipts.ts'),{queueRefund,createYooRefunds}=await import('../src/server/yookassa-refunds.ts'),{createYooKassaSandbox}=await import('../src/server/adapters/yookassa-sandbox.ts');
const q=(s,v=[])=>qa.owner.query(s,v),checks=[],posts=[],calls=[],remote=new Map(),refunds=new Map();
const cfg={shopId:'123456',secretKey:'qa-secret-not-real-00000',returnOrigin:'http://127.0.0.1:14323'};
let lose=false,fiscal=true,omitReceipt=false;
const factory=()=>createYooKassaSandbox(cfg,async(url,init)=>{
 calls.push({url,method:init.method??'GET'});
 if(url.endsWith('/me'))return Response.json({test:true,account_id:cfg.shopId,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:fiscal});
 if(init.method==='POST'){
  const body=JSON.parse(init.body),k=init.headers['Idempotence-Key'];posts.push({k,body});
  const target=url.endsWith('/refunds')?refunds:remote;
  if(!target.has(k))target.set(k,url.endsWith('/refunds')?{id:key(),payment_id:body.payment_id,amount:body.amount,status:'pending',receipt_registration:'pending'}:{id:key(),amount:body.amount,metadata:body.metadata,status:'pending',paid:false,test:true,recipient:{account_id:cfg.shopId},confirmation:{confirmation_url:'https://yoomoney.ru/qa'},receipt_registration:'pending'});
  if(omitReceipt)delete target.get(k).receipt_registration;
  if(lose){lose=false;throw Error('lost response');}return Response.json(target.get(k));
 }
 const collection=url.includes('/refunds/')?refunds:remote;return Response.json([...collection.values()].find(r=>r.id===url.split('/').at(-1)));
});
const payments=createYooPayments(factory),receipts=createYooReceipts(factory),refundService=createYooRefunds(factory);
const due=id=>q("UPDATE ar_payments SET provider_next_check_at=now()-interval '1 second',receipt_next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
async function fixture(kind='ordinary'){
 const orderId=key(),sessionId=key(),quote=key(),batch=key();
 await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[sessionId,key(),key()]);
 await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','{}','qa',now()+interval '1 hour')",[quote,sessionId]);await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,sessionId,quote]);
 const line={productId:key(),skuId:null,name:'QA комплект',variantLabel:'Чёрный',quantity:3,unitPriceRubles:'100.01',lineTotalRubles:'300.03',article:'QA',image:'',components:[]};
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,payment_status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles,expires_at) VALUES($1,$2,$3,$4,'awaiting_payment','unpaid','quoted','reserved','QA','+79990000000','qa@example.invalid','{}',$5,'300.03','10.00',now()+interval '30 minutes')",[orderId,batch,sessionId,kind,JSON.stringify([line])]);
 const category=key(),product=key(),sku=key();
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA',$2,'published')",[category,'qa-'+category]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status) VALUES($1,'QA',$2,$3,'published')",[product,'qa-'+product,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA','100.01','published')",[sku,product,'QA-'+sku]);
 await q('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,10,3)',[sku]);
 await q('INSERT INTO ar_order_components(order_id,sku_id,quantity) VALUES($1,$2,3)',[orderId,sku]);
 return{sku,session:{id:sessionId,email:null,csrfToken:'qa',expiresAt:new Date(Date.now()+3600000).toISOString()},body:{orderId,shippingVersion:0,method:'card',idempotencyKey:key()}};
}
try{
 const f=await fixture();await payments.preflight();
 const results=await Promise.all([initiatePayment(f.session,f.body),initiatePayment(f.session,{...f.body,idempotencyKey:key()})]);assert.equal(results[0].paymentId,results[1].paymentId);const id=results[0].paymentId;
 const read=async()=> (await q('SELECT * FROM ar_payments WHERE id=$1',[id])).rows[0];
 const saved=await read();assert.equal(saved.receipt_snapshot.items[0].description,'QA комплект — Чёрный');assert.equal(saved.receipt_snapshot.items[0].amount.value,'100.01');
 await assert.rejects(q("UPDATE ar_payments SET receipt_snapshot=NULL WHERE id=$1",[id]),/immutable/);await assert.rejects(q("UPDATE ar_payments SET amount_rubles='1.00' WHERE id=$1",[id]),/immutable/);checks.push('snapshot atomic with payment; concurrent initiate; immutable price/body');
 await assert.rejects(q("UPDATE ar_orders SET customer_email='changed@example.invalid',items_snapshot='[]' WHERE id=$1",[f.body.orderId]),/неизменяем/);
 lose=true;await assert.rejects(payments.process(id),{code:'PAYMENT_PENDING_CHECK'});await due(id);await payments.process(id);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].body.receipt.customer.email,'qa@example.invalid');assert.equal((await read()).receipt_registration,'pending');checks.push('lost response retries identical receipt/key with order and fiscal snapshot guards');
 const raw=remote.get(saved.provider_key);Object.assign(raw,{status:'succeeded',paid:true,captured_at:new Date().toISOString()});delete raw.confirmation;await due(id);await payments.process(id);assert.equal((await read()).status,'succeeded');assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku])).rows[0],{on_hand:7,reserved:0});assert.equal((await read()).receipt_registration,'pending');
 raw.receipt_registration='succeeded';await due(id);const before=posts.length;await Promise.all([receipts.reconcile(),receipts.reconcile()]);assert.equal((await read()).receipt_registration,'succeeded');assert.equal(posts.length,before);assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku])).rows[0],{on_hand:7,reserved:0});assert.equal((await q("SELECT count(*)::int n FROM ar_order_events WHERE order_id=$1 AND event_type='receipt_payment_succeeded'",[f.body.orderId])).rows[0].n,1);checks.push('money settles before receipt; terminal-payment GET and concurrent checks emit once');
 const r=(await queueRefund({id:key()},{orderId:f.body.orderId,paymentId:id,amountRubles:'310.03',reason:'QA возврат',confirmed:true,idempotencyKey:key()})).id;
 await refundService.process(r);const rr=(await q('SELECT * FROM ar_yookassa_refunds WHERE id=$1',[r])).rows[0];const refund=refunds.get(rr.provider_key);refund.status='succeeded';await q("UPDATE ar_yookassa_refunds SET next_check_at=now()-interval '1 second' WHERE id=$1",[r]);await refundService.process(r);assert.equal((await q('SELECT state FROM ar_yookassa_refunds WHERE id=$1',[r])).rows[0].state,'succeeded');
 refund.receipt_registration='canceled';await q("UPDATE ar_yookassa_refunds SET receipt_next_check_at=now()-interval '1 second' WHERE id=$1",[r]);await receipts.reconcile();assert.equal((await q('SELECT receipt_registration FROM ar_yookassa_refunds WHERE id=$1',[r])).rows[0].receipt_registration,'canceled');assert.equal((await q('SELECT allocation_state FROM ar_orders WHERE id=$1',[f.body.orderId])).rows[0].allocation_state,'settled');assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku])).rows[0],{on_hand:7,reserved:0});assert.ok(!('receipt' in posts.at(-1).body));checks.push('full refund with original receipt; fiscal failure distinct from refund success; stock untouched');
 const late=await fixture();const lp=await initiatePayment(late.session,late.body);await payments.process(lp.paymentId);const pl=(await q('SELECT * FROM ar_payments WHERE id=$1',[lp.paymentId])).rows[0],lr=remote.get(pl.provider_key);
 Object.assign(lr,{status:'succeeded',paid:true,captured_at:new Date().toISOString()});delete lr.confirmation;await due(pl.id);await payments.process(pl.id);
 const realNow=Date.now;Date.now=()=>realNow()+4*86400000;try{await due(pl.id);await receipts.reconcile();}finally{Date.now=realNow;}assert.equal((await q('SELECT receipt_last_error FROM ar_payments WHERE id=$1',[pl.id])).rows[0].receipt_last_error,'RECEIPT_OVERDUE');lr.receipt_registration='succeeded';await due(pl.id);await receipts.reconcile();assert.equal((await q('SELECT receipt_registration FROM ar_payments WHERE id=$1',[pl.id])).rows[0].receipt_registration,'succeeded');checks.push('overdue alert with no POST; later successful receipt still reconciles');
 // A canceled attempt never moved money and has no fiscal registration to wait for.
 omitReceipt=true;
 const canceled=await fixture(),cp=await initiatePayment(canceled.session,canceled.body);
 await payments.process(cp.paymentId);
 const canceledRow=async()=> (await q('SELECT status,provider_status,receipt_registration,receipt_last_error FROM ar_payments WHERE id=$1',[cp.paymentId])).rows[0];
 assert.equal((await canceledRow()).receipt_last_error,null);
 const cr=[...remote.values()].find(p=>p.metadata.autoreelz_payment_id===cp.paymentId);
 Object.assign(cr,{status:'canceled',paid:false});delete cr.confirmation;
 await due(cp.paymentId);await payments.process(cp.paymentId);
 const canceledStock=(await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[canceled.sku])).rows[0];
 const refundCanceled=(await queueRefund({id:key()},{orderId:late.body.orderId,paymentId:pl.id,amountRubles:'310.03',reason:'QA canceled refund',confirmed:true,idempotencyKey:key()})).id;
 await refundService.process(refundCanceled);
 const rc=(await q('SELECT * FROM ar_yookassa_refunds WHERE id=$1',[refundCanceled])).rows[0],remoteCanceledRefund=refunds.get(rc.provider_key);
 assert.equal(rc.receipt_last_error,null);remoteCanceledRefund.status='canceled';
 Date.now=()=>realNow()+4*86400000;
 try{
  // A repeated terminal callback and an older pending reply must both stay non-fiscal.
  await payments.webhook({type:'notification',event:'payment.canceled',object:{id:cr.id}});
  Object.assign(cr,{status:'pending',confirmation:{confirmation_url:'https://yoomoney.ru/qa'},receipt_registration:'pending'});
  await payments.webhook({type:'notification',event:'payment.canceled',object:{id:cr.id}});
  await refundService.process(refundCanceled,true);
  const prior=calls.length;
  for(let n=0;n<2;n++){
   await due(cp.paymentId);await q("UPDATE ar_yookassa_refunds SET receipt_next_check_at=now()-interval '1 second' WHERE id=$1",[refundCanceled]);
   assert.equal(await receipts.reconcile(),0);
  }
  assert.equal(calls.length,prior,'canceled payment/refund must not trigger provider reads');
 }finally{Date.now=realNow;omitReceipt=false;}
 assert.deepEqual(await canceledRow(),{status:'failed',provider_status:'canceled',receipt_registration:null,receipt_last_error:null});
 assert.deepEqual((await q('SELECT state,receipt_registration,receipt_last_error FROM ar_yookassa_refunds WHERE id=$1',[refundCanceled])).rows[0],{state:'canceled',receipt_registration:null,receipt_last_error:null});
 assert.equal((await q("SELECT count(*)::int n FROM ar_order_events WHERE order_id=$1 AND event_type='receipt_attention'",[canceled.body.orderId])).rows[0].n,0);
 // The successful overdue payment above has exactly its original alert; canceling its refund adds none.
 assert.equal((await q("SELECT count(*)::int n FROM ar_order_events WHERE order_id=$1 AND event_type='receipt_attention'",[late.body.orderId])).rows[0].n,1);
 assert.deepEqual((await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[canceled.sku])).rows[0],canceledStock);
 checks.push('pending without fiscal status; canceled payment and refund at +4 days; stale pending callback preserves canceled; repeated receipt reconcile makes zero provider calls and no false alerts');
 const pre=await fixture('preorder');await q("UPDATE ar_orders SET status='preorder_pending',allocation_state='none',expires_at=NULL WHERE id=$1",[pre.body.orderId]);await assert.rejects(initiatePayment(pre.session,pre.body),{code:'PAYMENT_CLOSED'});checks.push('unconfirmed supplier order cannot be paid');
 process.env.YOOKASSA_RECEIPTS_MODE='disabled';fiscal=false;const plain=await fixture();const pp=await initiatePayment(plain.session,plain.body);assert.equal((await q('SELECT receipt_snapshot FROM ar_payments WHERE id=$1',[pp.paymentId])).rows[0].receipt_snapshot,null);await payments.process(pp.paymentId);assert.ok(!('receipt' in posts.at(-1).body));checks.push('existing non-fiscal sandbox remains compatible');
 process.env.STORE_MODE='production';await assert.rejects(payments.preflight());await assert.rejects(receipts.reconcile());checks.push('production remains blocked');
 const output=process.env.AR_RECEIPTS_REPORT??'artifacts/yookassa-receipts/database.json';await fs.mkdir(path.dirname(output),{recursive:true});const report={passed:true,isolated:true,externalCalls:0,checks};await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await getPool().end();await qa.close(true);}
