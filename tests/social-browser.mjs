/** Browser social acceptance against a disposable clone; no live catalog writes. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {qaDatabase} from './helpers/qa-db.mjs';
import {root,env} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
process.chdir(root);const base='http://127.0.0.1:14327',output='artifacts/stage-5';mkdirSync(output,{recursive:true});
const report={checks:[],screenshots:[],errors:[],cleanup:false,passed:false};let qa,server,browser;
const p1='00000000-0000-4000-8000-000000000100',p2='00000000-0000-4000-8000-000000000101',sku='00000000-0000-4000-8000-000000001001';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(fn,message){for(let i=0;i<100;i++){if(await fn())return;await pause(100);}throw new Error(message);}
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:error.message});throw error;}}
async function ready(page,path){await page.goto(base+path,{waitUntil:'networkidle'});}
async function api(ctx,path,body){const session=await(await ctx.request.get(base+'/api/commerce/session')).json();const response=body===undefined?await ctx.request.get(base+path):await ctx.request.post(base+path,{headers:{Origin:base,'X-CSRF-Token':session.csrfToken},data:{...body,idempotencyKey:body.idempotencyKey??randomUUID()}});return{status:response.status(),body:await response.json()};}
async function login(page,email){await ready(page,'/account');await page.locator('#request-code-form [name=email]').fill(email);const request=page.waitForResponse(r=>r.url().endsWith('/api/auth/request'));await page.locator('#request-code-form button[type=submit]').click();const result=await(await request).json();assert.ok(result.challengeId);const row=(await qa.query('SELECT body FROM ar_mail_outbox WHERE deduplication_key=$1',[`login:${result.challengeId}`])).rows[0];const code=row.body.match(/код входа: (\d{6})/i)[1];await page.locator('#verify-code-form [name=code]').fill(code);await page.locator('#verify-code-form button[type=submit]').click();await page.locator('[data-account-identity]').waitFor();}
async function responsive(page,name){for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await pause(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} overflow ${width}`);const path=`${output}/social-${name}-${width}.png`;await page.screenshot({path,fullPage:true});report.screenshots.push(path);}await page.setViewportSize({width:1440,height:1000});}
try{
 assert.equal(await fetch(base+'/').then(()=>true).catch(()=>false),false,'QA social port already occupied');
 qa=await qaDatabase('social_browser');report.database=qa.database;
 await qa.query('UPDATE ar_stock SET on_hand=greatest(on_hand,100) WHERE sku_id=$1',[sku]);
 const uploads=join(root,'tmp','social-browser',qa.database,'uploads');mkdirSync(uploads,{recursive:true});
 for(const row of(await qa.query("SELECT DISTINCT f.filename_disk FROM directus_files f JOIN(SELECT file_id FROM ar_product_media UNION SELECT file_id FROM ar_sku_media)m ON m.file_id=f.id WHERE f.storage='local'")).rows){assert.equal(basename(row.filename_disk),row.filename_disk);const result=spawnSync('docker',['compose','-p','autoreelz2026-new','cp',`cms:/directus/uploads/${row.filename_disk}`,join(uploads,row.filename_disk)],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,'Could not copy new-store QA media');}
 server=spawn(join(root,'.tools/node-v24.21.0-darwin-arm64/bin/node'),['dist/server/entry.mjs'],{cwd:root,env:{...process.env,AR_DATABASE_NAME:qa.database,APP_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:base,PORT:'14327',HOST:'127.0.0.1',STORE_MODE:'local-test',CMS_INTERNAL_URL:`http://127.0.0.1:${env.CMS_PORT||28055}`,CMS_UPLOADS_PATH:uploads},stdio:['ignore','ignore','pipe']});let logs='';server.stderr.on('data',value=>logs=(logs+value).slice(-1500));
 await waitUntil(()=>fetch(base+'/api/social/favorites').then(r=>r.ok).catch(()=>false),'Fresh social QA server did not start');
 browser=await chromium.launch({channel:'chrome',headless:true});const buyer=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'}),device=await browser.newContext(),outsider=await browser.newContext();const page=await buyer.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.setDefaultTimeout(15000);
 const email=`qa-social-browser-${Date.now()}@example.invalid`;
 await check('guest favorites merge after OTP and removals do not resurrect on another device',async()=>{
  await ready(page,'/product/heater-control');const favorite=page.locator(`[data-favorite="${p1}"]`);await favorite.click();await waitUntil(()=>favorite.getAttribute('aria-pressed').then(v=>v==='true'),'Guest favorite not selected');
  await login(page,email);await waitUntil(async()=>(await api(buyer,'/api/social/favorites')).body.productIds.includes(p1),'Guest favorites were not merged after OTP');
  await ready(page,'/favorites');assert.equal(await page.locator('.cards-grid>div:visible').count(),1);await responsive(page,'favorites');
  // Cooldown itself is covered by auth integration tests; advance only this QA clock.
  await qa.query('UPDATE ar_rate_limits SET reset_at=now()');
  const otherPage=await device.newPage();await login(otherPage,email);
  assert.equal((await api(device,'/api/social/favorites',{action:'add',productId:p2})).status,200);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitUntil(()=>page.locator('.cards-grid>div:visible').count().then(n=>n===2),'Cross-device addition not refreshed');
  assert.equal((await api(device,'/api/social/favorites',{action:'remove',productId:p1})).status,200);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitUntil(()=>page.locator('.cards-grid>div:visible').count().then(n=>n===1),'Cross-device removal not refreshed');
  await page.reload({waitUntil:'networkidle'});assert.deepEqual((await api(buyer,'/api/social/favorites')).body.productIds,[p2]);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('autoreelz-favorites-guest-v2')));assert.deepEqual(stored.ids,[]);assert.deepEqual(stored.merges,[]);
 });
 let order,reviewId,mediaId;
 await check('verified delivered buyer submits actual multipart photos and sees moderation feedback',async()=>{
  const current=await api(buyer,'/api/commerce/cart'),added=await api(buyer,'/api/commerce/cart',{productId:p1,skuId:sku,quantity:1,mode:'add',cartVersion:current.body.version});
  const quote=await api(buyer,'/api/commerce/quote',{cartVersion:added.body.version,customer:{name:'QA покупатель',phone:'+79990000000',email},delivery:{method:'pickup_point',city:'QA Москва',address:'QA ПВЗ 1'}});assert.equal(quote.status,200);
  const purchase=await api(buyer,'/api/commerce/checkout',{quoteId:quote.body.id,cartVersion:quote.body.cartVersion});order=purchase.body.orders[0];
  await qa.query("UPDATE ar_orders SET delivery_status='quoted',shipping_cost_rubles=0,status='awaiting_payment' WHERE id=$1",[order.id]);
  const paid=await api(buyer,'/api/commerce/pay',{orderId:order.id,shippingVersion:order.shippingVersion,method:'card'});assert.equal(paid.status,200);
  await qa.query("UPDATE ar_orders SET delivery_status='delivered',delivered_at=now() WHERE id=$1",[order.id]);
  await ready(page,'/product/heater-control');const form=page.locator('.js-review-form');await form.waitFor();await responsive(page,'review-form');
  await form.locator('[name=authorName]').fill('QA покупатель');await form.locator('[name=body]').fill('Проверочный отзыв браузера. Это тест интерфейса, не реальный опыт использования.');
  const photo=await sharp({create:{width:80,height:60,channels:3,background:'#CB181A'}}).withMetadata().jpeg().toBuffer();await form.locator('[name=files]').setInputFiles({name:'qa-review.jpg',mimeType:'image/jpeg',buffer:photo});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/social/reviews')&&r.request().method()==='POST');await form.locator('button[type=submit]').click();const result=await response;assert.equal(result.status(),201);reviewId=(await result.json()).id;await page.locator('[data-review-success]').waitFor();
  mediaId=(await qa.query('SELECT id FROM ar_review_media WHERE review_id=$1',[reviewId])).rows[0].id;
  assert.equal((await outsider.request.get(base+`/review-media/${mediaId}`)).status(),404);assert.equal((await outsider.request.get(base+`/review-media/${mediaId}?preview=1`)).status(),401);
  await page.reload({waitUntil:'networkidle'});await page.getByText('Ваш отзыв на проверке',{exact:true}).waitFor();assert.equal(await page.locator('.js-review-form').count(),0);await responsive(page,'review-pending');
 });
 await check('staff moderation exposes sanitized photos only after approval',async()=>{
  const admin=await browser.newContext();const loginResult=await api(admin,'/api/manager/login',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});assert.equal(loginResult.status,200);
  const pending=(await api(admin,'/api/social/moderation')).body.reviews.find(r=>r.id===reviewId);assert.ok(pending.media[0].url.endsWith('?preview=1'));
  assert.equal((await admin.request.get(base+pending.media[0].url)).status(),200);
  assert.equal((await api(outsider,'/api/social/moderation')).status,401);
  const approved=await api(admin,'/api/social/moderation',{reviewId,status:'approved',note:'QA одобрение'});assert.equal(approved.status,200);
  const publicPhoto=await outsider.request.get(base+`/review-media/${mediaId}`);assert.equal(publicPhoto.status(),200);const metadata=await sharp(await publicPhoto.body()).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('.review-photos img').count(),1);await responsive(page,'review-approved');
 });
 await check('logout and a different account cannot see the previous account favorites',async()=>{
  await ready(page,'/account');await page.locator('[data-logout]').click();await page.locator('#request-code-form').waitFor();await ready(page,'/favorites');await waitUntil(()=>page.locator('.cards-grid>div:visible').count().then(n=>n===0),'Favorites leaked after logout');
  await login(page,`qa-social-other-${Date.now()}@example.invalid`);await ready(page,'/favorites');assert.equal(await page.locator('.cards-grid>div:visible').count(),0);assert.deepEqual((await api(buyer,'/api/social/favorites')).body.productIds,[]);
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.message;console.error(error.message);process.exitCode=1;}
finally{
 await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}
 try{await qa?.close();report.cleanup=true;}catch(error){report.cleanupError=error.message;report.passed=false;process.exitCode=1;}
 writeFileSync(`${output}/social-browser.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,cleanup:report.cleanup,error:report.error}));
}
