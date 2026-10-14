import test from 'node:test';import assert from 'node:assert/strict';
import {buildPaymentReceipt,validatePaymentReceipt} from '../src/server/yookassa-receipt-snapshot.ts';
import {createYooKassaSandbox} from '../src/server/adapters/yookassa-sandbox.ts';
const orderId='00000000-0000-4000-8000-000000000001',paymentId='00000000-0000-4000-8000-000000000002',providerId='00000000-0000-4000-8000-000000000003',refundId='00000000-0000-4000-8000-000000000004';
const order={customer_email:'qa@example.invalid',items_snapshot:[{productId:orderId,skuId:paymentId,name:'Комплект',variantLabel:'Чёрный',quantity:3,unitPriceRubles:'100.01',lineTotalRubles:'300.03',article:'QA',image:'',components:[]}],product_total_rubles:'300.03',shipping_cost_rubles:'10.00'};
const cfg={shopId:'123456',secretKey:'qa-secret-not-real-00000',returnOrigin:'http://127.0.0.1:14323'};
const input={orderId,internalPaymentId:paymentId,amountRubles:'310.03',idempotenceKey:refundId,returnUrl:cfg.returnOrigin+'/orders/'+orderId};
const me={account_id:cfg.shopId,test:true,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:true};
const payment={id:providerId,status:'succeeded',paid:true,test:true,recipient:{account_id:cfg.shopId},amount:{value:'310.03',currency:'RUB'},metadata:{autoreelz_order_id:orderId,autoreelz_payment_id:paymentId},receipt_registration:'pending'};
test('fiscal snapshot has exact prices, variant, bundle as sale item, separate shipping and no VAT',()=>{
 const receipt=buildPaymentReceipt(order,'310.03');assert.equal(receipt.items.length,2);assert.equal(receipt.items[0]!.description,'Комплект — Чёрный');assert.equal(receipt.items[0]!.quantity,'3');assert.equal(receipt.items[0]!.amount.value,'100.01');assert.equal(receipt.items[1]!.payment_subject,'service');assert.ok(receipt.items.every(i=>i.payment_mode==='full_prepayment'&&i.vat_code===1));
 assert.equal(buildPaymentReceipt({...order,shipping_cost_rubles:'0.00'},'300.03').items.length,1);
});
test('invalid email, mismatched totals, zero, fractional quantities and more than 80 positions fail before POST',()=>{
 for(const patch of [{customer_email:'bad'},{items_snapshot:[]},{product_total_rubles:'300.04'},{shipping_cost_rubles:null},{items_snapshot:[{...order.items_snapshot[0],quantity:1.5}]},{items_snapshot:[{...order.items_snapshot[0],unitPriceRubles:'0.00',lineTotalRubles:'0.00'}],product_total_rubles:'0.00'}])assert.throws(()=>buildPaymentReceipt({...order,...patch} as typeof order,'310.03'));
 const one={...order.items_snapshot[0]!,quantity:1,lineTotalRubles:'100.01'};
 assert.equal(buildPaymentReceipt({...order,items_snapshot:Array(80).fill(one),product_total_rubles:'8000.80',shipping_cost_rubles:'0.00'},'8000.80').items.length,80);
 assert.throws(()=>buildPaymentReceipt({...order,items_snapshot:Array(80).fill(one),product_total_rubles:'8000.80'},'8010.80'));
 assert.throws(()=>validatePaymentReceipt({...buildPaymentReceipt(order,'310.03'),items:[{...buildPaymentReceipt(order,'310.03').items[0],vat_code:2}]},'310.03'));
});
test('wire receipt is stable across retries, API checks fiscal shop and returns registration independently',async()=>{
 const posts:string[]=[];const receipt=buildPaymentReceipt(order,'310.03');
 const c=createYooKassaSandbox(cfg,async(url,init)=>{if(init.method==='POST')posts.push(String(init.body));return Response.json(url.endsWith('/me')?me:payment);});
 assert.equal((await c.createPayment({...input,receipt})).receiptRegistration,'pending');await c.createPayment({...input,receipt});assert.equal(posts[0],posts[1]);assert.deepEqual(JSON.parse(posts[0]!).receipt,receipt);
 for(const fiscal of [true,false]){let post=0;const client=createYooKassaSandbox(cfg,async(url,init)=>{if(init.method==='POST')post++;return Response.json(url.endsWith('/me')?{...me,fiscalization_enabled:fiscal}:payment);});await assert.rejects(client.createPayment({...input,...(!fiscal?{receipt}:{})}),{code:'RECEIPT_SETUP_REQUIRED'});assert.equal(post,0);}
});
test('fiscal full refund uses original payment receipt without sending duplicate receipt object',async()=>{
 const posts:string[]=[];const c=createYooKassaSandbox(cfg,async(url,init)=>{if(init.method==='POST')posts.push(String(init.body));return Response.json(url.endsWith('/me')?me:url.includes('/payments/')?payment:{id:refundId,payment_id:providerId,status:'succeeded',amount:payment.amount,receipt_registration:'canceled'});});
 const result=await c.createRefund({...input,providerPaymentId:providerId,internalRefundId:refundId,receipt:buildPaymentReceipt(order,'310.03')});assert.equal(result.status,'succeeded');assert.equal(result.receiptRegistration,'canceled');assert.ok(!('receipt' in JSON.parse(posts[0]!)));
});
test('unknown receipt registration never masks authenticated financial success',async()=>{
 const client=createYooKassaSandbox(cfg,async()=>Response.json({...payment,receipt_registration:'unexpected'}));const result=await client.getPayment(providerId,input);assert.equal(result.status,'succeeded');assert.equal(result.receiptRegistration,undefined);
});
