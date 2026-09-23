import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {backupPath,root} from '../scripts/ops-common.mjs';
const source=backupPath(process.argv[2]),dir=join(root,'private/backups',`qa-corrupt-${Date.now()}`),lock=join(root,'private/backup.lock');let locked=false;
mkdirSync(dir,{mode:0o700});
try{
 for(const f of ['manifest.json','database.dump'])copyFileSync(join(source,f),join(dir,f));
 const bytes=readFileSync(join(dir,'database.dump'));bytes[bytes.length-1]^=1;writeFileSync(join(dir,'database.dump'),bytes,{mode:0o600});
 const r=spawnSync(process.execPath,['scripts/restore-drill.mjs',dir],{encoding:'utf8',cwd:root});assert.notEqual(r.status,0);assert.match(r.stderr,/Backup checksum mismatch/);
 assert.throws(()=>backupPath('/tmp'),/inside this project/);
 const link=join(dir,'outside');symlinkSync('/tmp',link);assert.throws(()=>backupPath(link),/outside project/);
 mkdirSync(lock,{mode:0o700});locked=true;
 const concurrent=spawnSync(process.execPath,['scripts/backup-local.mjs','--create'],{encoding:'utf8',cwd:root});assert.notEqual(concurrent.status,0);assert.match(concurrent.stderr,/EEXIST/);
 const report={checkedAt:new Date().toISOString(),passed:true,corruptDumpRejectedBeforeRestore:true,outsidePathRejected:true,symlinkEscapeRejected:true,concurrentBackupRejected:true};mkdirSync('artifacts/stage-7',{recursive:true});writeFileSync('artifacts/stage-7/restore-guards.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{rmSync(dir,{recursive:true,force:true});if(locked)rmSync(lock,{recursive:true,force:true});}
