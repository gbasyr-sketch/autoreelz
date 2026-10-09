import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import pg from 'pg';
export const localConfig=JSON.parse(await fs.readFile('private/ai-image-local/config.json','utf8'));
export async function createImageDatabase(name='ar_qa_ai_images_'+randomUUID().replaceAll('-','').slice(0,12)){
 if(!/^ar_qa_ai_images_[a-z0-9_]+$/.test(name))throw Error('QA database name required');
 const admin=new pg.Pool({host:'127.0.0.1',port:localConfig.port,user:'ar_migrator',password:localConfig.ownerPassword,database:'postgres'});
 for(const [role,login]of [['ar_app',true],['ar_cms',false]]){if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await admin.query(`CREATE ROLE ${role} ${login?'LOGIN':''}`);}
 await admin.query(`ALTER ROLE ar_app PASSWORD '${localConfig.appPassword}'`);
 const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount;
 if(!exists)await admin.query('CREATE DATABASE '+name);await admin.end();
 const owner=new pg.Pool({host:'127.0.0.1',port:localConfig.port,user:'ar_migrator',password:localConfig.ownerPassword,database:name});
 if(!exists){
  await owner.query(`CREATE TABLE directus_files(id uuid PRIMARY KEY,storage text DEFAULT 'local',filename_disk text,filename_download text,title text,type text,filesize bigint,width integer,height integer,modified_on timestamptz DEFAULT now());CREATE TABLE directus_fields(collection text,field text);CREATE TABLE directus_presets(collection text,layout_query json);CREATE TABLE ar_migrations(name text PRIMARY KEY,sha256 text NOT NULL);`);
  for(const file of (await fs.readdir('migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort()){const sql=await fs.readFile('migrations/'+file,'utf8');await owner.query('BEGIN');try{await owner.query(sql);await owner.query('INSERT INTO ar_migrations VALUES($1,$2)',[file,createHash('sha256').update(sql).digest('hex')]);await owner.query('COMMIT');}catch(e){await owner.query('ROLLBACK');throw e;}}
 }
 return{database:name,owner,async close(drop=false){await owner.end();if(drop){if(name.includes('pilot')||name.endsWith('_local'))throw Error('Persistent image histories must not be deleted');const p=new pg.Pool({host:'127.0.0.1',port:localConfig.port,user:'ar_migrator',password:localConfig.ownerPassword,database:'postgres'});await p.query('DROP DATABASE '+name+' WITH (FORCE)');await p.end();}}};
}
export function imageEnvironment(database,root,provider='simulation'){
 return{...process.env,STORE_MODE:'local-test',APP_ORIGIN:'http://127.0.0.1:'+localConfig.webPort,APP_SECRET:localConfig.appSecret,AR_DB_HOST:'127.0.0.1',AR_DB_PORT:String(localConfig.port),AR_DATABASE_NAME:database,APP_DB_PASSWORD:localConfig.appPassword,CMS_INTERNAL_URL:'http://127.0.0.1:'+localConfig.cmsPort,CMS_UPLOADS_PATH:path.resolve(root,'uploads'),SHIPPING_PROVIDER:'simulation',PAYMENT_PROVIDER:'simulation',AI_TEXT_PROVIDER:'disabled',AI_TEXT_ALLOW_OPENAI:'false',AI_TEXT_ALLOW_DEEPSEEK:'false',AI_IMAGE_PROVIDER:provider,AI_IMAGE_BUDGET_KEY:provider==='simulation'?'qa-local-images':'pilot-2026-10-09',AI_IMAGE_BUDGET_USD:'5',AI_IMAGE_TRANSPORT:'direct',AI_IMAGE_STORAGE_PATH:path.resolve(root,'images'),HOST:'127.0.0.1',PORT:String(localConfig.webPort)};
}
