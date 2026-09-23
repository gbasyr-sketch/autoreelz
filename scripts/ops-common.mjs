import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,lstatSync,chmodSync,openSync,closeSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const root=fileURLToPath(new URL('..',import.meta.url));
export const project='autoreelz2026-new',database='autoreelz2026_new';
export function localEnvironment(){
 const values=Object.fromEntries(readFileSync(join(root,'.env'),'utf8').split(/\r?\n/).filter(s=>s&&!s.startsWith('#')&&s.includes('=')).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
 if(values.COMPOSE_PROJECT_NAME!==project||values.POSTGRES_DB!==database)throw Error('Unexpected project/database; refusing operation');
 return values;
}
export function run(command,args,options={}){
 const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:64*1024*1024,...options});
 if(r.error||r.status!==0)throw Error(`${command} failed (${r.status??'spawn'}); command output is suppressed to protect private data`);
 return r.stdout?.trim()??'';
}
export const docker=(args,options)=>run('docker',args,options);
export const compose=(args,options)=>docker(['compose','-p',project,...args],options);
export function toFile(command,args,path){
 const fd=openSync(path,'wx',0o600);try{run(command,args,{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
}
export function sql(input,{container,user='ar_migrator',db=database}={}){
 const target=container?['exec','-i',container]:['compose','-p',project,'exec','-T','db'];
 return docker([...target,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U',user,'-d',db],{input});
}
export function privateJson(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);}
export const shaFile=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function fileInventory(directory,{secure=false}={}){
 const files={};
 function visit(dir,prefix=''){
  if(secure)chmodSync(dir,0o700);
  for(const name of readdirSync(dir).sort()){
   const path=join(dir,name),relative=prefix+name,stat=lstatSync(path);
   if(stat.isSymbolicLink())throw Error('Symlink in backup media is not supported');
   if(stat.isDirectory())visit(path,relative+'/');
   else if(stat.isFile()){if(secure)chmodSync(path,0o600);files[relative]={bytes:stat.size,sha256:shaFile(path)};}
   else throw Error('Unexpected media file type');
  }
 }
 visit(directory);return files;
}
export function fingerprints(options){
 const names=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",options).split('\n').filter(Boolean);
 const tables={};for(const table of names){
  if(!/^[a-z][a-z0-9_]+$/.test(table))throw Error('Unexpected table identifier');
  const data=sql(`SELECT json_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''))) FROM public."${table}" t`,options);
  tables[table]=JSON.parse(data);
 }
 return tables;
}
export function backupPath(value){
 const base=resolve(root,'private/backups'),path=resolve(root,value??'');
 if(!path.startsWith(base+'/')||path===base)throw Error('Backup must be inside this project private/backups');
 if(!realpathSync(path).startsWith(realpathSync(base)+'/'))throw Error('Backup resolves outside project backups');
 return path;
}
