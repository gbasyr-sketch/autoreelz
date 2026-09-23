// Clone only this new project's trusted backup, scrub ephemeral data, and generate new server secrets.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,cpSync,chmodSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {root,project,database,localEnvironment,backupPath,sql,docker,toFile,privateJson,shaFile,fileInventory} from './ops-common.mjs';
const sourceEnv=localEnvironment(),source=backupPath(process.argv[2]),manifest=JSON.parse(readFileSync(join(source,'manifest.json')));
assert.equal(manifest.complete,true);assert.equal(manifest.project,project);assert.equal(shaFile(join(source,'database.dump')),manifest.files['database.dump']);assert.deepEqual(fileInventory(join(source,'uploads')),manifest.media);
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=join(root,'private','staging-transfer-'+stamp),clone=`ar_qa_deploy_${process.pid}_${Date.now()}`;
assert.match(clone,/^ar_qa_deploy_\d+_\d+$/);mkdirSync(output,{mode:0o700});
const random=()=>randomBytes(32).toString('hex'),adminPassword=random(),editorPassword=random(),gatePassword=randomBytes(24).toString('base64url');
const hashCode=`const fs=require('fs'),p=require('path');(async()=>{const b=p.dirname(require.resolve('@directus/api'));const {generateHash}=await import(require('url').pathToFileURL(p.join(b,'utils/generate-hash.js')).href);const v=JSON.parse(fs.readFileSync(0,'utf8')),r={};for(const [k,s]of Object.entries(v))r[k]=await generateHash(s);process.stdout.write(JSON.stringify(r));})();`;
const hashes=JSON.parse(docker(['compose','-p',project,'exec','-T','cms','node','-e',hashCode],{input:JSON.stringify({adminPassword,editorPassword})}));
const gateHash=docker(['run','--rm','-i','--network','none','caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b','caddy','hash-password'],{input:gatePassword+'\n'});
assert.match(gateHash,/^\$2[aby]\$/);
const values={RELEASE_IMAGE:'autoreelz2026-new-web:staging-pending',POSTGRES_DB:database,POSTGRES_USER:'ar_migrator',POSTGRES_PASSWORD:random(),CMS_DB_PASSWORD:random(),APP_DB_PASSWORD:random(),READ_DB_PASSWORD:random(),DIRECTUS_SECRET:random(),APP_SECRET:random(),ADMIN_EMAIL:sourceEnv.ADMIN_EMAIL,ADMIN_PASSWORD:adminPassword,EDITOR_EMAIL:sourceEnv.EDITOR_EMAIL,EDITOR_PASSWORD:editorPassword,CMS_PUBLIC_URL:'https://autoreelz.ru/cms',TEST_GATE_USER:'owner',TEST_GATE_HASH:gateHash,SEO_INDEXING_ENABLED:'false',YML_COMPANY_NAME:''};
writeFileSync(join(output,'server.env'),Object.entries(values).map(([k,v])=>`${k}=${v.includes('$')?"'"+v+"'":v}`).join('\n')+'\n',{mode:0o600});
privateJson(join(output,'access.json'),{store:{url:'https://autoreelz.ru',username:'owner',password:gatePassword},cms:{url:'https://autoreelz.ru/cms/admin',email:values.ADMIN_EMAIL,password:adminPassword},editor:{email:values.EDITOR_EMAIL,password:editorPassword}});
let created=false;
try{
 sql(`CREATE DATABASE ${clone};`);created=true;
 const fd=openSync(join(source,'database.dump'),'r');try{docker(['compose','-p',project,'exec','-T','db','pg_restore','-U','ar_migrator','-d',clone,'--exit-on-error','--single-transaction'],{stdio:[fd,'pipe','pipe']});}finally{closeSync(fd);}
 const q=statement=>sql(statement,{db:clone});
 q('TRUNCATE directus_sessions,directus_activity,directus_revisions,directus_notifications,ar_customers,ar_web_sessions,ar_orders,ar_command_results,ar_rate_limits,ar_mail_outbox,ar_owner_notifications,ar_worker_heartbeat,ar_description_drafts RESTART IDENTITY CASCADE; UPDATE ar_stock SET reserved=0; UPDATE directus_settings SET license_key=NULL,license_token=NULL; UPDATE directus_users SET token=NULL;');
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 for(const [email,hash]of [[values.ADMIN_EMAIL,hashes.adminPassword],[values.EDITOR_EMAIL,hashes.editorPassword]])q(`UPDATE directus_users SET password=${quote(hash)} WHERE email=${quote(email)};`);
 q("UPDATE directus_fields SET options=replace(options::text,'http://127.0.0.1:14323','https://autoreelz.ru')::json WHERE options::text LIKE '%http://127.0.0.1:14323%'; UPDATE directus_collections SET preview_url=replace(preview_url,'http://127.0.0.1:14323','https://autoreelz.ru') WHERE preview_url LIKE '%http://127.0.0.1:14323%';");
 assert.equal(q('SELECT count(*) FROM directus_settings WHERE license_key IS NOT NULL OR license_token IS NOT NULL'),'0');assert.equal(q('SELECT count(*) FROM ar_orders'),'0');
 toFile('docker',['compose','-p',project,'exec','-T','db','pg_dump','-U','ar_migrator','-d',clone,'-Fc'],join(output,'database.dump'));
 cpSync(join(source,'uploads'),join(output,'uploads'),{recursive:true});fileInventory(join(output,'uploads'),{secure:true});
 copyFileSync(join(root,'private/directus-oig-key.txt'),join(output,'license-key.txt'));chmodSync(join(output,'license-key.txt'),0o600);
 privateJson(join(output,'manifest.json'),{createdAt:new Date().toISOString(),sourceBackup:manifest.id,targetProject:'autoreelz2026-release',publicUrl:'https://autoreelz.ru',cmsPublicUrl:values.CMS_PUBLIC_URL,licenseBindingCopied:false,credentialsRotated:true,sessionsAndTestOrdersCopied:false,products:Number(q('SELECT count(*) FROM ar_products')),skus:Number(q('SELECT count(*) FROM ar_skus')),dumpSha256:shaFile(join(output,'database.dump')),media:manifest.media});
 console.log(JSON.stringify({output:output.slice(root.length),licenseBindingCopied:false,credentialsRotated:true,products:Number(q('SELECT count(*) FROM ar_products')),skus:Number(q('SELECT count(*) FROM ar_skus'))}));
}finally{if(created)sql(`DROP DATABASE ${clone} WITH (FORCE);`);}
