// Published checkout/client, synthetic cart/carrier replies; no orders or public tile traffic.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||`${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`);
const base=process.env.AR_MAP_URL||'https://autoreelz.ru',out=process.env.AR_MAP_OUTPUT||'artifacts/osm-map/browser';
const candidate=process.env.AR_MAP_CANDIDATE==='1';
const report={passed:false,candidate,api:'synthetic',tiles:'synthetic (no OSM tile requests)',checks:[],viewports:[]};
const browser=await chromium.launch({headless:true,...(process.env.AR_CHROMIUM_EXECUTABLE?{executablePath:process.env.AR_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});
const line={id:'qa-line',productId:'qa-product',skuId:'qa-sku',quantity:1,name:'Товар для проверки карты',article:'QA',variantLabel:'',image:'',url:'/catalog',unitPriceRubles:'1000.00',lineTotalRubles:'1000.00',available:5,kind:'ordinary',blocked:false,components:[]};
const makePoint=(code,latitude,longitude)=>({code,name:'Тестовый ПВЗ',cityCode:44,city:'Москва',address:`Тестовая улица, ${code}`,workTime:'Ежедневно 10:00–20:00',latitude,longitude});
const points=[makePoint('QA1',55.75,37.61),makePoint('QA2',55.75001,37.61001),makePoint('QA3',55.77,37.66),makePoint('QA-NO-COORDS',null,null)];
await mkdir(out,{recursive:true});
try{
 for(const width of [1440,768,375]){
  const ctx=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU',reducedMotion:'reduce',hasTouch:width===375});
  const page=await ctx.newPage(),errors=[],external=[],unexpected=[],estimates=[];let tiles=0,failTiles=false;
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname==='tile.openstreetmap.org'){
    tiles++;if(failTiles)return route.abort();
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eeeae0"/><path d="M0 80H256M100 0V256" stroke="#fff" stroke-width="15"/><text x="12" y="180" fill="#777" font-size="12">Тестовая подложка</text></svg>'});
   }
   if(url.origin!==new URL(base).origin){external.push(url.hostname);return route.abort();}
   if(candidate&&url.pathname==='/checkout'){
    const response=await route.fetch();let body=await response.text();
    body=body.replace('data-map-provider="yandex"','data-map-provider="osm"').replace(/ data-yandex-api-key="[^"]*"/g,'');
    return route.fulfill({response,body});
   }
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/commerce/session')return route.fulfill({json:{id:'qa',csrfToken:'qa',email:null,expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(url.pathname==='/api/commerce/cart'&&request.method()==='GET')return route.fulfill({json:{version:1,lines:[line],productTotalRubles:'1000.00',csrfToken:'qa'}});
   if(url.pathname==='/api/social/favorites')return route.fulfill({json:{productIds:[],items:[],csrfToken:'qa'}});
   if(url.pathname==='/api/shipping/cities')return route.fulfill({json:{items:[{code:44,name:'Москва',region:'Москва',subRegion:''},{code:442,name:'Махачкала',region:'Дагестан',subRegion:''}]}});
   if(url.pathname==='/api/shipping/points')return route.fulfill({json:{items:url.searchParams.get('cityCode')==='44'?points:[],hasMore:false}});
   if(url.pathname==='/api/commerce/delivery-estimate'){
    const data=request.postDataJSON();estimates.push(data);
    return route.fulfill({json:{cartVersion:1,delivery:data.delivery,groups:[{kind:'ordinary',lines:[line],shipping:{costRubles:'350.00'}}],productTotalRubles:'1000.00',shippingCostRubles:'350.00',totalRubles:'1350.00',expiresAt:new Date(Date.now()+300000).toISOString()}});
   }
   unexpected.push(`${request.method()} ${url.pathname}`);return route.fulfill({status:400,json:{error:{message:'Unexpected QA request'}}});
  });
  const city=page.locator('[name=city]'),selectCity=page.locator('[name=cityCode]'),selectPoint=page.locator('[name=pointCode]');
  async function chooseCity(){await city.fill('Москва');await page.getByRole('button',{name:'Найти город',exact:true}).click();await selectCity.locator('option[value="44"]').waitFor({state:'attached'});await selectCity.selectOption('44');await selectPoint.locator('option[value="QA1"]').waitFor({state:'attached'});await page.locator('.leaflet-container').waitFor();}
  await page.goto(base+'/checkout',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-pickup-map]').getAttribute('data-map-provider'),'osm');
  assert.equal(await page.locator('[data-yandex-api-key]').count(),0);assert.equal(tiles,0);
  await chooseCity();await page.locator('.pickup-marker.cluster').first().waitFor();
  assert.ok(tiles>0);assert.equal(await page.locator('[data-map-consent],[data-enable-map]').count(),0);
  assert.equal(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').isVisible(),true);
  await page.locator('.pickup-marker.cluster').first().click();
  await selectPoint.selectOption('QA1');await page.locator('.pickup-marker.selected').first().waitFor();
  // Nearby points remain a cluster until zoomed in; filtering isolates the keyboard target.
  await page.locator('[name=pointSearch]').fill('QA1');
  await page.locator('.pickup-marker.selected').focus();await page.keyboard.press('Enter');
  const choose=page.getByRole('button',{name:'Выбрать этот ПВЗ',exact:true});await choose.waitFor();
  await page.waitForTimeout(350);assert.equal(await choose.isVisible(),true,'Popup survives automatic pan');
  await choose.click();assert.equal(await page.locator('[name=selectedPointCode]').inputValue(),'QA1');
  assert.equal(await page.locator('[name=selectedPointAddress]').inputValue(),'Тестовая улица, QA1');
  await page.waitForFunction(()=>document.querySelector('[data-delivery-total]')?.getAttribute('data-delivery-total')==='350.00');
  assert.equal(estimates.at(-1).delivery.pointCode,'QA1');assert.equal('customer' in estimates.at(-1),false);
  await page.locator('[name=pointSearch]').fill('');await selectPoint.selectOption('QA3');
  await page.waitForFunction(()=>document.querySelector('[data-delivery-total]')?.getAttribute('data-delivery-total')==='350.00');
  assert.equal(estimates.at(-1).delivery.pointCode,'QA3');
  await page.locator('[data-pickup-map]').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:`${out}/map-${width}.png`});
  await page.getByRole('radio',{name:'СДЭК — доставка до двери',exact:true}).check();
  assert.equal(await page.locator('[data-point-controls]').isVisible(),false);
  await page.locator('[name=address]').fill('Тестовый адрес, 1');
  await page.waitForFunction(()=>document.querySelector('[data-delivery-total]')?.getAttribute('data-delivery-total')==='350.00');
  assert.equal(estimates.at(-1).delivery.method,'courier');assert.equal(estimates.at(-1).delivery.pointCode,undefined);
  await page.getByRole('radio',{name:'СДЭК — доставка до пункта выдачи',exact:true}).check();
  await selectCity.selectOption('442');await page.waitForFunction(()=>document.querySelector('[data-shipping-status]').textContent.includes('не найдены'));
  assert.equal(await page.locator('.pickup-marker').count(),0);
  failTiles=true;await page.reload({waitUntil:'networkidle'});await chooseCity();
  await page.waitForFunction(()=>document.querySelector('[data-map-status]').textContent.includes('недоступна'));
  await selectPoint.selectOption('QA-NO-COORDS');
  await page.waitForFunction(()=>document.querySelector('[data-delivery-total]')?.getAttribute('data-delivery-total')==='350.00');
  assert.equal(estimates.at(-1).delivery.pointCode,'QA-NO-COORDS');
  await page.locator('[name=manualDelivery]').check();assert.equal(await page.locator('[data-point-controls]').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);
  report.viewports.push({width,passed:true,tileRequestsMocked:tiles,estimateRequestsMocked:estimates.length});await ctx.close();
 }
 report.checks=['automatic OSM after city, no Yandex requests or consent gate','clusters, keyboard popup and selection, popup auto-pan','list/map code/address synchronization and delivery estimate','courier has no stale pickup code; empty city removes markers','tile failure and points without coordinates still permit list selection','manual fallback and responsive layout'];
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
