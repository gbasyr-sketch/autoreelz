import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {emptyProduct,emptyVariant} from '../src/lib/product-editor.ts';
import {bundlePreview} from './helpers/bundle-preview.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_MAIN_PHOTO_URL||'https://autoreelz.ru',out=process.env.AR_MAIN_PHOTO_OUTPUT||'artifacts/product-main-photo/preview';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.AR_CHROMIUM_EXECUTABLE||'/Applications/Yandex.app/Contents/MacOS/Yandex'});
const report={passed:false,mockedApi:true,candidate:process.env.AR_MAIN_PHOTO_PUBLIC!=='1',viewports:[]};
try{for(const width of [1440,768,375]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],calls=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('dialog',d=>d.accept());
 const photo=label=>({id:uuid(),alt:label}),old=photo('Исходное фото'),cover=photo('Новая обложка'),red=photo('Красный'),blue=photo('Синий'),category=uuid(),id=uuid();
 const variants=[{...emptyVariant(uuid()),name:'Красный',article:'RED',price:'100.00',mediaMode:'replace',photos:[red]},{...emptyVariant(uuid()),name:'Синий',article:'BLUE',price:'120.00',mediaMode:'replace',photos:[blue,cover]},{...emptyVariant(uuid()),name:'Белый',article:'WHITE',price:'150.00'}];
 const state={id,version:1,baseHash:'qa',data:{...emptyProduct(),name:'QA Панель',slug:'qa-panel',categoryId:category,photos:[old,cover],variants},hasDraft:false,live:true,existingSkuIds:variants.map(v=>v.id),stock:{}};
 if(report.candidate)await bundlePreview(page);
 let fail=false;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),api=url.pathname.split('/').at(-1),reply=(json,status=200)=>route.fulfill({status,json});
  if(api==='session')return reply({id:uuid(),csrfToken:'qa',expiresAt:'2030-01-01T00:00:00Z'});
  if(api==='product-ai')return reply({enabled:false,budget:{limitUsd:'10',remainingUsd:'10',committedUsd:'0'}});
  if(api==='product-image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#eeeae3"/><rect x="80" y="100" width="440" height="200" rx="20" fill="#222"/><text x="130" y="215" fill="white" font-size="40">QA PHOTO</text></svg>'});
  if(api==='product-editor'){
   if(req.method()==='GET')return reply(url.searchParams.has('options')?{categories:[{id:category,name:'Панели',parentId:null,status:'published'}],attributes:[],vehicles:[]}:state);
   const body=req.postDataJSON();calls.push(body);if(fail){fail=false;return reply({error:{message:'QA сбой сохранения'}},503);}state.data=structuredClone(body.data);state.version++;state.hasDraft=body.action==='draft';return reply({id,version:state.version,action:body.action,slug:state.data.slug});
  }
  return reply({error:{message:'Unexpected API '+api}},500);
 });
 await page.goto(base+'/manager/products/edit?id='+id,{waitUntil:'networkidle'});await page.locator('#pe-name').waitFor();
 const dialog=page.locator('[data-main-photo-dialog]'),common=page.locator('[data-editor-photos]');
 const choose=id=>common.locator(`[data-photo-id="${id}"] [data-make-main]`).click();
 await choose(cover.id);await dialog.waitFor({state:'visible'});
 assert.equal(await dialog.locator('input[value=all]').isChecked(),true);
 assert.equal(await page.locator('[data-save-draft]').isDisabled(),true);
 await dialog.screenshot({path:`${out}/scope-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await common.locator('.pe-photo').first().getAttribute('data-photo-id'),old.id);assert.equal(calls.length,0);
 await choose(cover.id);await dialog.locator('[data-pm-apply]').click();await dialog.waitFor({state:'hidden'});
 assert.equal(await common.locator('.pe-photo').first().getAttribute('data-photo-id'),cover.id);assert.equal(calls.length,0);
 fail=true;await page.locator('[data-save-draft]').click();await page.getByText('QA сбой сохранения',{exact:true}).waitFor();await page.locator('[data-save-draft]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-status]').textContent.includes('Открыт сохранённый черновик'));
 assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);assert.equal(calls[1].action,'draft');
 assert.deepEqual(state.data.variants.map(v=>v.photos.map(p=>p.id)),[[cover.id,red.id],[cover.id,blue.id],[]]);assert.equal(state.data.variants[2].mediaMode,'inherit');
 await page.reload({waitUntil:'networkidle'});await page.locator('#pe-name').waitFor();
 await choose(old.id);await dialog.locator('input[value=variant]').check();await dialog.locator('[data-pm-variant]').selectOption(variants[2].id);await dialog.locator('[data-pm-apply]').click();await dialog.waitFor({state:'hidden'});
 await page.locator('[data-save-draft]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Черновик сохранён');
 assert.deepEqual(state.data.photos.map(p=>p.id),[cover.id,old.id]);assert.deepEqual(state.data.variants[2].photos.map(p=>p.id),[old.id,cover.id]);assert.equal(state.data.variants[2].mediaMode,'replace');assert.deepEqual(state.data.variants[0].photos.map(p=>p.id),[cover.id,red.id]);
 // Opening from a variant selects that variant, and cancel does not save anything.
 await page.locator('.pe-variant').nth(2).getByText('Фотографии и характеристики этого варианта',{exact:true}).click();
 await page.locator('.pe-variant').nth(2).locator('[data-make-main]').first().click();assert.equal(await dialog.locator('input[value=variant]').isChecked(),true);assert.equal(await dialog.locator('[data-pm-variant]').inputValue(),variants[2].id);await dialog.locator('[data-pm-cancel]').click();
 const before=structuredClone(state.data);state.data.variants[1].photos=Array.from({length:12},(_,i)=>photo('Full '+i));await page.reload({waitUntil:'networkidle'});await page.locator('#pe-name').waitFor();await choose(old.id);await dialog.locator('[data-pm-apply]').click();await dialog.locator('[data-pm-error]').waitFor({state:'visible'});assert.match(await dialog.locator('[data-pm-error]').innerText(),/Синий.*12 фото/);await dialog.locator('[data-pm-cancel]').click();assert.equal(await common.locator('.pe-photo').first().getAttribute('data-photo-id'),cover.id);
 state.data=before;await page.reload({waitUntil:'networkidle'});await page.locator('#pe-name').waitFor();await page.locator('[data-publish-product]').click();await page.waitForFunction(()=>document.querySelector('[data-editor-save-hint]').textContent==='Данные загружены');assert.equal(calls.at(-1).action,'publish');assert.deepEqual(calls.at(-1).data,before);
 assert.deepEqual(errors,[]);report.viewports.push({width,passed:true});await context.close();
 }report.passed=true;
}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
