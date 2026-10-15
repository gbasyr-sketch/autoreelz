// Public markup/assets; all APIs intercepted. Candidate mode overlays only the changed CSS/JS.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||`${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`);
const base=process.env.AR_COOKIE_BASE||'https://autoreelz.ru',candidate=process.env.AR_COOKIE_CANDIDATE==='1',out=process.env.AR_COOKIE_OUTPUT||'private/cookie-banner-fix/browser';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.AR_CHROMIUM_EXECUTABLE}),report={passed:false,candidate,api:'mocked',checks:[],errors:[]};
const files=await fs.readdir('dist/client/_astro'),privacyEntry=files.find(n=>n.startsWith('PrivacyControls.')&&n.endsWith('.js'));
const routePath='/product/kryshka-avariyki-lada-priora-2007-2018';
try{
 for(const [width,height] of [[320,720],[375,900],[390,844],[600,375],[812,375],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',locale:'ru-RU'}),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));let choice=null,failChoice=false,cartWrites=0,cartIds={};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
   if(candidate&&request.isNavigationRequest()){const response=await route.fetch();let html=await response.text();html=html.replace('</head>','<style>[data-privacy]{padding-bottom:var(--privacy-clearance,0px)}html{scroll-padding-block:24px max(155px,var(--privacy-clearance,0px))}.privacy-banner{bottom:var(--privacy-bottom,24px)}@media(max-width:760px){.privacy-banner{bottom:var(--privacy-bottom,calc(76px + env(safe-area-inset-bottom)))}}</style></head>');return route.fulfill({response,body:html});}
   if(candidate&&url.pathname.startsWith('/_astro/')){let name=path.basename(url.pathname);if(name.startsWith('PrivacyControls.')&&name.endsWith('.js'))name=privacyEntry;try{return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile('dist/client/_astro/'+name)});}catch{return route.continue();}}
   if(!url.pathname.startsWith('/api/'))return request.method()==='GET'?route.continue():route.abort();
   const reply=json=>route.fulfill({json});
   if(url.pathname==='/api/commerce/session')return reply({id:'qa',csrfToken:'qa',email:null,expiresAt:'2030-01-01'});
   if(url.pathname==='/api/social/favorites')return reply({productIds:[],items:[],csrfToken:'qa'});
   if(url.pathname==='/api/commerce/cart'){if(request.method()==='POST'){cartWrites++;cartIds=request.postDataJSON();}return reply({version:cartWrites,lines:cartWrites?[{id:'qa',productId:cartIds.productId,skuId:cartIds.skuId,quantity:1}]:[],productTotalRubles:'300.00',csrfToken:'qa'});}
   if(url.pathname==='/api/privacy'){if(request.method()==='POST'){if(failChoice)return route.fulfill({status:503,json:{error:{code:'QA_NETWORK',message:'Не удалось сохранить выбор. Проверьте соединение и повторите попытку. Аналитика не включена.'}}});choice='rejected';}return reply({choice,expiresAt:choice?Date.now()+86400000:null,version:'analytics-2026-10-14-v1',enabled:false,counterId:null});}
   return route.fulfill({status:404,json:{error:{code:'QA_UNUSED',message:'Not used'}}});
  });
  const banner=page.locator('[data-privacy-banner]'),buy=page.locator('.mobile-purchase [data-add-product]');
  async function placement(){await page.waitForFunction(()=>{const b=document.querySelector('[data-privacy-banner]');const r=b.getBoundingClientRect();return [...document.querySelectorAll('.mobile-nav,.mobile-purchase')].every(n=>{const t=n.getBoundingClientRect();return !t.height||getComputedStyle(n).position!=='fixed'||r.bottom<=t.top-8;});});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
  await page.goto(base+routePath,{waitUntil:'networkidle'});await banner.waitFor();await placement();
  if(width===375){
   for(let step=0;step<85;step++){await page.keyboard.press('Tab');const covered=await page.evaluate(()=>{const e=document.activeElement;if(e===document.body)return false;const r=e.getBoundingClientRect(),top=document.elementFromPoint(Math.max(1,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(1,Math.min(innerHeight-1,r.y+r.height/2)));return !e.contains(top)&&!top?.contains(e);});if(covered){await page.screenshot({path:out+'/focus-failure.png'});report.focusFailure=await page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return{html:e.outerHTML,rect:r.toJSON(),cover:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,scrollY,clearance:getComputedStyle(document.documentElement).scrollPaddingBottom};});}assert.equal(covered,false,'Focused element covered, Tab '+step);}
   for(const size of [{width:812,height:375},{width:320,height:720},{width:375,height:900}]){await page.setViewportSize(size);await placement();}
  }
  if(await buy.isVisible()){await buy.focus();assert.equal(await buy.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);await buy.click();await page.waitForFunction(()=>document.querySelector('.mobile-purchase [data-add-product]')?.textContent.includes('Перейти в корзину'));assert.equal(cartWrites,1);await placement();}
  failChoice=true;await banner.locator('[data-privacy-reject]').click();await banner.locator('[data-privacy-status]').waitFor();await placement();
  await page.screenshot({path:`${out}/open-${width}.png`});
  failChoice=false;await banner.locator('[data-privacy-reject]').click();await banner.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--privacy-clearance').trim()),'0px');
  await page.locator('[data-privacy-settings]').click();await page.locator('[data-privacy-dialog]').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('[data-privacy-settings]').evaluate(e=>e===document.activeElement),true);
  report.checks.push({width,height,keyboardTabSteps:width===375?85:0,rotationChecked:width===375,purchaseClickable:width<=600,noticeAboveFixedBars:true,errorMessageLayout:true,dismissal:true,settingsFocus:true});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
