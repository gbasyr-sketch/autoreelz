import fs from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_HOME_URL||'http://127.0.0.1:14331',out=process.env.AR_HOME_OUTPUT||'artifacts/homepage/preview';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];const report={base,viewports:[],checks:[],errors};
try{
 for(const width of [1440,768,375]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.status(),200);assert.equal(await page.locator('[data-hero-slide]:visible').count(),1);
  await page.locator('[data-hero-step="1"]').click();assert.match(await page.locator('[data-hero-slide]:visible').innerText(),/Обновление салона/);
  await page.locator('[data-hero-dot="0"]').click();await page.locator('[data-hero-dot="0"]').press('ArrowRight');assert.equal(await page.locator('[data-hero-dot="1"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-hero-dot="0"]').click();
  assert.equal(await page.locator('.home-category').count(),6);assert.equal(await page.locator('[data-home-review]').count(),4);assert.equal(await page.locator('.home-article').count(),6);
  assert.ok((await page.locator('[data-home-review]').allTextContents()).every(t=>t.includes('Демонстрационный отзыв')));
  const reviewLink=await page.locator('[data-home-review] a').first().getAttribute('href');const demoText=await page.locator('[data-home-review] .review-body').first().innerText();
  for(const track of ['.home-review-track','.home-article-track']){const rail=page.locator(track);await rail.focus();await rail.press('ArrowRight');await page.waitForTimeout(150);assert.ok(await rail.evaluate(el=>el.scrollLeft>0));}
  await page.locator('.home-review-track').evaluate(el=>el.scrollLeft=0);await page.locator('.home-article-track').evaluate(el=>el.scrollLeft=0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Page overflow '+width);
  await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>{if(img.loading==='lazy')img.loading='eager';return img.decode().catch(()=>{});}));});
  const broken=await page.locator('main img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));assert.deepEqual(broken,[]);
  await page.screenshot({path:`${out}/home-${width}.png`,fullPage:true});
  await page.goto(base+reviewLink,{waitUntil:'networkidle'});assert.equal(await page.locator('[data-demo-product-review]').count(),1);assert.equal(await page.locator('[data-demo-product-review] .review-copy').innerText(),demoText);
  await page.locator('#reviews').screenshot({path:`${out}/product-review-${width}.png`});report.viewports.push({width,overflow,reviewLink});await context.close();
 }
 const page=await browser.newPage();await page.goto(base+'/blog',{waitUntil:'networkidle'});const slugs=JSON.parse(fs.readFileSync('content/homepage-articles-2026-09.json')).articles.map(a=>a.slug);
 for(const slug of slugs){const r=await page.goto(base+'/blog/'+slug,{waitUntil:'domcontentloaded'});assert.equal(r.status(),200,slug);assert.ok(await page.locator('.content-prose h2').count());}
 await page.goto(base+'/blog/obnovlenie-konsoli-priora-plan');assert.equal(await page.locator('.content-prose a[href^="https://auto.ru/"]').count(),1);
 await page.goto(base+'/blog/priora-1-v-stile-priora-2-video',{waitUntil:'networkidle'});assert.equal(await page.locator('.article-video iframe').count(),0);await page.locator('[data-load-video]').click();assert.match(await page.locator('.article-video iframe').getAttribute('src'),/^https:\/\/rutube.ru\/play\/embed\/3ec4422ba87176934bc52c201e113d0d/);
 report.checks.push('8 article pages, headings, Auto.ru attribution link, lazy RUTUBE embed');assert.deepEqual(errors,[]);report.passed=true;
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
