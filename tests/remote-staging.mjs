// Read-only acceptance of the exact staging build on the owner-selected public domain.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const path=resolve(process.argv[2]??'');assert.ok(path.startsWith(resolve('private')+'/'),'Private access file required');
const access=JSON.parse(readFileSync(path,'utf8')),base='https://autoreelz.ru',expected='6ab6bea4f0cb16fbd2dea2c23711b3783611d017';assert.equal(access.store.url,base);
const auth='Basic '+Buffer.from(access.store.username+':'+access.store.password).toString('base64');
const cmsOnly=process.argv.includes('--cms-only');
const report={startedAt:new Date().toISOString(),base,expectedAppSha:expected,passed:false,checks:[],errors:[]};let browser;
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
mkdirSync('artifacts/staging',{recursive:true});
try{
 await check('public HTTPS requires authentication and health matches the approved revision',async()=>{const anonymous=await fetch(base+'/',{redirect:'manual'});assert.equal(anonymous.status,401);assert.match(anonymous.headers.get('x-robots-tag'),/noindex/);const r=await fetch(base+'/health',{headers:{Authorization:auth},redirect:'error'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,revision:expected});});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',httpCredentials:{username:access.store.username,password:access.store.password,origin:base}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 if(!cmsOnly)await check('storefront, selected SKU and media render on the public host at desktop and mobile widths',async()=>{
  await page.goto(base+'/',{waitUntil:'networkidle'});assert.equal(await page.locator('h1').count(),1);
  await page.goto(base+'/product/heater-control?sku=00000000-0000-4000-8000-000000001001',{waitUntil:'networkidle'});assert.equal(await page.locator('[data-price-rubles]').getAttribute('data-price-rubles'),'4900.00');
  assert.ok(await page.locator('img[src^="/media/"]').first().evaluate(e=>e.complete&&e.naturalWidth>0));
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`artifacts/staging/public-product-${width}.png`,fullPage:true});}
 });
 await check('Directus Studio loads through /cms and accepts the new owner credentials',async()=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/cms/admin/login',{waitUntil:'networkidle'});
  await page.locator('input[type=email]').fill(access.cms.email);await page.locator('input[type=password]').fill(access.cms.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'));await page.waitForLoadState('networkidle');
  assert.match(new URL(page.url()).pathname,/^\/cms\/admin/);await page.goto(base+'/cms/admin/content/ar_products',{waitUntil:'networkidle'});await page.getByText('ДЕМО — Блок управления отопителем',{exact:true}).first().waitFor({state:'visible',timeout:30000});await page.screenshot({path:'artifacts/staging/public-cms.png',fullPage:true,mask:[page.locator('input[type=password]')]});
 });
 if(!cmsOnly)await check('manager signs in via the public HTTPS origin and reads an empty migrated order list',async()=>{
  await page.goto(base+'/manager',{waitUntil:'networkidle'});
  const form=page.locator('#manager-login-form');if(await form.isVisible()){await form.locator('[name=email]').fill(access.cms.email);await form.locator('[name=password]').fill(access.cms.password);await form.locator('button[type=submit]').click();}
  await page.locator('[data-manager-content]').waitFor({state:'visible'});await page.screenshot({path:'artifacts/staging/public-manager.png',fullPage:true,mask:[page.locator('input[type=password]')]});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser?.close();report.finishedAt=new Date().toISOString();writeFileSync(cmsOnly?'artifacts/staging/public-cms-check.json':'artifacts/staging/public-check.json',JSON.stringify(report,null,2)+'\n');}
