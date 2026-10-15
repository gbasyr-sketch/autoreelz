import test from 'node:test';
import assert from 'node:assert/strict';
import {createYooKassa,createYooKassaSandbox} from '../src/server/adapters/yookassa-sandbox.ts';
import type {ClosingReceipt} from '../src/server/yookassa-closing-snapshot.ts';
const config={shopId:'1472823',secretKey:'qa-production-secret-not-real',returnOrigin:'https://autoreelz.ru',test:false};
const ids={orderId:'00000000-0000-4000-8000-000000000001',internalPaymentId:'00000000-0000-4000-8000-000000000002',providerPaymentId:'2a000000-0000-4000-8000-000000000003'};
const input={...ids,amountRubles:'5300.01',idempotenceKey:'00000000-0000-4000-8000-000000000004',returnUrl:config.returnOrigin+'/orders/'+ids.orderId};
const me={account_id:config.shopId,test:false,status:'enabled',payment_methods:['bank_card','sbp'],fiscalization_enabled:false};
const payment={id:ids.providerPaymentId,status:'succeeded',paid:true,test:false,amount:{value:input.amountRubles,currency:'RUB'},recipient:{account_id:config.shopId},metadata:{autoreelz_order_id:ids.orderId,autoreelz_payment_id:ids.internalPaymentId}};
const receipt:ClosingReceipt={customer:{email:'qa@example.invalid'},items:[{description:'Товар',quantity:'1',amount:{value:input.amountRubles,currency:'RUB'},vat_code:1,payment_mode:'full_payment',payment_subject:'commodity',measure:'piece'}],type:'payment',send:true,payment_id:ids.providerPaymentId,settlements:[{type:'prepayment',amount:{value:input.amountRubles,currency:'RUB'}}],internet:true,timezone:3};
const receiptResult={id:'rt-2a000000-0000-4000-8000-000000000005',type:'payment',payment_id:ids.providerPaymentId,status:'pending',items:receipt.items,settlements:receipt.settlements};
const closing={...input,receipt};
const json=(v:unknown)=>Response.json(v);

