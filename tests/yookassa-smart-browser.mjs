import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';import {workspaceFixtures} from './helpers/manager-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base='http://127.0.0.1:14381',out='private/yookassa-smart-20261015/browser';await fs.mkdir(out,{recursive:true});
const qa=await createImageDatabase('ar_qa_ai_images_smart_browser_'+randomUUID().replaceAll('-','').slice(0,10));
let server,browser;const report={passed:false,synthetic:true,externalProviderRequests:0,checks:[]};
try{
 const env={...imageEnvironment(qa.database,out),STORE_MODE:'production',APP_ORIGIN:'https://autoreelz.ru',PORT:'14381',SEO_INDEXING_ENABLED:'false',METRIKA_ENABLED:'false',PAYMENT_PROVIDER:'yookassa-live',YOOKASSA_LIVE_OPERATIONS_ENABLED:'true',YOOKASSA_RECEIPTS_MODE:'yookassa',YOOKASSA_LIVE_SHOP_ID:'100500',YOOKASSA_LIVE_SECRET_KEY:'qa-smart-not-a-real-key',CDEK_SHIPMENTS_MODE:'disabled'};
 server=spawn(process.execPath,['dist/server/entry.mjs'],{env,stdio:['ignore','ignore','pipe']});let log='';server.stderr.on('data',d=>log=(log+d).slice(-2000));
 for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(i===59)throw Error('Preview failed: '+log);await new Promise(r=>setTimeout(r,150));}
 browser=await chromium.launch({headless:true,executablePath:process.env.AR_CHROMIUM_EXECUTABLE||'/Users/magomedrasul/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 for(const width of [1440,375]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],commands=[];page.on('pageerror',e=>errors.push(e.message));
  const order=workspaceFixtures().orders[0];Object.assign(order,{status:'awaiting_payment',paymentStatus:'unpaid',deliveryStatus:'quoted',expiresAt:new Date(Date.now()+30*60000).toISOString(),canPay:true,canCancel:false,paymentAction:{provider:'yookassa-live',pending:false,confirmationUrl:null,canCheck:false,message:null}});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.hostname==='yookassa.ru')return route.fulfill({status:200,contentType:'text/html',body:'<h1>QA hosted payment page</h1>'});
   if(url.origin!==base)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   const reply=data=>route.fulfill({status:200,json:data});
   if(url.pathname==='/api/commerce/session')return reply({id:order.id,csrfToken:'qa',email:null,expiresAt:new Date(Date.now()+3600000).toISOString()});
   if(url.pathname==='/api/commerce/order')return reply(order);
   if(url.pathname==='/api/commerce/pay'){commands.push(req.postDataJSON());order.paymentAction={...order.paymentAction,pending:true,canCheck:true,confirmationUrl:'https://yookassa.ru/synthetic-smart-payment'};return reply(order);}
   if(url.pathname==='/api/commerce/payment-status')return reply(order);
   if(url.pathname==='/api/privacy')return reply({enabled:false,counterId:null});
   return route.fulfill({status:404,json:{error:{code:'QA_UNUSED'}}});
  });
  await page.goto(base+'/orders/'+order.id,{waitUntil:'networkidle'});let actions=page.locator('.order-actions');const pay=actions.getByRole('button',{name:'Перейти к оплате',exact:true});await pay.waitFor();assert.equal(await actions.getByRole('radio').count(),0);assert.equal(await pay.count(),1);await actions.getByText('Выберите удобный способ оплаты на защищённой странице ЮKassa.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await actions.screenshot({path:out+'/smart-'+width+'.png'});
  await pay.click();await page.waitForURL('https://yookassa.ru/synthetic-smart-payment');assert.equal(commands.length,1);assert.equal(commands[0].method,'smart');assert.equal(commands[0].orderId,order.id);assert.equal(Object.hasOwn(commands[0],'amountRubles'),false);
  await page.goto(base+'/orders/'+order.id,{waitUntil:'networkidle'});actions=page.locator('.order-actions');await actions.getByRole('link',{name:'Продолжить оплату',exact:true}).waitFor();assert.equal(await actions.getByRole('button',{name:'Перейти к оплате',exact:true}).count(),0);assert.equal(await actions.getByRole('radio').count(),0);assert.equal(commands.length,1);
  order.paymentAction={...order.paymentAction,pending:false,confirmationUrl:null,canCheck:false,provider:'yookassa-sandbox'};await page.reload({waitUntil:'networkidle'});actions=page.locator('.order-actions');await actions.getByRole('button',{name:'Перейти к тестовой оплате',exact:true}).waitFor();assert.equal(await actions.getByRole('radio').count(),0);
  order.paymentAction.provider='simulation';await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Оплатить тестово',exact:true}).waitFor();assert.equal(await page.locator('.order-actions').getByRole('radio').count(),2);assert.deepEqual(errors,[]);
  report.checks.push({width,singleSmartButton:true,noMethodRadios:true,methodChosenByProvider:true,existingPaymentContinuesWithoutNewCommand:true,sandboxSmart:true,simulationPreserved:true,noOverflow:true});await context.close();
 }
 report.passed=true;await fs.mkdir('artifacts/yookassa-smart',{recursive:true});await fs.writeFile('artifacts/yookassa-smart/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}await qa.close(true);}
