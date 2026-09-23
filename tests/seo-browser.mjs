import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,basename} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {qaDatabase} from './helpers/qa-db.mjs';
import {env,root} from '../scripts/cms-client.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||(process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base='http://127.0.0.1:14329',out='artifacts/stage-6',report={startedAt:new Date().toISOString(),checks:[],passed:false,cleanup:false};
mkdirSync(out,{recursive:true});assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false,'QA port occupied');
const db=await qaDatabase('seo'),sql=db.query,ids=Array.from({length:13},()=>({p:randomUUID(),s:randomUUID()})),cat=randomUUID(),oldCat='qa-seo-'+cat,finalCat='qa-seo-final-'+cat;
let server,browser;const uploads=join(root,'tmp/stage-6',db.database,'uploads');mkdirSync(uploads,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
const html=(path,redirect='follow')=>fetch(base+path,{redirect});
try{
 const file=(await sql("SELECT f.id,f.filename_disk FROM directus_files f JOIN ar_product_media m ON m.file_id=f.id LIMIT 1")).rows[0];assert.ok(file);assert.equal(basename(file.filename_disk),file.filename_disk);
 const copy=spawnSync('docker',['compose','-p','autoreelz2026-new','cp',`cms:/directus/uploads/${file.filename_disk}`,join(uploads,file.filename_disk)],{encoding:'utf8'});assert.equal(copy.status,0);
 await sql("INSERT INTO ar_categories(id,name,slug,status,seo_title) VALUES($1,'QA SEO категория',$2,'published','QA ручной title категории')",[cat,oldCat]);
 for(const [i,{p,s}]of ids.entries()){
  await sql("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo,description,seo_title) VALUES($1,$2,$3,$4,'published',false,$5,$6)",[p,'QA SEO товар '+i,'qa-seo-product-'+p,cat,'QA описание '+i,i===0?'QA ручной title — без автозамены':null]);
  await sql("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA исполнение','7200.50','published')",[s,p,'QA-SEO-'+i]);
  await sql('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,$2,0)',[s,i===0?0:5]);
  await sql("INSERT INTO ar_product_media(product_id,file_id,alt) VALUES($1,$2,'QA изображение')",[p,file.id]);
 }
 const extra=randomUUID();await sql("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,'QA-SEO-EXTRA','QA второе исполнение','5300.01','published')",[extra,ids[0].p]);await sql('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,3,0)',[extra]);
 const node=join(root,'.tools/node-v24.21.0-darwin-arm64/bin/node');server=spawn(node,['dist/server/entry.mjs'],{cwd:root,env:{...process.env,AR_DATABASE_NAME:db.database,AR_DB_HOST:'127.0.0.1',AR_DB_PORT:env.DB_PORT,APP_DB_PASSWORD:env.APP_DB_PASSWORD,APP_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:base,HOST:'127.0.0.1',PORT:'14329',STORE_MODE:'local-test',SEO_INDEXING_ENABLED:'true',CMS_UPLOADS_PATH:uploads},stdio:['ignore','ignore','ignore']});
 for(let i=0;i<60;i++){if(await html('/health').then(r=>r.ok).catch(()=>false))break;await pause(150);}
 browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}}),page=await ctx.newPage();
 await check('13 published QA products are reachable through HTML pagination with JavaScript disabled',async()=>{
  await page.goto(base+'/catalog?category='+oldCat);assert.equal(await page.locator('.cat-product-grid .product-card').count(),12);await page.getByRole('link',{name:'Далее',exact:true}).click();assert.equal(await page.locator('.cat-product-grid .product-card').count(),1);assert.ok((await page.locator('link[rel=canonical]').getAttribute('href')).endsWith('category='+oldCat+'&page=2'));const r=await html('/catalog?category='+oldCat+'&page=3');assert.equal(r.status,404);
 });
 await check('selected SKU has exact SSR money, availability, manual title and canonical ProductGroup',async()=>{
  await page.goto(base+'/product/qa-seo-product-'+ids[0].p+'?sku='+extra);assert.equal(await page.title(),'QA ручной title — без автозамены');assert.equal(await page.locator('[data-price-rubles]').getAttribute('data-price-rubles'),'5300.01');const json=JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());const group=json.find(x=>x['@type']==='ProductGroup');assert.equal(group.hasVariant.find(x=>x.sku==='QA-SEO-EXTRA').offers.price,'5300.01');assert.equal(group.hasVariant.find(x=>x.sku==='QA-SEO-0').offers.availability,'https://schema.org/BackOrder');assert.ok(!(await page.locator('link[rel=canonical]').getAttribute('href')).includes('sku='));assert.ok(!/aggregateRating|reviewRating/.test(JSON.stringify(json)));writeFileSync(out+'/qa-product-schema.json',JSON.stringify(json,null,2));
 });
 await check('old product and category slugs redirect directly to their current published destination',async()=>{
  const original='qa-seo-product-'+ids[0].p,final='qa-final-'+ids[0].p;
  await sql('UPDATE ar_products SET slug=$2 WHERE id=$1',[ids[0].p,'qa-middle-'+ids[0].p]);await sql('UPDATE ar_products SET slug=$2 WHERE id=$1',[ids[0].p,final]);
  const p=await html('/product/'+original+'?sku='+extra,'manual');assert.equal(p.status,301);assert.equal(p.headers.get('location'),'/product/'+final+'?sku='+extra);assert.equal((await html(p.headers.get('location'))).status,200);
  await sql('UPDATE ar_categories SET slug=$2 WHERE id=$1',[cat,finalCat]);const r=await html('/catalog?category='+oldCat,'manual');assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/catalog?category='+finalCat);
  await sql("UPDATE ar_categories SET status='draft' WHERE id=$1",[cat]);assert.equal((await html('/product/'+original,'manual')).status,404);assert.equal((await html('/catalog?category='+oldCat,'manual')).status,404);await sql("UPDATE ar_categories SET status='published' WHERE id=$1",[cat]);
 });
 await check('invalid SKU, category and page return 404; empty search remains 200',async()=>{assert.equal((await html('/product/qa-final-'+ids[0].p+'?sku='+ids[1].s)).status,404);assert.equal((await html('/catalog?category=missing')).status,404);assert.equal((await html('/catalog?page=0')).status,404);assert.equal((await html('/catalog?q=definitely-no-match')).status,200);});
 await check('local guards survive a mistakenly enabled SEO flag; robots, sitemap and feed stay safe',async()=>{for(const path of ['/','/catalog','/account']){const r=await html(path);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(await r.text(),/name="robots" content="noindex/);}assert.match(await(await html('/robots.txt')).text(),/Disallow: \//);assert.ok(!(await(await html('/sitemap.xml')).text()).includes('<url>'));assert.equal((await html('/feed.yml')).status,503);});
 await check('Article and conditional VideoObject match visible metadata and related product links',async()=>{
  const article=randomUUID(),slug='qa-video-'+article,category=(await sql('SELECT id FROM ar_blog_categories WHERE status=\'published\' LIMIT 1')).rows[0].id;
  await sql("INSERT INTO ar_articles(id,title,slug,category_id,status,body,excerpt,published_at,video_url,video_title,video_description,video_thumbnail_id,video_uploaded_at,video_duration_seconds) VALUES($1,'QA статья с видео',$2,$3,'published','QA текст статьи','QA описание статьи','2026-09-01T12:00:00Z',$4,'QA ролик','QA описание ролика',$5,'2026-09-01T12:00:00Z',120)",[article,slug,category,'https://rutube.ru/video/'+'a'.repeat(32),file.id]);
  await sql('INSERT INTO ar_article_products(article_id,product_id) VALUES($1,$2)',[article,ids[0].p]);
  await page.goto(base+'/blog/'+slug);const data=JSON.parse(await page.locator('script[type=\"application/ld+json\"]').textContent());assert.ok(data.some(x=>x['@type']==='Article'));assert.equal(data.find(x=>x['@type']==='VideoObject').duration,'PT120S');assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('[data-video-placeholder] img').count(),1);assert.ok(await page.locator('.product-card .card-title').count());
  const videoContext=await browser.newContext();await videoContext.route('https://rutube.ru/**',r=>r.abort());const videoPage=await videoContext.newPage();await videoPage.goto(base+'/blog/'+slug);await videoPage.locator('[data-load-video]').click();await videoPage.locator('iframe').waitFor();assert.match(await videoPage.locator('.article-video').innerText(),/Если плеер не открылся/);assert.ok(await videoPage.locator('.article-video a').isVisible());await videoContext.close();
 });
 await check('public export builders use the current database facts and exclude demo/private URLs',async()=>{
  const {getCatalog}=await import('../src/server/catalog.ts'),{getContent}=await import('../src/server/content.ts'),{sitemapPaths,renderSitemap}=await import('../src/lib/seo.ts'),{feedOffers,renderYml}=await import('../src/lib/feed.ts');
  const c=await getCatalog(),content=await getContent(),paths=sitemapPaths(c,content),offers=feedOffers(c);assert.equal(offers.filter(o=>ids.some(x=>x.p===o.productId)).length,14);assert.ok(paths.includes('/catalog?category='+finalCat+'&page=2'));assert.ok(!paths.some(x=>x.includes('account')||x.includes('sku=')));assert.equal(offers.find(o=>o.id===extra).price,'5300.01');assert.ok(offers.every(o=>/^[1-9]\d{0,17}$/.test(o.categoryId)));writeFileSync(out+'/qa-sitemap.xml',renderSitemap(paths));writeFileSync(out+'/qa-feed.yml',renderYml(c,'QA тестовая компания'));
 });
 report.passed=true;
}catch(error){report.error=error.message;throw error;}
finally{await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}const{getPool}=await import('../src/server/db.ts');await getPool().end();await db.close();report.cleanup=true;writeFileSync(out+'/seo-browser.json',JSON.stringify(report,null,2)+'\n');console.log({passed:report.passed,cleanup:report.cleanup,checks:report.checks.length});}
