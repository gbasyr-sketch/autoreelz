import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {chromium}=await import('/Users/magomedrasul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.AR_PURGE_URL||'http://127.0.0.1:14340',out=process.env.AR_PURGE_OUTPUT||'artifacts/product-purge';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.AR_BROWSER_PATH?{executablePath:process.env.AR_BROWSER_PATH}:{channel:'chrome'})}),report={passed:false,mockedApi:true,viewports:[]};
try{for(const width of [1440,768,375]){
 const ctx=await browser.newContext({viewport:{width,height:1000}}),page=await ctx.newPage(),parent=randomUUID(),child=randomUUID(),other=randomUUID(),calls=[],errors=[];
 const item=(name,category_id,category_ids=[])=>({id:randomUUID(),name,slug:'qa-'+randomUUID(),status:'published',kind:'single',is_demo:false,category_id,category_ids});
 const products=[item('QA Потомок',child),item('QA Дополнительная',other,[child]),item('QA Без категории',null),item('QA Другая',other)],drafts=[{id:randomUUID(),name:'QA Черновик потомка',category_id:child},{id:randomUUID(),name:'QA Черновик другой',category_id:other}];
 let deleted=[item('QA Удалённый потомок',child),item('QA Удалённый другой',other)],fail=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),action=url.pathname.split('/').at(-1),reply=(json,status=200)=>route.fulfill({status,json});
  if(action==='session')return reply({id:randomUUID(),csrfToken:'qa-csrf',email:null,expiresAt:'2030-01-01T00:00:00Z'});
  if(action==='access')return reply({ok:true});
  if(action==='catalog-readiness')return reply({products,quality:[],categories:[{id:parent,name:'QA Родитель',parent_id:null},{id:child,name:'QA Потомок',parent_id:parent},{id:other,name:'QA Другая',parent_id:null}]});
  if(action==='product-editor'&&url.searchParams.has('drafts'))return reply({drafts});
  if(action==='product-lifecycle'){
   if(url.searchParams.has('archived'))return reply({products:deleted});
   if(url.searchParams.has('trash'))return reply({count:deleted.length,token:'b'.repeat(64),items:deleted});
   if(req.method()==='POST'){const b=req.postDataJSON();calls.push(b);if(fail){fail=false;return reply({error:{message:'QA временный сбой'}},503);}if(b.action==='purge-all'){const count=deleted.length;deleted=[];return reply({action:b.action,count});}deleted=deleted.filter(p=>p.id!==b.id);return reply({id:b.id,action:b.action});}
   const p=deleted.find(p=>p.id===url.searchParams.get('id'));return reply({...p,archived:true,token:'a'.repeat(64),hasLive:true,hasDraft:false,bundles:[],onHand:7,reserved:2});
  }
  throw Error('Unmocked '+url.pathname);
 });
 await page.goto(base+'/manager/products',{waitUntil:'networkidle'});
 const category=page.locator('[data-product-category]'),list=page.locator('[data-product-list]');await category.selectOption(parent);
 await list.getByRole('heading',{name:'QA Потомок',exact:true}).waitFor();await list.getByRole('heading',{name:'QA Дополнительная',exact:true}).waitFor();assert.equal(await list.getByRole('heading',{name:'QA Другая',exact:true}).count(),0);
 await page.locator('[data-product-drafts]').getByText('QA Черновик потомка',{exact:true}).waitFor();assert.equal(await page.locator('[data-product-drafts]').getByText('QA Черновик другой',{exact:true}).count(),0);
 const none=await category.locator('option').evaluateAll(options=>options.find(o=>o.textContent.trim()==='Без категории')?.value);assert.ok(none);await category.selectOption(none);await list.getByRole('heading',{name:'QA Без категории',exact:true}).waitFor();assert.equal(await list.locator('article').count(),1);
 await category.selectOption(parent);await page.locator('[data-product-scope]').selectOption('archived');await list.getByRole('heading',{name:'QA Удалённый потомок',exact:true}).waitFor();assert.equal(await list.getByRole('heading',{name:'QA Удалённый другой',exact:true}).count(),0);
 await page.locator('[data-product-purge-all]').click();const bulk=page.getByRole('dialog',{name:'Очистить раздел «Удалённые»?'});await bulk.getByText(/Поиск, категории и другие фильтры не ограничивают очистку/).waitFor();assert.match(await bulk.textContent(),/Удалённые»: 2/);
 await bulk.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(calls.length,0);
 await list.getByRole('button',{name:/Удалить окончательно/}).click();const single=page.getByRole('dialog',{name:'Удалить товар окончательно?'});await single.getByRole('button',{name:'Удалить окончательно',exact:true}).click();await single.getByText('QA временный сбой',{exact:true}).waitFor();await single.getByRole('button',{name:'Удалить окончательно',exact:true}).click();await single.waitFor({state:'hidden'});assert.equal(calls.length,2);assert.equal(calls[0].action,'purge');assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
 await page.locator('[data-product-purge-all]').click();await bulk.getByText(/Удалённые»: 1/).waitFor();await bulk.getByRole('button',{name:'Удалить все окончательно',exact:true}).click();await bulk.waitFor({state:'hidden'});assert.equal(calls.at(-1).action,'purge-all');assert.equal(deleted.length,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:out+'/purged-'+width+'.png'});await ctx.close();report.viewports.push({width,passed:true});
}report.passed=true;}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
