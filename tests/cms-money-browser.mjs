// Verify actual Directus price entry, both roles, persistence, and storefront propagation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {client,env,base} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const api=await client(),sku='00000000-0000-4000-8000-000000001012',route='/items/ar_skus/'+sku;
const original=await api('GET',route);assert.equal(original.article,'DEMO-CONSOLE-G');
const output='artifacts/ruble-prices';mkdirSync(output,{recursive:true});
const report={checkedAt:new Date().toISOString(),checks:[],errors:[],restored:false,passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
const testPrices=['7200.50','7200.01'];
async function dismiss(page){for(const text of ['Пропустить','Remind Later']){const button=page.getByRole('button',{name:text,exact:true});if(await button.isVisible())await button.click();}}
try{
 for(const [index,role] of ['admin','editor'].entries()){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'}),page=await ctx.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base+'/admin/login',{waitUntil:'networkidle'});
  await page.locator('input[type=email]').fill(role==='admin'?env.ADMIN_EMAIL:env.EDITOR_EMAIL);
  await page.locator('input[type=password]').fill(role==='admin'?env.ADMIN_PASSWORD:env.EDITOR_PASSWORD);
  await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('/login'));
  await page.waitForLoadState('networkidle');await dismiss(page);
  await page.goto(base+'/admin/content/ar_skus/'+sku,{waitUntil:'networkidle'});await dismiss(page);
  const price=page.locator('#main-content [data-field="price_rubles"] input');await price.waitFor();
  const expected=await api('GET',route);assert.equal(Number(await price.inputValue()),Number(expected.price_rubles));
  await price.fill(testPrices[index]);
  const response=page.waitForResponse(r=>r.url().includes(route)&&r.request().method()==='PATCH');
  await page.locator('#main-content').getByRole('button',{name:'Сохранить',exact:true}).click();assert.ok((await response).ok());
  const saved=await api('GET',route);assert.equal(saved.price_rubles,testPrices[index]);
  await page.goto(base+'/admin/content/ar_skus/'+sku,{waitUntil:'networkidle'});await price.waitFor();assert.equal(Number(await price.inputValue()),Number(testPrices[index]));
  await page.screenshot({path:`${output}/${role}-price-edit.png`,fullPage:true});
  // Resolve the actual product slug from CMS instead of relying on a hardcoded UI label.
  const product=await api('GET','/items/ar_products/'+original.product_id);
  const actual=await(await fetch(`http://127.0.0.1:14323/product/${product.slug}?sku=${sku}`)).text();
  assert.ok(actual.includes(`data-price-rubles="${testPrices[index]}"`));
  report.checks.push(`${role}: decimal rubles saved, reopened, stored exactly and visible in SSR`);
  await ctx.close();
 }
 await api('PATCH',route,{price_rubles:original.price_rubles});report.restored=true;
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'}),page=await ctx.newPage();
 await page.goto(base+'/admin/login',{waitUntil:'networkidle'});await page.locator('input[type=email]').fill(env.ADMIN_EMAIL);await page.locator('input[type=password]').fill(env.ADMIN_PASSWORD);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('/login'));await page.waitForLoadState('networkidle');await dismiss(page);
 await page.goto(base+'/admin/content/ar_skus',{waitUntil:'networkidle'});await dismiss(page);
 const content=await page.locator('#main-content').innerText();assert.ok(content.includes('Цена, ₽'));assert.ok(/7\s?200[.,]00\s*₽/.test(content));assert.ok(!content.includes('720000'));
 await page.screenshot({path:`${output}/sku-prices-rubles.png`,fullPage:true});
 report.checks.push('SKU table displays prices in rubles with the ₽ currency sign');
 assert.equal(report.errors.length,0);report.passed=true;
}finally{
 const current=await api('GET',route);
 if(testPrices.includes(current.price_rubles))await api('PATCH',route,{price_rubles:original.price_rubles});
 report.restored=(await api('GET',route)).price_rubles===original.price_rubles;
 await browser.close();writeFileSync(`${output}/cms-check.json`,JSON.stringify(report,null,2)+'\n');console.log(report);assert.ok(report.restored);
}
