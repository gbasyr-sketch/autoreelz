import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID as key} from 'node:crypto';import {spawn} from 'node:child_process';import {createServer} from 'node:http';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';import {workspaceFixtures} from './helpers/manager-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const qa=await createImageDatabase('ar_qa_ai_images_refund_ui_'+key().replaceAll('-','').slice(0,12)),base='http://127.0.0.1:14361',out='private/payment-refunds/browser';await fs.mkdir(out,{recursive:true});
const actor=key();const cms=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:req.url.startsWith('/users/me')?{id:actor,first_name:'QA'}:{ar_stock:{update:{access:req.headers.cookie?.includes('=owner')?'full':'none'}}}}));});await new Promise(r=>cms.listen(14362,'127.0.0.1',r));
const server=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...imageEnvironment(qa.database,'private/payment-refunds/qa'),APP_ORIGIN:base,PORT:'14361',CMS_INTERNAL_URL:'http://127.0.0.1:14362'},stdio:'ignore'});let browser;
const report={passed:false,mockProvider:true,api:{},viewports:[]};
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 const sessionRes=await fetch(base+'/api/commerce/session'),session=await sessionRes.json(),sessionCookie=sessionRes.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),url=base+'/api/manager/payment-refunds?orderId='+key();
 assert.equal((await fetch(url,{headers:{Cookie:sessionCookie}})).status,401);
 assert.equal((await fetch(url,{headers:{Cookie:sessionCookie+'; autoreelz2026_new_session=viewer'}})).status,403);
 const headers={Cookie:sessionCookie+'; autoreelz2026_new_session=owner','Content-Type':'application/json',Origin:base};
 assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-CSRF-Token':session.csrfToken,Origin:'https://evil.invalid'},body:'{}'})).status,403);
 const valid=await fetch(url,{method:'POST',headers:{...headers,'X-CSRF-Token':session.csrfToken},body:'{}'});assert.ok([400,503].includes(valid.status));assert.match(valid.headers.get('cache-control'),/no-store/);report.api={anonymous401:true,role403:true,csrf403:true,origin403:true,noStore:true,cms:'isolated stub; real staff guard'};
 browser=await chromium.launch({executablePath:process.env.AR_CHROMIUM_EXECUTABLE||'/Users/magomedrasul/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',headless:true});
 for(const width of [1440,375])for(const mode of ['full','partial']){
  const order=workspaceFixtures().orders[0];Object.assign(order,{status:'paid',paymentStatus:'paid',deliveryStatus:'delivered',canPay:false,canCancel:false});const paymentId=key(),unsafe='<img src=x onerror="window.refundXss=true">'+('Длинное название товара '.repeat(8));
  const ws={enabled:true,payments:[{id:paymentId,amountRubles:'410.09',refundedRubles:'0.00',reservedRubles:'0.00',remainingRubles:'410.09',shippingRemainingRubles:'10.05',canRefund:true,partialAvailable:true,blockReason:null,lines:[{lineIndex:0,name:unsafe,variantLabel:'Цвет '.repeat(80),quantity:4,remainingQuantity:4,unitPriceRubles:'100.01'}]}],refunds:[]};
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),calls=[],errors=[];let lose=true;page.on('pageerror',e=>errors.push(e.message));
  const failClear=mode==='partial'&&width===375;if(failClear)await page.addInitScript(()=>{const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key.startsWith('autoreelz:refund-intent:')&&!window.refundClearFailed){window.refundClearFailed=true;throw new DOMException('QA storage unavailable','SecurityError');}return remove.call(this,key);};});
  await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),reply=(json,status=200)=>route.fulfill({status,json});
   if(u.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:'2030-01-01T00:00:00Z'});
   if(u.pathname==='/api/manager/order')return reply(order);if(u.pathname==='/api/manager/access')return reply({ok:true});
   if(u.pathname==='/api/manager/cdek-shipments')return reply({enabled:false,reason:'QA',shipments:[]});
   if(u.pathname==='/api/manager/payment-refunds'){
    if(req.method()==='GET')return reply(ws);const b=req.postDataJSON();calls.push(b);
    if(!ws.refunds.length){const amount=mode==='partial'?'210.07':'410.09',lines=mode==='partial'?[{lineIndex:0,quantity:2,unitPriceRubles:'100.01'}]:[{lineIndex:0,quantity:4,unitPriceRubles:'100.01'}];ws.refunds.push({id:key(),paymentId,amountRubles:amount,state:'queued',reason:b.reason,createdAt:new Date().toISOString(),providerId:null,selection:{version:1,mode,opaque:false,lines,shippingRubles:'10.05'}});Object.assign(ws.payments[0],{reservedRubles:amount,remainingRubles:mode==='partial'?'200.02':'0.00',shippingRemainingRubles:'0.00',canRefund:false,partialAvailable:false,blockReason:'Дождитесь результата текущего возврата.'});ws.payments[0].lines[0].remainingQuantity=mode==='partial'?2:0;order.status='manual_review';order.paymentStatus='review';}
    if(lose){lose=false;return reply({error:{message:'Ответ потерян после сохранения'}},503);}return reply({id:ws.refunds[0].id},202);
   }
   return reply({error:{message:'Unmocked '+u.pathname}},404);
  });
  await page.goto(base+'/manager/orders/'+order.id,{waitUntil:'networkidle'});let panel=page.locator('[data-refunds]');await panel.getByRole('button',{name:'Вернуть тестовый платёж'}).waitFor();
  const reason=panel.locator('textarea'),consent=panel.locator('[name=refundConfirmed]');await reason.fill('QA возврат <script>window.refundXss=true</script>');
  await consent.check();await reason.fill('QA возврат товара');assert.equal(await consent.isChecked(),false);
  if(mode==='partial'){
   await panel.locator('[name=refundMode]').selectOption('partial');assert.equal(await consent.isChecked(),false);assert.equal(await consent.isDisabled(),true);
   await panel.locator('[name=refundQuantity-0]').fill('2');await consent.check();await panel.locator('[name=refundShipping]').check();assert.equal(await consent.isChecked(),false);await panel.getByText('К возврату: 210,07 ₽',{exact:true}).waitFor();
  }
  await consent.check();await panel.screenshot({path:`${out}/form-${mode}-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await panel.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.refundXss===true),false);
  await panel.getByRole('button',{name:'Вернуть тестовый платёж'}).evaluate(b=>{b.click();b.click();});await panel.getByText(/Ответ потерян после сохранения/).waitFor();assert.equal(calls.length,1);assert.equal(await reason.getAttribute('readonly'),'');assert.equal(await panel.getByRole('button',{name:'Обновить результат'}).isDisabled(),true);
  assert.equal(calls[0].mode,mode);assert.equal(calls[0].amountRubles,mode==='partial'?'210.07':'410.09');assert.deepEqual(calls[0].lines,mode==='partial'?[{lineIndex:0,quantity:2}]:[]);assert.equal(calls[0].shippingRubles,mode==='partial'?'10.05':'0.00');
  await page.reload({waitUntil:'networkidle'});await panel.getByRole('button',{name:'Повторить тот же запрос'}).waitFor();assert.equal(await panel.locator('textarea').getAttribute('readonly'),'');assert.equal(await panel.getByRole('button',{name:'Обновить результат'}).isDisabled(),true);
  await panel.getByRole('button',{name:'Повторить тот же запрос'}).click();if(failClear){await panel.getByText(/Браузер не смог очистить локальную запись/).waitFor();assert.equal(calls.length,2);assert.equal(await panel.getByRole('button',{name:'Обновить результат'}).isDisabled(),true);await panel.getByRole('button',{name:'Повторить тот же запрос'}).click();}await page.waitForFunction(id=>sessionStorage.getItem('autoreelz:refund-intent:'+id)===null,order.id);await panel.getByText(/Ожидает отправки/).waitFor();assert.equal(calls.length,failClear?3:2);if(failClear)assert.deepEqual(calls[2],calls[0]);assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(id=>sessionStorage.getItem('autoreelz:refund-intent:'+id),order.id),null);
  ws.refunds[0].state='succeeded';Object.assign(ws.payments[0],{refundedRubles:ws.refunds[0].amountRubles,reservedRubles:'0.00',canRefund:mode==='partial',partialAvailable:mode==='partial',blockReason:null});
  await panel.getByRole('button',{name:'Обновить результат'}).click();await panel.getByText(/Возврат подтверждён/).waitFor();await page.reload({waitUntil:'networkidle'});await panel.getByText(/Возврат подтверждён/).waitFor();
  if(mode==='partial'){assert.equal(await panel.locator('form').count(),1);await panel.getByText('К возврату: 200,02 ₽',{exact:true}).waitFor();await panel.locator('[name=refundMode]').selectOption('partial');assert.equal(await panel.locator('[name=refundQuantity-0]').getAttribute('max'),'2');await panel.locator('[name=refundMode]').selectOption('full');}
  else assert.equal(await panel.locator('form').count(),0);
  await panel.screenshot({path:`${out}/done-${mode}-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await page.evaluate(()=>window.refundXss===true),false);assert.deepEqual(errors,[]);
  if(mode==='partial'){Object.assign(ws.payments[0],{canRefund:false,blockReason:'Накладная ещё в пути. Дождитесь завершения доставки.'});await panel.getByRole('button',{name:'Обновить результат'}).click();await panel.getByText('Накладная ещё в пути. Дождитесь завершения доставки.',{exact:true}).waitFor();assert.equal(await panel.locator('form').count(),0);}
  report.viewports.push({width,mode,passed:true,exactAmount:true,doubleClickBlocked:true,sameRetryKeyAcrossReload:true,storageRemovalFailureSafe:failClear,unknownRefreshBlocked:true,confirmationReset:true,reloadRestoresRemaining:true,historySelection:true,blockReason:true,textEscaped:true,noOverflow:true});await context.close();
 }
 report.passed=true;await fs.mkdir('artifacts/partial-refunds',{recursive:true});await fs.writeFile('artifacts/partial-refunds/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>cms.close(r));await qa.close(true);}
