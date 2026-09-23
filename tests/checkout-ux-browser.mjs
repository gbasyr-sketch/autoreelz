import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {qaDatabase} from './helpers/qa-db.mjs';
import {env} from '../scripts/cms-client.mjs';
import {testOrderTerms,yandexMapConsent} from '../src/lib/checkout-confirmations.ts';
const {chromium}=createRequire(import.meta.url)(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.equal(process.env.AR_CHECKOUT_UX_TESTS,'1');
const base='http://127.0.0.1:14330',out='artifacts/checkout-ux',report={checks:[],passed:false,cleanup:false};let qa,server,browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
mkdirSync(out,{recursive:true});
try{
 assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false);
 qa=await qaDatabase('checkout_ux');
 const product=randomUUID(),sku=randomUUID(),sku2=randomUUID();
 await qa.query("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,'QA корзина',$2,'00000000-0000-4000-8000-000000000001','published',true)",[product,'qa-'+product]);
 for(const id of [sku,sku2]){await qa.query("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA исполнение','100.01','published')",[id,product,id]);await qa.query('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,20,0)',[id]);}
 server=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...process.env,AR_DATABASE_NAME:qa.database,AR_DB_HOST:'127.0.0.1',AR_DB_PORT:env.DB_PORT,APP_DB_PASSWORD:env.APP_DB_PASSWORD,APP_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:base,STORE_MODE:'local-test',SHIPPING_PROVIDER:'cdek',PICKUP_MAP_PROVIDER:'yandex',YANDEX_MAPS_API_KEY:'qa-placeholder-key-no-external-traffic',PAYMENT_PROVIDER:'simulation',HOST:'127.0.0.1',PORT:'14330'},stdio:['ignore','ignore','pipe']});
 let log='';server.stderr.on('data',d=>log=(log+d).slice(-2000));
 for(let i=0;i<100;i++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;await delay(100);if(i===99)throw Error('QA server unavailable '+log);}
 browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}}),page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(path,body)=>{const s=await(await ctx.request.get(base+'/api/commerce/session')).json();const res=body?await ctx.request.post(base+path,{headers:{Origin:base,'X-CSRF-Token':s.csrfToken},data:{...body,idempotencyKey:body.idempotencyKey??randomUUID()}}):await ctx.request.get(base+path);return{status:res.status(),body:await res.json()};};
 const cart=async()=>(await api('/api/commerce/cart')).body;
 const add=async id=>{const c=await cart();assert.equal((await api('/api/commerce/cart',{productId:product,skuId:id,quantity:1,mode:'add',cartVersion:c.version})).status,200);};
 await add(sku);await add(sku2);let firstId;
 await check('rapid edits on two lines are serialized; latest quantity and focus survive delayed responses',async()=>{
  await page.goto(base+'/cart');await page.locator('.commerce-line').nth(1).waitFor();assert.equal(await page.getByRole('button',{name:'Обновить',exact:true}).count(),0);
  firstId=(await cart()).lines[0].id;
  const input=page.locator(`[data-cart-line="${firstId}"] input`),second=page.locator('.commerce-line input').nth(1);
  await page.route('**/api/commerce/cart',async route=>{if(route.request().method()==='POST'){await delay(250);}await route.continue();});
  await input.fill('2');await delay(480);await input.fill('3');await second.fill('4');await input.focus();
  await page.waitForFunction(()=>[...document.querySelectorAll('.cart-save-status')].every(n=>n.textContent===''));
  const saved=await cart();assert.equal(saved.lines.find(l=>l.id===firstId).quantity,3);assert.equal(saved.lines.find(l=>l.id!==firstId).quantity,4);assert.equal(saved.productTotalRubles,'700.07');assert.equal(await input.evaluate(n=>document.activeElement===n),true);
  await page.unroute('**/api/commerce/cart');
 });
 await check('checkout flushes a pending quantity; removal cancels its unsent draft',async()=>{
  const input=page.locator(`[data-cart-line="${firstId}"] input`);await input.fill('5');await page.getByRole('link',{name:'Перейти к оформлению',exact:true}).click();await page.waitForURL('**/checkout');assert.equal((await cart()).lines.find(l=>l.id===firstId).quantity,5);
  await page.goto(base+'/cart');await page.locator('.commerce-line').nth(1).waitFor();const second=page.locator('.commerce-line').nth(1);await second.locator('input').fill('8');await second.getByRole('button',{name:/Удалить/}).click();await page.waitForFunction(()=>document.querySelectorAll('.commerce-line').length===1);assert.equal((await cart()).lines.length,1);
  await page.locator('.commerce-line input').fill('');await page.getByRole('link',{name:'Перейти к оформлению',exact:true}).click();assert.match(page.url(),/\/cart$/);assert.equal(await page.locator('.commerce-line input').evaluate(n=>n.validationMessage),'Укажите количество.');
  await page.locator('.commerce-line input').fill('1');await page.waitForFunction(()=>document.querySelector('.cart-save-status').textContent==='');
 });
 await check('failed save has explicit retry and cannot silently proceed to checkout',async()=>{
  await page.route('**/api/commerce/cart',async route=>{if(route.request().method()==='POST')await route.abort();else await route.continue();});
  await page.locator('.commerce-line input').fill('2');await page.getByRole('button',{name:'Повторить сохранение',exact:true}).waitFor();await page.getByRole('link',{name:'Перейти к оформлению',exact:true}).click();assert.match(page.url(),/\/cart$/);
  await page.unroute('**/api/commerce/cart');await page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cart-save-status').textContent==='');assert.equal((await cart()).lines[0].quantity,2);
 });
 await check('a competing cart version is reloaded without overwriting the other tab',async()=>{
  const current=await cart(),line=current.lines[0];await api('/api/commerce/cart',{productId:line.productId,skuId:line.skuId,mode:'set',quantity:3,cartVersion:current.version});
  await page.locator('.commerce-line input').fill('4');await page.locator('[data-page-error]').filter({hasText:'Корзина изменилась'}).waitFor();assert.equal((await cart()).lines[0].quantity,3);assert.equal(await page.locator('.commerce-line input').inputValue(),'3');
 });
 await check('English browser receives Russian required, minlength and email messages',async()=>{
  await page.goto(base+'/checkout');await page.locator('#checkout-form').waitFor();const submit=page.locator('#checkout-form button[type=submit]'),name=page.locator('[name=name]');await submit.click();assert.equal(await name.evaluate(n=>n.validationMessage),'Укажите имя и фамилию.');
  await name.pressSequentially('я');await submit.click();assert.equal(await name.evaluate(n=>n.validationMessage),'Введите не менее 2 символов.');
  await name.fill('QA Покупатель');await page.locator('[name=phone]').fill('+79990000000');await page.locator('[name=email]').fill('wrong');await submit.click();assert.equal(await page.locator('[name=email]').evaluate(n=>n.validationMessage),'Введите корректный адрес электронной почты.');await page.locator('[name=email]').fill('qa@example.invalid');
 });
 await check('Yandex is not requested before explicit separate consent; list remains usable',async()=>{
  const calls=[];await page.route(/https:\/\/.*yandex\./,async route=>{calls.push(new URL(route.request().url()).hostname);await route.abort();});
  await page.route('**/api/shipping/cities?*',route=>route.fulfill({json:{items:[{code:44,name:'Москва',region:'Москва',subRegion:''}]}}));
  await page.route('**/api/shipping/points?*',route=>route.fulfill({json:{items:[{code:'MSK-QA',name:'QA',cityCode:44,city:'Москва',address:'QA, 1',workTime:'QA',latitude:55.75,longitude:37.61}],hasMore:false}}));
  await page.locator('[name=city]').fill('Москва');await page.getByRole('button',{name:'Найти город'}).click();await page.locator('[name=cityCode]').selectOption('44');await page.locator('[data-enable-map]').waitFor();await page.locator('[name=pointCode]').selectOption('MSK-QA');assert.deepEqual(calls,[]);
  assert.equal(await page.locator('[data-map-consent]').isChecked(),false);await page.locator('[data-enable-map]').click();assert.deepEqual(calls,[]);
  const before=Number((await qa.query('SELECT count(*) n FROM ar_service_consents')).rows[0].n);
  await page.locator('[data-map-consent]').check();await page.locator('[data-enable-map]').click();await page.waitForFunction(()=>document.querySelector('[data-map-status]').textContent.includes('не загрузилась'));
  assert.ok(calls.length>0);const records=(await qa.query('SELECT version,snapshot FROM ar_service_consents ORDER BY accepted_at DESC LIMIT 1')).rows;assert.equal(records[0].version,yandexMapConsent.version);assert.equal(records[0].snapshot.body,yandexMapConsent.body);assert.equal(Number((await qa.query('SELECT count(*) n FROM ar_service_consents')).rows[0].n),before+1);
  await page.locator('[name=manualDelivery]').check();await page.locator('[name=address]').fill('QA адрес, 1');
 });
 let quote,result;
 await check('checkout requires active confirmation, stores immutable exact terms and uses server time',async()=>{
  const response=page.waitForResponse(r=>r.url().endsWith('/api/commerce/quote'));await page.locator('#checkout-form button[type=submit]').click();quote=await(await response).json();assert.ok(quote.confirmation?.version);
  assert.equal(await page.locator('[data-accept-checkout]').isChecked(),false);await page.locator('[data-confirm-checkout]').click();assert.equal(await page.locator('#checkout-confirmation-error').isVisible(),true);
  for(const confirmation of [undefined,{accepted:false,version:testOrderTerms.version},{accepted:'true',version:testOrderTerms.version},{accepted:true,version:'obsolete'}]){const rejected=await api('/api/commerce/checkout',{quoteId:quote.id,cartVersion:quote.cartVersion,confirmation});assert.ok([400,409].includes(rejected.status));}
  await page.locator('[data-accept-checkout]').check();await page.screenshot({path:out+'/checkout-confirmation-desktop.png',fullPage:true});
  const res=page.waitForResponse(r=>r.url().endsWith('/api/commerce/checkout'));await page.locator('[data-confirm-checkout]').click();assert.equal((await res).status(),200);await page.waitForURL('**/orders/**');const orderId=new URL(page.url()).pathname.split('/').at(-1);result={orderIds:[orderId],orders:[(await api('/api/commerce/order?id='+orderId)).body]};assert.equal(result.orders.length,1);assert.equal(result.orders[0].confirmation.version,testOrderTerms.version);
  const stored=(await qa.query('SELECT b.confirmation,b.created_at FROM ar_checkout_batches b JOIN ar_orders o ON o.batch_id=b.id WHERE o.id=$1',[result.orders[0].id])).rows[0];assert.equal(stored.confirmation.body,testOrderTerms.body);assert.equal(stored.confirmation.version,testOrderTerms.version);assert.equal(new Date(stored.confirmation.acceptedAt).getTime(),new Date(stored.created_at).getTime());
  await assert.rejects(()=>qa.query("UPDATE ar_checkout_batches SET confirmation=confirmation || '{\"version\":\"tampered\"}'::jsonb WHERE quote_id=$1",[quote.id]),/immutable/);
  const repeat=await api('/api/commerce/checkout',{quoteId:quote.id,cartVersion:quote.cartVersion,confirmation:{accepted:true,version:testOrderTerms.version}});assert.deepEqual(repeat.body.orderIds,result.orderIds);
 });
 await check('mobile layout remains readable without the removed cookies page',async()=>{
  await page.setViewportSize({width:375,height:812});await add(sku);await page.goto(base+'/cart');await page.locator('.commerce-line').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/cart-mobile.png',fullPage:true});assert.equal(await page.locator('a[href="/cookies"]').count(),0);assert.equal((await page.goto(base+'/cookies')).status(),404);
 });
 assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;console.error(report.error);}
finally{await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}await qa?.close();report.cleanup=true;writeFileSync(out+'/browser.json',JSON.stringify(report,null,2));}
