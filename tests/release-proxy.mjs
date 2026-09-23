import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {qaDatabase} from './helpers/qa-db.mjs';
import {env,root} from '../scripts/cms-client.mjs';
const base='http://127.0.0.1:14330',origin='https://autoreelz.ru',revision='f'.repeat(40);
assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false,'QA port occupied');
const db=await qaDatabase('release'),report={startedAt:new Date().toISOString(),checks:[],passed:false,cleanup:false};let server;
const headers={'X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https'};
const request=(path,options={})=>fetch(base+path,{...options,headers:{...headers,...options.headers}});
const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
try{
 server=spawn(process.execPath,['dist/server/entry.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'14330',AR_DATABASE_NAME:db.database,AR_DB_HOST:'127.0.0.1',AR_DB_PORT:env.DB_PORT,APP_DB_PASSWORD:env.APP_DB_PASSWORD,APP_SECRET:randomBytes(48).toString('hex'),APP_REVISION:revision,APP_ORIGIN:origin,STORE_MODE:'production',SEO_INDEXING_ENABLED:'false'},stdio:'ignore'});
 let ready=false;for(let n=0;n<50;n++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false)){ready=true;break;}await new Promise(r=>setTimeout(r,150));}assert.ok(ready);
 await check('health exposes a bounded revision without private operational metrics',async()=>{const r=await request('/health');assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,revision});assert.match(r.headers.get('cache-control'),/no-store/);});
 let cookie,csrf;
 await check('trusted HTTPS proxy creates Secure HttpOnly SameSite cookie; staged SEO stays disabled',async()=>{const r=await request('/api/commerce/session');assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/Secure/i);assert.match(c,/HttpOnly/i);assert.match(c,/SameSite=Lax/i);cookie=c.split(';')[0];csrf=(await r.json()).csrfToken;assert.ok(csrf);const robots=await request('/robots.txt');assert.match(await robots.text(),/Disallow: \//);assert.equal((await request('/feed.yml')).status,503);assert.ok(!(await(await request('/sitemap.xml')).text()).includes('<url>'));});
 await check('valid proxy Origin and CSRF reach the normal authentication check',async()=>{const r=await request('/api/social/favorites',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:randomUUID(),action:'merge',productIds:[]})});assert.equal(r.status,401);assert.equal((await r.json()).error.code,'AUTH_REQUIRED');});
 await check('foreign forwarded host and foreign Origin cannot pass CSRF checks',async()=>{for(const extra of [{'X-Forwarded-Host':'attacker.example.invalid'},{Origin:'https://attacker.example.invalid'}]){const r=await request('/api/social/favorites',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json',...extra},body:JSON.stringify({idempotencyKey:randomUUID(),action:'merge',productIds:[]})});assert.equal(r.status,403);}});
 await check('production mode cannot invoke local test payments or issue simulated login mail',async()=>{for(const [path,body]of [['/api/commerce/pay',{orderId:randomUUID(),shippingVersion:0,method:'card'}],['/api/auth/request',{email:'release-qa@example.invalid'}]]){const r=await request(path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({...body,idempotencyKey:randomUUID()})});assert.ok(r.status>=400);}assert.equal((await db.query("SELECT count(*)::int n FROM ar_mail_outbox WHERE recipient='release-qa@example.invalid'")).rows[0].n,0);});
 report.passed=true;
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(server.exitCode===null&&server.signalCode===null)server.kill('SIGKILL');}
 await db.close();report.cleanup=true;report.finishedAt=new Date().toISOString();mkdirSync('artifacts/stage-7',{recursive:true});writeFileSync('artifacts/stage-7/proxy-check.json',JSON.stringify(report,null,2)+'\n');
}
