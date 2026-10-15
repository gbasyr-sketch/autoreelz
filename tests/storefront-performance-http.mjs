// Verify actual built SSR resource isolation and font/image hints; synthetic database only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const base='http://127.0.0.1:14378';
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
 app=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...imageEnvironment(qa.database,'private/seo-indexing-qa'),PORT:'14378',STORE_MODE:'production',SHIPPING_PROVIDER:'cdek',PAYMENT_PROVIDER:'yookassa-live',APP_ORIGIN:'https://autoreelz.ru',SEO_INDEXING_ENABLED:'true'},stdio:['ignore','ignore','inherit']});
 for(let i=0;i<100;i++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 const headers={'X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https'};
 const report=[];
 for(const route of ['/','/catalog','/product/seo-qa','/cart']){
  const response=await fetch(base+route,{headers});assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/<script>document.documentElement.classList.add\('has-js'\);<\/script>/);
  const cssUrls=[...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(m=>m[1]);
  const css=await Promise.all(cssUrls.map(url=>fetch(base+url).then(r=>r.text())));
  const hasMap=css.some(text=>text.includes('.leaflet-pane'));
  assert.equal(hasMap,route==='/cart',`Map CSS isolation: ${route}`);
  const fonts=[...html.matchAll(/<link[^>]+rel="preload"[^>]+href="([^"]+\.woff2)"[^>]*>/g)].map(m=>m[1]);
  assert.equal(fonts.length,2);
  for(const font of fonts){assert.ok(css.some(text=>text.includes(font.split('/').pop())), 'Preload must reuse the CSS font');assert.equal((await fetch(base+font)).status,200);}
  if(route==='/product/seo-qa')assert.match(html,/sizes="\(max-width: 600px\) calc\(100vw - 32px\)/);
  report.push({route,stylesheets:cssUrls.length,mapCss:hasMap,fontPreloads:fonts.length});
 }
 console.log(JSON.stringify({passed:true,checks:report}));
} finally {
 if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}
 await qa.close(true);
}
