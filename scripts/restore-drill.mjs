// Restore into a new disposable PostgreSQL container: no host ports, no network, no CMS activation.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {root,project,database,localEnvironment,backupPath,docker,sql,privateJson,shaFile,fileInventory,fingerprints} from './ops-common.mjs';
localEnvironment();
const source=backupPath(process.argv[2]),manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
assert.equal(manifest.complete,true);assert.equal(manifest.project,project);assert.equal(manifest.database,database);
for(const name of ['database.dump','roles.sql','environment.env'])assert.equal(shaFile(join(source,name)),manifest.files[name],`Backup checksum mismatch: ${name}`);
assert.deepEqual(fileInventory(join(source,'uploads')),manifest.media);
assert.match(manifest.postgresImage,/^postgres:17\.[0-9]+-alpine@sha256:[a-f0-9]{64}$/);
const name=`${project}-restore-${process.pid}-${Date.now()}`,scratch=join(root,'private/restore-drills',name),db='ar_qa_restore',user='ar_restore_admin';
mkdirSync(scratch,{recursive:true,mode:0o700});
const envPath=join(scratch,'container.env');writeFileSync(envPath,`POSTGRES_USER=${user}\nPOSTGRES_PASSWORD=${randomBytes(48).toString('hex')}\nPOSTGRES_DB=postgres\n`,{mode:0o600});
const report={startedAt:new Date().toISOString(),backupId:manifest.id,container:name,network:'none',hostPorts:[],licensedCmsStarted:false,passed:false,cleanup:false};
let created=false;
try{
 docker(['create','--name',name,'--network','none','--label',`autoreelz.restore-drill=${name}`,'--env-file',envPath,'--memory','512m',manifest.postgresImage]);created=true;docker(['start',name]);
 // TCP readiness skips the temporary socket-only server used by image initialization.
 let ready=false;for(let n=0;n<80;n++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U',user]);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
 assert.ok(ready,'Restore PostgreSQL did not start');
 sql(readFileSync(join(source,'roles.sql'),'utf8'),{container:name,user,db:'postgres'});
 sql(`CREATE DATABASE ${db} OWNER ar_migrator;`,{container:name,user,db:'postgres'});
 const fd=openSync(join(source,'database.dump'),'r');try{docker(['exec','-i',name,'pg_restore','--exit-on-error','--single-transaction','-U',user,'-d',db],{stdio:[fd,'pipe','pipe']});}finally{closeSync(fd);}
 assert.deepEqual(fingerprints({container:name,user,db}),manifest.tables,'Restored row fingerprints differ');
 const grants=JSON.parse(sql("SELECT json_build_object('appReadsCatalog',has_table_privilege('ar_app','ar_products','SELECT'),'appCannotEditCatalog',NOT has_table_privilege('ar_app','ar_products','DELETE'),'cmsCannotWriteStock',NOT has_table_privilege('ar_cms','ar_stock','UPDATE'))",{container:name,user,db}));assert.ok(Object.values(grants).every(Boolean));
 cpSync(join(source,'uploads'),join(scratch,'uploads'),{recursive:true});assert.deepEqual(fileInventory(join(scratch,'uploads'),{secure:true}),manifest.media);
 report.tablesMatched=Object.keys(manifest.tables).length;report.rowsMatched=Object.values(manifest.tables).reduce((n,t)=>n+t.rows,0);report.mediaMatched=Object.keys(manifest.media).length;report.grants=grants;report.passed=true;
}finally{
 if(created)docker(['rm','-f','-v',name]);rmSync(scratch,{recursive:true,force:true});report.cleanup=true;report.finishedAt=new Date().toISOString();report.elapsedMs=Date.parse(report.finishedAt)-Date.parse(report.startedAt);
 mkdirSync(join(root,'artifacts/stage-7'),{recursive:true});writeFileSync(join(root,'artifacts/stage-7/restore-drill.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
