// New local CMS only: marked QA fixtures, real browser forms, JS-disabled SSR, cleanup.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {client,env,root,base} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
process.chdir(root);mkdirSync('artifacts/stage-6',{recursive:true});mkdirSync('tmp/stage-6',{recursive:true});
const stamp=Date.now().toString(36),created=[],checks=[],errors=[];
const report={date:new Date().toISOString(),cms:base,store:'http://127.0.0.1:14323',checks,errors,cleanup:false};
const admin=await client(),browser=await chromium.launch({channel:'chrome',headless:true});
report.browser=browser.version();
const ssr=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}}),store=await ssr.newPage();
const pass=name=>{checks.push(name);console.log('PASS',name);};
const field=(p,key)=>p.locator(`#main-content [data-field="${key}"]`).first();
async function fill(p,key,value){await field(p,key).locator('input,textarea').first().fill(value);}
async function dismiss(p){for(const label of ['Пропустить','Remind Later']){const q=p.getByRole('button',{name:label,exact:true});if(await q.count()&&await q.isVisible())await q.click();}}
async function save(p,method){const [r]=await Promise.all([p.waitForResponse(r=>r.url().includes('/items/ar_categories')&&r.request().method()===method),p.locator('#main-content').getByRole('button',{name:'Сохранить',exact:true}).click()]);assert.ok(r.ok(),`UI save ${r.status()} ${await r.text()}`);return (await r.json()).data;}
async function relation(p,name){const f=field(p,'parent_id');const clear=f.locator('button.v-icon:has(i[data-icon="close"])');if(await clear.count())await clear.click();await f.getByText('Выбрать элемент...', {exact:true}).click();await p.getByText(name,{exact:true}).last().click();await p.getByRole('button',{name:'Сохранить',exact:true}).last().click();}
async function category(p,role,suffix,parent){await p.goto(base+'/admin/content/ar_categories/+',{waitUntil:'networkidle'});await dismiss(p);const name=`QA6 ${role} ${suffix} ${stamp}`;await fill(p,'name',name);await fill(p,'slug',`qa6-${role}-${suffix}-${stamp}`);if(parent)await relation(p,parent.name);await field(p,'status').locator('div.input').first().click();await p.getByText('Опубликовано',{exact:true}).last().click();const item=await save(p,'POST');created.push({collection:'ar_categories',id:item.id,slug:item.slug});return item;}
async function fixture(api,collection,data){const id=randomUUID();await api('POST','/items/'+collection,{id,...data});created.push({collection,id,...(data.slug?{slug:data.slug}:{})});return {id,...data};}
async function cat(slug){const r=await store.goto(report.store+'/catalog?category='+slug,{waitUntil:'domcontentloaded'});assert.equal(r.status(),200);}
const cards=()=>store.locator('.cat-product-grid a.card-title');
try{
 for(const role of ['admin','editor']){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage();p.setDefaultTimeout(15000);
  await p.goto(base+'/admin/login',{waitUntil:'networkidle'});await p.locator('input[type=email]').fill(role==='admin'?env.ADMIN_EMAIL:env.EDITOR_EMAIL);await p.locator('input[type=password]').fill(role==='admin'?env.ADMIN_PASSWORD:env.EDITOR_PASSWORD);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForURL(u=>!u.pathname.includes('/login'));await p.waitForLoadState('networkidle');await dismiss(p);pass(role+': real CMS login');
  const api=role==='admin'?admin:await client(env.EDITOR_EMAIL,env.EDITOR_PASSWORD);
  const a=await category(p,role,'root-a'),b=await category(p,role,'root-b'),mid=await category(p,role,'middle',a),leaf=await category(p,role,'leaf',mid);
  pass(role+': created section → category → subcategory through CMS forms');
  const x=await fixture(api,'ar_attributes',{name:`QA6 ${role} origin A`,code:`qa6_${role}_a_${stamp}`,value_type:'text',filterable:true});
  const y=await fixture(api,'ar_attributes',{name:`QA6 ${role} origin B`,code:`qa6_${role}_b_${stamp}`,value_type:'text',filterable:true});
  await fixture(api,'ar_category_attributes',{category_id:a.id,attribute_id:x.id,show_filter:true});await fixture(api,'ar_category_attributes',{category_id:b.id,attribute_id:y.id,show_filter:true});
  const product=await fixture(api,'ar_products',{name:`QA6 ${role} demonstration`,slug:`qa6-${role}-product-${stamp}`,category_id:leaf.id,status:'published',is_demo:true});
  await fixture(api,'ar_skus',{product_id:product.id,article:`QA6-${role}-${stamp}`,name:'QA6 исполнение',price_rubles:'123.45',status:'published'});
  for(const [attribute_id,text_value] of [[x.id,'alpha'],[y.id,'beta']])await fixture(api,'ar_product_attributes',{product_id:product.id,attribute_id,text_value});
  await cat(a.slug);assert.ok((await cards().getAttribute('href')).includes(product.slug));
  const leafLink=store.locator(`nav.cat-categories a[href="/catalog?category=${leaf.slug}"]`);assert.equal(await leafLink.count(),1);await leafLink.click();assert.equal(new URL(store.url()).searchParams.get('category'),leaf.slug);
  assert.deepEqual(await store.locator('.breadcrumbs a').allTextContents(),['Главная','Каталог',a.name,mid.name]);assert.equal(await store.locator(`#cat-filter-form [name="attr.${x.code}"]`).count(),1);assert.equal(await store.locator(`#cat-filter-form [name="attr.${y.code}"]`).count(),0);
  await store.locator(`#cat-filter-form [name="attr.${x.code}"]`).fill('missing');await store.getByRole('button',{name:'Применить фильтры'}).click();assert.equal(await cards().count(),0);
  await store.locator(`#cat-filter-form [name="attr.${x.code}"]`).fill('alpha');await store.getByRole('button',{name:'Применить фильтры'}).click();assert.ok(await cards().count()>0);pass(role+': real HTML navigation and inherited filter, matching/nonmatching values');
  await p.goto(base+'/admin/content/ar_categories/'+mid.id,{waitUntil:'networkidle'});
  // Standard relation field: remove current selection before choosing a new parent.
  await relation(p,b.name);await save(p,'PATCH');
  await cat(a.slug);assert.equal(await cards().count(),0);await cat(b.slug);assert.ok(await cards().count()>0);await cat(leaf.slug);
  assert.deepEqual(await store.locator('.breadcrumbs a').allTextContents(),['Главная','Каталог',b.name,mid.name]);assert.equal(await store.locator(`#cat-filter-form [name="attr.${x.code}"]`).count(),0);assert.equal(await store.locator(`#cat-filter-form [name="attr.${y.code}"]`).count(),1);
  await store.locator(`#cat-filter-form [name="attr.${y.code}"]`).fill('beta');await store.getByRole('button',{name:'Применить фильтры'}).click();assert.ok(await cards().count()>0);pass(role+': moved category with child using CMS form; SSR ancestry/results/filters changed without rebuild');
  const vehicle=(await api('GET','/items/ar_vehicles?limit=1'))[0];assert.ok(vehicle);
  await store.goto(report.store+'/catalog?category='+leaf.slug+'&vehicle='+vehicle.slug);assert.equal(await cards().count(),0);assert.ok((await store.locator('main').innerText()).includes('Подтверждённых совпадений пока нет'));
  await store.getByRole('link',{name:/Показать товары.*с неизвестной совместимостью/}).click();assert.ok(await cards().count()>0);assert.ok((await store.locator('.cat-product-grid').innerText()).includes('Совместимость уточняется'));pass(role+': unknown fitment hidden by default and explicitly marked when included');
  await store.screenshot({path:`artifacts/stage-6/cms-${role}-moved.png`,fullPage:true});
  await api('PATCH','/items/ar_categories/'+b.id,{status:'draft'});await store.goto(report.store+'/catalog');assert.equal(await store.locator('nav.cat-categories').getByText(leaf.name,{exact:true}).count(),0);assert.equal((await store.goto(report.store+'/product/'+product.slug)).status(),404);await api('PATCH','/items/ar_categories/'+b.id,{status:'published'});pass(role+': draft ancestor hides descendant navigation and product route');
  if(role==='editor'){
   for(const collection of ['ar_orders','ar_customers','ar_mail_outbox','ar_login_challenges','ar_web_sessions'])await assert.rejects(api('GET','/items/'+collection+'?limit=1'),/403/);
   await assert.rejects(api('GET','/schema/snapshot'),/403/);await assert.rejects(api('POST','/items/ar_stock',{sku_id:randomUUID(),on_hand:1}),/403/);pass('editor: private collections, schema and stock writes denied');
  }
  await ctx.close();
 }
 for(const collection of ['ar_products','ar_orders','ar_customers','ar_mail_outbox','ar_login_challenges','ar_web_sessions'])assert.equal((await fetch(base+'/items/'+collection+'?limit=1')).status,403);pass('public: catalog API and all checked private collections denied');
}catch(e){errors.push(e.message);console.error(e.stack);for(const [i,p]of browser.contexts().flatMap(c=>c.pages()).entries())await p.screenshot({path:`tmp/stage-6/cms-failure-${i}.png`,fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{
 try{
  // Delete children before parents; moving the middle node to B retains creation ordering.
  for(const r of [...created].reverse())await admin('DELETE','/items/'+r.collection+'/'+r.id);
  const slugs=created.filter(r=>r.slug);if(slugs.length){const ids=slugs.map(r=>`'${r.id}'`).join(',');const sql=`DELETE FROM ar_slug_history WHERE entity_id IN (${ids}) AND old_slug LIKE 'qa6-%'; DELETE FROM ar_slug_registry WHERE entity_id IN (${ids}) AND slug LIKE 'qa6-%';`;
   const r=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:sql,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  for(const collection of new Set(created.map(r=>r.collection))){const ids=created.filter(r=>r.collection===collection).map(r=>r.id).join(',');assert.deepEqual(await admin('GET',`/items/${collection}?filter[id][_in]=${ids}&fields=id`),[]);}
  report.cleanup=true;
 }catch(e){errors.push('Cleanup: '+e.message);console.error(e.stack);process.exitCode=1;}
 report.passed=errors.length===0;report.fixtureCount=created.length;writeFileSync('artifacts/stage-6/cms-check.json',JSON.stringify(report,null,2));await browser.close();
}
console.log(JSON.stringify(report));
