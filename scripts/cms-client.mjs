import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('..',import.meta.url));
export const env=Object.fromEntries(readFileSync(`${root}/.env`,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(env.COMPOSE_PROJECT_NAME!=='autoreelz2026-new'||env.POSTGRES_DB!=='autoreelz2026_new')throw new Error('Refusing to access an unexpected project/database');
export const base=`http://127.0.0.1:${env.CMS_PORT||28055}`;
export async function client(email=env.ADMIN_EMAIL,password=env.ADMIN_PASSWORD){
 const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 const auth=await login.json();if(!login.ok)throw new Error(`New CMS login failed (${login.status})`);
 const token=auth.data.access_token;
 return async function api(method,path,data){
  const multipart=data instanceof FormData;
  const res=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(multipart?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});
  const out=res.status===204?{}:await res.json();
  if(!res.ok)throw new Error(`${method} ${path}: ${res.status} ${out.errors?.map(e=>e.message).join('; ')??'request failed'}`);
  return out.data;
 };
}
