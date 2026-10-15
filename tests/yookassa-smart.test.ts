import test from 'node:test';
import assert from 'node:assert/strict';
import {createYooKassa} from '../src/server/adapters/yookassa-sandbox.ts';
const config={shopId:'100500',secretKey:'qa-smart-not-a-real-key',returnOrigin:'https://autoreelz.ru',test:false};
const ids={orderId:'00000000-0000-4000-8000-000000000001',internalPaymentId:'00000000-0000-4000-8000-000000000002'};
const receipt={customer:{email:'qa@example.invalid'},items:[{description:'QA товар',quantity:'1',amount:{value:'485.00',currency:'RUB' as const},vat_code:1 as const,payment_mode:'full_prepayment' as const,payment_subject:'commodity' as const,measure:'piece' as const}],internet:true as const,timezone:3 as const};
const input={...ids,amountRubles:'485.00',idempotenceKey:'00000000-0000-4000-8000-000000000003',returnUrl:config.returnOrigin+'/orders/'+ids.orderId,method:'smart' as const,receipt};
const me={account_id:config.shopId,test:false,status:'enabled',payment_methods:['yoo_money','bank_card','sberbank','sbp','tinkoff_bank'],fiscalization_enabled:true};
const result={id:'2a000000-0000-4000-8000-000000000004',status:'pending',paid:false,test:false,amount:{value:'485.00',currency:'RUB'},recipient:{account_id:config.shopId},metadata:{autoreelz_order_id:ids.orderId,autoreelz_payment_id:ids.internalPaymentId},confirmation:{type:'redirect',confirmation_url:'https://yookassa.ru/synthetic-payment'}};
test('smart redirect omits all method selectors and preserves exact receipt, metadata and retry body',async()=>{
 const posts:RequestInit[]=[];const client=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts.push(init);return Response.json(url.endsWith('/me')?me:result);});
 assert.equal((await client.createPayment(input)).confirmationUrl,result.confirmation.confirmation_url);await client.createPayment(input);
 const body=JSON.parse(String(posts[0]!.body));for(const name of ['payment_method_data','payment_method_id','payment_token','save_payment_method'])assert.equal(Object.hasOwn(body,name),false);
 assert.deepEqual(body.receipt,receipt);assert.deepEqual(body.amount,result.amount);assert.deepEqual(body.metadata,result.metadata);assert.deepEqual(body.confirmation,{type:'redirect',return_url:input.returnUrl});assert.equal(body.capture,true);assert.equal(posts[0]!.body,posts[1]!.body);assert.deepEqual(posts[0]!.headers,posts[1]!.headers);
});
test('smart can use each connected non-card option; an empty or unsupported-only shop cannot POST',async()=>{
 for(const method of ['yoo_money','bank_card','sberbank','sbp','tinkoff_bank']){
  let posts=0;const client=createYooKassa(config,async(url,init)=>{if(init.method==='POST')posts++;return Response.json(url.endsWith('/me')?{...me,payment_methods:[method]}:result);});await client.createPayment(input);assert.equal(posts,1);
 }
 for(const methods of [[],['b2b_sberbank'],['electronic_certificate'],['b2b_sberbank','electronic_certificate']]){
  let posts=0;const client=createYooKassa(config,async(_url,init)=>{if(init.method==='POST')posts++;return Response.json({...me,payment_methods:methods});});await assert.rejects(client.createPayment(input),{code:'PAYMENT_METHOD_NOT_ENABLED'});assert.equal(posts,0);
 }
});
test('legacy card and SBP requests retain their original explicit method, including default card',async()=>{
 for(const method of [undefined,'card','sbp'] as const){let body:any;const client=createYooKassa(config,async(url,init)=>{if(init.method==='POST')body=JSON.parse(String(init.body));return Response.json(url.endsWith('/me')?me:result);});await client.createPayment({...input,method});assert.deepEqual(body.payment_method_data,{type:method==='sbp'?'sbp':'bank_card'});assert.deepEqual(body.receipt,receipt);}
});
test('smart keeps shop/fiscal/response identity validation and reports uncertain POST without another request',async()=>{
 for(const patch of [{account_id:'wrong'},{test:true},{status:'disabled'},{fiscalization_enabled:false}]){let posts=0;const client=createYooKassa(config,async(_url,init)=>{if(init.method==='POST')posts++;return Response.json({...me,...patch});});await assert.rejects(client.createPayment(input));assert.equal(posts,0);}
 let posts=0;const client=createYooKassa(config,async(url,init)=>{if(url.endsWith('/me'))return Response.json(me);posts++;throw Error('synthetic unknown outcome');});await assert.rejects(client.createPayment(input),{code:'PAYMENT_OUTCOME_UNKNOWN'});assert.equal(posts,1);
 for(const patch of [{test:true},{recipient:{account_id:'wrong'}},{amount:{value:'1.00',currency:'RUB'}},{metadata:{}},{confirmation:{type:'redirect',confirmation_url:'https://evil.invalid/'}}]){const c=createYooKassa(config,async url=>Response.json(url.endsWith('/me')?me:{...result,...patch}));await assert.rejects(c.createPayment(input));}
});
