// Isolated real app/API fixture. UI is exercised through the browser tool, not by this script.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID as key} from 'node:crypto';import {spawn} from 'node:child_process';import {createServer,request as httpRequest} from 'node:http';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_privacy_ui_'+key().replaceAll('-','').slice(0,12));
const root='private/legal-analytics-20261014',base='http://127.0.0.1:14364',calls=[],apiChecks={},metrics={scriptRequests:0,commands:0};let failNext=false,delayScript=false,held=[],ending=false;
const pages=JSON.parse(await fs.readFile('output/legal/pages.json','utf8')).pages;
for(const p of pages)await qa.owner.query("INSERT INTO ar_pages(id,title,slug,body,body_format,summary,is_legal,is_draft_text,sort,status) VALUES($1,$2,$3,$4,'html',$5,true,true,$6,'published')",[key(),p.title,p.slug,p.body,p.summary,Number(p.sort)]);
const app=spawn(process.execPath,['dist/server/entry.mjs'],{env:{...imageEnvironment(qa.database,root+'/qa'),HOST:'127.0.0.1',PORT:'14363',APP_ORIGIN:base,METRIKA_ENABLED:'true',METRIKA_COUNTER_ID:'123456'},stdio:'ignore'});
const stub=`window.ym=function(...args){fetch('/qa/hit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});};`;
const proxy=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,base);
  if(url.pathname==='/qa/report'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({metrics,calls,apiChecks}));return;}
  if(url.pathname==='/qa/fail-next'){failNext=true;res.end('armed');return;}
  if(url.pathname==='/qa/hold-script'){delayScript=true;res.end('armed');return;}
  if(url.pathname==='/qa/release-script'){delayScript=false;for(const r of held){r.setHeader('Content-Type','application/javascript');r.end(stub);}held=[];res.end('released');return;}
  if(url.pathname==='/qa/metrika-tag.js'){metrics.scriptRequests++;if(delayScript){held.push(res);return;}res.setHeader('Content-Type','application/javascript');res.end(stub);return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  if(url.pathname==='/qa/hit'){calls.push(JSON.parse(body.toString()));res.end('ok');return;}
  if(url.pathname==='/api/privacy'&&req.method==='POST')metrics.commands++;
  const upstream=await new Promise((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:14363,path:url.pathname+url.search,method:req.method,headers:{...req.headers,host:'127.0.0.1:14364','accept-encoding':'identity'}},async response=>{try{const chunks=[];for await(const chunk of response)chunks.push(chunk);resolve(new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode,headers:response.headers}));}catch(e){reject(e);}});request.on('error',reject);request.end(body);});
  if(url.pathname==='/api/privacy'&&req.method==='POST'&&failNext){failNext=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'QA: ответ потерян после сохранения'}}));return;}
  for(const [k,v]of upstream.headers)if(!['content-length','content-encoding','transfer-encoding','set-cookie'].includes(k))res.setHeader(k,v);
  const cookies=upstream.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.statusCode=upstream.status;
  const type=upstream.headers.get('content-type')??'';if(type.includes('javascript'))res.end((await upstream.text()).replaceAll('https://mc.yandex.ru/metrika/tag.js',base+'/qa/metrika-tag.js'));else res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch{res.statusCode=502;res.end('QA upstream unavailable');}
});await new Promise(r=>proxy.listen(14364,'127.0.0.1',r));
for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
process.on('uncaughtException',async e=>{console.error(e);await end(true);});process.on('unhandledRejection',async e=>{console.error(e);await end(true);});
const s=await fetch(base+'/api/commerce/session'),session=await s.json(),cookie=s.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
assert.equal((await fetch(base+'/api/privacy',{method:'POST',headers,body:'{}'})).status,403);apiChecks.csrf403=true;
assert.equal((await fetch(base+'/api/privacy',{method:'POST',headers:{...headers,'X-CSRF-Token':session.csrfToken,Origin:'https://evil.invalid'},body:'{}'})).status,403);apiChecks.origin403=true;
assert.equal((await fetch(base+'/api/privacy',{method:'POST',headers:{...headers,'X-CSRF-Token':session.csrfToken},body:JSON.stringify({choice:'accepted',version:'old',idempotencyKey:key()})})).status,409);apiChecks.oldVersion409=true;
const response=await fetch(base+'/api/privacy');assert.match(response.headers.get('cache-control'),/no-store/);apiChecks.noStore=true;
console.log(JSON.stringify({ready:true,url:base+'/info/contacts',documents:pages.length,apiChecks}));
async function end(failed=false){if(ending)return;ending=true;await fs.writeFile(root+'/browser-network.json',JSON.stringify({metrics,calls,apiChecks},null,2));for(const r of held)r.end(stub);proxy.closeAllConnections();await new Promise(r=>proxy.close(r));if(app.exitCode===null){app.kill('SIGTERM');await new Promise(r=>app.once('exit',r));}await qa.close(true);process.exit(failed?1:0);}
process.on('SIGINT',()=>end());process.on('SIGTERM',()=>end());
