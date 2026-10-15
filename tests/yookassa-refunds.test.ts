import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID as key} from 'node:crypto';
import {createYooKassaSandbox} from '../src/server/adapters/yookassa-sandbox.ts';
const config={shopId:'123456',secretKey:'qa-secret-not-real-000000',returnOrigin:'http://127.0.0.1:14323'};
const input={orderId:key(),internalPaymentId:key(),providerPaymentId:key(),internalRefundId:key(),amountRubles:'123.45',idempotenceKey:key()};
const me={account_id:config.shopId,test:true,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:false};
const payment={id:input.providerPaymentId,status:'succeeded',paid:true,test:true,amount:{value:'123.45',currency:'RUB'},recipient:{account_id:config.shopId},metadata:{autoreelz_order_id:input.orderId,autoreelz_payment_id:input.internalPaymentId}};
const refund={id:key(),payment_id:input.providerPaymentId,status:'pending',amount:payment.amount};
const json=(v:unknown)=>Response.json(v);
test('refund verifies sandbox shop and paid payment; repeat body/key are identical',async()=>{
 const sent:RequestInit[]=[];const c=createYooKassaSandbox(config,async(url,init)=>{if(url.endsWith('/me'))return json(me);if(url.includes('/payments/'))return json(payment);sent.push(init);return json(refund);});
 await c.createRefund(input);await c.createRefund(input);assert.equal(sent.length,2);assert.equal(sent[0]!.body,sent[1]!.body);assert.deepEqual(sent[0]!.headers,sent[1]!.headers);assert.deepEqual(JSON.parse(String(sent[0]!.body)),{payment_id:input.providerPaymentId,amount:{value:'123.45',currency:'RUB'},description:'AUTO REELZ refund '+input.internalRefundId});
});
test('live shop, fiscalization, unconfirmed or mismatched payment prohibit refund POST',async()=>{
 for(const [shop,p]of [[{...me,test:false},payment],[{...me,fiscalization_enabled:true},payment],[me,{...payment,status:'canceled',paid:false}],[me,{...payment,test:false}],[me,{...payment,amount:{value:'1.00',currency:'RUB'}}]]){
  let posts=0;const c=createYooKassaSandbox(config,async(url,init)=>{if(init.method==='POST')posts++;return json(url.endsWith('/me')?shop:p);});await assert.rejects(c.createRefund(input));assert.equal(posts,0);
 }
});
test('refund GET verifies payment identity and refuses wrong refund id, amount, currency or status',async()=>{
 for(const patch of [{id:key()},{payment_id:key()},{amount:{value:'123.46',currency:'RUB'}},{amount:{value:'123.45',currency:'USD'}},{status:'unknown'}]){
  const c=createYooKassaSandbox(config,async url=>json(url.includes('/payments/')?payment:{...refund,...patch}));await assert.rejects(c.getRefund(refund.id,input));
 }
 const c=createYooKassaSandbox(config,async url=>json(url.includes('/payments/')?payment:{...refund,status:'succeeded'}));assert.equal((await c.getRefund(refund.id,input)).status,'succeeded');
});
test('lost refund POST is uncertain, no implicit retry and no provider secrets in errors',async()=>{
 let posts=0;const c=createYooKassaSandbox(config,async(url,init)=>{if(url.endsWith('/me'))return json(me);if(init.method==='GET')return json(payment);posts++;throw Error(config.secretKey);});await assert.rejects(c.createRefund(input),{message:'PAYMENT_OUTCOME_UNKNOWN'});assert.equal(posts,1);
});
test('partial refund verifies ORIGINAL payment amount and sends exact refund amount; fiscal partial sends subset receipt',async()=>{
 const wanted={...input,paymentAmountRubles:'123.45',amountRubles:'23.45'},sent:Record<string,any>[]=[];
 const receipt={customer:{email:'qa@example.invalid'},internet:true as const,timezone:3 as const,items:[{description:'QA',quantity:'1',amount:{value:'23.45',currency:'RUB' as const},vat_code:1 as const,payment_mode:'full_prepayment' as const,payment_subject:'commodity' as const,measure:'piece' as const}]};
 const client=createYooKassaSandbox(config,async(url,init)=>{
  if(url.endsWith('/me'))return json({...me,fiscalization_enabled:true});
  if(url.includes('/payments/'))return json(payment);
  if(init.method==='GET')return json({...refund,amount:{value:'23.45',currency:'RUB'},status:'succeeded'});
  const body=JSON.parse(String(init.body));sent.push(body);return json({...refund,amount:body.amount,status:'succeeded',receipt_registration:'pending'});
 });
 const result=await client.createRefund({...wanted,receipt});assert.equal(result.amountRubles,'23.45');assert.deepEqual(sent[0]!.receipt,receipt);
 assert.equal((await client.getRefund(refund.id,wanted)).amountRubles,'23.45');
});
