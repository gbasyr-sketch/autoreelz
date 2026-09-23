import test from 'node:test';import assert from 'node:assert/strict';
import {createYooKassaSandbox,YooKassaError} from '../src/server/adapters/yookassa-sandbox.ts';
const config={shopId:'123456',secretKey:'qa-secret-not-real-000000',returnOrigin:'http://127.0.0.1:14323'};
const ids={orderId:'00000000-0000-4000-8000-000000000001',internalPaymentId:'00000000-0000-4000-8000-000000000002',providerPaymentId:'2a000000-0000-4000-8000-000000000003'};
const wanted={...ids,amountRubles:'5300.01'},input={...wanted,idempotenceKey:'00000000-0000-4000-8000-000000000004',returnUrl:config.returnOrigin+'/orders/'+ids.orderId};
const me={account_id:config.shopId,test:true,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:false};
const payment={id:ids.providerPaymentId,status:'pending',paid:false,test:true,amount:{value:'5300.01',currency:'RUB'},recipient:{account_id:config.shopId},metadata:{autoreelz_order_id:ids.orderId,autoreelz_payment_id:ids.internalPaymentId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/payments/external/confirmation?orderId=qa'}};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const code=(expected:string)=>(e:unknown)=>e instanceof YooKassaError&&e.code===expected;
test('YooKassa request uses exact RUB, card redirect, fixed API and stable caller idempotence key',async()=>{
 const sent:{url:string;init:RequestInit}[]=[];const client=createYooKassaSandbox(config,async(url,init)=>{sent.push({url,init});return json(url.endsWith('/me')?me:payment);});
 assert.equal((await client.createPayment(input)).amountRubles,'5300.01');await client.createPayment(input);
 const posts=sent.filter(x=>x.init.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0]!.init.body,posts[1]!.init.body);assert.deepEqual(posts[0]!.init.headers,posts[1]!.init.headers);
 // AbortSignal identity is deliberately excluded from business payload comparisons.
 const body=JSON.parse(String(posts[0]!.init.body));assert.deepEqual(body.amount,{value:'5300.01',currency:'RUB'});assert.equal(body.payment_method_data.type,'bank_card');assert.equal(body.capture,true);assert.equal(body.metadata.autoreelz_payment_id,ids.internalPaymentId);
 assert.equal((posts[0]!.init.headers as Record<string,string>)['Idempotence-Key'],input.idempotenceKey);assert.equal(posts[0]!.url,'https://api.yookassa.ru/v3/payments');assert.equal(posts[0]!.init.redirect,'error');
 assert.ok(!('card' in body));assert.ok(!('receipt' in body));
});
test('live shop, wrong account, missing test flag and missing receipt setup never cause POST',async()=>{
 for(const [patch,error] of [[{test:false},'NOT_EXPECTED_TEST_SHOP'],[{account_id:'999'},'NOT_EXPECTED_TEST_SHOP'],[{test:undefined},'NOT_EXPECTED_TEST_SHOP'],[{fiscalization_enabled:true},'RECEIPT_SETUP_REQUIRED']] as const){let calls=0;const c=createYooKassaSandbox(config,async(_url,init)=>{calls++;assert.equal(init.method,'GET');return json({...me,...patch});});await assert.rejects(c.createPayment(input),code(error));assert.equal(calls,1);}
});
test('invalid amounts, missing idempotence key and hostile return URL rejected before network',async()=>{
 const c=createYooKassaSandbox(config,async()=>{throw Error('network must not be called');});for(const patch of [{amountRubles:'530001'},{amountRubles:'0.00'},{amountRubles:'1.234'},{idempotenceKey:''},{returnUrl:'https://evil.example/orders/'+ids.orderId}])await assert.rejects(c.createPayment({...input,...patch}));
});
test('payment test/account/id/metadata/currency/amount mismatches fail closed',async()=>{
 for(const patch of [{test:false},{recipient:{account_id:'other'}},{id:input.orderId},{metadata:{}},{amount:{currency:'USD',value:'5300.01'}},{amount:{currency:'RUB',value:'530001.00'}},{status:'succeeded',paid:false}]){const c=createYooKassaSandbox(config,async()=>json({...payment,...patch}));await assert.rejects(c.getPayment(ids.providerPaymentId,wanted));}
});
test('callback status is only a hint; authenticated GET state wins',async()=>{
 let calls=0;const c=createYooKassaSandbox(config,async(url,init)=>{calls++;assert.equal(url,'https://api.yookassa.ru/v3/payments/'+ids.providerPaymentId);assert.equal(init.method,'GET');return json({...payment,status:'canceled',confirmation:undefined});});
 const r=await c.verifyNotification({type:'notification',event:'payment.succeeded',object:{id:ids.providerPaymentId,status:'succeeded',amount:{value:'999999.00'}}},wanted);assert.equal(r.status,'canceled');assert.equal(calls,1);
 await assert.rejects(c.verifyNotification({type:'notification',event:'payment.succeeded',object:{id:ids.orderId}},wanted),code('UNEXPECTED_NOTIFICATION'));assert.equal(calls,1);
});
test('successful state requires paid and matching immutable facts; status is never inferred from redirect',async()=>{
 const c=createYooKassaSandbox(config,async()=>json({...payment,status:'succeeded',paid:true,confirmation:undefined}));const r=await c.getPayment(ids.providerPaymentId,wanted);assert.equal(r.status,'succeeded');assert.equal(r.confirmationUrl,null);
});
test('network and HTTP500 after POST mean unknown outcome, with no automatic second POST',async()=>{
 for(const status of [500,429,0]){let posts=0;const c=createYooKassaSandbox(config,async(url)=>{if(url.endsWith('/me'))return json(me);posts++;if(!status)throw Error('network timeout '+config.secretKey);return json({description:config.secretKey},status);});await assert.rejects(c.createPayment(input),code('PAYMENT_OUTCOME_UNKNOWN'));assert.equal(posts,1);}
});
test('errors redact provider bodies/credentials and unsafe confirmation URLs are rejected',async()=>{
 const denied=createYooKassaSandbox(config,async()=>json({description:config.secretKey},401));await assert.rejects(denied.checkShop(),e=>e instanceof Error&&e.message==='PROVIDER_AUTH_FAILED'&&!e.message.includes(config.secretKey));
 for(const url of ['https://evil.example/pay','http://yoomoney.ru/pay','https://user:pass@yoomoney.ru/pay','https://yoomoney.ru:444/pay']){const c=createYooKassaSandbox(config,async()=>json({...payment,confirmation:{confirmation_url:url}}));await assert.rejects(c.getPayment(ids.providerPaymentId,wanted),code('UNSAFE_CONFIRMATION_URL'));}
});
test('oversized or malformed provider responses are rejected without retaining private payload',async()=>{
 const malformed=createYooKassaSandbox(config,async()=>new Response('not-json'));await assert.rejects(malformed.checkShop(),code('INVALID_PROVIDER_RESPONSE'));
 const large=createYooKassaSandbox(config,async()=>new Response('x'.repeat(140000)));await assert.rejects(large.checkShop(),code('INVALID_PROVIDER_RESPONSE'));
});
