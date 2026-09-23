import{existsSync,readFileSync}from'node:fs';
import{join}from'node:path';
let local:Record<string,string>|undefined;
export function setting(key:string,fallback=''){
 if(process.env[key]!==undefined)return process.env[key]!;
 if(!local){const path=join(process.cwd(),'.env');local=existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];})):{};}
 return local[key]??fallback;
}
export function appConfig(){
 const database=setting('AR_DATABASE_NAME',setting('POSTGRES_DB','autoreelz2026_new'));
 if(database!=='autoreelz2026_new'&&!/^ar_qa_[a-zA-Z0-9_]+$/.test(database))throw new Error('Unexpected store database');
 const secret=setting('APP_SECRET');if(secret.length<32)throw new Error('APP_SECRET is not configured');
 return {database,secret,host:setting('AR_DB_HOST','127.0.0.1'),port:Number(setting('AR_DB_PORT',setting('DB_PORT','65432'))),password:setting('APP_DB_PASSWORD'),origin:setting('APP_ORIGIN','http://127.0.0.1:14323'),mode:setting('STORE_MODE','local-test'),cmsBase:setting('CMS_INTERNAL_URL',`http://127.0.0.1:${setting('CMS_PORT','28055')}`),cmsCookie:'autoreelz2026_new_session',uploadsPath:setting('CMS_UPLOADS_PATH','/cms-uploads')};
}
export function requireLocalTest(){const c=appConfig();if(c.mode!=='local-test'||!['127.0.0.1','localhost','[::1]'].includes(new URL(c.origin).hostname))throw new Error('Test adapters are available only on the local store');}
export function isTestEnvironment(mode:string,origin:string){
 try{const url=new URL(origin);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return false;
  if(mode==='local-test')return['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&['http:','https:'].includes(url.protocol);
  return mode==='staging'&&url.origin==='https://autoreelz.ru';
 }catch{return false;}
}
export function requireTestEnvironment(){const c=appConfig();if(!isTestEnvironment(c.mode,c.origin))throw new Error('Test adapters are available only in the local or approved HTTPS staging environment');}
