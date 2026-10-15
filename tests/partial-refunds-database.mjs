import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_partial_refunds_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/partial-refunds/qa'),{
 APP_ORIGIN:'http://127.0.0.1:14323',PAYMENT_PROVIDER:'yookassa-sandbox',MAIL_PROVIDER:'simulation',
 YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'qa-secret-not-real-00000',
 CDEK_SHIPMENTS_MODE:'test',CDEK_TEST_CLIENT_ID:'fixture',CDEK_TEST_CLIENT_SECRET:'fixture',CDEK_FROM_PVZ:'MKHCH13',
});
const {getPool}=await import('../src/server/db.ts');
const {queueRefund,refundWorkspace,createYooRefunds}=await import('../src/server/yookassa-refunds.ts');
const {buildPaymentReceipt}=await import('../src/server/yookassa-receipt-snapshot.ts');
const {createYooKassaSandbox}=await import('../src/server/adapters/yookassa-sandbox.ts');
const {createYooReceipts}=await import('../src/server/yookassa-receipts.ts');
const {shipmentConfig}=await import('../src/server/cdek-shipment-policy.ts');
const {cdekShipmentTick}=await import('../src/server/cdek-shipment-worker.ts');
const {overrideDelivery}=await import('../src/server/management.ts');
const {canonical,hash}=await import('../src/server/security.ts');
const q=(s,v=[])=>qa.owner.query(s,v),actor={id:key()},checks=[],posts=[],remote=new Map(),payments=new Map();
const cfg={shopId:'123456',secretKey:'qa-secret-not-real-00000',returnOrigin:'http://127.0.0.1:14323'};
let lost=false;
const clientFactory=()=>createYooKassaSandbox(cfg,async(url,init)=>{
 if(url.endsWith('/me'))return Response.json({test:true,account_id:cfg.shopId,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:true});
 if(url.includes('/payments/'))return Response.json(payments.get(url.split('/').at(-1)));
 if(init.method==='POST'){
  const body=JSON.parse(init.body),k=init.headers['Idempotence-Key'];posts.push({key:k,body});
  if(!remote.has(k))remote.set(k,{id:key(),payment_id:body.payment_id,amount:body.amount,status:'pending',receipt_registration:'pending'});
  if(lost){lost=false;throw Error('lost reply');}return Response.json(remote.get(k));
 }
 return Response.json([...remote.values()].find(r=>r.id===url.split('/').at(-1)));
});
const service=createYooRefunds(clientFactory),receipts=createYooReceipts(clientFactory);
async function buy(){
 const session=key(),quote=key(),batch=key(),orderId=key(),paymentId=key(),providerId=key();
 const lines=[{productId:key(),skuId:key(),article:'QA-A',name:'QA деталь',variantLabel:'Чёрная',quantity:2,unitPriceRubles:'100.01',lineTotalRubles:'200.02',image:'',components:[]},
  {productId:key(),skuId:null,article:'QA-KIT',name:'QA комплект',variantLabel:'',quantity:1,unitPriceRubles:'300.03',lineTotalRubles:'300.03',image:'',components:[{skuId:key(),name:'QA компонент',article:'QA-C',quantity:1,unitPriceRubles:'300.03'}]}];
 const receipt=buildPaymentReceipt({customer_email:'qa@example.invalid',items_snapshot:lines,product_total_rubles:'500.05',shipping_cost_rubles:'50.10'},'550.15');
 await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[session,key(),key()]);
 await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','{}','qa',now()+interval '1 hour')",[quote,session]);
 await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,session,quote]);
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,payment_status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles) VALUES($1,$2,$3,'ordinary','paid','paid','quoted','settled','QA','+79990000000','qa@example.invalid','{}',$4,'500.05','50.10')",[orderId,batch,session,JSON.stringify(lines)]);
 await q("INSERT INTO ar_payments(id,order_id,amount_rubles,method,shipping_version,status,provider,provider_shop_id,provider_id,provider_return_url,provider_status,receipt_snapshot) VALUES($1,$2,'550.15','card',0,'succeeded','yookassa-sandbox','123456',$3,$4,'succeeded',$5)",[paymentId,orderId,providerId,cfg.returnOrigin+'/orders/'+orderId,receipt]);
 payments.set(providerId,{id:providerId,status:'succeeded',paid:true,test:true,recipient:{account_id:cfg.shopId},amount:{value:'550.15',currency:'RUB'},metadata:{autoreelz_order_id:orderId,autoreelz_payment_id:paymentId}});
 return{orderId,paymentId,providerId,receipt};
}
const body=(f,patch={})=>({orderId:f.orderId,paymentId:f.paymentId,reason:'QA возврат товара',confirmed:true,mode:'partial',lines:[{lineIndex:0,quantity:1}],shippingRubles:'0.00',amountRubles:'100.01',idempotencyKey:key(),...patch});
const read=async id=>(await q('SELECT * FROM ar_yookassa_refunds WHERE id=$1',[id])).rows[0];
const due=id=>q("UPDATE ar_yookassa_refunds SET next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
async function settle(id,state='succeeded'){
 await service.process(id);let row=await read(id);remote.get(row.provider_key).status=state;
 await due(id);await service.process(id);assert.equal((await read(id)).state,state);
}
try{
 const f=await buy(),request=body(f),all=await Promise.all([queueRefund(actor,request),queueRefund(actor,request),queueRefund(actor,{...request,idempotencyKey:key()})]);
 assert.equal(new Set(all.map(r=>r.id)).size,1);const first=all[0].id;
 await assert.rejects(queueRefund(actor,body(f,{lines:[{lineIndex:1,quantity:1}],amountRubles:'300.03'})),{code:'REFUND_BUSY'});
 assert.equal((await refundWorkspace(f.orderId)).payments[0].reservedRubles,'100.01');checks.push('concurrent identical requests return one partial refund; another intent blocked while unresolved');
 lost=true;await service.process(first);assert.equal((await read(first)).state,'uncertain');await due(first);await createYooRefunds(clientFactory).process(first);
 assert.deepEqual(posts[0],posts[1]);assert.equal(remote.size,1);assert.deepEqual(posts[1].body.receipt.items,[{...f.receipt.items[0],quantity:'1'}]);
 await settle(first);assert.equal((await read(first)).payment_amount_rubles,'550.15');checks.push('lost reply reuses immutable partial amount/key/receipt; original whole payment is verified');
 let balance=(await refundWorkspace(f.orderId)).payments[0];assert.equal(balance.remainingRubles,'450.14');assert.equal(balance.lines[0].remainingQuantity,1);
 const second=(await queueRefund(actor,body(f))).id;assert.notEqual(first,second);await settle(second);
 await assert.rejects(queueRefund(actor,body(f)),{code:'INVALID_INPUT'});
 const rest=(await queueRefund(actor,body(f,{mode:'full',lines:[],shippingRubles:'0.00',amountRubles:'350.13'}))).id;await settle(rest);
 assert.deepEqual(posts.at(-1).body.receipt.items,[f.receipt.items[1],f.receipt.items[2]]);
 balance=(await refundWorkspace(f.orderId)).payments[0];assert.equal(balance.refundedRubles,'550.15');assert.equal(balance.remainingRubles,'0.00');assert.equal(balance.canRefund,false);
 await assert.rejects(queueRefund(actor,body(f,{mode:'full',amountRubles:'550.15'})));checks.push('same-priced second unit may be returned once; full remaining receipt excludes earlier units; payment cannot be over-refunded');
  await assert.rejects(q(`INSERT INTO ar_yookassa_refunds(id,order_id,payment_id,provider_payment_id,shop_id,amount_rubles,provider_key,reason,actor_id,payment_amount_rubles,selection_snapshot)
   VALUES($1,$2,$3,$4,'123456','1.00',$5,'QA direct over-budget',$6,'550.15',$7)`,[key(),f.orderId,f.paymentId,f.providerId,key(),actor.id,{version:1,mode:'partial',opaque:false,lines:[],shippingRubles:'0.00'}]),/exceeds remaining payment/);
  checks.push('database payment lock and budget trigger reject direct over-refund even beyond application checks');
 const fiscal=await read(second);remote.get(fiscal.provider_key).receipt_registration='canceled';await q("UPDATE ar_yookassa_refunds SET receipt_next_check_at=now() WHERE id=$1",[second]);await receipts.reconcile();
 assert.equal((await read(second)).receipt_registration,'canceled');assert.equal((await read(second)).state,'succeeded');checks.push('fiscal reconciliation verifies original payment amount and remains separate from financial success');
 const c=await buy(),cId=(await queueRefund(actor,body(c))).id;await settle(cId,'canceled');const repeat=(await queueRefund(actor,body(c))).id;assert.notEqual(repeat,cId);await settle(repeat);
 assert.equal((await refundWorkspace(c.orderId)).payments[0].refundedRubles,'100.01');checks.push('confirmed provider cancellation releases quantities/budget only for a new explicit command');
 const a=await buy(),aId=(await queueRefund(actor,body(a))).id;await q("UPDATE ar_yookassa_refunds SET state='attention' WHERE id=$1",[aId]);
 await assert.rejects(queueRefund(actor,body(a,{lines:[{lineIndex:1,quantity:1}],amountRubles:'300.03'})),{code:'REFUND_BUSY'});
 assert.equal((await refundWorkspace(a.orderId)).payments[0].canRefund,false);checks.push('attention reserves money and units; no new-key workaround');
 const d=await buy(),shipmentId=key(),carrierId=key(),number=key();
 await q("INSERT INTO ar_cdek_shipments(id,order_id,environment,account_hash,number,payload,fingerprint,actor_id,state,provider_uuid,carrier_code) VALUES($1,$2,'test',$3,$4,'{}','qa',$5,'ready',$6,'CREATED')",[shipmentId,d.orderId,shipmentConfig().accountHash,number,actor.id,carrierId]);
 await overrideDelivery(actor,{orderId:d.orderId,status:'delivered',trackingNumber:'QA-MANUAL',reason:'QA ручная отметка',idempotencyKey:key()});
 await assert.rejects(queueRefund(actor,body(d)),{code:'REFUND_SHIPMENT'});
 await cdekShipmentTick({async get(){return{entity:{uuid:carrierId,number,cdek_number:'990000001',statuses:[{code:'DELIVERED',date_time:new Date().toISOString()}]}};}});
 const carrierBefore=(await q('SELECT * FROM ar_cdek_shipments WHERE id=$1',[shipmentId])).rows[0];assert.equal(carrierBefore.carrier_code,'DELIVERED');assert.ok(carrierBefore.carrier_at);
 const historyBefore=(await q('SELECT count(*)::int n FROM ar_cdek_history WHERE shipment_id=$1',[shipmentId])).rows[0].n;
 const afterDelivery=(await queueRefund(actor,body(d))).id;await settle(afterDelivery);
 assert.deepEqual((await q('SELECT * FROM ar_cdek_shipments WHERE id=$1',[shipmentId])).rows[0],carrierBefore);
 assert.equal((await q('SELECT count(*)::int n FROM ar_cdek_history WHERE shipment_id=$1',[shipmentId])).rows[0].n,historyBefore);checks.push('manual delivered flag cannot bypass guard; verified carrier GET unlocks refund without changing shipment/history');
 await assert.rejects(getPool().query("UPDATE ar_yookassa_refunds SET selection_snapshot='{}' WHERE id=$1",[first]),/immutable/);
 await assert.rejects(getPool().query("UPDATE ar_yookassa_refunds SET receipt_snapshot='{}' WHERE id=$1",[first]),/immutable/);
 await assert.rejects(getPool().query("UPDATE ar_yookassa_refunds SET state='canceled' WHERE id=$1",[first]),/immutable/);
 await assert.rejects(getPool().query('DELETE FROM ar_yookassa_refunds WHERE id=$1',[first]),e=>e.code==='42501');
 assert.equal((await q('SELECT count(*)::int n FROM ar_stock_movements')).rows[0].n,0);
 assert.equal((await q('SELECT allocation_state FROM ar_orders WHERE id=$1',[f.orderId])).rows[0].allocation_state,'settled');checks.push('allocation/receipt/terminal result immutable; least privilege and physical stock untouched');
 // Seed a pre-031 record in isolated QA only, representing a previously accepted full request.
 const legacy=await buy(),legacyId=key();await q('ALTER TABLE ar_yookassa_refunds DISABLE TRIGGER ar_refund_allocation_guard');
 try{await q("INSERT INTO ar_yookassa_refunds(id,order_id,payment_id,provider_payment_id,shop_id,amount_rubles,provider_key,reason,actor_id) VALUES($1,$2,$3,$4,'123456','550.15',$5,'QA legacy',$6)",[legacyId,legacy.orderId,legacy.paymentId,legacy.providerId,key(),actor.id]);}finally{await q('ALTER TABLE ar_yookassa_refunds ENABLE TRIGGER ar_refund_allocation_guard');}
 const legacyKey=key(),command={orderId:legacy.orderId,paymentId:legacy.paymentId,reason:'QA legacy',amount:'550.15',confirmed:true};
 await q('INSERT INTO ar_command_results(scope,request_key,request_hash,result) VALUES($1,$2,$3,$4)',[`yookassa-refund:${actor.id}`,legacyKey,hash(canonical(command)),{id:legacyId}]);
 assert.equal((await queueRefund(actor,{orderId:legacy.orderId,paymentId:legacy.paymentId,reason:'QA legacy',amountRubles:'550.15',confirmed:true,idempotencyKey:legacyKey})).id,legacyId);
 await settle(legacyId);assert.equal((await refundWorkspace(legacy.orderId)).payments[0].remainingRubles,'0.00');assert.ok(!posts.at(-1).body.receipt);checks.push('legacy full request and saved command hash survive upgrade; legacy receipt stays full and never replays as partial');
 process.env.STORE_MODE='production';await assert.rejects(queueRefund(actor,body(await buy())));assert.equal((await refundWorkspace(f.orderId)).enabled,false);checks.push('production remains closed');
 await fs.mkdir('artifacts/partial-refunds',{recursive:true});await fs.writeFile('artifacts/partial-refunds/database.json',JSON.stringify({passed:true,isolated:true,externalCalls:0,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{await getPool().end();await qa.close(true);}
