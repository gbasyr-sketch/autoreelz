import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {root} from '../scripts/ops-common.mjs';
const image='caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b',password='qa-gate-password-not-for-deployment',username='qa_owner';
const dir=join(root,'tmp',`stage-gate-${process.pid}`),name=`autoreelz2026-new-gateqa-${process.pid}`;mkdirSync(dir,{recursive:true});let created=false;
const command=(args,options={})=>{const r=spawnSync('docker',args,{cwd:root,encoding:'utf8',timeout:30000,...options});assert.equal(r.status,0,'Docker staging check failed');return r.stdout.trim();};
try{
 const hash=command(['run','--rm','--network','none',image,'caddy','hash-password','--plaintext',password]);
 const template=readFileSync('infra/release/environment.example','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const [k,...v]=l.split('=');return`${k}=${v.join('=')||({RELEASE_IMAGE:'autoreelz2026-new-web:stage7-prep',ADMIN_EMAIL:'qa@example.invalid',CMS_PUBLIC_URL:'https://cms.example.invalid',TLS_EMAIL:'qa@example.invalid',YML_COMPANY_NAME:'QA'})[k]||'qa-not-a-secret'}`;}).join('\n');
 const envFile=join(dir,'validation.env');writeFileSync(envFile,template+'\n',{mode:0o600});
 const doc=JSON.parse(command(['compose','--env-file',envFile,'-f','infra/release/compose.yaml','-f','infra/release/staging.yaml','config','--format','json'],{env:{...process.env,TEST_GATE_USER:username,TEST_GATE_HASH:hash}}));
 assert.equal(doc.services.web.environment.STORE_MODE,'staging');assert.equal(doc.services.worker.environment.STORE_MODE,'staging');assert.equal(doc.services.web.environment.SEO_INDEXING_ENABLED,'false');assert.equal(doc.services.edge.environment.TEST_GATE_HASH.replaceAll('$$','$'),hash);assert.ok(doc.services.edge.volumes.some(v=>v.source.endsWith('Caddyfile.staging')));
 command(['run','--rm','--network','none','-e','TLS_EMAIL=qa@example.invalid','-e',`TEST_GATE_USER=${username}`,'-e',`TEST_GATE_HASH=${hash}`,'-v',`${root}/infra/release/Caddyfile.staging:/etc/caddy/Caddyfile:ro`,image,'caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);
 // Exercise actual gateway auth in an isolated container; TLS/ACME remain untested until deployment.
 const config=readFileSync('infra/release/Caddyfile.staging','utf8').replace('autoreelz.ru {','http://127.0.0.1:18444 {').replace('reverse_proxy web:4321','reverse_proxy 127.0.0.1:18445')+'\n:18445 {\n respond "ok:{http.request.header.Authorization}"\n}\n';
 const file=join(dir,'Caddyfile');writeFileSync(file,config);
 command(['create','--name',name,'--network','none','-e','TLS_EMAIL=qa@example.invalid','-e',`TEST_GATE_USER=${username}`,'-e',`TEST_GATE_HASH=${hash}`,'-v',`${file}:/etc/caddy/Caddyfile:ro`,image]);created=true;command(['start',name]);
 const get=(value)=>spawnSync('docker',['exec',name,'wget','-S','-O','-',...(value?['--header',`Authorization: Basic ${Buffer.from(value).toString('base64')}`]:[]),'http://127.0.0.1:18444/'],{encoding:'utf8',timeout:5000});
 let unauth;for(let i=0;i<30;i++){unauth=get();if(unauth.stderr.includes('401'))break;await new Promise(r=>setTimeout(r,100));}assert.match(unauth.stderr,/401/);
 assert.match(get(username+':wrong').stderr,/401/);
 const allowed=get(username+':'+password);assert.equal(allowed.status,0);assert.equal(allowed.stdout,'ok:');assert.match(allowed.stderr,/X-Robots-Tag: noindex, nofollow, noarchive/i);
 const report={checkedAt:new Date().toISOString(),passed:true,stagingOverlayValidated:true,caddyConfigValidated:true,anonymousDenied:true,wrongPasswordDenied:true,authorizedAccess:true,gatewayCredentialStripped:true,noindexHeader:true,network:'none',publicTlsTested:false};mkdirSync('artifacts/staging',{recursive:true});writeFileSync('artifacts/staging/gate-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(created)command(['rm','-f','-v',name]);rmSync(dir,{recursive:true,force:true});}
