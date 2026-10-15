// Real streaming SSR regression, isolated database and no external operations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const base='http://127.0.0.1:14379';
assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false);
const qa=await createImageDatabase();
let app;
try {
 await qa.owner.query("INSERT INTO ar_categories(id,name,slug,status) VALUES('a6000000-0000-4000-8000-000000000001','QA','seo-qa','published')");
 await qa.owner.query("INSERT INTO directus_files(id,type) VALUES('a6000000-0000-4000-8000-000000000002','image/jpeg')");
 await qa.owner.query("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES('a6000000-0000-4000-8000-000000000003','QA','seo-qa','a6000000-0000-4000-8000-000000000001','published',false)");
 await qa.owner.query("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES('a6000000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000003','QA-SEO','QA','100.00','published')");
 await qa.owner.query("INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES('a6000000-0000-4000-8000-000000000004',5,0)");
 await qa.owner.query("INSERT INTO ar_product_media(product_id,file_id,alt,sort) VALUES('a6000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000002','QA',0)");
 app=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...imageEnvironment(qa.database,'private/seo-indexing-qa'),PORT:'14379',STORE_MODE:'production',SHIPPING_PROVIDER:'cdek',PAYMENT_PROVIDER:'yookassa-live',APP_ORIGIN:'https://autoreelz.ru',SEO_INDEXING_ENABLED:'true'},stdio:['ignore','ignore','inherit']});
 for(let i=0;i<100;i++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 const headers={'X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https'};
 for(const route of ['/','/catalog','/product/seo-qa']){
  const r=await fetch(base+route,{headers});assert.equal(r.status,200);assert.doesNotMatch(r.headers.get('x-robots-tag')??'',/noindex/);assert.match(await r.text(),/name="robots" content="index,follow"/);
 }
 for(const route of ['/account','/cart','/catalog?q=QA','/product/not-found']){
  const r=await fetch(base+route,{headers}),html=await r.text();assert.ok(/noindex/.test(r.headers.get('x-robots-tag')??'')||/name="robots" content="noindex/.test(html));
 }
 const robots=await fetch(base+'/robots.txt',{headers});assert.equal(robots.headers.get('x-robots-tag'),null);assert.match(await robots.text(),/Allow: \//);
 const sitemap=await fetch(base+'/sitemap.xml',{headers});assert.equal(sitemap.headers.get('x-robots-tag'),null);assert.match(await sitemap.text(),/https:\/\/autoreelz.ru\/product\/seo-qa/);
 const local=await fetch(base+'/');assert.match(local.headers.get('x-robots-tag'),/noindex/);
 console.log('PASS: streaming SSR public/private/error, robots/sitemap and local-origin guard (10 checks)');
} finally {
 if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}
 await qa.close(true);
}
