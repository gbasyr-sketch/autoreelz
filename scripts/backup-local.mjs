// Consistent local backup. Only this project's existing writer services are paused.
import {mkdirSync,copyFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {root,project,database,localEnvironment,compose,docker,sql,toFile,privateJson,shaFile,fileInventory,fingerprints,run} from './ops-common.mjs';
localEnvironment();
if(process.argv[2]!=='--create')throw Error('Usage: node scripts/backup-local.mjs --create');
const lock=join(root,'private/backup.lock');
mkdirSync(join(root,'private'),{recursive:true,mode:0o700});
mkdirSync(lock,{mode:0o700});
try{
const start=Date.now(),id=new Date().toISOString().replace(/[:.]/g,'-'),directory=join(root,'private/backups',id);
mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
const running=compose(['ps','--services','--filter','status=running']).split('\n');
if(!running.includes('db')||!running.includes('cms'))throw Error('Local db and CMS must exist and be running before backup');
const writers=['web','worker','cms'].filter(s=>running.includes(s));
const manifest={format:1,id,project,database,startedAt:new Date(start).toISOString(),complete:false,gitSha:run('git',['rev-parse','HEAD']),gitDirty:Boolean(run('git',['status','--porcelain'])),writers,postgresImage:docker(['inspect',`${project}-db-1`,'--format','{{.Config.Image}}'])};
let resumeError;
privateJson(join(directory,'manifest.json'),manifest);
try{
 compose(['stop','--timeout','30',...writers]);
 if(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename IN('ar_app','ar_cms') AND pid<>pg_backend_pid()")!=='0')throw Error('Other store connections remain; stop local dev/QA writers before backing up');
 manifest.tables=fingerprints();
 manifest.migrations=JSON.parse(sql("SELECT coalesce(json_agg(t ORDER BY name),'[]') FROM (SELECT name,sha256 FROM ar_migrations) t"));
 toFile('docker',['compose','-p',project,'exec','-T','db','pg_dump','-U','ar_migrator','-d',database,'-Fc'],join(directory,'database.dump'));
 toFile('docker',['compose','-p',project,'exec','-T','db','pg_dumpall','-U','ar_migrator','--roles-only','--no-role-passwords'],join(directory,'roles.sql'));
 mkdirSync(join(directory,'uploads'),{mode:0o700});compose(['cp','cms:/directus/uploads/.',join(directory,'uploads')]);
 copyFileSync(join(root,'.env'),join(directory,'environment.env'));chmodSync(join(directory,'environment.env'),0o600);
 manifest.media=fileInventory(join(directory,'uploads'),{secure:true});
 manifest.files=Object.fromEntries(['database.dump','roles.sql','environment.env'].map(name=>[name,shaFile(join(directory,name))]));
 manifest.complete=true;
}finally{
 try{compose(['start',...writers]);}catch{resumeError='Could not restart previous writer services; inspect the new project';}
 manifest.finishedAt=new Date().toISOString();manifest.elapsedMs=Date.now()-start;manifest.resumed=!resumeError;
 privateJson(join(directory,'manifest.json'),manifest);
}
if(resumeError)throw Error(resumeError);
console.log(JSON.stringify({backup:`private/backups/${id}`,complete:manifest.complete,mediaFiles:Object.keys(manifest.media).length,tables:Object.keys(manifest.tables).length,elapsedMs:manifest.elapsedMs}));

}finally{rmSync(lock,{recursive:true,force:true});}
