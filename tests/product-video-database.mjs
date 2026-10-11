import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_video_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/product-video-qa','simulation'));
const {readProductEditor,saveProductEditor}=await import('../src/server/product-editor.ts');
const {getCatalog}=await import('../src/server/catalog.ts');const {getPool}=await import('../src/server/db.ts');
const id=key(),cat=key(),sku=key(),photo=key(),actor={id:key()},url='https://rutube.ru/video/3ec4422ba87176934bc52c201e113d0d/?r=wd',checks=[];
const q=(text,values=[])=>qa.owner.query(text,values),command=(s,action='publish',data=s.data)=>({id:s.id,version:s.version,baseHash:s.baseHash,data,action,idempotencyKey:key()});
try{
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA','qa-video','published')",[cat]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status) VALUES($1,'QA Видео','qa-video',$2,'published')",[id,cat]);
 await q("INSERT INTO ar_skus(id,product_id,name,article,price_rubles,status) VALUES($1,$2,'QA','QA-VIDEO','100.50','published')",[sku,id]);
 await q("INSERT INTO directus_files(id,storage,filename_disk,title,type) VALUES($1,'local','qa.webp','QA','image/webp')",[photo]);
 await q('INSERT INTO ar_product_media(product_id,file_id,alt) VALUES($1,$2,\'QA\')',[id,photo]);
 // Exercise the additive migration against a previously saved editor fingerprint.
 await q('ALTER TABLE ar_products DROP COLUMN video_url');let state=await readProductEditor(id);delete state.data.videoUrl;
 await saveProductEditor(actor,command(state,'draft'));const before=await readProductEditor(id);
 await q(await fs.readFile('migrations/022_product_video.sql','utf8'));state=await readProductEditor(id);assert.equal(state.baseHash,before.baseHash);
 await saveProductEditor(actor,command(state));checks.push('migration preserves pre-existing null-video draft fingerprint');
 state=await readProductEditor(id);state.data.videoUrl=url;const draft=command(state,'draft');assert.deepEqual(await saveProductEditor(actor,draft),await saveProductEditor(actor,draft));
 assert.equal((await q('SELECT video_url FROM ar_products WHERE id=$1',[id])).rows[0].video_url,null);assert.equal((await getCatalog()).products.find(p=>p.id===id).video,null);
 state=await readProductEditor(id);assert.equal(state.data.videoUrl,url);checks.push('draft and idempotent retry leave live video hidden');
 const pub=command(state);assert.deepEqual(...await Promise.all([saveProductEditor(actor,pub),saveProductEditor(actor,pub)]));
 state=await readProductEditor(id);assert.equal(state.data.videoUrl,url.split('?')[0]);assert.equal((await getCatalog()).products.find(p=>p.id===id).video.provider,'RUTUBE');checks.push('atomic publish and repeat expose one normalized video');
 const invalid={...state.data,videoUrl:'https://example.invalid/video'};await assert.rejects(()=>saveProductEditor(actor,command(state,'publish',invalid)),e=>e.code==='PRODUCT_FIELDS');
 const legacy=structuredClone(state.data);delete legacy.videoUrl;await saveProductEditor(actor,command(state,'publish',legacy));state=await readProductEditor(id);assert.ok(state.data.videoUrl);checks.push('invalid publication rejected; older client cannot silently remove video');
 await saveProductEditor(actor,command(state,'draft',{...state.data,videoUrl:''}));state=await readProductEditor(id);assert.ok((await getCatalog()).products.find(p=>p.id===id).video);await saveProductEditor(actor,command(state));state=await readProductEditor(id);assert.equal(state.data.videoUrl,'');checks.push('deletion remains a draft until published');
 const stale=state;await q('UPDATE ar_products SET video_url=$2 WHERE id=$1',[id,url.split('?')[0]]);await assert.rejects(()=>saveProductEditor(actor,command(stale)),e=>e.code==='PRODUCT_CONFLICT');checks.push('CMS video edits invalidate stale editor fingerprint');
 const bundle=await readProductEditor(key(),'bundle');bundle.data={...bundle.data,name:'QA Видео комплекта',slug:'qa-video-bundle',categoryId:cat,photos:[{id:photo,alt:'QA'}],components:[{skuId:sku,quantity:'1'}],videoUrl:url};await saveProductEditor(actor,command(bundle));assert.equal((await getCatalog()).products.find(p=>p.id===bundle.id).video.provider,'RUTUBE');assert.equal((await q('SELECT count(*)::int n FROM ar_skus WHERE product_id=$1',[bundle.id])).rows[0].n,0);checks.push('bundle shares the same video contract without creating a SKU');
 assert.equal((await q('SELECT count(*)::int n FROM ar_stock_movements')).rows[0].n,0);assert.equal((await q('SELECT price_rubles FROM ar_skus WHERE id=$1',[sku])).rows[0].price_rubles,'100.50');assert.equal((await q('SELECT file_id FROM ar_product_media WHERE product_id=$1',[id])).rows[0].file_id,photo);
 const report={passed:true,isolated:true,checks,stockAndPhotosPreserved:true};await fs.mkdir('artifacts/product-video',{recursive:true});await fs.writeFile('artifacts/product-video/database.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await getPool().end();await qa.close(true);}
