// One database and real domain commands from cart to waybill and MIME mail.
// All carrier/SMTP boundaries are injected; no production data or external I/O.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID as key} from 'node:crypto';
import {createTransport} from 'nodemailer';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';

const output='private/order-dispatch-e2e',report={passed:false,isolated:true,externalCalls:0,checks:[],cleanup:false};
const qa=await createImageDatabase('ar_qa_ai_images_dispatch_e2e_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,output),{
 SHIPPING_PROVIDER:'cdek',PAYMENT_PROVIDER:'simulation',MAIL_PROVIDER:'timeweb-smtp',
 MAIL_RECIPIENT_POLICY:'allowlist',MAIL_NEW_MESSAGES_FROM:'',
 MAIL_ALLOWED_RECIPIENTS:'ordinary@example.invalid,mixed@example.invalid,owner@example.invalid',
 MAIL_OWNER_RECIPIENT:'owner@example.invalid',SMTP_PASSWORD:'synthetic-no-network',
 CDEK_SHIPMENTS_MODE:'test',CDEK_SHIPMENTS_ALLOW_LIVE:'false',CDEK_TEST_CLIENT_ID:'fixture',
 CDEK_TEST_CLIENT_SECRET:'fixture-secret',CDEK_CLIENT_ID:'fixture',CDEK_CLIENT_SECRET:'fixture-secret',
 CDEK_FROM_PVZ:'MKHCH13',CDEK_TEST_FROM_PVZ:'MKHCH13',CDEK_FROM_CITY_CODE:'442',
});
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{report.externalCalls++;throw Error('Unexpected network in isolated dispatch test');};
const db=await import('../src/server/db.ts'),security=await import('../src/server/security.ts');
const cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts');
const payments=await import('../src/server/payments.ts'),management=await import('../src/server/management.ts');
const {createCdekClient}=await import('../src/server/adapters/cdek.ts');
const {createCdekShipping}=await import('../src/server/cdek-shipping.ts');
const {createCdekOrdersClient}=await import('../src/server/adapters/cdek-orders.ts');
const shipments=await import('../src/server/cdek-shipments.ts');
const {shipmentConfig}=await import('../src/server/cdek-shipment-policy.ts');
const {cdekShipmentTick}=await import('../src/server/cdek-shipment-worker.ts');
const {createMailWorker}=await import('../src/server/mail.ts');
const {createTimewebMail}=await import('../src/server/adapters/timeweb-mail.ts');
const q=(sql,values=[])=>qa.owner.query(sql,values),actor={id:key()};
const sent=[],remote=new Map();let carrierCreates=0,carrierPrints=0,pdfDownloads=0;
const stage=(name)=>{report.checks.push(name);console.log('PASS '+name);};
const directory=createCdekClient({clientId:'fixture',clientSecret:'fixture-secret'},async url=>{
 const u=new URL(url);
 if(u.pathname.endsWith('/oauth/token'))return Response.json({access_token:'fixture',token_type:'bearer',expires_in:3600});
 if(u.pathname.endsWith('/location/cities'))return Response.json([{code:44,country_code:'RU',city:'QA город'}]);
 if(u.pathname.endsWith('/deliverypoints')){const code=u.searchParams.get('code');return Response.json([{code,name:'QA ПВЗ',type:'PVZ',is_handout:true,is_reception:true,location:{city_code:code==='MKHCH13'?442:44,country_code:'RU',city:'QA город',address:'QA адрес'}}]);}
 if(u.pathname.endsWith('/calculator/tariff'))return Response.json({total_sum:590.15,currency:'RUB',period_min:2,period_max:4});
 throw Error('Unexpected mocked directory request');
});
const shipping=createCdekShipping(()=>directory);
// A complete, synthetic one-page PDF; it is not a real carrier waybill.
function pdfFixture(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const content='BT /F1 14 Tf 25 150 Td (AUTO REELZ - SYNTHETIC WAYBILL) Tj ET';
 objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
 let text='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const start=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 return Buffer.from(text+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const pdf=pdfFixture(),printIds=new Set();
async function carrierTransport(url,init={}){
 assert.ok(url.startsWith('https://api.edu.cdek.ru/v2/'));assert.equal(init.redirect,'error');
 const u=new URL(url),path=u.pathname.replace('/v2','');
 if(path==='/oauth/token')return Response.json({access_token:'fixture',token_type:'bearer',expires_in:3600});
 if(path==='/orders'&&init.method==='POST'){
  carrierCreates++;const payload=JSON.parse(init.body);assert.equal(payload.shipment_point,'MKHCH13');
  assert.equal(payload.delivery_recipient_cost.value,0);assert.ok(payload.packages[0].items.every(i=>i.payment.value===0));
  const entity={...payload,uuid:key(),cdek_number:String(9900000000+carrierCreates),statuses:[{code:'CREATED',date_time:new Date().toISOString()}]};remote.set(entity.uuid,entity);
  return Response.json({entity:{uuid:entity.uuid},requests:[{type:'CREATE',state:'ACCEPTED'}]},{status:202});
 }
 if(path.startsWith('/orders/')){const entity=remote.get(path.split('/').at(-1));assert.ok(entity);return Response.json({entity});}
 if(path==='/print/orders'&&init.method==='POST'){carrierPrints++;const id=key();printIds.add(id);return Response.json({entity:{uuid:id}});}
 if(path.startsWith('/print/orders/')){
  const id=path.split('/').at(-1).replace('.pdf','');assert.ok(printIds.has(id));
  if(path.endsWith('.pdf')){pdfDownloads++;return new Response(pdf,{headers:{'Content-Type':'application/pdf'}});}
  return Response.json({entity:{uuid:id,statuses:[{code:'READY',date_time:new Date().toISOString()}]}});
 }
 throw Error('Unexpected mocked carrier request');
}
const carrier=createCdekOrdersClient(shipmentConfig(),carrierTransport);
const mail=createMailWorker(()=>createTimewebMail(()=>({
 async verify(){return true;},close(){},
 async sendMail(options){
  assert.ok(options.envelope.to.every(to=>to.endsWith('@example.invalid')));
  const transport=createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const result=await transport.sendMail(options);transport.close();
  sent.push({id:options.messageId,recipient:options.envelope.to[0],subject:options.subject,text:options.text,html:options.html,mime:result.message.toString()});
  return{accepted:options.envelope.to,rejected:[]};
 }
})));
async function drain(){
 for(let n=0;n<40;n++){if(!(await q("SELECT 1 FROM ar_mail_outbox WHERE status IN('pending','retry') LIMIT 1")).rowCount)return;await mail.tick();}
 throw Error('Mail queue did not drain');
}
async function fixture(name,stock,price){
 const category=key(),productId=key(),skuId=key(),pack=key();
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA',$2,'published')",[category,'qa-'+category]);
 await q("INSERT INTO ar_packages(id,name,weight_g,length_mm,width_mm,height_mm) VALUES($1,'QA коробка',700,220,150,100)",[pack]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,$2,$3,$4,'published',true)",[productId,name,'qa-'+productId,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status,package_id) VALUES($1,$2,$3,'QA исполнение',$4,'published',$5)",[skuId,productId,'QA-'+skuId,price,pack]);
 await q('INSERT INTO ar_stock(sku_id,on_hand) VALUES($1,$2)',[skuId,stock]);return{productId,skuId,pack};
}
const due=async id=>q("UPDATE ar_cdek_shipments SET next_check_at=now()-interval '1 second' WHERE id=$1",[id]);
try{
 await fs.mkdir(output,{recursive:true});
 for(const mixed of [false,true]){
  const label=mixed?'mixed':'ordinary',recipient=label+'@example.invalid',jar=new Map();
  const session=await security.getSession({cookies:{get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v)}});
  const a=await fixture('QA деталь в наличии',5,'1800.10'),b=mixed?await fixture('QA деталь поставщика',0,'3200.20'):null;
  if(b)await q("INSERT INTO ar_packing_rules(name,components,package_id,active) VALUES('QA общая коробка',$1,$2,true)",[JSON.stringify({[a.skuId]:1,[b.skuId]:1}),a.pack]);
  let view=await cart.changeCart(session,{...a,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});
  if(b)view=await cart.changeCart(session,{...b,quantity:1,mode:'add',cartVersion:view.version,idempotencyKey:key()});
  const quote=await cart.createQuote(session,{cartVersion:view.version,customer:{name:'QA покупатель',phone:'+79990000000',email:recipient},delivery:{method:'pickup_point',cityCode:44,city:'QA город',pointCode:'QA44',address:'QA ПВЗ'}},shipping);
  assert.equal(quote.groups.length,1);assert.equal(quote.delivery.provider,'cdek');assert.equal(quote.groups[0].shipping.costRubles,'590.15');
  const checkoutBody={quoteId:quote.id,cartVersion:view.version,confirmation:{accepted:true,version:quote.confirmation.version},idempotencyKey:key()};
  let order=(await orders.checkout(session,checkoutBody)).orders[0];assert.equal((await orders.checkout(session,checkoutBody)).orders[0].id,order.id);
  assert.equal((await q('SELECT count(*)::int n FROM ar_orders WHERE session_id=$1',[session.id])).rows[0].n,1);
  const customerMails=async()=>(await q("SELECT * FROM ar_mail_outbox WHERE recipient=$1 ORDER BY created_at,id",[recipient])).rows;
  assert.equal((await customerMails()).length,1);
  assert.equal(order.status,mixed?'preorder_pending':'awaiting_payment');
  if(mixed){
   assert.equal(order.canPay,false);assert.equal((await q('SELECT sum(reserved)::int n FROM ar_stock WHERE sku_id=ANY($1::uuid[])',[[a.skuId,b.skuId]])).rows[0].n,0);
   assert.ok(!(await customerMails())[0].html_body.includes('>Оплатить заказ'));
   await assert.rejects(()=>payments.payOrder(session,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:key()}));
   await orders.receiveStock(actor,{skuId:b.skuId,quantity:1,reason:'QA подтверждённый приход',idempotencyKey:key()});
   const confirm={orderId:order.id,terms:'QA наличие подтверждено',deliveryDeadline:'2099-12-31',idempotencyKey:key()};
   order=await orders.confirmPreorder(actor,confirm);await orders.confirmPreorder(actor,confirm);
   assert.equal((await customerMails()).length,2);assert.ok((await customerMails())[1].html_body.includes('Оплатить заказ'));
  }
  stage(label+': real cart/quote/checkout, one order and guarded manager confirmation');
  const pay={orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:key()};
  order=await payments.payOrder(session,pay);await payments.payOrder(session,pay);assert.equal(order.paymentStatus,'paid');
  assert.equal((await q('SELECT count(*)::int n FROM ar_payments WHERE order_id=$1',[order.id])).rows[0].n,1);
  assert.equal((await q('SELECT on_hand FROM ar_stock WHERE sku_id=$1',[a.skuId])).rows[0].on_hand,4);
  const beforeShipment=JSON.stringify((await q('SELECT on_hand,reserved FROM ar_stock ORDER BY sku_id')).rows);
  const paid=(await customerMails()).find(m=>m.deduplication_key.endsWith(':paid'));assert.ok(paid.html_body.includes('Реальные деньги не списывались'));
  await drain();stage(label+': simulation payment settles once, stock and payment MIME queued exactly once');
  const ws=await shipments.shipmentWorkspace(order.id);assert.equal(ws.package.lengthMm,220);
  const input={weightG:700,lengthMm:220,widthMm:150,heightMm:100,itemWeights:b?[200,200]:[200]};
  const preview=await shipments.previewShipment({orderId:order.id,...input},directory);
  assert.equal(preview.declaredValue,mixed?'5000.30':'1800.10');assert.equal(preview.collectionAmount,'0.00');
  const create={orderId:order.id,...input,previewToken:preview.token,idempotencyKey:key()};
  const shipment=await shipments.queueShipment(actor,create);await shipments.queueShipment(actor,create);
  await cdekShipmentTick(carrier);await due(shipment.id);await cdekShipmentTick(carrier);
  let workspace=await shipments.shipmentWorkspace(order.id);assert.equal(workspace.shipments[0].state,'ready');
  assert.equal(workspace.shipments[0].carrierCode,'CREATED');
  const track=workspace.shipments[0].trackingNumber;assert.ok(track);
  const print={action:'print',shipmentId:shipment.id,idempotencyKey:key()};await shipments.shipmentCommand(actor,print);await shipments.shipmentCommand(actor,print);
  await cdekShipmentTick(carrier);await q('UPDATE ar_cdek_prints SET next_check_at=now() WHERE shipment_id=$1',[shipment.id]);await cdekShipmentTick(carrier);
  workspace=await shipments.shipmentWorkspace(order.id);assert.equal(workspace.shipments[0].print.state,'ready');
  // shipmentPdf deliberately has no test seam: intercept only the approved fixed carrier URLs.
  globalThis.fetch=carrierTransport;
  let downloaded;try{downloaded=await shipments.shipmentPdf(workspace.shipments[0].print.id);}finally{globalThis.fetch=async()=>{report.externalCalls++;throw Error('Unexpected network in isolated dispatch test');};}
  assert.deepEqual(downloaded,pdf);await fs.writeFile(output+'/'+label+'-synthetic-waybill.pdf',downloaded,{mode:0o600});
  assert.equal((await q('SELECT delivery_status FROM ar_orders WHERE id=$1',[order.id])).rows[0].delivery_status,'quoted');
  assert.ok(!(await customerMails()).some(m=>m.deduplication_key.startsWith('delivery:')));
  stage(label+': one carrier job and PDF, full declared merchandise value; no premature shipped mail');
  await management.fulfill(actor,{orderId:order.id,status:'packing',reason:'QA упаковка',idempotencyKey:key()});
  const send={orderId:order.id,status:'shipped',trackingNumber:track,reason:'QA имитация сдачи в ПВЗ',idempotencyKey:key()};
  await management.fulfill(actor,send);await management.fulfill(actor,send);await drain();
  const rows=await customerMails(),shipped=rows.filter(m=>m.deduplication_key.startsWith('delivery:'));
  assert.equal(shipped.length,1);assert.ok(shipped[0].html_body.includes(track));assert.ok(shipped[0].html_body.includes('/orders/'+order.id));
  assert.ok(rows.every(m=>m.status==='delivered'&&m.attempts===1));assert.equal(rows.length,mixed?4:3);
  for(const row of rows){const captured=sent.find(m=>m.id===row.message_id);assert.ok(captured);assert.match(captured.mime,/multipart\/alternative/);assert.match(captured.mime,/Content-Type: text\/plain/);assert.match(captured.mime,/Content-Type: text\/html/);assert.match(captured.mime,/Content-ID: <autoreelz-logo-v1>/);assert.equal(captured.html,row.html_body);assert.equal(captured.text,row.body);}
  assert.equal(beforeShipment,JSON.stringify((await q('SELECT on_hand,reserved FROM ar_stock ORDER BY sku_id')).rows));
  await fs.writeFile(output+'/'+label+'-shipped.eml',sent.find(m=>m.id===shipped[0].message_id).mime,{mode:0o600});
  stage(label+': handover simulation creates one tracking MIME mail; PDF/dispatch never debit stock again');
 }
 assert.equal(carrierCreates,2);assert.equal(carrierPrints,2);assert.equal(pdfDownloads,2);assert.equal(report.externalCalls,0);
 report.scenarios=2;report.customerMessages=7;report.carrierCreateCalls=carrierCreates;report.pdfJobs=carrierPrints;
 report.realPayments=0;report.realShipments=0;report.actualSmtpMessages=0;report.mimeMessages=sent.length;
 report.paymentProvider='simulation';report.carrierTransport='in-memory fixed-host fixture';report.mailTransport='Nodemailer streamTransport';
 report.integrationLayer='real domain commands and PostgreSQL, no browser/HTTP claim';report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;}
finally{
 globalThis.fetch=originalFetch;await db.getPool().end();await qa.close(true);report.cleanup=true;
 await fs.mkdir('artifacts/order-dispatch-e2e',{recursive:true});await fs.writeFile('artifacts/order-dispatch-e2e/verification.json',JSON.stringify(report,null,2)+'\n');
}
