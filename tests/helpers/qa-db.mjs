import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {env,root} from '../../scripts/cms-client.mjs';
export async function qaDatabase(label,applyFiles=[]){
 assert.match(label,/^[a-z0-9_]+$/);assert.equal(env.POSTGRES_DB,'autoreelz2026_new');
 const database=`ar_qa_${label}_${process.pid}_${Date.now()}`;
 const args=['compose','-p','autoreelz2026-new','exec','-T','db'];
 const command=(tail,input)=>{const r=spawnSync('docker',[...args,...tail],{cwd:root,input,encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024});if(r.status!==0)throw Error(r.stderr||'QA database command failed');return r.stdout;};
 const sql=(statement,db)=>command(['psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d',db],statement);
 let created=false,owner;
 try{
  const dump=command(['pg_dump','-U','ar_migrator','-d',env.POSTGRES_DB]);
  sql(`CREATE DATABASE ${database};`,env.POSTGRES_DB);created=true;sql(dump,database);
  for(const file of applyFiles){assert.match(file,/^migrations\/\d+_[a-z_]+\.sql$/);sql('BEGIN;\n'+readFileSync(file,'utf8')+'\nCOMMIT;',database);}
  process.env.AR_DATABASE_NAME=database;process.env.AR_DB_HOST='127.0.0.1';process.env.AR_DB_PORT=env.DB_PORT;process.env.APP_DB_PASSWORD=env.APP_DB_PASSWORD;
  owner=new pg.Pool({host:'127.0.0.1',port:Number(env.DB_PORT),database,user:'ar_migrator',password:env.POSTGRES_PASSWORD,max:5});
  return{database,owner,query:(statement,params=[])=>owner.query(statement,params),async close(){await owner.end();sql(`DROP DATABASE ${database} WITH (FORCE);`,env.POSTGRES_DB);}};
 }catch(error){if(owner)await owner.end();if(created)sql(`DROP DATABASE ${database} WITH (FORCE);`,env.POSTGRES_DB);throw error;}
}
