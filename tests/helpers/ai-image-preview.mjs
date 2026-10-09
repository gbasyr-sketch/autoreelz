// Local-only fixture CMS and PostgreSQL. Never connects to the production CMS.
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import sharp from 'sharp';
import {createImageDatabase,imageEnvironment,localConfig} from './ai-image-qa.mjs';
import {emptyProduct,emptyVariant} from '../../src/lib/product-editor.ts';
const provider=process.env.AR_IMAGE_PREVIEW_PROVIDER||'simulation';if(!['simulation','openai'].includes(provider))throw Error('Invalid local provider');
if(provider==='openai'){
 try{await fs.access(path.resolve('private/ai-image-local/pilot/server-allocation.json'));throw Error('Image pilot budget is allocated to the server. Use its existing ledger instead of restarting the local paid pilot.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
const defaultRoot=path.resolve('private/ai-image-local',provider==='openai'?'pilot':'preview'),root=path.resolve(process.env.AR_IMAGE_PREVIEW_DIR||defaultRoot);await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(root,'uploads'),{recursive:true});
const database=provider==='openai'?'ar_qa_ai_images_pilot_20261009':process.env.AR_IMAGE_PREVIEW_DATABASE||'ar_qa_ai_images_local',qa=await createImageDatabase(database);
let fixture;try{fixture=JSON.parse(await fs.readFile(path.join(root,'fixture.json'),'utf8'));}catch{
 fixture={actor:randomUUID(),product:randomUUID(),category:randomUUID(),sku:randomUUID(),files:[],email:'image-owner@example.invalid',password:randomUUID()};
 await qa.owner.query("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'Инфографика','infographic','published')",[fixture.category]);
 for(const name of ['01.webp','02.webp','03.webp','04.webp','06.webp','07.webp','14.webp']){
  const id=randomUUID(),source=await fs.readFile('output/imagegen/wb-864989074/source/'+name),image=await sharp(source).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});await fs.writeFile(path.join(root,'uploads',id+'.webp'),image.data);
  await qa.owner.query("INSERT INTO directus_files(id,filename_disk,filename_download,title,type,filesize,width,height) VALUES($1,$2,$3,$4,'image/webp',$5,$6,$7)",[id,id+'.webp',name,'Исходник '+name,image.data.length,image.info.width,image.info.height]);fixture.files.push({id,name});
 }
 const data={...emptyProduct(),name:'Переходная рамка с блоком управления',slug:'local-image-pilot',categoryId:fixture.category,photos:fixture.files.filter(f=>['01.webp','03.webp'].includes(f.name)).map(f=>({id:f.id,alt:'Исходник '+f.name})),variants:[{...emptyVariant(fixture.sku),name:'Чёрный глянец',article:'LOCAL-IMAGE-PILOT',price:''}]};
 await qa.owner.query('INSERT INTO ar_product_editor_drafts(id,actor_id,payload,version) VALUES($1,$2,$3,1)',[fixture.product,fixture.actor,JSON.stringify(data)]);
 await fs.writeFile(path.join(root,'fixture.json'),JSON.stringify(fixture,null,2),{mode:0o600});
}
const sessions=new Set(),cms=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'),cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('autoreelz2026_new_session='))?.split('=')[1];
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/auth/login'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks));if(value.email!==fixture.email||value.password!==fixture.password)return send(401,{});const token=randomUUID();sessions.add(token);res.setHeader('Set-Cookie',`autoreelz2026_new_session=${token}; Path=/; HttpOnly; SameSite=Lax`);return send(200,{data:{}});}
  if(!sessions.has(cookie))return send(401,{});
  if(url.pathname==='/auth/logout'){sessions.delete(cookie);return send(200,{});}
  if(url.pathname==='/users/me')return send(200,{data:{id:fixture.actor,first_name:'Локальная',last_name:'проверка'}});
  if(url.pathname==='/permissions/me')return send(200,{data:{ar_stock:{update:{access:'full'}}}});
  if(req.method==='POST'&&url.pathname==='/files'){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)return send(413,{});chunks.push(chunk);}
   const form=await new Request('http://127.0.0.1/files',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData(),id=form.get('id'),file=form.get('file');if(typeof id!=='string'||!/^[a-f\d-]{36}$/.test(id)||!file||typeof file==='string')return send(400,{});
   const bytes=Buffer.from(await file.arrayBuffer()),meta=await sharp(bytes).metadata();await fs.writeFile(path.join(root,'uploads',id+'.webp'),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
   await qa.owner.query("INSERT INTO directus_files(id,filename_disk,filename_download,title,type,filesize,width,height) VALUES($1,$2,'result.webp','Результат инфографики','image/webp',$3,$4,$5) ON CONFLICT DO NOTHING",[id,id+'.webp',bytes.length,meta.width,meta.height]);return send(200,{data:{id}});
  }
  const id=url.pathname.split('/')[2];if(!/^[a-f\d-]{36}$/.test(id??''))return send(404,{});const file=(await qa.owner.query('SELECT * FROM directus_files WHERE id=$1',[id])).rows[0];if(!file)return send(404,{});
  if(url.pathname.startsWith('/files/'))return send(200,{data:{id}});
  if(url.pathname.startsWith('/assets/')){res.writeHead(200,{'Content-Type':file.type});return res.end(await fs.readFile(path.join(root,'uploads',file.filename_disk)));}return send(404,{});
 }catch{res.writeHead(500);res.end('{}');}
});
await new Promise((resolve,reject)=>{cms.once('error',reject);cms.listen(localConfig.cmsPort,'127.0.0.1',resolve);});
const env=imageEnvironment(database,root,provider);
if(provider==='openai'){
 const values=Object.fromEntries((await fs.readFile('private/ai-texts.env','utf8')).split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim()];}));env.AI_IMAGE_OPENAI_API_KEY=values.OPENAI_API_KEY;env.AI_IMAGE_API_KEY_CONFIGURED='true';if(!env.AI_IMAGE_OPENAI_API_KEY)throw Error('Existing API key missing');
}
const children=[spawn(process.execPath,['dist/server/entry.mjs'],{env,stdio:['ignore','ignore','inherit']})];
if(process.env.AR_IMAGE_PREVIEW_WORKER!=='off')children.push(spawn(process.execPath,['scripts/ai-image-worker.ts'],{env,stdio:['ignore','ignore','inherit']}));
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');await new Promise(r=>cms.close(r));await qa.close(process.env.AR_IMAGE_PREVIEW_DROP_DATABASE==='1');if(process.env.AR_IMAGE_PREVIEW_REMOVE_FILES==='1')await fs.rm(root,{recursive:true,force:true});};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
console.log(JSON.stringify({url:`http://127.0.0.1:${localConfig.webPort}/manager/products/edit?id=${fixture.product}`,provider,database,fixture:path.join(root,'fixture.json'),worker:process.env.AR_IMAGE_PREVIEW_WORKER!=='off'}));
