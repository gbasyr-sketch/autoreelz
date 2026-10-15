// Real Astro SSR against disposable synthetic DB; no provider operations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const base='http://127.0.0.1:14381';assert.equal(await fetch(base+'/health').then(()=>true).catch(()=>false),false);
const qa=await createImageDatabase();let app;const checks=[];
try{
 const env={...imageEnvironment(qa.database,'private/session-rate-http'),PORT:'14381',APP_ORIGIN:base};
 app=spawn(process.execPath,['dist/server/entry.mjs'],{env,stdio:['ignore','ignore','inherit']});
 for(let i=0;i<100;i++){if(await fetch(base+'/health').then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,100));}
 const first=await fetch(base+'/api/commerce/session');assert.equal(first.status,200);const cookie=first.headers.getSetCookie().find(x=>x.startsWith('autoreelz2026_shop=')).split(';')[0],session=await first.json();
 const rows=await qa.owner.query('SELECT key FROM ar_rate_limits');assert.equal(rows.rowCount,2);
 const minute=createHmac('sha256',env.APP_SECRET).update('session-create:60:127.0.0.1').digest('hex');assert.ok(rows.rows.some(x=>x.key===minute));
 await qa.owner.query('UPDATE ar_rate_limits SET count=60 WHERE key=$1',[minute]);
 const before=(await qa.owner.query('SELECT count(*)::int n FROM ar_web_sessions')).rows[0].n;
 for(const path of ['/api/commerce/session','/catalog','/unknown-audit-path']){
  const r=await fetch(base+path);assert.equal(r.status,429);assert.ok(Number(r.headers.get('Retry-After'))>0);assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match(r.headers.get('X-Robots-Tag'),/noindex/);
  if(path.startsWith('/api/'))assert.equal((await r.json()).error.code,'SESSION_RATE_LIMIT');else assert.match(await r.text(),/Подождите/);
 }checks.push('API, storefront and unknown paths return429/Retry-After/no-store, never503 or extra sessions');
 assert.equal((await qa.owner.query('SELECT count(*)::int n FROM ar_web_sessions')).rows[0].n,before);
 for(const path of ['/api/commerce/session','/api/commerce/cart','/cart','/checkout','/account']){const r=await fetch(base+path,{headers:{Cookie:cookie},redirect:'follow'});assert.equal(r.status,200,path);}
 checks.push('existing cookie keeps session/cart/cart page/checkout/account available at exhausted limit');
 const csrf=await fetch(base+'/api/commerce/cart',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);checks.push('CSRF protection remains enforced for existing visitor');
 const exit=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:'{}'});assert.equal(exit.status,200);assert.match(exit.headers.get('Set-Cookie'),/Max-Age=0|Expires=Thu, 01 Jan 1970/i);checks.push('logout succeeds over real HTTP while new sessions are blocked');
 for(const path of ['/health','/robots.txt','/sitemap.xml'])assert.equal((await fetch(base+path)).status,200);checks.push('health and discovery endpoints remain available without session creation');
 await fs.mkdir('artifacts/session-rate-limit',{recursive:true});await fs.writeFile('artifacts/session-rate-limit/http.json',JSON.stringify({passed:true,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await qa.close(true);}
