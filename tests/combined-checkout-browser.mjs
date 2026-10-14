// Full browser/API path against synthetic native PostgreSQL. No paid/external services.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base='http://127.0.0.1:14365',output=path.resolve(process.env.AR_COMBINED_OUTPUT||'private/combined-checkout/full-browser');
const report={passed:false,isolated:true,externalCalls:0,checks:[],cleanup:false};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=async(name,work)=>{await work();report.checks.push(name);console.log('PASS '+name);};
let qa,server,browser,db;
await fs.mkdir(path.join(output,'uploads'),{recursive:true});
try{
 assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false,'QA port must be free');
 qa=await createImageDatabase('ar_qa_ai_images_combined_'+key().replaceAll('-','').slice(0,12));
 const runtime={...imageEnvironment(qa.database,output),APP_ORIGIN:base,PORT:'14365'};
 Object.assign(process.env,runtime);
 db=await import('../src/server/db.ts');const orders=await import('../src/server/orders.ts');
 const query=(sql,values=[])=>qa.owner.query(sql,values),actor={id:key()},category=key();
 await query("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA','qa-combined','published')",[category]);
 async function fixture(name,stock,price){
  const productId=key(),skuId=key(),file=key(),pack=key();
  const image='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="12" fill="#ededdf"/><rect x="25" y="45" width="110" height="60" rx="8" fill="#343832"/><text x="80" y="132" text-anchor="middle" font-size="14" fill="#343832">QA</text></svg>';
  await fs.writeFile(path.join(output,'uploads',file+'.svg'),image);
  await query("INSERT INTO directus_files(id,filename_disk,type,filesize,width,height) VALUES($1,$2,'image/svg+xml',$3,160,160)",[file,file+'.svg',Buffer.byteLength(image)]);
  await query("INSERT INTO ar_packages(id,name,weight_g,length_mm,width_mm,height_mm) VALUES($1,'QA package',500,200,100,50)",[pack]);
  await query("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,$2,$3,$4,'published',true)",[productId,name,'qa-'+productId,category]);
  await query("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status,package_id) VALUES($1,$2,$3,'QA исполнение',$4,'published',$5)",[skuId,productId,'QA-'+skuId,price,pack]);
  await query('INSERT INTO ar_product_media(product_id,file_id,alt,sort) VALUES($1,$2,$3,0)',[productId,file,name]);
  await query('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,$2,0)',[skuId,stock]);
  return{productId,skuId,file,pack};
 }
 const a=await fixture('QA консоль в наличии',10,'100.01'),b=await fixture('QA дефлекторы под заказ',0,'200.02');
 await query("INSERT INTO ar_packing_rules(name,components,package_id,active) VALUES('QA mixed',$1,$2,true)",[JSON.stringify({[a.skuId]:1,[b.skuId]:1}),a.pack]);
 server=spawn(process.execPath,['dist/server/entry.mjs'],{env:runtime,stdio:['ignore','ignore','pipe']});let log='';server.stderr.on('data',d=>log=(log+d).slice(-2000));
 for(let i=0;i<100;i++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;if(i===99)throw Error('QA app unavailable '+log);await pause(100);}
 browser=await chromium.launch({headless:true,...(process.env.AR_CHROMIUM_EXECUTABLE?{executablePath:process.env.AR_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
 await ctx.route('**/*',async route=>{if(!route.request().url().startsWith(base+'/')){report.externalCalls++;return route.abort();}return route.continue();});
 async function api(route,body){const s=await(await ctx.request.get(base+'/api/commerce/session')).json();const response=body?await ctx.request.post(base+route,{headers:{Origin:base,'X-CSRF-Token':s.csrfToken},data:{...body,idempotencyKey:key()}}):await ctx.request.get(base+route);const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;}
 const cart=()=>api('/api/commerce/cart');
 async function add(item){return api('/api/commerce/cart',{productId:item.productId,skuId:item.skuId,quantity:1,mode:'add',cartVersion:(await cart()).version});}
 async function fill(){await page.locator('[name=name]').fill('QA Покупатель');await page.locator('[name=phone]').fill('+79990000000');await page.locator('[name=email]').fill('combined@example.invalid');await page.locator('[name=city]').fill('QA город');await page.locator('[name=address]').fill('QA адрес, 1');}
 async function review(){const response=page.waitForResponse(r=>r.url().endsWith('/api/commerce/quote'));await page.locator('[data-review-order]').click();const r=await response;assert.equal(r.status(),200);await page.locator('[data-quote-review]').waitFor({state:'visible'});return r.json();}
 async function confirm(){const before=(await api('/api/commerce/orders')).orders.length;await page.locator('[data-accept-checkout]').check();const response=page.waitForResponse(r=>r.url().endsWith('/api/commerce/checkout'));await page.locator('[data-confirm-checkout]').click();assert.equal((await response).status(),200);await page.waitForURL('**/orders/**');const id=new URL(page.url()).pathname.split('/').at(-1);assert.equal((await api('/api/commerce/orders')).orders.length,before+1);return api('/api/commerce/order?id='+id);}

 await check('combined page shows decoded product photos and form at 1440/768/375/812px',async()=>{
  await add(a);await add(b);await page.goto(base+'/cart');await page.locator('.commerce-line').nth(1).waitFor();await fill();
  assert.equal(await page.locator('.commerce-line img').count(),2);
  await page.waitForFunction(()=>[...document.querySelectorAll('.commerce-line img')].every(img=>img.complete&&img.naturalWidth>0));
  for(const width of [1440,768,375,812]){await page.setViewportSize({width,height:width===812?375:1000});await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'combined-'+width+'.png'),fullPage:true});}
  await page.setViewportSize({width:1440,height:1000});
 });
 await check('changing quantity invalidates review and consent, preserves contact and address, recalculates',async()=>{
  const initial=await review();assert.equal(initial.groups.length,1);assert.equal(initial.groups[0].kind,'preorder');assert.equal(await page.locator('[data-confirm-checkout]').textContent(),'Отправить на подтверждение');
  assert.equal(await page.locator('#checkout-form').isVisible(),true);assert.equal(await page.locator('.commerce-line').count(),2);
  await page.setViewportSize({width:375,height:812});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'review-375.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-accept-checkout]').check();const amount=page.locator('.commerce-line input').first();await amount.fill('2');
  assert.equal(await page.locator('[data-quote-review]').isHidden(),true);assert.equal(await page.locator('[data-accept-checkout]').isChecked(),false);assert.equal(await page.locator('[data-review-order]').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('[data-review-order]').disabled===false);
  assert.equal(await page.locator('[name=name]').inputValue(),'QA Покупатель');assert.equal(await page.locator('[name=address]').inputValue(),'QA адрес, 1');
  const changed=await review();assert.equal(changed.groups[0].productTotalRubles,'400.04');assert.equal(await page.locator('[data-accept-checkout]').isChecked(),false);
  await amount.fill('1');await page.waitForFunction(()=>document.querySelector('[data-review-order]').disabled===false);await review();
 });
 await check('late quote response after a cart edit cannot restore obsolete confirmation',async()=>{
  await page.locator('[data-edit-checkout]').click();
  let release,reached;const hold=new Promise(resolve=>release=resolve),received=new Promise(resolve=>reached=resolve);
  await page.route('**/api/commerce/quote',async route=>{const response=await route.fetch();reached();await hold;await route.fulfill({response});});
  await page.locator('[data-review-order]').click();await received;
  const amount=page.locator('.commerce-line input').first();await amount.fill('2');await page.waitForFunction(()=>document.querySelector('[data-review-order]').disabled===false);
  release();await page.locator('[data-page-error]').filter({hasText:'Корзина изменилась во время расчёта'}).waitFor();assert.equal(await page.locator('[data-quote-review]').isHidden(),true);
  await page.unroute('**/api/commerce/quote');await amount.fill('1');await page.waitForFunction(()=>document.querySelector('[data-review-order]').disabled===false);await review();
 });
 let mixed;
 await check('mixed basket creates one unpaid manager-pending order, no stock reserve',async()=>{
  mixed=await confirm();assert.equal(mixed.kind,'preorder');assert.equal(mixed.status,'preorder_pending');assert.equal(mixed.canPay,false);assert.equal(mixed.lines.length,2);assert.equal(mixed.totalRubles,'800.03');
  assert.equal(await page.locator('.payment-form').count(),0);
  assert.equal((await query('SELECT sum(reserved)::int n FROM ar_stock')).rows[0].n,0);
 });
 await check('manager confirmation opens one payment and browser settlement does not debit twice',async()=>{
  await orders.receiveStock(actor,{skuId:b.skuId,quantity:1,reason:'QA restock',idempotencyKey:key()});
  const ready=await orders.confirmPreorder(actor,{orderId:mixed.id,terms:'QA согласовано',deliveryDeadline:'2099-12-31',idempotencyKey:key()});assert.equal(ready.canPay,true);
  await page.reload();await page.locator('.payment-form').waitFor();const response=page.waitForResponse(r=>r.url().endsWith('/api/commerce/pay'));await page.locator('.payment-form button[type=submit]').click();assert.equal((await response).status(),200);
  await page.locator('.status-pill.paid').waitFor();assert.deepEqual((await query('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[a.skuId])).rows[0],{on_hand:9,reserved:0});assert.deepEqual((await query('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[b.skuId])).rows[0],{on_hand:0,reserved:0});
 });
 await check('all available basket immediately opens payment with a full reserve and one delivery',async()=>{
  await add(a);await page.goto(base+'/checkout');await page.locator('.commerce-line').waitFor();await fill();const quote=await review();assert.equal(quote.groups[0].kind,'ordinary');assert.ok(quote.groups[0].deliveryDeadline);assert.equal(await page.locator('[data-confirm-checkout]').textContent(),'Оформить тестовый заказ');
  const order=await confirm();assert.equal(order.status,'awaiting_payment');assert.equal(order.canPay,true);assert.equal(order.totalRubles,'600.01');await page.locator('.payment-form').waitFor();assert.deepEqual((await query('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[a.skuId])).rows[0],{on_hand:9,reserved:1});
  assert.equal(await page.locator('.snapshot-image').count(),1);await page.waitForFunction(()=>document.querySelector('.snapshot-image')?.naturalWidth>0);
 });
 assert.deepEqual(errors,[]);assert.equal(report.externalCalls,0);report.passed=true;
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;}
finally{
 await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 if(db)await db.getPool().end();await qa?.close(true);report.cleanup=true;await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
