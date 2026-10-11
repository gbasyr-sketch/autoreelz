// Uses the isolated local preview CMS/database; never saves a production product.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID as uuid} from 'node:crypto';
import {localConfig} from './helpers/ai-image-qa.mjs';import {emptyVariant} from '../src/lib/product-editor.ts';
const root=process.env.AR_VIDEO_PREVIEW_DIR||'private/product-video-20261011/preview',fixture=JSON.parse(await fs.readFile(root+'/fixture.json','utf8'));
const base='http://127.0.0.1:'+localConfig.webPort,out=process.env.AR_VIDEO_OUTPUT||'private/product-video-20261011/browser';await fs.mkdir(out,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:process.env.AR_CHROMIUM_EXECUTABLE||'/Applications/Yandex.app/Contents/MacOS/Yandex'});
const video='https://rutube.ru/video/3ec4422ba87176934bc52c201e113d0d/?r=wd',report={passed:false,isolated:true,realManagerApi:true,externalPlayerMocked:true,viewports:[]};
try{for(const width of [1440,768,375]){
 const ctx=await browser.newContext({viewport:{width,height:1000}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const session=await(await ctx.request.get(base+'/api/commerce/session')).json(),headers={Origin:base,'X-CSRF-Token':session.csrfToken};
 assert.equal((await ctx.request.get(base+'/api/manager/product-editor?id='+fixture.product)).status(),401);
 assert.equal((await ctx.request.post(base+'/api/manager/login',{headers,data:{email:fixture.email,password:fixture.password}})).status(),200);
 const read=async()=> (await ctx.request.get(base+'/api/manager/product-editor?id='+fixture.product)).json();
 const save=async(state,action='publish',extraHeaders=headers)=>ctx.request.post(base+'/api/manager/product-editor',{headers:extraHeaders,data:{id:state.id,version:state.version,baseHash:state.baseHash,data:state.data,action,idempotencyKey:uuid()}});
 let state=await read();state.data.videoUrl='';state.data.name='QA Видео товара';state.data.variants[0].price='100.50';if(state.data.variants.length===1)state.data.variants.push({...emptyVariant(uuid()),name:'Другой цвет',article:'QA-VIDEO-OTHER',price:'120.50'});
 assert.equal((await save(state,'publish',{...headers,'X-CSRF-Token':'bad'})).status(),403);
 assert.equal((await save(state,'publish',{...headers,Origin:'https://example.invalid'})).status(),403);
 assert.equal((await save(state)).status(),200);
 let external=0;await page.route(/https:\/\/(rutube\.ru|vkvideo\.ru)\//,async route=>{external++;await route.fulfill({contentType:'text/html',body:'<html><body style="background:#171713;color:white;font:20px sans-serif;display:grid;place-items:center;height:90vh">Тестовый плеер</body></html>'});});
 await page.goto(base+'/manager/products/edit?id='+fixture.product,{waitUntil:'networkidle'});await page.locator('#pe-videoUrl').waitFor();
 await page.locator('#pe-videoUrl').fill(video);assert.equal(external,0);await page.getByRole('button',{name:'Проверить видео',exact:true}).click();
 const dialog=page.locator('[data-product-video-dialog]');await dialog.locator('iframe').waitFor();assert.match(await dialog.locator('iframe').getAttribute('src'),/autoplay=false$/);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await dialog.locator('iframe').waitFor({state:'detached'});assert.equal(await dialog.locator('iframe').count(),0);
 await page.locator('[data-save-draft]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Черновик сохранён');
 assert.equal((await(await ctx.request.get(base+'/product/local-image-pilot')).text()).includes('data-product-video='),false);
 await page.reload({waitUntil:'networkidle'});await page.locator('#pe-videoUrl').waitFor();assert.equal(await page.locator('#pe-videoUrl').inputValue(),video);
 await page.locator('[data-publish-product]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Данные загружены');
 state=await read();const photoIds=state.data.photos.map(p=>p.id);assert.equal(state.data.variants.length,2);
 for(const variant of state.data.variants){
  const before=external;await page.goto(base+'/product/local-image-pilot?sku='+variant.id,{waitUntil:'networkidle'});assert.equal(external,before);assert.equal(await page.locator('[data-product-video]').count(),1);assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.locator('[data-gallery-src]').count(),photoIds.length);await page.locator('[data-gallery-src]').nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('[data-gallery-src]')[1]?.getAttribute('aria-pressed')==='true');const imageBefore=await page.locator('#product-image').getAttribute('src');
  const play=page.locator('[data-product-video]');await play.focus();await page.keyboard.press('Enter');await dialog.locator('iframe').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await dialog.screenshot({path:`${out}/player-${width}.png`});
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.waitFor({state:'hidden'});await dialog.locator('iframe').waitFor({state:'detached'});assert.equal(await dialog.locator('iframe').count(),0);assert.equal(await page.locator('#product-image').getAttribute('src'),imageBefore);
 }
 await page.goto(base+'/manager/products/edit?id='+fixture.product,{waitUntil:'networkidle'});await page.locator('#pe-videoUrl').waitFor();await page.locator('#pe-videoUrl').fill('https://example.invalid/video');assert.equal(await page.getByRole('button',{name:'Проверить видео',exact:true}).isDisabled(),true);await page.locator('[data-publish-product]').click();await page.locator('[data-editor-errors]').waitFor({state:'visible'});
 await page.locator('#pe-videoUrl').fill('https://vk.com/video-123_456');await page.getByRole('button',{name:'Проверить видео',exact:true}).click();await dialog.locator('iframe').waitFor();assert.equal(await dialog.locator('iframe').getAttribute('src'),'https://vkvideo.ru/video_ext.php?oid=-123&id=456&autoplay=0');await page.keyboard.press('Escape');
 await page.locator('[data-editor-video]').screenshot({path:`${out}/editor-${width}.png`});await page.getByRole('button',{name:'Убрать видео',exact:true}).click();assert.equal(await page.locator('#pe-videoUrl').inputValue(),'');await page.locator('[data-save-draft]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Черновик сохранён');assert.ok((await(await ctx.request.get(base+'/product/local-image-pilot')).text()).includes('data-product-video='));
 await page.locator('[data-publish-product]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Данные загружены');assert.equal((await(await ctx.request.get(base+'/product/local-image-pilot')).text()).includes('data-product-video='),false);
 assert.equal((await ctx.request.post(base+'/api/manager/logout',{headers,data:{}})).status(),200);assert.deepEqual(errors,[]);report.viewports.push({width,passed:true});await ctx.close();
 }report.passed=true;
}finally{await browser.close();await fs.mkdir('artifacts/product-video',{recursive:true});await fs.writeFile('artifacts/product-video/browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
