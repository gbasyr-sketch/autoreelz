// Browser CRUD acceptance for the new CMS only. Creates and removes marked QA records.
import{createRequire}from'node:module';import{writeFileSync,mkdirSync}from'node:fs';import{spawnSync}from'node:child_process';import{env,client,root,base}from'../scripts/cms-client.mjs';const require=createRequire(import.meta.url);const{chromium}=require(process.env.PLAYWRIGHT_MODULE || (process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
process.chdir(root);
mkdirSync('tmp/stage-3',{recursive:true});mkdirSync('artifacts/stage-3',{recursive:true});const report={roles:[],created:[],errors:[],cleanup:false};const api=await client();const stamp=Date.now().toString(36);const b=await chromium.launch({channel:'chrome',headless:true});
async function dismiss(p){for(let i=0;i<3;i++){for(const name of ['Пропустить','Remind Later']){const q=p.getByRole('button',{name,exact:true});if(await q.count()&&await q.isVisible()){await q.click({force:true,timeout:2000}).catch(()=>{});await p.waitForTimeout(350);}}}}
async function login(p,role){await p.goto(base+'/admin/login',{waitUntil:'networkidle'});await p.locator('input[type=email]').fill(role==='admin'?env.ADMIN_EMAIL:env.EDITOR_EMAIL);await p.locator('input[type=password]').fill(role==='admin'?env.ADMIN_PASSWORD:env.EDITOR_PASSWORD);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForURL(url=>!url.pathname.includes('/login'));await p.waitForLoadState('networkidle');await dismiss(p);}
function field(p,name){return p.locator(`#main-content [data-field="${name}"]`).first();}
async function waitValue(p,key,value){await p.waitForFunction(({key,value})=>document.querySelector(`#main-content [data-field="${key}"] input, #main-content [data-field="${key}"] textarea`)?.value===value,{key,value});}
async function fill(p,key,value){await field(p,key).locator('input,textarea').first().fill(String(value));}
async function choose(p,key,label){const box=field(p,key);await box.locator('div.input').first().click();await p.getByText(label,{exact:true}).last().click();}
async function relation(p,key,label){const box=field(p,key);await box.getByText('Выбрать элемент...', {exact:true}).click();await p.getByText(label,{exact:true}).last().click();await p.getByRole('button',{name:'Сохранить',exact:true}).last().click();await p.waitForFunction(({key,label})=>document.querySelector(`#main-content [data-field="${key}"]`)?.textContent.includes(label),{key,label});}
async function save(p,collection,method){const [r]=await Promise.all([p.waitForResponse(r=>r.url().includes('/items/'+collection)&&r.request().method()===method),p.locator('#main-content').getByRole('button',{name:'Сохранить',exact:true}).click()]);if(!r.ok())throw new Error(`${collection} UI save ${r.status()}: ${await r.text()}`);const payload=await r.json();await p.waitForLoadState('networkidle');return payload.data;}
async function create(p,collection,setup){await p.goto(base+'/admin/content/'+collection,{waitUntil:'networkidle'});await dismiss(p);const createLink=p.locator('#main-content').getByRole('link',{name:'Создать',exact:true});if(await createLink.count())await createLink.click();else await p.locator('#main-content').getByRole('button',{name:'Создать',exact:true}).click();await p.waitForLoadState('networkidle');await setup();const data=await save(p,collection,'POST');const item=Array.isArray(data)?data[0]:data;report.created.push({collection,id:item.id});console.log('UI create',collection,item.id);return item;}
try{
for(const role of ['admin','editor']){
 const ctx=await b.newContext({viewport:{width:1440,height:1000}});const p=await ctx.newPage();p.setDefaultTimeout(10000);await login(p,role);console.log('Logged in',role);
 await p.goto(base+'/admin/content/ar_products',{waitUntil:'networkidle'});await dismiss(p);await p.getByText('ДЕМО — Автомобильная консоль',{exact:true}).last().click();await waitValue(p,'name','ДЕМО — Автомобильная консоль');const old=await field(p,'description').locator('textarea').inputValue();await fill(p,'description',`Проверка формы ${role} ${stamp}`);await save(p,'ar_products','PATCH');await p.goto(base+'/admin/content/ar_products',{waitUntil:'networkidle'});await p.getByText('ДЕМО — Автомобильная консоль',{exact:true}).last().click();await waitValue(p,'description',`Проверка формы ${role} ${stamp}`);if(await field(p,'description').locator('textarea').inputValue()!==`Проверка формы ${role} ${stamp}`)throw new Error('UI reopen did not preserve description');await p.screenshot({path:`artifacts/stage-3/${role}-edit-reopen.png`,fullPage:true});await fill(p,'description',old);await save(p,'ar_products','PATCH');console.log('Edit/reopen/restore passed',role);
 const productName=`QA ${role} товар ${stamp}`;
 const product=await create(p,'ar_products',async()=>{await fill(p,'name',productName);await fill(p,'slug',`qa-${role}-${stamp}`);await relation(p,'category_id','Блоки отопителя');});
 await p.goto(base+'/admin/content/ar_products/'+product.id,{waitUntil:'networkidle'});await waitValue(p,'name',productName);if(await field(p,'name').locator('input').inputValue()!==productName)throw new Error('Product creation reopen failed');
 const article=`QA-${role.toUpperCase()}-${stamp}`;const sku=await create(p,'ar_skus',async()=>{await relation(p,'product_id',productName);await fill(p,'article',article);await fill(p,'name','Проверка исполнения');await fill(p,'price_kopecks','125000');});
 await p.goto(base+'/admin/content/ar_skus/'+sku.id,{waitUntil:'networkidle'});await waitValue(p,'article',article);if(await field(p,'article').locator('input').inputValue()!==article)throw new Error('SKU reopen failed');await p.screenshot({path:`artifacts/stage-3/${role}-sku-created.png`,fullPage:true});
 const fitment=await create(p,'ar_fitment',async()=>{await relation(p,'product_id',productName);await relation(p,'vehicle_id','Лада Приора 1');await fill(p,'note','QA: совместимость неизвестна, не факт применимости');});
 await p.goto(base+'/admin/content/ar_fitment/'+fitment.id,{waitUntil:'networkidle'});await p.screenshot({path:`artifacts/stage-3/${role}-fitment-created.png`,fullPage:true});
 const bundleName=`QA ${role} комплект ${stamp}`;const bundle=await create(p,'ar_products',async()=>{await fill(p,'name',bundleName);await fill(p,'slug',`qa-${role}-bundle-${stamp}`);await choose(p,'kind','Готовый комплект');await relation(p,'category_id','Готовые комплекты');await fill(p,'discount_percent','5');});
 const component=await create(p,'ar_bundle_components',async()=>{await relation(p,'bundle_id',bundleName);await relation(p,'sku_id',article);await fill(p,'quantity','2');});
 await p.goto(base+'/admin/content/ar_bundle_components/'+component.id,{waitUntil:'networkidle'});await waitValue(p,'quantity','2');if(await field(p,'quantity').locator('input').inputValue()!=='2')throw new Error('Bundle composition reopen failed');await p.screenshot({path:`artifacts/stage-3/${role}-bundle-component-created.png`,fullPage:true});
 await p.goto(base+'/admin/content/ar_products',{waitUntil:'networkidle'});await p.screenshot({path:`artifacts/stage-3/${role}-catalog.png`});report.roles.push({role,edit_reopen:true,product_create:true,sku_create:true,fitment_create:true,bundle_create:true,component_create:true});await ctx.close();
}
}catch(e){report.errors.push(e.message);console.error(e.message);const pages=b.contexts().flatMap(c=>c.pages());if(pages[0]){console.log((await pages[0].locator('body').innerText()).slice(-6000));await pages[0].screenshot({path:'tmp/stage-3/crud-failure.png',fullPage:true});}process.exitCode=1;}finally{
 try{
  const productIds=[];
  for(const r of report.created){
   if(!['ar_products','ar_skus','ar_fitment','ar_bundle_components'].includes(r.collection)||!/^[-0-9a-f]{36}$/.test(r.id))throw Error('Unexpected QA record');
   if(r.collection==='ar_products'){const item=await api('GET','/items/ar_products/'+r.id);if(!item.name.startsWith('QA ')||!item.slug.startsWith('qa-'))throw Error('Refusing to delete a non-QA product');productIds.push(r.id);}
  }
  for(const r of [...report.created].reverse())await api('DELETE','/items/'+r.collection+'/'+r.id);
  if(productIds.length){
   const ids=productIds.map(id=>`'${id}'`).join(',');
   const sql=`DELETE FROM ar_slug_history WHERE entity_type='product' AND entity_id IN (${ids}) AND old_slug LIKE 'qa-%'; DELETE FROM ar_slug_registry WHERE entity_type='product' AND entity_id IN (${ids}) AND slug LIKE 'qa-%';`;
   const result=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:sql,encoding:'utf8'});
   if(result.status!==0)throw Error(result.stderr);
  }
  report.cleanup=true;
 }catch(e){report.errors.push('Cleanup: '+e.message);process.exitCode=1;}
 report.passed=report.errors.length===0&&report.roles.length===2;
 writeFileSync('artifacts/stage-3/browser-check.json',JSON.stringify(report,null,2));await b.close();
}
console.log(JSON.stringify({roles:report.roles,errors:report.errors}));
