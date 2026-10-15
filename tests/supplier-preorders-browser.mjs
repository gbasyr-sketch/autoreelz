// Synthetic manager UI verification. All API requests are mocked; no payments, mail, or stock mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {workspaceFixtures} from './helpers/manager-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||`${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`);
const base=process.env.AR_SUPPLIER_BASE||'http://127.0.0.1:14368';
const output=path.resolve(process.env.AR_SUPPLIER_OUTPUT||'private/supplier-preorders/browser');
const report={passed:false,syntheticApi:true,externalCalls:0,viewports:[]};
let browser;
await fs.mkdir(output,{recursive:true});
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.AR_CHROMIUM_EXECUTABLE||`${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`});
 for(const width of [1440,375]){
  const order=workspaceFixtures().orders[2];Object.assign(order,{shippingCostRubles:'200.00',totalRubles:'2000.00',deliveryStatus:'quoted',deliveryDeadline:'2099-12-31',checkoutPolicyVersion:'qa',allocationState:'none',supplierConfirmedAt:null,waitingForStock:false});
  const context=await browser.newContext({viewport:{width,height:950},locale:'ru-RU',reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[],unmocked=[];
  let allocationAttempt=0;
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==new URL(base).origin){report.externalCalls++;return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const reply=(json,status=200)=>route.fulfill({status,json});
   if(url.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:'2099-01-01T00:00:00Z'});
   if(url.pathname==='/api/manager/order')return reply(order);
   if(url.pathname==='/api/manager/access')return reply({ok:true});
   if(url.pathname==='/api/manager/cdek-shipments')return reply({enabled:false,reason:'Синтетическая проверка',shipments:[]});
   if(url.pathname==='/api/manager/payment-refunds')return reply({enabled:false,payments:[],refunds:[]});
   if(url.pathname==='/api/manager/confirm'){
    const body=request.postDataJSON();calls.push({api:'confirm',body});
    Object.assign(order,{status:'awaiting_payment',canPay:true,allocationState:'supplier_pending',supplierConfirmedAt:new Date().toISOString(),waitingForStock:false});return reply(order);
   }
   if(url.pathname==='/api/manager/allocate-stock'){
    const body=request.postDataJSON();calls.push({api:'allocate',body});allocationAttempt++;
    if(allocationAttempt===1)return reply({error:{code:'INSUFFICIENT_STOCK',message:'На складе пока недостаточно товаров.'}},409);
    if(allocationAttempt===2)return route.abort('failed');
    Object.assign(order,{allocationState:'settled',waitingForStock:false});return reply(order);
   }
   unmocked.push(url.pathname);return reply({error:{message:'Неожиданный API в browser QA'}},404);
  });
  await page.goto(base+'/manager/orders/'+order.id,{waitUntil:'networkidle'});
  const confirmation=page.locator('[data-preorder-confirm]');
  await confirmation.waitFor();
  const supplier=confirmation.locator('input[type=checkbox]');assert.equal(await supplier.count(),1);assert.equal(await supplier.isChecked(),false);
  await confirmation.locator('textarea[name=terms]').fill('Поставщик подтвердил наличие, срок согласован.');
  await confirmation.locator('input[name=deliveryDeadline]').fill('2099-12-31');
  await supplier.check();await page.screenshot({path:path.join(output,`supplier-confirm-${width}.png`),fullPage:true});
  await confirmation.getByRole('button',{name:'Подтвердить и открыть оплату',exact:true}).click();
  await page.getByText('Предзаказ подтверждён, оплата открыта.',{exact:true}).waitFor();
  assert.equal(calls.filter(c=>c.api==='confirm').length,1);assert.equal(calls[0].body.supplierConfirmed,true);
  Object.assign(order,{status:'paid',paymentStatus:'paid',canPay:false,canCancel:false,waitingForStock:true});
  await page.reload({waitUntil:'networkidle'});
  const allocate=page.getByRole('button',{name:'Выделить товары со склада',exact:true});await allocate.waitFor();
  assert.equal(await page.locator('[data-fulfillment-form],[data-cdek-panel],[data-delivery-override-tools],[data-carrier-test-tools]').count(),0,'paid supplier order must wait for warehouse allocation');
  await page.getByText('Оплачен · ожидает поступления товаров',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`waiting-stock-${width}.png`),fullPage:true});
  await allocate.click();await page.getByText('На складе пока недостаточно товаров.',{exact:true}).waitFor();
  assert.equal(await allocate.isVisible(),true);assert.equal(await page.locator('[data-fulfillment-form]').count(),0);
  await allocate.click();
  await page.locator('[data-workspace-error]').waitFor({state:'visible'});
  await allocate.click();
  await page.locator('[data-fulfillment-form]').waitFor();
  assert.equal(await page.getByRole('button',{name:'Выделить товары со склада',exact:true}).count(),0);
  const allocationCalls=calls.filter(c=>c.api==='allocate');assert.equal(allocationCalls.length,3);assert.deepEqual(allocationCalls[1].body,allocationCalls[2].body,'unknown allocation outcome retries the same immutable request');assert.ok(allocationCalls[1].body.idempotencyKey);
  await page.screenshot({path:path.join(output,`allocated-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(unmocked,[]);
  report.viewports.push({width,explicitSupplierConsent:true,confirmPayload:true,paidWaitingForStock:true,insufficientStockKeepsWaiting:true,sameKeyUnknownRetry:true,settledAllowsPacking:true,noOverflow:true});
  await context.close();
 }
 assert.equal(report.externalCalls,0);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
 await browser?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await fs.mkdir('artifacts/supplier-preorders',{recursive:true});await fs.writeFile('artifacts/supplier-preorders/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
