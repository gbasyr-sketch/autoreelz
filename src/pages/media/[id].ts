import type {APIRoute} from 'astro';
import {existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {getCatalog} from '../../server/catalog.ts';
import {isPublishedArticleMedia} from '../../server/content.ts';
import {query} from '../../server/db.ts';
import {appConfig} from '../../server/config.ts';
const allowed=new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml']);
export const GET:APIRoute=async({params,request})=>{
 const id=params.id;if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return new Response(null,{status:404});
 const catalog=await getCatalog();
 if(!catalog.products.some(p=>catalog.offerFor(p)!==null&&[...p.media,...p.variants.flatMap(v=>v.media)].some(m=>m.id===id))&&!await isPublishedArticleMedia(id))return new Response(null,{status:404});
 const file=(await query('SELECT id,storage,filename_disk,type,filesize FROM directus_files WHERE id=$1',[id])).rows[0];
 if(!file||file.storage!=='local'||!allowed.has(file.type)||!file.filename_disk||!(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).test(file.filename_disk)||basename(file.filename_disk)!==file.filename_disk||file.filename_disk.includes('\\')||Number(file.filesize)>20*1024*1024)return new Response(null,{status:404});
 const headers={'Content-Type':file.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"};
 try{const path=join(appConfig().uploadsPath,file.filename_disk);if((await stat(path)).size>20*1024*1024)return new Response(null,{status:413});const bytes=await readFile(path);return new Response(new Uint8Array(bytes),{headers});}
 catch(error){
  const url=new URL(request.url);
  // A fixed loopback destination only. Docker never proxies back to itself.
  if((error as NodeJS.ErrnoException).code==='ENOENT'&&!existsSync(appConfig().uploadsPath)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.port!=='14323'){
   try{const response=await fetch(`http://127.0.0.1:14323/media/${id}`,{redirect:'error',signal:AbortSignal.timeout(5000)});if(response.ok&&allowed.has(response.headers.get('content-type')??'')){return new Response(response.body,{headers});}}catch{/* Missing development media is a 404. */}
  }
  return new Response(null,{status:404});
 }
};