test('production strictly binds GET /me and payment test/account/metadata to expected shop',async()=>{
 const client=createYooKassa(config,async url=>json(url.endsWith('/me')?me:payment));
 assert.deepEqual(await client.checkShop(),{test:false,cardAvailable:true,sbpAvailable:true,fiscalizationEnabled:false});
 assert.equal((await client.getPayment(ids.providerPaymentId,input)).test,false);
 for(const patch of [{test:true},{test:undefined},{account_id:'999'},{status:'disabled'},{payment_methods:null},{fiscalization_enabled:undefined}]){
  let posts=0;const c=createYooKassa(config,async(_url,init)=>{if(init.method==='POST')posts++;return json({...me,...patch});});
  await assert.rejects(c.createPayment(input));assert.equal(posts,0);
 }
 for(const patch of [{test:true},{test:undefined},{recipient:{account_id:'999'}},{metadata:{}},{amount:{value:'1.00',currency:'RUB'}}]){
  const c=createYooKassa(config,async()=>json({...payment,...patch}));await assert.rejects(c.getPayment(ids.providerPaymentId,input));
 }
});
test('production disallows local/foreign origins and test keys before transport; sandbox remains forced test',async()=>{
 for(const patch of [{returnOrigin:'http://127.0.0.1:14323'},{returnOrigin:'http://autoreelz.ru'},{returnOrigin:'https://evil.example'},{returnOrigin:'https://autoreelz.ru/'},{secretKey:'test_not-a-live-secret'},{test:undefined}])assert.throws(()=>createYooKassa({...config,...patch} as typeof config,async()=>{throw Error('no network');}));
 const c=createYooKassaSandbox({...config},async()=>json(me));await assert.rejects(c.checkShop(),{code:'NOT_EXPECTED_TEST_SHOP'});
});
test('card and SBP use explicit method, exact price and stable idempotence; absent method cannot POST',async()=>{
 for(const method of ['card','sbp'] as const){
  const posts:RequestInit[]=[];const c=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts.push(init);return json(url.endsWith('/me')?me:payment);});
  await c.createPayment({...input,method});await c.createPayment({...input,method});
  const body=JSON.parse(String(posts[0]!.body));assert.equal(body.payment_method_data.type,method==='card'?'bank_card':'sbp');assert.equal(body.amount.value,input.amountRubles);assert.equal(body.description,'AUTO REELZ — оплата заказа');assert.equal(posts[0]!.body,posts[1]!.body);assert.deepEqual(posts[0]!.headers,posts[1]!.headers);
  let postsDenied=0;const denied=createYooKassa(config,async(_url,init)=>{if(init.method==='POST')postsDenied++;return json({...me,payment_methods:method==='card'?['sbp']:['bank_card']});});await assert.rejects(denied.createPayment({...input,method}));assert.equal(postsDenied,0);
 }
});
test('production refunds verify original payment mode before POST and preserve original account',async()=>{
 const refundInput={...input,internalRefundId:'00000000-0000-4000-8000-000000000006'};
 const refund={id:'2a000000-0000-4000-8000-000000000007',payment_id:ids.providerPaymentId,status:'succeeded',amount:payment.amount};
 let posts=0;const c=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts++;return json(url.endsWith('/me')?me:url.includes('/payments/')?payment:refund);});
 assert.equal((await c.createRefund(refundInput)).status,'succeeded');assert.equal(posts,1);
 for(const patch of [{test:true},{recipient:{account_id:'wrong'}},{metadata:{}},{status:'canceled',paid:false}]){
  let blocked=0;const denied=createYooKassa(config,async(url,init)=>{if(init.method==='POST')blocked++;return json(url.endsWith('/me')?me:{...payment,...patch});});await assert.rejects(denied.createRefund(refundInput));assert.equal(blocked,0);
 }
});
test('closing receipt uses standalone API, rebuilt whitelist and stable key/body without exposing customer in result',async()=>{
 const posts:RequestInit[]=[];const c=createYooKassa(config,async(url,init)=>{if(init.method==='POST'){assert.equal(url,'https://api.yookassa.ru/v3/receipts');posts.push(init);}return json(url.endsWith('/me')?{...me,fiscalization_enabled:true}:url.includes('/payments/')?payment:receiptResult);});
 const dirty={...closing,receipt:{...receipt,arbitrary:'must be stripped'}};
 const result=await c.createReceipt(dirty);await c.createReceipt(dirty);
 assert.deepEqual(result,{id:receiptResult.id,paymentId:ids.providerPaymentId,status:'pending'});
 assert.deepEqual(JSON.parse(String(posts[0]!.body)),receipt);assert.equal(posts[0]!.body,posts[1]!.body);assert.deepEqual(posts[0]!.headers,posts[1]!.headers);
 assert.equal((posts[0]!.headers as Record<string,string>)['Idempotence-Key'],input.idempotenceKey);
 assert.equal((await c.getReceipt(receiptResult.id,closing)).status,'pending');
});
test('closing receipt validates original total after partial refund and refuses unverified payment or fiscal setup',async()=>{
 const remaining={...closing,amountRubles:'5300.01',paymentAmountRubles:'6000.00'};
 const c=createYooKassa(config,async url=>json(url.endsWith('/me')?{...me,fiscalization_enabled:true}:url.includes('/payments/')?{...payment,amount:{value:'6000.00',currency:'RUB'}}:receiptResult));
 assert.equal((await c.createReceipt(remaining)).id,receiptResult.id);
 for(const p of [{test:true},{recipient:{account_id:'wrong'}},{status:'canceled',paid:false},{metadata:{}}]){
  let posts=0;const denied=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts++;return json(url.endsWith('/me')?{...me,fiscalization_enabled:true}:{...payment,...p});});await assert.rejects(denied.createReceipt(closing));assert.equal(posts,0);
 }
 let posts=0;const disabled=createYooKassa(config,async(_url,init)=>{if(init.method==='POST')posts++;return json(me);});await assert.rejects(disabled.createReceipt(closing),{code:'RECEIPT_SETUP_REQUIRED'});assert.equal(posts,0);
});
test('receipt GET rejects wrong identity, statuses, fiscal items, quantity and amounts',async()=>{
 const item=receipt.items[0]!;
 for(const patch of [{id:'2a000000-0000-4000-8000-000000000005'},{id:'rt-2a000000-0000-4000-8000-000000000006'},{type:'refund'},{payment_id:input.orderId},{status:'unknown'},{items:[]},...[{quantity:'2'},{quantity:'1.001'},{payment_mode:'full_prepayment'},{payment_subject:'service'},{vat_code:2},{description:'Wrong'},{amount:{value:'5300.00',currency:'RUB'}}].map(p=>({items:[{...item,...p}]})),{settlements:[{type:'cashless',amount:{value:'1.00',currency:'RUB'}}]}]){
  const c=createYooKassa(config,async url=>json(url.includes('/payments/')?payment:{...receiptResult,...patch}));await assert.rejects(c.getReceipt(receiptResult.id,closing));
 }
 for(const quantity of [1,'1.000']){const c=createYooKassa(config,async url=>json(url.includes('/payments/')?payment:{...receiptResult,items:[{...item,quantity}],settlements:[{type:'cashless',amount:receipt.settlements[0].amount}]}));assert.equal((await c.getReceipt(receiptResult.id,closing)).status,'pending');}
});
test('receipt malformed/timeout response is uncertain once posted and never retries automatically',async()=>{
 for(const failure of ['network','invalid','oversize','http500']){
  let posts=0;const c=createYooKassa(config,async(url,init)=>{
   if(url.endsWith('/me'))return json({...me,fiscalization_enabled:true});if(url.includes('/payments/'))return json(payment);posts++;
   if(failure==='network')throw Error(config.secretKey);if(failure==='invalid')return new Response('invalid');if(failure==='oversize')return new Response('x'.repeat(140000));return new Response('{}',{status:500});
  });await assert.rejects(c.createReceipt(closing),{code:'PAYMENT_OUTCOME_UNKNOWN'});assert.equal(posts,1);
 }
});
test('full refund after closing sends full_payment receipt explicitly instead of reusing prepayment receipt',async()=>{
 const fiscal={...me,fiscalization_enabled:true};
 const fullReceipt={customer:receipt.customer,items:receipt.items,internet:true as const,timezone:3 as const};
 const refundInput={...input,internalRefundId:'00000000-0000-4000-8000-000000000006',receipt:fullReceipt,forceReceipt:true};
 const refund={id:'2a000000-0000-4000-8000-000000000007',payment_id:ids.providerPaymentId,status:'succeeded',amount:payment.amount};
 const posts:RequestInit[]=[];const c=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts.push(init);return json(url.endsWith('/me')?fiscal:url.includes('/payments/')?payment:refund);});
 await c.createRefund(refundInput);const body=JSON.parse(String(posts[0]!.body));assert.equal(body.receipt.items[0].payment_mode,'full_payment');assert.deepEqual(body.receipt,fullReceipt);
});
