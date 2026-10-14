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
 for(const width of [1440,375]){
  const order=workspaceFixtures().orders[0];Object.assign(order,{status:'paid',paymentStatus:'paid',deliveryStatus:'quoted',canPay:false,canCancel:false});const paymentId=key();const ws={enabled:true,payments:[{id:paymentId,amountRubles:'2190.10',canRefund:true}],refunds:[]};
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),calls=[],errors=[];let lose=true;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),reply=(json,status=200)=>route.fulfill({status,json});
   if(u.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:'2030-01-01T00:00:00Z'});
   if(u.pathname==='/api/manager/order')return reply(order);if(u.pathname==='/api/manager/access')return reply({ok:true});
   if(u.pathname==='/api/manager/cdek-shipments')return reply({enabled:false,reason:'QA',shipments:[]});
   if(u.pathname==='/api/manager/payment-refunds'){
    if(req.method()==='GET')return reply(ws);const b=req.postDataJSON();calls.push(b);if(!ws.refunds.length)ws.refunds.push({id:key(),paymentId,amountRubles:'2190.10',state:'queued',reason:b.reason,createdAt:new Date().toISOString(),providerId:null});ws.payments[0].canRefund=false;order.status='manual_review';order.paymentStatus='review';
    if(lose){lose=false;return reply({error:{message:'Ответ потерян после сохранения'}},503);}return reply({id:ws.refunds[0].id},202);
   }
   return reply({error:{message:'Unmocked '+u.pathname}},404);
  });
  await page.goto(base+'/manager/orders/'+order.id,{waitUntil:'networkidle'});let panel=page.locator('[data-refunds]');await panel.getByRole('button',{name:'Вернуть тестовый платёж'}).waitFor();await panel.locator('textarea').fill('QA отмена до отправки');await panel.getByRole('checkbox').check();await panel.screenshot({path:`${out}/form-${width}.png`});
  await panel.getByRole('button',{name:'Вернуть тестовый платёж'}).evaluate(b=>{b.click();b.click();});await panel.getByText('Ответ потерян после сохранения',{exact:true}).waitFor();assert.equal(calls.length,1);assert.equal(await panel.locator('textarea').getAttribute('readonly'),'');
  await panel.getByRole('button',{name:'Повторить тот же запрос'}).click();await panel.getByText(/Ожидает отправки/).waitFor();assert.equal(calls.length,2);assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);assert.deepEqual(calls[0],calls[1]);
  ws.refunds[0].state='succeeded';await panel.getByRole('button',{name:'Обновить результат'}).click();await panel.getByText(/Возврат подтверждён/).waitFor();await page.reload({waitUntil:'networkidle'});await panel.getByText(/Возврат подтверждён/).waitFor();assert.equal(await panel.locator('form').count(),0);await panel.screenshot({path:`${out}/done-${width}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);report.viewports.push({width,passed:true,doubleClickBlocked:true,sameRetryKey:true,reloadRestores:true,noOverflow:true});await context.close();
 }
 report.passed=true;await fs.mkdir('artifacts/payment-refunds',{recursive:true});await fs.writeFile('artifacts/payment-refunds/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>cms.close(r));await qa.close(true);}
