import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID as key} from 'node:crypto';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {qaDatabase} from './helpers/qa-db.mjs';
test('YooKassa lifecycle on an isolated PostgreSQL clone',{skip:process.env.AR_YOOKASSA_TESTS!=='1',timeout:180000},async t=>{
 const qa=await qaDatabase('yookassa');const q=qa.query;
 const has=(await q("SELECT 1 FROM information_schema.columns WHERE table_name='ar_payments' AND column_name='provider'")).rowCount;if(!has)await q(readFileSync('migrations/010_yookassa_payments.sql','utf8'));
 process.env.APP_SECRET=randomBytes(48).toString('hex');process.env.APP_ORIGIN='http://127.0.0.1:14323';process.env.STORE_MODE='local-test';process.env.PAYMENT_PROVIDER='yookassa-sandbox';process.env.YOOKASSA_SHOP_ID='123456';process.env.YOOKASSA_SECRET_KEY='qa-secret-not-real-00000';
 const db=await import('../src/server/db.ts'),security=await import('../src/server/security.ts'),cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts');
 const {createYooPayments}=await import('../src/server/yookassa-payments.ts'),{createYooKassaSandbox}=await import('../src/server/adapters/yookassa-sandbox.ts'),{testPaymentAdapter}=await import('../src/server/adapters/payment.ts');
 const report:{checks:{name:string;passed:boolean}[];passed:boolean;cleanup:boolean}={checks:[],passed:false,cleanup:false};
 t.after(async()=>{await db.getPool().end();await qa.close();report.cleanup=true;mkdirSync('artifacts/yookassa',{recursive:true});writeFileSync('artifacts/yookassa/integration.json',JSON.stringify(report,null,2)+'\n');});
 const check=async(name:string,fn:()=>Promise<void>)=>t.test(name,async()=>{try{await fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false});throw e;}});
 const one=async(s:string,p:unknown[]=[]) => (await q(s,p)).rows[0];
 const actor={id:key()},remote=new Map<string,any>(),byKey=new Map<string,string>(),posts:any[]=[],gets:string[]=[];
 let lose=false,pausePost:((value:any)=>Promise<void>)|null=null;
 const cfg={shopId:'123456',secretKey:'qa-secret-not-real-00000',returnOrigin:'http://127.0.0.1:14323'};
 const service=createYooPayments(()=>createYooKassaSandbox(cfg,async(url,init)=>{
  if(url.endsWith('/me'))return Response.json({test:true,account_id:cfg.shopId,status:'enabled',payment_methods:['bank_card'],fiscalization_enabled:false});
  if(init.method==='POST'){
   const k=(init.headers as Record<string,string>)['Idempotence-Key']!,body=JSON.parse(String(init.body));posts.push({key:k,body});
   let id=byKey.get(k);if(!id){id=key();byKey.set(k,id);remote.set(id,{id,status:'pending',paid:false,test:true,recipient:{account_id:cfg.shopId},amount:body.amount,metadata:body.metadata,confirmation:{confirmation_url:'https://yoomoney.ru/payments/external/confirmation?orderId='+id}});}
   const result=structuredClone(remote.get(id));if(pausePost)await pausePost(result);if(lose){lose=false;throw Error('QA lost response');}return Response.json(result);
  }
  const id=url.split('/').at(-1)!;gets.push(id);return remote.has(id)?Response.json(remote.get(id)):Response.json({},404);
 }));
 async function session(){const jar=new Map<string,string>();return security.getSession({cookies:{get:(n:string)=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n:string,v:string)=>jar.set(n,v)}} as never);}
 async function fixture(preorder=false){
  const product=key(),sku=key(),s=await session();await q("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,'QA gateway product',$2,'00000000-0000-4000-8000-000000000001','published',true)",[product,'qa-'+product]);await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA card option','100.01','published')",[sku,product,'QA-'+sku]);await q('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,$2,0)',[sku,preorder?0:3]);
  const c=await cart.changeCart(s,{productId:product,skuId:sku,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});const quote=await cart.createQuote(s,{cartVersion:c.version,customer:{name:'QA',phone:'+79990000000',email:'qa-gateway@example.invalid'},delivery:{method:'pickup_point',city:'QA City',address:'QA Address'}});let o=(await orders.checkout(s,{quoteId:quote.id,cartVersion:c.version,idempotencyKey:key()})).orders[0]!;
  o=await orders.quoteShipping(actor,{orderId:o.id,costRubles:'40.20',note:'QA shipping',idempotencyKey:key()});
  if(preorder){assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[sku]),{on_hand:0,reserved:0});await orders.receiveStock(actor,{skuId:sku,quantity:1,reason:'QA receipt',idempotencyKey:key()});o=await orders.confirmPreorder(actor,{orderId:o.id,terms:'QA test terms',idempotencyKey:key()});}
  const body={orderId:o.id,shippingVersion:o.shippingVersion,method:'card',idempotencyKey:key()},p=await payments.initiatePayment(s,body);assert.ok('paymentId'in p&&p.paymentId);return{s,o,sku,body,pid:(p as any).paymentId as string};
 }
 const due=(id:string)=>q("UPDATE ar_payments SET provider_next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
 const lookup=(id:string)=>one('SELECT * FROM ar_payments WHERE id=$1',[id]);
 function succeed(id:string){Object.assign(remote.get(id),{status:'succeeded',paid:true,confirmation:undefined});}
 const callback=(pid:string,local?:string)=>({type:'notification',event:'payment.succeeded',object:{id:pid,status:'succeeded',metadata:local?{autoreelz_payment_id:local}:{}}});
 await check('parallel browser commands share one attempt and one leased provider request',async()=>{
  const f=await fixture();const p=await payments.initiatePayment(f.s,{...f.body,idempotencyKey:key()});assert.equal((p as any).paymentId,f.pid);
  let unblock!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>unblock=r);pausePost=async()=>{entered();await hold;};const first=service.process(f.pid);await started;assert.equal(await service.process(f.pid),'busy');unblock();await first;pausePost=null;assert.equal(posts.filter(p=>p.body.metadata.autoreelz_payment_id===f.pid).length,1);assert.equal((await orders.getOrder(f.s,f.o.id)).paymentAction?.pending,true);
 });
 await check('lost POST response reuses the same key/body and never creates a second provider object',async()=>{
  const f=await fixture();lose=true;await assert.rejects(service.process(f.pid),{code:'PAYMENT_PENDING_CHECK'});const first=await lookup(f.pid);assert.equal(first.provider_id,null);assert.equal(first.status,'pending');await due(f.pid);await service.process(f.pid);const sent=posts.filter(p=>p.body.metadata.autoreelz_payment_id===f.pid);assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal((await lookup(f.pid)).provider_id,byKey.get(first.provider_key));
 });
 await check('callback body cannot declare success; authenticated provider state settles once',async()=>{
  const f=await fixture();await service.process(f.pid);const p=await lookup(f.pid);await service.webhook(callback(p.provider_id));assert.equal((await orders.getOrder(f.s,f.o.id)).status,'awaiting_payment');succeed(p.provider_id);await service.webhook(callback(p.provider_id));await service.webhook(callback(p.provider_id));const o=await orders.getOrder(f.s,f.o.id);assert.equal(o.status,'paid');assert.equal(o.totalRubles,'140.21');assert.equal(o.paymentAction?.confirmationUrl,null);assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku]),{on_hand:2,reserved:0});
 });
 await check('a correctly signed simulation event cannot settle a YooKassa attempt',async()=>{
  const f=await fixture(),event=testPaymentAdapter.event({id:f.pid,amountRubles:'140.21'});await assert.rejects(payments.applyPaymentEvent(event.event,event.signature),{code:'PAYMENT_PROVIDER_MISMATCH'});assert.equal((await lookup(f.pid)).status,'pending');
 });
 await check('cancel during a slow provider request is not blocked by a DB transaction; late success goes to review',async()=>{
  const f=await fixture();let unblock!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>unblock=r);pausePost=async()=>{entered();await hold;};const call=service.process(f.pid);await started;await orders.cancelOrder(f.s,{orderId:f.o.id,idempotencyKey:key()});unblock();await call;pausePost=null;const p=await lookup(f.pid);succeed(p.provider_id);await service.webhook(callback(p.provider_id));assert.equal((await orders.getOrder(f.s,f.o.id)).status,'manual_review');assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku]),{on_hand:3,reserved:0});
 });
 await check('callback recovers an unknown provider ID after expiry without a new POST',async()=>{
  const f=await fixture();lose=true;await assert.rejects(service.process(f.pid));const p=await lookup(f.pid),providerId=byKey.get(p.provider_key)!;await q("UPDATE ar_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[f.o.id]);await orders.expireDueOrders();const count=posts.length;assert.equal(await service.process(f.pid,providerId),'done');succeed(providerId);await service.webhook(callback(providerId,f.pid));assert.equal(posts.length,count);assert.equal((await orders.getOrder(f.s,f.o.id)).status,'manual_review');assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku]),{on_hand:3,reserved:0});
 });
 await check('confirmed preorder is not debited again when YooKassa succeeds',async()=>{
  const f=await fixture(true);await service.process(f.pid);const p=await lookup(f.pid);succeed(p.provider_id);await service.webhook(callback(p.provider_id));assert.equal((await orders.getOrder(f.s,f.o.id)).status,'paid');assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku]),{on_hand:0,reserved:0});
 });
 await check('unknown callbacks and foreign sessions cannot read or mutate another payment',async()=>{
  const before=gets.length;await service.webhook(callback(key(),key()));assert.equal(gets.length,before);const f=await fixture();await assert.rejects(service.refresh(await session(),f.o.id),{code:'FORBIDDEN'});assert.equal(gets.length,before);
 });
 await check('mismatched verified amount is rejected without stock debit',async()=>{
  const f=await fixture();await service.process(f.pid);const p=await lookup(f.pid);succeed(p.provider_id);remote.get(p.provider_id).amount.value='999.99';await assert.rejects(service.webhook(callback(p.provider_id)),{code:'PAYMENT_PENDING_CHECK'});assert.equal((await lookup(f.pid)).status,'pending');assert.deepEqual(await one('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[f.sku]),{on_hand:3,reserved:1});
 });
 await check('payment snapshot fields cannot be rewritten and no new POST is sent after the idempotence window',async()=>{
  const f=await fixture();for(const change of ["amount_rubles='1.00'","provider_key=gen_random_uuid()","provider_shop_id='999'","provider_return_url='https://evil.invalid'"])await assert.rejects(q('UPDATE ar_payments SET '+change+' WHERE id=$1',[f.pid]),/immutable/);await q("UPDATE ar_payments SET provider_requested_at=now()-interval '24 hours' WHERE id=$1",[f.pid]);const count=posts.length;assert.equal(await service.process(f.pid),'closed');assert.equal(posts.length,count);assert.equal((await lookup(f.pid)).provider_last_error,'IDEMPOTENCE_WINDOW_EXPIRED');
 });
 await check('a delayed pending response cannot regress a payment settled by a recovered lease',async()=>{
  const f=await fixture();let unblock!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>unblock=r);let first=true;pausePost=async()=>{if(first){first=false;entered();await hold;}};
  const slow=service.process(f.pid);await started;const p=await lookup(f.pid);succeed(byKey.get(p.provider_key)!);await q("UPDATE ar_payments SET provider_lease_until=now()-interval '1 second' WHERE id=$1",[f.pid]);await service.process(f.pid);unblock();await slow;pausePost=null;assert.equal((await lookup(f.pid)).provider_status,'succeeded');assert.equal((await orders.getOrder(f.s,f.o.id)).status,'paid');
 });
 report.passed=report.checks.length===11&&report.checks.every(c=>c.passed);
});
