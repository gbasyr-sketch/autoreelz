// Synthetic isolated app fixture. Browser interactions are performed through Codex CUA.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import sharp from 'sharp';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const port=14371,base=`http://127.0.0.1:${port}`,root=path.resolve('private/seo-improvements-20261015'),checks=[];
assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false,'QA port occupied');
const qa=await createImageDatabase('ar_qa_ai_images_seo_'+randomUUID().replaceAll('-','').slice(0,12));
let app,finished=false;
const id=n=>`a6000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const report=async()=>fs.writeFile(root+'/http.json',JSON.stringify({base,database:qa.database,checks},null,2));
async function stop(){if(finished)return;finished=true;if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await qa.close(true);await fs.rm(root+'/uploads',{recursive:true,force:true});console.log('CLEANUP');}
try{
 await fs.mkdir(root+'/uploads',{recursive:true});
 const shapes=Array.from({length:300},(_,i)=>`<rect x="${i*37%1536}" y="${i*71%1024}" width="130" height="90" fill="hsl(${i*43%360},60%,50%)"/>`).join('');
 const bytes=await sharp(Buffer.from(`<svg width="1536" height="1024"><rect width="1536" height="1024" fill="#ddd"/>${shapes}<text x="150" y="500" font-size="100">QA PHOTO</text></svg>`)).jpeg({quality:95}).toBuffer();
 for(let n=9;n<=11;n++){
  const file=n===10?await sharp(bytes).flop().toBuffer():bytes;await fs.writeFile(root+`/uploads/qa-${n}.jpg`,file);
  await qa.owner.query("INSERT INTO directus_files(id,storage,filename_disk,type,filesize) VALUES($1,'local',$2,'image/jpeg',$3)",[id(n),`qa-${n}.jpg`,file.length]);
 }
 await qa.owner.query("INSERT INTO ar_categories(id,name,slug,status,seo_title) VALUES($1,'QA Детали','parts','published','Ручной заголовок категории')",[id(1)]);
 for(let n=0;n<15;n++){
  const specific=n===13||n===14;
  const sku=n===13?'4606fd6e-f55f-5230-a6c9-fad372d04fc0':n===14?'fad7e444-92e4-5be5-a808-66fc1588ab71':id(200+n);
  const slug=n===13?'kozyrek-pod-planshet-9-dyuymov-v-stile-priora-2-dlya-priora-1-chernyy-glyanets':n===14?'kozyrek-pod-planshet-9-dyuymov-v-stile-priora-2-dlya-priora-1-chernyy-matovyy':'qa-product-'+n;
  await qa.owner.query("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo,description) VALUES($1,$2,$3,$4,'published',false,'Синтетическое описание для проверки изображений.')",[id(100+n),specific?'Козырек под планшет 9 дюймов в стиле Приора 2 Для Приора 1':'QA Товар '+n,slug,id(1)]);
  await qa.owner.query("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA исполнение','2700.00','published')",[sku,id(100+n),'QA-SEO-'+n]);
  await qa.owner.query('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,5,0)',[sku]);
  await qa.owner.query("INSERT INTO ar_product_media(product_id,file_id,alt,sort) VALUES($1,$2,'QA фотография',0)",[id(100+n),id(n===12?11:9)]);
 }
 await qa.owner.query("INSERT INTO ar_product_media(product_id,file_id,alt,sort) VALUES($1,$2,'QA вторая фотография',1)",[id(100),id(10)]);
 const titleSql=await fs.readFile('scripts/data/seo-product-titles.sql','utf8');
 await check('targeted title correction is idempotent and preserves an existing manual title',async()=>{
  assert.equal((await qa.owner.query(titleSql)).rowCount,2);assert.equal((await qa.owner.query(titleSql)).rowCount,0);
  const saved=(await qa.owner.query('SELECT seo_title FROM ar_products WHERE id=$1',[id(113)])).rows[0].seo_title;
  await qa.owner.query("UPDATE ar_products SET seo_title='Ручной заголовок владельца' WHERE id=$1",[id(113)]);
  assert.equal((await qa.owner.query(titleSql)).rowCount,0);assert.equal((await qa.owner.query('SELECT seo_title FROM ar_products WHERE id=$1',[id(113)])).rows[0].seo_title,'Ручной заголовок владельца');
  await qa.owner.query('UPDATE ar_products SET seo_title=$2 WHERE id=$1',[id(113),saved]);
 });
 await qa.owner.query("INSERT INTO ar_blog_categories(id,name,slug,status) VALUES($1,'QA Статьи','guides','published')",[id(3)]);
 await qa.owner.query("INSERT INTO ar_articles(id,title,slug,category_id,status,body,excerpt,cover_file_id,published_at,is_demo) VALUES($1,'QA Статья','qa-article',$2,'published','Синтетический материал','Проверка обложки',$3,now(),false)",[id(300),id(3),id(9)]);
 app=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...imageEnvironment(qa.database,root),HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:base,SEO_INDEXING_ENABLED:'false',METRIKA_ENABLED:'false'},stdio:['ignore','ignore','pipe']});
 let errors='';app.stderr.on('data',b=>errors+=String(b));
 for(let n=0;n<100;n++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;if(app.exitCode!==null)throw Error('QA app exited');await new Promise(r=>setTimeout(r,100));}
 await check('original bytes unchanged, bounded responsive width, small transfer and invalid widths rejected',async()=>{
  const original=await fetch(base+'/media/'+id(9)),originalBytes=Buffer.from(await original.arrayBuffer());assert.deepEqual(originalBytes,bytes);
  const r=await fetch(base+'/media/'+id(9)+'?w=320'),small=Buffer.from(await r.arrayBuffer());assert.equal(r.headers.get('content-type'),'image/webp');assert.equal((await sharp(small).metadata()).width,320);assert.ok(small.length<bytes.length/2);
  for(const width of ['1','999999','320&w=640','320.0'])assert.equal((await fetch(base+'/media/'+id(9)+'?w='+width)).status,400);
  await fs.writeFile(root+'/sizes.json',JSON.stringify({original:bytes.length,width320:small.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
 });
 await check('parallel responsive requests keep images available',async()=>{
  const responses=await Promise.all([9,10,11].flatMap(n=>[160,320,480,640,960,1280].map(w=>fetch(`${base}/media/${id(n)}?w=${w}`))));
  assert.ok(responses.every(r=>r.status===200));await Promise.all(responses.map(r=>r.arrayBuffer()));
 });
 await check('warm rendition never exposes media after its only product becomes unpublished',async()=>{
  assert.equal((await fetch(base+'/media/'+id(11)+'?w=320')).status,200);
  await qa.owner.query("UPDATE ar_products SET status='draft' WHERE id=$1",[id(112)]);
  assert.equal((await fetch(base+'/media/'+id(11)+'?w=320')).status,404);
  await qa.owner.query("UPDATE ar_products SET status='published' WHERE id=$1",[id(112)]);
 });
 await check('changing source file invalidates warm rendition',async()=>{
  const first=Buffer.from(await (await fetch(base+'/media/'+id(10)+'?w=160')).arrayBuffer());
  const changed=await sharp({create:{width:1536,height:1024,channels:3,background:'blue'}}).jpeg().toBuffer();await fs.writeFile(root+'/uploads/qa-10.jpg',changed);
  const second=Buffer.from(await (await fetch(base+'/media/'+id(10)+'?w=160')).arrayBuffer());assert.notDeepEqual(first,second);
 });
 await check('SSR responsive cards, gallery thumbnails, original zoom deferred, canonical and social metadata',async()=>{
  for(const route of ['/','/catalog','/catalog?page=2','/blog/qa-article','/product/qa-product-0']){
   const r=await fetch(base+route),html=await r.text();assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(html,/srcset="[^\"]+\?w=160/);assert.match(html,/property="og:image"/);assert.match(html,/name="twitter:card" content="summary_large_image"/);assert.match(html,/property="og:url" content="https:\/\/autoreelz.ru/);
  }
  const product=await fetch(base+'/product/qa-product-0').then(r=>r.text());assert.ok(!/<img[^>]*data-gallery-enlarged[^>]*\ssrc=/.test(product));assert.match(product,/data-original-src="\/media\//);
  const second=await fetch(base+'/catalog?category=parts&page=2').then(r=>r.text());assert.match(second,/<title>Ручной заголовок категории — страница 2<\/title>/);
  const article=await fetch(base+'/blog/qa-article').then(r=>r.text());assert.match(article,/property="og:type" content="article"/);assert.match(article,/property="og:image" content="https:\/\/autoreelz.ru\/media\//);
  assert.equal((await fetch(base+'/images/social-default.jpg')).status,200);
 });
 await check('private and missing pages omit social canonical data; indexing guards stay closed',async()=>{
  for(const route of ['/account','/cart','/product/not-found']){const r=await fetch(base+route),html=await r.text();assert.doesNotMatch(html,/property="og:url"/);assert.match(r.headers.get('x-robots-tag'),/noindex/);}
  assert.match(await fetch(base+'/robots.txt').then(r=>r.text()),/Disallow: \//);assert.ok(!(await fetch(base+'/sitemap.xml').then(r=>r.text())).includes('<url>'));assert.equal((await fetch(base+'/feed.yml')).status,503);
 });
 await report();console.log('READY '+base+' (synthetic QA only)');
 if(process.argv.includes('--http-only'))await stop();else{process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());}
}catch(error){await report().catch(()=>{});await stop();throw error;}
