import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {root} from '../scripts/ops-common.mjs';
const dir=join(root,'tmp/stage-7-config');mkdirSync(dir,{recursive:true});
const file=join(dir,'validation.env');
const replacements={RELEASE_IMAGE:'autoreelz2026-new-web:stage6',ADMIN_EMAIL:'qa@example.invalid',CMS_PUBLIC_URL:'https://cms.example.invalid',TLS_EMAIL:'qa@example.invalid',YML_COMPANY_NAME:'QA only'};
const values=readFileSync('infra/release/environment.example','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const [k,...v]=l.split('=');return`${k}=${v.join('=')||replacements[k]||'validation-placeholder-not-a-real-secret'}`;});writeFileSync(file,values.join('\n'),{mode:0o600});
function command(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000});assert.equal(r.status,0,'Config validation failed');return r.stdout;}
try{
 const c=JSON.parse(command(['compose','--env-file',file,'-f','infra/release/compose.yaml','--profile','bootstrap','config','--format','json']));
 assert.equal(c.name,'autoreelz2026-release');for(const name of ['db','web','worker'])assert.ok(!c.services[name].ports?.length);
 assert.ok(c.services.cms.ports.every(p=>p.host_ip==='127.0.0.1'));assert.equal(c.services.web.environment.SEO_INDEXING_ENABLED,'false');assert.equal(c.services.cms.environment.TELEMETRY,'true');assert.equal(c.services.web.environment.STORE_MODE,'production');
 const caddy='caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b';
 command(['run','--rm','--network','none','-e','TLS_EMAIL=qa@example.invalid','-v',`${root}/infra/release/Caddyfile:/etc/caddy/Caddyfile:ro`,caddy,'caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);
 const report={checkedAt:new Date().toISOString(),passed:true,composeValidated:true,noPublicDbOrAppPorts:true,cmsLoopbackOnly:true,indexingDisabled:true,caddyValidatedOffline:true,caddyImage:caddy,publicTlsCertificateIssued:false,serverDeployed:false,limitations:['Template only; production adapters and final server/credentials are not configured','No DNS, public ports or ACME certificate activation performed']};
 mkdirSync('artifacts/stage-7',{recursive:true});writeFileSync('artifacts/stage-7/release-config.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{rmSync(dir,{recursive:true,force:true});}
