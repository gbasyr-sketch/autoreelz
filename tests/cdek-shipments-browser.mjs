import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {workspaceFixtures} from './helpers/manager-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_CDEK_SHIPMENTS_URL||'http://127.0.0.1:14358',out=process.env.AR_CDEK_SHIPMENTS_OUTPUT||'private/cdek-shipments/browser-final';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.AR_CHROMIUM_EXECUTABLE?{executablePath:process.env.AR_CHROMIUM_EXECUTABLE}:{channel:'chrome',headless:true}),report={passed:false,mockProvider:true,viewports:[]};
try{for(const width of [1440,375]){
 const order=workspaceFixtures().orders[0];Object.assign(order,{status:'paid',paymentStatus:'paid',deliveryStatus:'quoted',trackingNumber:null,canCancel:false,canPay:false,delivery:{provider:'cdek',method:'pickup_point',cityCode:44,city:'Москва',pointCode:'MOS4',address:'Тестовый пункт'}});
 const ws={mode:'test',enabled:true,reason:null,orderId:order.id,package:{weightG:300,lengthMm:220,widthMm:100,heightMm:40},shipments:[]};
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),calls=[],errors=[];let lose=true;page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),b=req.method()==='POST'?req.postDataJSON():{},reply=(json,status=200)=>route.fulfill({status,json});
  if(u.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:'2030-01-01T00:00:00Z'});
  if(u.pathname==='/api/manager/order')return reply(order);
  if(u.pathname==='/api/manager/access')return reply({ok:true});
  if(u.pathname==='/api/manager/cdek-shipments'){
   if(req.method()==='GET'){if(u.searchParams.has('printId'))return route.fulfill({status:200,contentType:'application/pdf',body:'%PDF-1.4\nfixture'});return reply(ws);}
   calls.push(b);
   if(b.action==='preview')return reply({token:'qa-token',expiresAt:new Date(Date.now()+300000).toISOString(),environment:'test',recipient:'Тестовый получатель',phone:'+70000000001',destination:'Москва · MOS4',origin:'MOS4',tariff:136,parcel:b,items:order.lines.map((l,i)=>({name:l.name,quantity:l.quantity,unitPrice:l.unitPriceRubles,weightG:b.itemWeights[i]})),declaredValue:order.productTotalRubles,collectionAmount:'0.00'});
   if(b.action==='create'){ws.shipments=[{id:order.id,state:'queued',environment:'test',number:'QA-1',trackingNumber:null,carrierCode:null,error:null,updatedAt:new Date().toISOString(),canCancel:false,canPrint:false,print:null,history:[]}];if(lose){lose=false;return reply({error:{message:'Ответ потерян после сохранения'}},503);}return reply({id:order.id},202);}
   const s=ws.shipments[0];if(b.action==='print')s.print={id:order.id,state:'pending',error:null};if(b.action==='cancel')s.state='cancel_queued';return reply({id:order.id},202);
  }
  return reply({error:{message:'Unmocked '+u.pathname}},404);
 });
 await page.goto(base+'/manager/orders/'+order.id,{waitUntil:'networkidle'});let panel=page.locator('[data-cdek-panel]');await panel.locator('[data-cdek-form]').waitFor();
 for(let i=0;i<order.lines.length;i++)await panel.locator(`[name="item-${i}"]`).fill('100');
 await panel.locator('[data-cdek-preview]').click();await panel.locator('[data-cdek-create]').waitFor();await panel.screenshot({path:`${out}/preview-${width}.png`});
 await panel.locator('[name=weightG]').fill('350');assert.equal(await panel.locator('[data-cdek-create]').count(),0);await panel.locator('[data-cdek-preview]').click();await panel.locator('[data-cdek-create]').waitFor();
 await panel.locator('[data-cdek-create]').evaluate(b=>{b.click();b.click();});await panel.getByText('Ответ потерян после сохранения',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='create').length,1);
 // Explicit retry keeps its key; refresh later restores the server-side job.
 await panel.locator('[data-cdek-create]').click();await panel.locator('[data-shipment-id]').waitFor();const commands=calls.filter(c=>c.action==='create');assert.equal(commands.length,2);assert.equal(commands[0].idempotencyKey,commands[1].idempotencyKey);await page.reload({waitUntil:'networkidle'});await panel.locator('[data-shipment-id]').waitFor();assert.equal(await panel.locator('[data-cdek-create]').count(),0);
 const s=ws.shipments[0];Object.assign(s,{state:'ready',trackingNumber:'1110000000',carrierCode:'CREATED',canCancel:true,canPrint:true,history:[{kind:'result',at:new Date().toISOString(),message:'Регистрация подтверждена'}]});await panel.locator('[data-cdek-refresh]').click();await panel.locator('[data-cdek-print]').waitFor();await panel.locator('[data-cdek-print]').click();await page.waitForFunction(()=>document.querySelector('[data-cdek-print]')?.disabled===true);
 s.print.state='ready';await panel.locator('[data-cdek-refresh]').click();await panel.locator('[data-cdek-download]').waitFor();assert.match(await panel.locator('[data-cdek-download]').getAttribute('href'),/^\/api\/manager\/cdek-shipments\?printId=/);
 await panel.screenshot({path:`${out}/ready-${width}.png`});await panel.getByText('Отменить отправление',{exact:true}).click();await panel.locator('[name=cdekCancelReason]').fill('Исправить упаковку');await panel.locator('[data-cdek-cancel]').click();await panel.getByText('Ожидает отмены',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);report.viewports.push({width,passed:true,previewInvalidated:true,doubleClickBlocked:true,retrySameKey:true,reloadRestores:true,printAndCancel:true});await context.close();
 }report.passed=true;
}finally{await browser.close();await fs.mkdir('artifacts/cdek-shipments',{recursive:true});await fs.writeFile('artifacts/cdek-shipments/browser.json',JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report));
