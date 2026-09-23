import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {qaDatabase} from './helpers/qa-db.mjs';
import {env,root} from '../scripts/cms-client.mjs';
const base='http://127.0.0.1:14331',origin='https://autoreelz.ru';
assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false,'QA port occupied');
const db=await qaDatabase('staging'),children=[],report={startedAt:new Date().toISOString(),checks:[],passed:false,cleanup:false};
const headers={'X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https'};
const request=(path,options={})=>fetch(base+path,{...options,headers:{...headers,...options.headers}});
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function session(){const r=await request('/api/commerce/session');assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Secure/i);return{cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};}
async function post(path,actor,body){const r=await request(path,{method:'POST',headers:{Cookie:actor.cookie,Origin:origin,'X-CSRF-Token':actor.csrf,'Content-Type':'application/json'},body:JSON.stringify({...body,idempotencyKey:randomUUID()})});assert.equal(r.status,200,path);return{value:await r.json(),cookie:r.headers.get('set-cookie')};}
try{
 await db.query("UPDATE ar_stock SET on_hand=3,reserved=0 WHERE sku_id='00000000-0000-4000-8000-000000001001'");
 const runtime={...process.env,HOST:'127.0.0.1',PORT:'14331',AR_DATABASE_NAME:db.database,AR_DB_HOST:'127.0.0.1',AR_DB_PORT:env.DB_PORT,APP_DB_PASSWORD:env.APP_DB_PASSWORD,APP_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:origin,STORE_MODE:'staging',SEO_INDEXING_ENABLED:'true',CMS_INTERNAL_URL:'http://127.0.0.1:28055'};
 for(const entry of ['dist/server/entry.mjs','scripts/commerce-worker.ts'])children.push(spawn(process.execPath,[entry],{cwd:root,env:runtime,stdio:'ignore'}));
 let ready=false;for(let n=0;n<50;n++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false)){ready=true;break;}await pause(150);}assert.ok(ready);
 const buyer=await session(),manager=await session();let order;
 await check('approved HTTPS staging creates a real QA cart and order with manual shipping',async()=>{
  const cart=(await post('/api/commerce/cart',buyer,{productId:'00000000-0000-4000-8000-000000000100',skuId:'00000000-0000-4000-8000-000000001001',quantity:1,mode:'add',cartVersion:0})).value;
  const quote=(await post('/api/commerce/quote',buyer,{cartVersion:cart.version,customer:{name:'QA Staging',phone:'+79990000000',email:'staging@example.invalid'},delivery:{method:'pickup_point',city:'QA City',address:'QA Pickup'}})).value;
  assert.equal(quote.groups[0].shipping.costRubles,null);
  const result=(await post('/api/commerce/checkout',buyer,{quoteId:quote.id,cartVersion:cart.version})).value;order=result.orders[0];assert.equal(order.kind,'ordinary');assert.equal(order.canPay,false);
 });
 await check('manager login and shipping correction work behind the approved HTTPS proxy',async()=>{
  const login=await post('/api/manager/login',manager,{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});assert.ok(login.cookie);manager.cookie+='; '+login.cookie.split(';')[0];
  order=(await post('/api/manager/shipping',manager,{orderId:order.id,costRubles:'40.20',note:'QA staging delivery'})).value;assert.equal(order.shippingCostRubles,'40.20');assert.equal(order.canPay,true);
 });
 await check('staging test payment settles the QA order once without any PSP call',async()=>{
  order=(await post('/api/commerce/pay',buyer,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card'})).value;assert.equal(order.status,'paid');assert.equal(order.totalRubles,'4940.20');
  const stock=(await db.query("SELECT on_hand,reserved FROM ar_stock WHERE sku_id='00000000-0000-4000-8000-000000001001'")).rows[0];assert.deepEqual(stock,{on_hand:2,reserved:0});
 });
 await check('staging worker processes simulated mail; no email transport is involved',async()=>{
  const result=(await post('/api/auth/request',buyer,{email:'staging-login@example.invalid'})).value;assert.ok(result.challengeId);
  let delivered=false;for(let n=0;n<60;n++){const row=(await db.query('SELECT status FROM ar_mail_outbox WHERE deduplication_key=$1',['login:'+result.challengeId])).rows[0];if(row?.status==='delivered'){delivered=true;break;}await pause(150);}assert.ok(delivered);
  const heartbeat=(await db.query("SELECT count(*)::int n FROM ar_worker_heartbeat WHERE name='commerce' AND last_run_at>now()-interval '60 seconds'")).rows[0];assert.equal(heartbeat.n,1);
 });
 await check('staging stays noindex despite a mistakenly enabled SEO switch',async()=>{
  const r=await request('/');assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(await r.text(),/name="robots" content="noindex/);assert.match(await(await request('/robots.txt')).text(),/Disallow: \//);assert.equal((await request('/feed.yml')).status,503);assert.ok(!(await(await request('/sitemap.xml')).text()).includes('<url>'));
 });
 await check('foreign Origin is rejected in staging too',async()=>{const r=await request('/api/commerce/cart',{method:'POST',headers:{Cookie:buyer.cookie,Origin:'https://evil.example','X-CSRF-Token':buyer.csrf,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);});
 report.passed=true;
}finally{
 for(const child of children)if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 await db.close();report.cleanup=true;report.finishedAt=new Date().toISOString();mkdirSync('artifacts/staging',{recursive:true});writeFileSync('artifacts/staging/http-check.json',JSON.stringify(report,null,2)+'\n');
}
