import fs from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_HOME_URL||'http://127.0.0.1:14331',out=process.env.AR_HOME_OUTPUT||'private/homepage-cleanup/browser';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.AR_CHROMIUM_EXECUTABLE?{executablePath:process.env.AR_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});const errors=[],report={base,viewports:[],errors};
try{
 for(const width of [1440,768,375]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===new URL(base).origin?route.continue():route.abort();});
  const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  assert.equal(await page.locator('.hero-slide:visible').count(),1);assert.equal(await page.locator('.hero-controls').count(),0);
  assert.doesNotMatch(await page.locator('main').innerText(),/Изображение-заглушка|Демонстрационный отзыв|вымышленные примеры/);
  assert.equal(await page.locator('.home-hero img[src*="placeholder"]').count(),0);
  const productLink=await page.locator('a[href^="/product/"]').first().getAttribute('href');
  assert.doesNotMatch(await page.locator('#search-dialog').textContent(),/DEMO-/);
  if(await page.locator('[data-open-search]').isVisible()){
   await page.locator('[data-open-search]').click();await page.locator('#search-dialog').waitFor({state:'visible'});await page.locator('#search-dialog input').fill('отопитель');await page.locator('#search-dialog form button').click();
  }else{await page.locator('.header-search input').fill('отопитель');await page.locator('.header-search button').click();}
  await page.waitForURL(/\/catalog\?q=/);assert.equal(new URL(page.url()).searchParams.get('q'),'отопитель');
  await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});}));});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(await page.locator('main img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)),[]);
  await page.screenshot({path:`${out}/home-${width}.png`,fullPage:true});
  await page.goto(new URL(productLink,base).href,{waitUntil:'networkidle'});assert.equal(await page.locator('[data-demo-product-review]').count(),0);assert.doesNotMatch(await page.locator('main').innerText(),/Демонстрационный отзыв|Вымышленный пример/);
  report.viewports.push({width,passed:true});await context.close();
 }
 assert.deepEqual(errors,[]);report.passed=true;
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
