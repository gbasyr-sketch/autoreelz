import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {localConfig} from './helpers/ai-image-qa.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=process.env.AR_IMAGE_PREVIEW_DIR||'private/ai-image-local/preview',out=process.env.AR_AI_IMAGE_BROWSER_OUTPUT||'artifacts/ai-image-studio/browser';
const fixture=JSON.parse(await fs.readFile(root+'/fixture.json','utf8')),base=`http://127.0.0.1:${localConfig.webPort}`;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.AR_CHROMIUM_EXECUTABLE?{executablePath:process.env.AR_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});
const report={passed:false,provider:'simulation',externalCalls:0,viewports:[],checks:[]};
try{
 for(const width of [1440,375]){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/manager/products/edit?id=${fixture.product}`,{waitUntil:'networkidle'});
  await page.locator('[data-workspace-login]').waitFor({state:'visible'});
  await page.locator('[name=email]').fill(fixture.email);await page.locator('[name=password]').fill(fixture.password);await page.locator('[data-workspace-login-form] button').click();
  await page.locator('#pe-name').waitFor();await page.locator('[data-open-ai-infographic]').click();
  const dialog=page.locator('[data-ai-image-studio]');await dialog.waitFor({state:'visible'});
  assert.match(await dialog.locator('[data-aii-budget]').innerText(),/без ИИ/);
  assert.match(await dialog.locator('[data-aii-confirm-copy]').innerText(),/без передачи данных во внешний сервис/);
  if(width===1440){
   await dialog.locator('[data-aii-gallery] button').first().click();
   await dialog.locator('[data-aii-gallery] input[type=checkbox]:checked').waitFor();
   await dialog.locator('[data-aii-preview]').click();await dialog.locator('[data-aii-cost]').waitFor({state:'visible'});
   assert.match(await dialog.locator('[data-aii-estimate]').innerText(),/Оценка: \$.*Резерв бюджета/);
   await dialog.locator('[data-aii-confirm]').check();await dialog.locator('[data-aii-generate]').click();
   await page.waitForFunction(()=>document.querySelector('[data-aii-result]')?.hidden===false,{timeout:30000});
   await page.waitForFunction(()=>{const image=document.querySelector('[data-aii-result]');return image?.complete&&image.naturalWidth===1536;},{timeout:15000});
   const firstResult=await dialog.locator('[data-aii-result]').getAttribute('src');assert.ok(firstResult);
   await dialog.locator('[data-aii-close]').click();await page.locator('[data-open-ai-infographic]').click();
   const reopened=page.locator('[data-ai-image-studio]');await reopened.locator('.aii-job').first().getByRole('button',{name:'Посмотреть'}).click();
   assert.equal(await reopened.locator('[data-aii-result]').getAttribute('src'),firstResult);
   assert.equal(await reopened.locator('[data-aii-placeholder]').isVisible(),false);
   const [download]=await Promise.all([page.waitForEvent('download'),reopened.locator('[data-aii-download]').click()]);assert.equal(download.suggestedFilename(),'autoreelz-slide.png');
   await reopened.locator('[data-aii-reviewed]').check();await reopened.locator('[data-aii-cover]').click();
   await reopened.locator('[data-aii-anchor] option').filter({hasText:'Обложка №'}).waitFor();
   const coverId=await reopened.locator('[data-aii-anchor]').inputValue();assert.ok(coverId);
   await reopened.locator('[data-aii-type]').selectOption('features');assert.equal(await reopened.locator('[data-aii-headline]').inputValue(),'Характеристики');
   await reopened.locator('[data-aii-preview]').click();await reopened.locator('[data-aii-cost]').waitFor({state:'visible'});
   await reopened.locator('[data-aii-cost] summary').click();assert.match(await reopened.locator('[data-aii-prompt]').innerText(),/STYLE ONLY/);
   await reopened.locator('[data-aii-confirm]').check();await reopened.locator('[data-aii-generate]').click();
   await page.waitForFunction(()=>{const items=[...document.querySelectorAll('.aii-job')];return items.some(item=>item.innerText.includes('Характеристики')&&item.querySelector('img'));},{timeout:30000});
   const feature=reopened.locator('.aii-job').filter({hasText:'Характеристики'}).first();await feature.locator('input[type=checkbox]').check();await reopened.locator('[data-aii-reviewed]').check();await reopened.locator('[data-aii-apply]').click();
   await reopened.locator('[data-aii-apply-status]').getByText('Добавлено в форму товара').waitFor();
   assert.equal(await page.locator('[data-editor-photos] .pe-photo').count(),3);
   await page.locator('[data-aii-close]').click();await page.locator('[data-save-draft]').click();
   await page.waitForFunction(()=>document.querySelector('[data-editor-status]')?.textContent.includes('сохранённый черновик'),{timeout:15000});
   await page.screenshot({path:`${out}/studio-${width}.png`,fullPage:true});
  }else{
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
   assert.ok(await dialog.locator('[data-aii-gallery]').isVisible());
   await page.screenshot({path:`${out}/studio-${width}.png`,fullPage:true});
   await dialog.locator('[data-aii-close]').click();
  }
  assert.deepEqual(errors,[]);report.viewports.push({width,passed:true});await context.close();
 }
 report.checks=['manager login and product editor','gallery photo import','price quote and explicit paid confirmation','background simulation survives generation UI','original/result review and PNG download','approved cover anchors later slide style','feature slide generation','reviewed result applies only to unsaved form','explicit save remains a draft','mobile modal has no horizontal overflow'];report.passed=true;
}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
