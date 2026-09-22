// Real Directus forms under owner/editor. Only uniquely marked content records are created and removed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {client,env,root,base} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
process.chdir(root);mkdirSync('artifacts/stage-5',{recursive:true});mkdirSync('tmp/stage-5',{recursive:true});
const report={roles:[],created:[],checks:[],errors:[],cleanup:false,passed:false};
const secrets=[env.ADMIN_EMAIL,env.ADMIN_PASSWORD,env.EDITOR_EMAIL,env.EDITOR_PASSWORD].filter(Boolean),scrub=input=>secrets.reduce((s,value)=>s.replaceAll(value,'[redacted]'),String(input));
const api=await client(),stamp=Date.now().toString(36),browser=await chromium.launch({channel:'chrome',headless:true});
const field=(p,key)=>p.locator(`#main-content [data-field="${key}"]`).first();
async function fill(p,key,value){await field(p,key).locator('input,textarea').first().fill(value);}
async function dropdown(p,key,label){await field(p,key).locator('div.input').first().click();await p.getByText(label,{exact:true}).last().click();}
async function relation(p,key,label){await field(p,key).getByText('Выбрать элемент...', {exact:true}).click();await p.getByText(label,{exact:true}).last().click();await p.getByRole('button',{name:'Сохранить',exact:true}).last().click();await p.waitForFunction(({key,label})=>document.querySelector(`#main-content [data-field="${key}"]`)?.textContent.includes(label),{key,label});}
async function save(p,collection,method){const pending=p.waitForResponse(r=>r.url().includes('/items/'+collection)&&r.request().method()===method);await p.locator('#main-content').getByRole('button',{name:'Сохранить',exact:true}).click();const r=await pending;assert.ok(r.ok(),`${collection} save ${r.status()}`);const body=await r.json();await p.waitForLoadState('networkidle');return Array.isArray(body.data)?body.data[0]:body.data;}
async function create(p,collection,setup){await p.goto(`${base}/admin/content/${collection}`,{waitUntil:'networkidle'});await p.locator('#main-content').getByRole('link',{name:'Создать',exact:true}).click();await p.waitForLoadState('networkidle');await setup();const row=await save(p,collection,'POST');report.created.push({collection,id:row.id});return row;}
try{
 for(const role of ['admin','editor']){
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),p=await context.newPage();p.setDefaultTimeout(15000);
  await p.goto(base+'/admin/login',{waitUntil:'networkidle'});await p.locator('input[type=email]').fill(role==='admin'?env.ADMIN_EMAIL:env.EDITOR_EMAIL);await p.locator('input[type=password]').fill(role==='admin'?env.ADMIN_PASSWORD:env.EDITOR_PASSWORD);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForURL(url=>!url.pathname.includes('/login'));await p.waitForLoadState('networkidle');
  const suffix=`${role}-${stamp}`,name=`QA content ${suffix}`;
  const page=await create(p,'ar_pages',async()=>{await fill(p,'title',name+' Page');await fill(p,'slug','qa-page-'+suffix);await fill(p,'summary','QA краткое вступление');await fill(p,'body','QA исходный абзац\n\nВторой абзац <script>window.qaUnsafe=1</script>');await dropdown(p,'status','Опубликовано');});
  await p.goto(`${base}/admin/content/ar_pages/${page.id}`,{waitUntil:'networkidle'});await fill(p,'body','QA сохранённое изменение\n\nВторой абзац <script>window.qaUnsafe=1</script>');await save(p,'ar_pages','PATCH');await p.goto(`${base}/admin/content/ar_pages/${page.id}`,{waitUntil:'networkidle'});assert.match(await field(p,'body').locator('textarea').inputValue(),/QA сохранённое изменение/);await p.screenshot({path:`artifacts/stage-5/content-${role}-page.png`,fullPage:true});
  const category=await create(p,'ar_blog_categories',async()=>{await fill(p,'name',name+' Category');await fill(p,'slug','qa-category-'+suffix);await dropdown(p,'status','Опубликовано');});
  const tag=await create(p,'ar_blog_tags',async()=>{await fill(p,'name',name+' Tag');await fill(p,'slug','qa-tag-'+suffix);});
  const article=await create(p,'ar_articles',async()=>{await fill(p,'title',name+' Article');await fill(p,'slug','qa-article-'+suffix);await relation(p,'category_id',name+' Category');await fill(p,'excerpt','QA описание статьи');await fill(p,'body','QA материал\n\nПроверка безопасного текста <img src=x onerror="window.qaUnsafe=1">');await fill(p,'video_url','https://vkvideo.ru/video_ext.php?oid=-123&id=456&hash=abcd1234');await dropdown(p,'status','Опубликовано');});
  await create(p,'ar_article_tags',async()=>{await relation(p,'article_id',name+' Article');await relation(p,'tag_id',name+' Tag');});
  await p.goto(`${base}/admin/content/ar_articles/${article.id}`,{waitUntil:'networkidle'});await fill(p,'slug','qa-renamed-'+suffix);await fill(p,'meta_description','QA SEO-описание после изменения');await save(p,'ar_articles','PATCH');await p.goto(`${base}/admin/content/ar_articles/${article.id}`,{waitUntil:'networkidle'});assert.equal(await field(p,'slug').locator('input').inputValue(),'qa-renamed-'+suffix);assert.equal(await field(p,'meta_description').locator('textarea').inputValue(),'QA SEO-описание после изменения');assert.match(await field(p,'tags').innerText(),new RegExp(name+' Tag'));await p.screenshot({path:`artifacts/stage-5/content-${role}-article.png`,fullPage:true});
  const {getContent}=await import('../src/server/content.ts'),{resolveContent}=await import('../src/lib/content.ts');const content=await getContent();assert.equal(content.pages.find(item=>item.id===page.id)?.body.includes('<script>'),true);const publicArticle=content.articles.find(item=>item.id===article.id);assert.equal(publicArticle?.category.id,category.id);assert.equal(publicArticle?.tags[0]?.id,tag.id);assert.ok(publicArticle?.video?.embedUrl.startsWith('https://vkvideo.ru/video_ext.php?'));assert.deepEqual(resolveContent(content,'article','qa-article-'+suffix),{id:article.id,slug:'qa-renamed-'+suffix,redirect:true});
  report.roles.push({role,pageCreateEditReopen:true,categoryCreate:true,tagCreate:true,articleCreateEditReopen:true,relationTag:true,liveRepository:true,slugHistory:true});console.log(`PASS content forms ${role}`);await context.close();
 }
}catch(error){report.errors.push(scrub(error.message));console.error(scrub(error.message));process.exitCode=1;}
finally{
 try{
  for(const row of [...report.created].reverse()){
   assert.ok(['ar_pages','ar_blog_categories','ar_blog_tags','ar_articles','ar_article_tags'].includes(row.collection));assert.match(row.id,/^[0-9a-f-]{36}$/);
   if(row.collection!=='ar_article_tags'){const current=await api('GET',`/items/${row.collection}/${row.id}`);assert.ok(current.slug.startsWith('qa-'));}
   await api('DELETE',`/items/${row.collection}/${row.id}`);
  }
  const ids=report.created.filter(r=>r.collection!=='ar_article_tags').map(r=>`'${r.id}'`);if(ids.length){const result=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:`DELETE FROM ar_content_slugs WHERE entity_id IN (${ids.join(',')}) AND slug LIKE 'qa-%';`,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
  report.cleanup=true;
 }catch(error){report.errors.push('Cleanup: '+scrub(error.message));process.exitCode=1;}
 report.passed=report.roles.length===2&&report.errors.length===0&&report.cleanup;writeFileSync('artifacts/stage-5/content-cms-browser.json',JSON.stringify(report,null,2));await browser.close();const{getPool}=await import('../src/server/db.ts');await getPool().end();
}
console.log(JSON.stringify({passed:report.passed,roles:report.roles.length,cleanup:report.cleanup}));
