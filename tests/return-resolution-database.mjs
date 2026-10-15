import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as key,createHash} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_return_resolution_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/return-resolution/qa'),{MAIL_PROVIDER:'simulation',MAIL_OWNER_RECIPIENT:'',PAYMENT_PROVIDER:'simulation',SHIPPING_PROVIDER:'simulation',YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'qa-secret-not-real-00000'});
let externalCalls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalCalls++;throw Error('External calls prohibited in resolution QA');};
const {getPool}=await import('../src/server/db.ts'),security=await import('../src/server/security.ts'),cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts'),management=await import('../src/server/management.ts');
const {returnIntakeWorkspace,receiveReturn,inspectReturn}=await import('../src/server/return-intake.ts');
const {returnResolutionWorkspace,closeReturnResolution}=await import('../src/server/return-resolution.ts');
const {queueRefund}=await import('../src/server/yookassa-refunds.ts');
const {planRefund}=await import('../src/server/refund-plan.ts'),{sumRubles,multiplyRubles}=await import('../src/lib/money.ts');
const {dashboardOrderFilters}=await import('../src/server/dashboard.ts');
const q=(s,v=[])=>qa.owner.query(s,v),actor={id:key()},checks=[];
async function buy({pay=true,ship=true,supplier=false}={}){
 const category=key(),pa=key(),pb=key(),kit=key(),a=key(),b=key();
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA',$2,'published')",[category,'qa-'+category]);
 for(const [id,name,kind]of [[pa,'QA одиночная деталь','single'],[pb,'QA вторая деталь','single'],[kit,'QA комплект','bundle']])await q("INSERT INTO ar_products(id,name,slug,category_id,status,kind,discount_percent) VALUES($1,$2,$3,$4,'published',$5,CASE WHEN $5='bundle' THEN 10 ELSE 0 END)",[id,name,'qa-'+id,category,kind]);
 for(const [sku,p,price]of [[a,pa,'100.01'],[b,pb,'50.02']]){await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA цвет',$4,'published')",[sku,p,'QA-'+sku,price]);await q('INSERT INTO ar_stock(sku_id,on_hand) VALUES($1,$2)',[sku,supplier?0:20]);}
 await q('INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES($1,$2,2),($1,$3,1)',[kit,a,b]);
 const jar=new Map(),session=await security.getSession({cookies:{get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v)}});
 let view=await cart.changeCart(session,{productId:pa,skuId:a,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});view=await cart.changeCart(session,{productId:kit,skuId:null,quantity:2,mode:'add',cartVersion:view.version,idempotencyKey:key()});
 const quote=await cart.createQuote(session,{cartVersion:view.version,customer:{name:'QA покупатель',phone:'+79990000000',email:'qa@example.invalid'},delivery:{method:'pickup_point',city:'QA город',address:'QA адрес',provider:'manual',manual:true}});
 let order=(await orders.checkout(session,{quoteId:quote.id,cartVersion:view.version,confirmation:{accepted:true,version:quote.confirmation.version},idempotencyKey:key()})).orders[0];
 order=await orders.quoteShipping(actor,{orderId:order.id,costRubles:'100.00',note:'QA доставка',deliveryDeadline:'2099-12-31',idempotencyKey:key()});
 if(supplier)order=await orders.confirmPreorder(actor,{orderId:order.id,supplierConfirmed:true,terms:'QA подтверждено поставщиком',deliveryDeadline:'2099-12-31',idempotencyKey:key()});
 if(pay)order=await payments.payOrder(session,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:key()});
 if(ship){order=await management.fulfill(actor,{orderId:order.id,status:'packing',reason:'QA сборка',idempotencyKey:key()});order=await management.fulfill(actor,{orderId:order.id,status:'shipped',trackingNumber:'QA-OUTBOUND',reason:'QA отправка',idempotencyKey:key()});}
 // A failed earlier simulation attempt is retained; the confirmed sandbox facts below are isolated fixtures.
 await q("UPDATE ar_payments SET status='failed' WHERE order_id=$1",[order.id]);
 const row=(await q('SELECT * FROM ar_orders WHERE id=$1',[order.id])).rows[0],paymentId=key(),providerId=key();
 const total=sumRubles([row.product_total_rubles,row.shipping_cost_rubles]);
 await q("INSERT INTO ar_payments(id,order_id,amount_rubles,method,shipping_version,status,provider,provider_shop_id,provider_id,provider_return_url,provider_status,provider_checked_at) VALUES($1,$2,$3,'card',$4,'succeeded','yookassa-sandbox','123456',$5,$6,'succeeded',now())",[paymentId,order.id,total,row.shipping_version,providerId,process.env.APP_ORIGIN+'/orders/'+order.id]);
 return{orderId:order.id,a,b,kit,session,paymentId,providerId};
}
const one=async f=>(await q('SELECT * FROM ar_orders WHERE id=$1',[f.orderId])).rows[0];
const rows=async(f,table)=>(await q('SELECT * FROM '+table+' WHERE order_id=$1 ORDER BY id',[f.orderId])).rows;
const snapshot=async f=>({stock:(await q('SELECT * FROM ar_stock WHERE sku_id=ANY($1::uuid[]) ORDER BY sku_id',[[f.a,f.b]])).rows,movements:await rows(f,'ar_stock_movements'),payments:await rows(f,'ar_payments'),refunds:await rows(f,'ar_yookassa_refunds'),mail:(await q('SELECT * FROM ar_mail_outbox ORDER BY id')).rows});
async function reception(f,{all=false,held=false,inspect=true,reference=key()}={}){
 const lines=[{skuId:f.a,quantity:all?5:3},{skuId:f.b,quantity:all?2:1}];
 const receipt=(await receiveReturn(actor,{orderId:f.orderId,trackingNumber:'QA-'+reference,note:'QA physical return',confirmed:true,lines,idempotencyKey:key()})).id;
 if(inspect)await inspectReturn(actor,{orderId:f.orderId,receiptId:receipt,note:'QA checked goods',confirmed:true,lines:lines.map(l=>({skuId:l.skuId,restockQuantity:held?0:l.quantity})),idempotencyKey:key()});
 return receipt;
}
async function refund(f,{full=false,state='succeeded',shipping=false,lines=[{lineIndex:0,quantity:1},{lineIndex:1,quantity:1}],selectionPatch={},amountPatch=null,confirmed=true}={}){
 const order=await one(f),payment=(await rows(f,'ar_payments')).find(p=>p.id===f.paymentId),history=await rows(f,'ar_yookassa_refunds');
 const shippingRubles=shipping?order.shipping_cost_rubles:'0.00';
 const amount=full?sumRubles([order.product_total_rubles,order.shipping_cost_rubles]):sumRubles([...lines.map(l=>multiplyRubles(order.items_snapshot[l.lineIndex].unitPriceRubles,l.quantity)),shippingRubles]);
 const plan=planRefund(order,payment,history,{mode:full?'full':'partial',lines,shippingRubles,amountRubles:amount});
 const id=key();await q("INSERT INTO ar_yookassa_refunds(id,order_id,payment_id,provider_payment_id,shop_id,amount_rubles,provider_key,reason,actor_id,payment_amount_rubles,selection_snapshot,state,provider_id,checked_at) VALUES($1,$2,$3,$4,'123456',$5,$6,'QA synthetic confirmed return',$7,$8,$9,$10,$11,$12)",[id,f.orderId,f.paymentId,f.providerId,amountPatch??plan.amountRubles,key(),actor.id,plan.paymentAmountRubles,{...plan.selection,...selectionPatch},state,confirmed?key():null,confirmed?new Date():null]);
 return id;
}
async function command(f,patch={}){const ws=await returnResolutionWorkspace(f.orderId);return{orderId:f.orderId,revision:ws.revision,note:'QA checked goods and reconciled confirmed refund',confirmed:true,idempotencyKey:key(),...patch};}
async function blocked(f){const ws=await returnResolutionWorkspace(f.orderId);assert.equal(ws.canClose,false);assert.ok(ws.reason);await assert.rejects(closeReturnResolution(actor,await command(f)),{code:'RETURN_RESOLUTION_BLOCKED'});}
const directInsert=(f,summary)=>q("INSERT INTO ar_return_resolutions(id,order_id,revision,note,actor_id,summary,snapshot) SELECT $1,$2,encode(sha256(convert_to(s::text,'UTF8')),'hex'),'QA direct bypass',$3,$4,s FROM (SELECT ar_return_resolution_snapshot($2) s) q",[key(),f.orderId,actor.id,summary]);
try{
 const f=await buy();await blocked(f);await reception(f);await blocked(f);await refund(f);
 let ws=await returnResolutionWorkspace(f.orderId);assert.equal(ws.canClose,true);assert.equal(ws.summary.kind,'partial');assert.equal(ws.summary.receivedQuantity,4);
 const before=await snapshot(f),body=await command(f),result=await Promise.all([closeReturnResolution(actor,body),closeReturnResolution(actor,body),closeReturnResolution({id:key()},{...body,idempotencyKey:key()})]);
 assert.equal(new Set(result.map(r=>r.id)).size,1);assert.deepEqual(await snapshot(f),before);
 let order=await one(f);assert.equal(order.status,'return_closed');assert.equal(order.payment_status,'partially_refunded');assert.equal(order.allocation_state,'settled');
 assert.equal((await q('SELECT id FROM ar_orders o WHERE id=$1 AND ('+dashboardOrderFilters.review+')',[f.orderId])).rowCount,0);
 ws=await returnResolutionWorkspace(f.orderId);assert.equal(ws.history.length,1);assert.equal(ws.canClose,false);checks.push('real checkout/payment/dispatch; exact single-plus-bundle physical refund closes once across keys/operators, without stock, PSP, mail or allocation side effects');
 await assert.rejects(closeReturnResolution(actor,{...body,note:'QA changed intent'}),{code:'KEY_REUSED'});
 await assert.rejects(getPool().query('DELETE FROM ar_return_resolutions WHERE id=$1',[result[0].id]),e=>e.code==='42501');
 await assert.rejects(q("UPDATE ar_return_resolutions SET note='QA rewrite' WHERE id=$1",[result[0].id]),/immutable/);
 checks.push('resolution audit and immutable closure intent cannot be deleted or rewritten');
 const oldRevision=body.revision;
 const second=(await receiveReturn(actor,{orderId:f.orderId,trackingNumber:'QA-SECOND-PARCEL',note:'QA remaining kit',confirmed:true,lines:[{skuId:f.a,quantity:2},{skuId:f.b,quantity:1}],idempotencyKey:key()})).id;
 assert.equal((await one(f)).status,'manual_review');
 assert.equal((await closeReturnResolution(actor,body)).id,result[0].id);assert.equal((await one(f)).status,'manual_review');assert.equal((await returnResolutionWorkspace(f.orderId)).history.length,1);
 assert.equal((await q('SELECT id FROM ar_orders o WHERE id=$1 AND ('+dashboardOrderFilters.review+')',[f.orderId])).rowCount,1);
 await inspectReturn(actor,{orderId:f.orderId,receiptId:second,note:'QA all held outside sale',confirmed:true,lines:[{skuId:f.a,restockQuantity:0},{skuId:f.b,restockQuantity:0}],idempotencyKey:key()});
 await refund(f,{lines:[{lineIndex:1,quantity:1}],shipping:true});
 assert.notEqual((await returnResolutionWorkspace(f.orderId)).revision,oldRevision);
 await assert.rejects(closeReturnResolution(actor,{...await command(f),revision:oldRevision}),{code:'RETURN_RESOLUTION_STALE'});
 const next=await closeReturnResolution(actor,await command(f));assert.notEqual(next.id,result[0].id);
 order=await one(f);assert.equal(order.status,'return_closed');assert.equal(order.payment_status,'refunded');ws=await returnResolutionWorkspace(f.orderId);assert.equal(ws.history.length,2);assert.equal(ws.history.at(-1).summary.kind,'full');assert.equal(ws.history.at(-1).summary.heldQuantity,3);
 checks.push('later receipt reopens review, stale revision rejects, cumulative remaining kit plus shipping closes full return with held goods acknowledged');
 const all=await buy();await reception(all,{all:true,held:true});await refund(all,{full:true});ws=await returnResolutionWorkspace(all.orderId);assert.equal(ws.canClose,true);assert.equal(ws.summary.restockedQuantity,0);assert.equal(ws.summary.heldQuantity,7);await closeReturnResolution(actor,await command(all));checks.push('full refund with every returned item held outside sale closes without inventing warehouse credit');
 const pending=await buy();await reception(pending,{inspect:false});await refund(pending);await blocked(pending);checks.push('received but uninspected parcels block closure even when money was refunded');
 for(const state of ['queued','pending','uncertain','attention']){const item=await buy();await reception(item);await refund(item,{state});await blocked(item);}
 checks.push('queued, pending, uncertain and attention financial outcomes cannot be closed');
 const unknown=await buy();await reception(unknown);await refund(unknown,{confirmed:false});await blocked(unknown);
 const opaque=await buy();await reception(opaque);await refund(opaque,{selectionPatch:{opaque:true}});await blocked(opaque);
 const mismatch=await buy();await reception(mismatch);await refund(mismatch,{lines:[{lineIndex:1,quantity:1}]});await blocked(mismatch);
 const mismatchAmount=await buy();await reception(mismatchAmount);await refund(mismatchAmount,{amountPatch:'1.00'});await blocked(mismatchAmount);
 checks.push('missing provider confirmation, opaque selection, unmatched physical components and financial selection amount mismatch block closure');
 await assert.rejects(directInsert(pending,{}),/every inspection/);
 await assert.rejects(directInsert(mismatch,{}),/physical financial mismatch/);
 await assert.rejects(directInsert(mismatchAmount,{}),/refund amount mismatch/);
 const fakePrices=await buy();await reception(fakePrices);await refund(fakePrices,{amountPatch:'1.00',selectionPatch:{lines:[{lineIndex:0,quantity:1,unitPriceRubles:'0.50'},{lineIndex:1,quantity:1,unitPriceRubles:'0.50'}]}});await blocked(fakePrices);await assert.rejects(directInsert(fakePrices,{}),/purchased lines mismatch/);
 const valid=await buy();await reception(valid);await refund(valid);const validWs=await returnResolutionWorkspace(valid.orderId);
 await assert.rejects(directInsert(valid,{...validWs.summary,receivedQuantity:999}),/summary mismatch/);
 await assert.rejects(q("INSERT INTO ar_return_resolutions(id,order_id,revision,note,actor_id,summary,snapshot) VALUES($1,$2,$3,'QA stale bypass',$4,'{}','{}')",[key(),valid.orderId,'0'.repeat(64),actor.id]),/snapshot is stale/);
 await assert.rejects(q("UPDATE ar_orders SET status='return_closed',payment_status='partially_refunded',review_reason=NULL WHERE id=$1",[valid.orderId]),/matching resolution/);
 await assert.rejects(closeReturnResolution(actor,{...await command(valid),confirmed:false}),{code:'RETURN_RESOLUTION_CONFIRMATION'});
 await assert.rejects(closeReturnResolution(actor,{...await command(valid),revision:'invalid'}),{code:'RETURN_RESOLUTION_REVISION'});
 checks.push('direct database inserts reject pending inspection, unmatched physical units, incorrect amount, forged summary and stale snapshot');
 for(const shippingRubles of [undefined,null]){
  const malformed=await buy();await reception(malformed);await refund(malformed,{amountPatch:'50.00',selectionPatch:{shippingRubles}});await blocked(malformed);await assert.rejects(directInsert(malformed,{}),/selection shape mismatch/);
 }
 for(const patch of [{quantity:undefined},{quantity:null},{quantity:'1'},{quantity:1.5},{unitPriceRubles:undefined},{unitPriceRubles:null},{unitPriceRubles:100.01},{unitPriceRubles:'broken'}]){
  const malformed=await buy();await reception(malformed);const raw=(await one(malformed)).items_snapshot;await refund(malformed,{selectionPatch:{lines:[{lineIndex:0,quantity:1,unitPriceRubles:raw[0].unitPriceRubles,...patch},{lineIndex:1,quantity:1,unitPriceRubles:raw[1].unitPriceRubles}]}});await blocked(malformed);await assert.rejects(directInsert(malformed,{}),/line shape mismatch/);
 }
 checks.push('SQL NULL cannot bypass validation: missing/null shipping and missing/null/noncanonical line quantity or price reject direct insertion');
 const shippingOnly=await buy();await reception(shippingOnly,{all:true});await refund(shippingOnly,{lines:[{lineIndex:0,quantity:1},{lineIndex:1,quantity:2}]});await closeReturnResolution(actor,await command(shippingOnly));
 const currentProvider=process.env.PAYMENT_PROVIDER;process.env.PAYMENT_PROVIDER='yookassa-sandbox';let shippingId;
 try{shippingId=(await queueRefund(actor,{orderId:shippingOnly.orderId,paymentId:shippingOnly.paymentId,reason:'QA refund original shipping separately',confirmed:true,mode:'partial',lines:[],shippingRubles:'100.00',amountRubles:'100.00',idempotencyKey:key()})).id;}finally{process.env.PAYMENT_PROVIDER=currentProvider;}
 assert.equal((await one(shippingOnly)).status,'manual_review');await blocked(shippingOnly);
 await q("UPDATE ar_yookassa_refunds SET state='succeeded',provider_id=$2,checked_at=now() WHERE id=$1",[shippingId,key()]);assert.equal((await returnResolutionWorkspace(shippingOnly.orderId)).canClose,true);await closeReturnResolution(actor,await command(shippingOnly));assert.equal((await one(shippingOnly)).payment_status,'refunded');
 checks.push('separate later shipping refund reopens closed review via actual queue command; pending outcome blocks and confirmed result closes remaining balance');
 for(const state of ['pending','review','succeeded']){
  const item=await buy();await reception(item);await refund(item);
  await q("INSERT INTO ar_payments(id,order_id,amount_rubles,method,shipping_version,status,provider,provider_shop_id,provider_id,provider_return_url,provider_status) SELECT $1,id,product_total_rubles+shipping_cost_rubles,'card',shipping_version,$2,'yookassa-sandbox','123456',$3,$4,$5 FROM ar_orders WHERE id=$6",[key(),state,key(),process.env.APP_ORIGIN+'/orders/'+item.orderId,state==='succeeded'?'succeeded':'pending',item.orderId]);await blocked(item);
 }
 checks.push('unresolved extra payment and multiple successful payments block closure; failed attempt from fixture does not');
 const carrier=await buy();await reception(carrier);await refund(carrier);
 const shipment=key();await q("INSERT INTO ar_cdek_shipments(id,order_id,environment,account_hash,number,payload,fingerprint,actor_id,state,provider_uuid,carrier_code) VALUES($1,$2,'test','qa',$3,'{}','qa',$4,'ready',$5,'CREATED')",[shipment,carrier.orderId,key(),actor.id,key()]);await blocked(carrier);
 await q('UPDATE ar_cdek_shipments SET carrier_code=NULL,carrier_at=now() WHERE id=$1',[shipment]);await blocked(carrier);await assert.rejects(directInsert(carrier,{}),/carrier is unresolved/);
 await q("UPDATE ar_cdek_shipments SET carrier_code='DELIVERED',carrier_at=now() WHERE id=$1",[shipment]);assert.equal((await returnResolutionWorkspace(carrier.orderId)).canClose,true);
 checks.push('manual delivery cannot replace confirmed completed carrier delivery');
 const race=await buy();await reception(race);await refund(race);const raceBody=await command(race);
 const outcomes=await Promise.allSettled([closeReturnResolution(actor,raceBody),receiveReturn(actor,{orderId:race.orderId,trackingNumber:'QA-CONCURRENT-PARCEL',note:'QA remaining parcel',confirmed:true,lines:[{skuId:race.a,quantity:2},{skuId:race.b,quantity:1}],idempotencyKey:key()})]);
 assert.equal(outcomes[1].status,'fulfilled');assert.equal((await one(race)).status,'manual_review');assert.equal((await returnResolutionWorkspace(race.orderId)).canClose,false);
 if(outcomes[0].status==='rejected')assert.ok(['RETURN_RESOLUTION_STALE','RETURN_RESOLUTION_BLOCKED'].includes(outcomes[0].reason.code));
 checks.push('concurrent new parcel and closure serialize on order; new work never stays hidden behind closed status');
 process.env.STORE_MODE='production';await assert.rejects(closeReturnResolution(actor,await command(carrier)),/Test adapters are available only/);await assert.rejects(closeReturnResolution(actor,{}),/Test adapters are available only/);await assert.rejects(closeReturnResolution(actor,body),/Test adapters are available only/);assert.equal((await returnResolutionWorkspace(carrier.orderId)).enabled,false);assert.equal((await returnResolutionWorkspace(f.orderId)).history.length,2);assert.equal(externalCalls,0);checks.push('production writes and old-key replay disabled before validation, history readable, zero external calls');
 await fs.mkdir('artifacts/return-resolution',{recursive:true});await fs.writeFile('artifacts/return-resolution/database.json',JSON.stringify({passed:true,isolated:true,migrationSha256:createHash('sha256').update(await fs.readFile('migrations/034_return_resolution.sql')).digest('hex'),externalCalls,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{globalThis.fetch=originalFetch;await getPool().end();await qa.close(true);}
