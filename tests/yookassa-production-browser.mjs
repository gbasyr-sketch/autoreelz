// Run against a locally running built app. All API/provider calls are intercepted.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {workspaceFixtures} from './helpers/manager-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_BROWSER_BASE||'http://127.0.0.1:14323',out='private/yookassa-production/browser';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.AR_CHROMIUM_EXECUTABLE||'/Users/magomedrasul/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',headless:true});
const report={passed:false,mockProvider:true,viewports:[]};
try{
 for(const width of [1440,375]){
  const order=workspaceFixtures().orders[0];Object.assign(order,{status:'paid',paymentStatus:'paid',deliveryStatus:'delivered',deliveredAt:new Date().toISOString(),canPay:false,canCancel:false,paymentAction:{provider:'yookassa-live',pending:false,confirmationUrl:null,canCheck:false,message:null}});
  const workspace={enabled:true,canConfirm:true,jobs:[]},paymentId=randomUUID();const posts=[],errors=[];let lose=true,checks=0;
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),reply=(json,status=200)=>route.fulfill({status,json});
   if(url.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:'2030-01-01T00:00:00Z'});
   if(url.pathname==='/api/manager/access')return reply({ok:true});if(url.pathname==='/api/manager/order'||url.pathname==='/api/commerce/order')return reply(order);
   if(url.pathname==='/api/manager/cdek-shipments')return reply({enabled:false,reason:'QA',shipments:[]});
   if(url.pathname==='/api/manager/return-resolution')return reply({enabled:false,canClose:false,reason:'QA',orderId:order.id,revision:'a'.repeat(64),summary:null,history:[]});
   if(url.pathname==='/api/manager/return-intake')return reply({enabled:false,canReceive:false,reason:'QA',orderId:order.id,lines:[],receipts:[]});
   if(url.pathname==='/api/manager/payment-refunds')return reply({enabled:true,payments:[{id:paymentId,amountRubles:'2000.00',refundedRubles:'0.00',reservedRubles:'0.00',remainingRubles:'2000.00',shippingRemainingRubles:'200.00',canRefund:true,partialAvailable:true,blockReason:null,lines:[]}],refunds:[]});
   if(url.pathname==='/api/manager/closing-receipt'){
    if(req.method()==='GET')return reply(workspace);const body=req.postDataJSON();
    if(body.action==='check'){checks++;workspace.jobs[0].state='succeeded';workspace.jobs[0].checkedAt=new Date().toISOString();return reply(workspace);}
    posts.push(body);if(!workspace.jobs.length){workspace.canConfirm=false;workspace.jobs.push({id:randomUUID(),paymentId,state:'queued',amountRubles:'2000.00',createdAt:new Date().toISOString(),checkedAt:null,error:null,providerId:null});}
    if(lose){lose=false;return reply({error:{message:'Ответ потерян после сохранения'}},503);}return reply({id:workspace.jobs[0].id},202);
   }
   return reply({error:{message:'Unmocked '+url.pathname}},404);
  });
  await page.goto(base+'/manager/orders/'+order.id,{waitUntil:'networkidle'});let panel=page.locator('[data-closing-receipts]');const submit=panel.getByRole('button',{name:'Подтвердить получение и сформировать чек'});
  await submit.waitFor();assert.equal(await submit.isDisabled(),true);assert.equal(posts.length,0);
  await page.locator('[data-refunds]').getByRole('heading',{name:'Платёж ЮKassa'}).waitFor();assert.equal(await page.locator('[data-refunds]').getByRole('button',{name:'Вернуть платёж',exact:true}).count(),1);
  const reason=panel.locator('[name=closingReceiptReason]'),received=panel.locator('[name=closingReceiptReceived]');await reason.fill('Выдано покупателю лично');await received.check();await reason.fill('Выдано покупателю по подтверждению');assert.equal(await received.isChecked(),false);assert.equal(await submit.isDisabled(),true);await received.check();
  await submit.evaluate(b=>{b.click();b.click();});await panel.getByText(/Ответ потерян после сохранения/).waitFor();assert.equal(posts.length,1);assert.equal(posts[0].received,true);assert.equal(posts[0].confirmed,true);assert.equal(await reason.getAttribute('readonly'),'');assert.equal(await panel.getByRole('button',{name:'Обновить состояние чеков'}).isDisabled(),true);
  await page.reload({waitUntil:'networkidle'});panel=page.locator('[data-closing-receipts]');await panel.getByRole('button',{name:'Повторить тот же запрос чека'}).click();await panel.getByText(/Ожидает отправки/).waitFor();assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);await panel.locator('form').waitFor({state:'detached'});assert.equal(await panel.locator('form').count(),0);
  workspace.jobs[0].providerId='rt-'+randomUUID();workspace.jobs[0].state='pending';await panel.getByRole('button',{name:'Обновить состояние чеков'}).click();await panel.getByRole('button',{name:'Проверить чек в ЮKassa'}).click();await panel.getByText(/Чек полного расчёта сформирован/).waitFor();assert.equal(checks,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await panel.screenshot({path:out+'/closing-'+width+'.png'});
  order.canPay=true;order.status='awaiting_payment';order.paymentStatus='unpaid';order.deliveryStatus='quoted';await page.goto(base+'/orders/'+order.id,{waitUntil:'networkidle'});
  const actions=page.locator('.order-actions');await actions.getByRole('button',{name:'Перейти к оплате',exact:true}).waitFor();assert.equal(await actions.locator('[value=sbp]').count(),1);assert.equal(await actions.locator('[value=card]').count(),1);assert.ok(!(await actions.innerText()).includes('тестов'));
  order.canPay=false;order.status='paid';order.paymentStatus='paid';await page.getByRole('button',{name:'Обновить статус',exact:true}).click();await actions.getByText('Оплата получена',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  report.viewports.push({width,passed:true,liveCardAndSbp:true,liveRefundLabels:true,receiptConfirmation:true,doubleClickBlocked:true,retryKeyAcrossReload:true,separateReceiptStatus:true,knownReceiptReconciliation:true,noOverflow:true});await context.close();
 }
 report.passed=true;await fs.mkdir('artifacts/yookassa-production',{recursive:true});await fs.writeFile('artifacts/yookassa-production/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
