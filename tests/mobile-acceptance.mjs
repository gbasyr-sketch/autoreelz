// Read-only, reproducible browser checks against this project's loopback storefront.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.AR_MOBILE_BASE||'http://127.0.0.1:14323';
assert.equal(new URL(base).hostname,'127.0.0.1');
assert.ok(['14323','14325'].includes(new URL(base).port),'Only new store or isolated QA');
const output=process.env.AR_MOBILE_OUTPUT||'artifacts/stage-6';mkdirSync(output,{recursive:true});
const report={timestamp:new Date().toISOString(),base,browser:null,checks:[],errors:[],screenshots:[],limits:['No screen-reader or physical-device audit; browser keyboard and DOM checks only.','No real payments, emails or mutations.']};
const browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:e.message});report.errors.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message);}}
const routes=['/','/catalog','/product/heater-control?sku=00000000-0000-4000-8000-000000001001','/cart','/account','/favorites','/blog','/cars'];
try{
 for(const width of [375,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
  for(const route of routes)await check(`${width}px ${route} layout and semantics`,async()=>{
   const response=await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(response.status(),200);
   const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,headings:document.querySelectorAll('h1').length,main:document.querySelectorAll('main').length,lang:document.documentElement.lang,badImages:[...document.images].filter(i=>!i.hasAttribute('alt')).length,unlabeled:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>e.getClientRects().length&&![...(e.labels??[])].some(label=>label.getClientRects().length)&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.name)}));
   assert.equal(state.overflow,false);assert.equal(state.headings,1);assert.equal(state.main,1);assert.equal(state.lang,'ru');assert.equal(state.badImages,0);assert.deepEqual(state.unlabeled,[]);
   if(route==='/'){const fonts=await page.evaluate(()=>({ready:document.fonts.check('600 16px Manrope','Авто Ёё ₽'),requests:performance.getEntriesByType('resource').filter(e=>/manrope.*\.(ttf|woff2)/.test(e.name)).map(e=>e.name)}));assert.equal(fonts.ready,true);assert.ok(fonts.requests.length>0);assert.ok(fonts.requests.every(url=>url.endsWith('.woff2')),'Published build must serve WOFF2');}
   if(width===375&&['/','/catalog','/cart'].includes(route)){const path=`${output}/mobile-${route==='/'?'home':route.slice(1)}.png`;await page.screenshot({path,fullPage:true});report.screenshots.push(path);}
  });
  await check(`${width}px reduced motion`,async()=>{assert.equal(await page.locator('.button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');});
  if(width===375){
   for(const [trigger,id] of [['[data-open-menu]','#menu-dialog'],['[data-open-search]','#search-dialog']])await check(`${id} focus trap, Escape, restore`,async()=>{
    await page.goto(base+'/',{waitUntil:'networkidle'});const opener=page.locator(trigger).filter({visible:true}).first();await opener.focus();await page.keyboard.press('Enter');await page.locator(id+'[open]').waitFor();
    for(let n=0;n<18;n++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(id=>document.querySelector(id).contains(document.activeElement)||document.activeElement===document.body,id),true);}
    await page.keyboard.press('Escape');assert.equal(await page.locator(id).getAttribute('open'),null);assert.equal(await opener.evaluate(e=>document.activeElement===e),true);
   });
   await check('mobile catalog filter dialog Escape restores opener',async()=>{await page.goto(base+'/catalog',{waitUntil:'networkidle'});const opener=page.locator('[data-open-catalog-filters]');await opener.click();await page.locator('#cat-filter-dialog[open]').waitFor();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#cat-filter-dialog').contains(document.activeElement)),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#cat-filter-dialog').open);assert.equal(await opener.evaluate(e=>document.activeElement===e),true);});
   await check('empty search, favorites and cart explain state',async()=>{for(const [route,pattern] of [['/catalog?q=qa-no-product-acceptance',/не найден|ничего|нет товаров/i],['/favorites',/Сохраните то, что нравится/i],['/cart',/пуст|пока нет/i]]){await page.goto(base+route,{waitUntil:'networkidle'});assert.match(await page.locator('main').innerText(),pattern);}});
   await check('email invalid form is rejected locally',async()=>{await page.goto(base+'/account',{waitUntil:'networkidle'});const input=page.locator('#request-code-form input');await input.fill('invalid');assert.equal(await input.evaluate(e=>e.checkValidity()),false);assert.equal(await input.evaluate(e=>e.labels.length),1);assert.equal(await input.evaluate(e=>getComputedStyle(e).fontSize),'16px');});
   await check('keyboard focus remains visible above sticky navigation',async()=>{
    for(const route of ['/','/catalog','/product/heater-control']){
     await page.goto(base+route,{waitUntil:'networkidle'});
     for(let n=0;n<80;n++){
      await page.keyboard.press('Tab');
      const covered=await page.evaluate(()=>{const e=document.activeElement;if(e===document.body)return false;const r=e.getBoundingClientRect(),top=document.elementFromPoint(Math.max(1,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(1,Math.min(innerHeight-1,r.y+r.height/2)));return !e.contains(top)&&!top?.contains(e);});
      assert.equal(covered,false,route+' keyboard step '+n);
     }
    }
   });
   await check('skip link keyboard focus visible',async()=>{await page.goto(base+'/',{waitUntil:'networkidle'});await page.keyboard.press('Tab');assert.equal(await page.locator('.skip-link').evaluate(e=>document.activeElement===e),true);assert.equal(await page.locator('.skip-link').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>location.hash),'#main');});
  }
  await check(`${width}px no uncaught JS errors`,async()=>assert.deepEqual(jsErrors,[]));await context.close();
 }
 await check('slow modules do not flash the mobile sidebar or shift catalog results',async()=>{
  const slowContext=await browser.newContext({viewport:{width:375,height:900}}),slowPage=await slowContext.newPage();let release;const gate=new Promise(resolve=>{release=resolve;});
  await slowPage.route('**/_astro/*.js',async route=>{await gate;await route.continue();});
  try{
   await slowPage.goto(base+'/catalog',{waitUntil:'commit'});await slowPage.locator('.cat-results').waitFor();
   await slowPage.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   assert.equal(await slowPage.locator('.cat-sidebar').isVisible(),false);
   assert.equal(await slowPage.locator('[data-open-catalog-filters]').isVisible(),true);
   const before=await slowPage.locator('.cat-results').boundingBox();release();await slowPage.waitForLoadState('networkidle');
   const after=await slowPage.locator('.cat-results').boundingBox();assert.ok(Math.abs(after.y-before.y)<=1,`Results shifted ${after.y-before.y}px when modules loaded`);
   await slowPage.locator('[data-open-catalog-filters]').click();await slowPage.locator('#cat-filter-dialog[open]').waitFor();
  }finally{release();await slowContext.close();}
 });
 const context=await browser.newContext({viewport:{width:375,height:900},javaScriptEnabled:false}),p=await context.newPage();
 await check('no-JS catalog retains native search and filters',async()=>{await p.goto(base+'/catalog');assert.ok(await p.locator('form input[name=q]').count());assert.ok(await p.locator('form select').count());assert.match(await p.locator('body').innerText(),/без JavaScript/);});await context.close();
}finally{await browser.close();report.passed=report.errors.length===0;writeFileSync(output+'/mobile-browser.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}
