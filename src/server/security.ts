import{randomBytes,createHash,createHmac,timingSafeEqual}from'node:crypto';
import type{APIContext}from'astro';
import type{PoolClient}from'pg';
import type{ShopSession}from'../lib/commerce-types.ts';
import{appConfig}from'./config.ts';
import{query,transaction}from'./db.ts';
import{StoreError,uuid,iso}from'./errors.ts';
export const COOKIE='autoreelz2026_shop';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const sign=(value:string)=>createHmac('sha256',appConfig().secret).update(value).digest('hex');
export function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value)??'null';}
export function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function setSessionCookie(ctx:Pick<APIContext,'cookies'>,token:string){ctx.cookies.set(COOKIE,token,{path:'/',httpOnly:true,sameSite:'lax',secure:new URL(appConfig().origin).protocol==='https:',maxAge:30*24*60*60});}
export async function getSession(ctx:Pick<APIContext,'cookies'>):Promise<ShopSession>{
 const token=ctx.cookies.get(COOKIE)?.value;
 if(token&&/^[A-Za-z0-9_-]{40,100}$/.test(token)){
  const r=await query('SELECT s.id,s.csrf_token,s.expires_at,c.email FROM ar_web_sessions s LEFT JOIN ar_customers c ON c.id=s.customer_id WHERE token_hash=$1 AND expires_at>now()',[hash(token)]);
  if(r.rows[0]){const s=r.rows[0];return{id:s.id,csrfToken:s.csrf_token,email:s.email,expiresAt:iso(s.expires_at)!};}
 }
 const newToken=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');
 const session=await transaction(async c=>{const r=await c.query("INSERT INTO ar_web_sessions(token_hash,csrf_token,expires_at) VALUES($1,$2,now()+interval '30 days') RETURNING id,expires_at",[hash(newToken),csrfToken]);await c.query('INSERT INTO ar_carts(session_id) VALUES($1)',[r.rows[0].id]);return{id:r.rows[0].id,csrfToken,email:null,expiresAt:iso(r.rows[0].expires_at)!};});
 setSessionCookie(ctx,newToken);return session;
}
export async function readBody(request:Request,session:ShopSession,maxBytes=16384){
 if(request.headers.get('Origin')!==appConfig().origin||new URL(request.url).host!==new URL(appConfig().origin).host)throw new StoreError('ORIGIN','Источник запроса не разрешён.',403);
 if(!equal(request.headers.get('X-CSRF-Token')??'',session.csrfToken))throw new StoreError('CSRF','Сессия обновилась. Обновите страницу и повторите действие.',403);
 return jsonBody(request,maxBytes);
}
export async function jsonBody(request:Request,maxBytes=16384){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)throw new Error('Invalid JSON body limit');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new StoreError('CONTENT_TYPE','Ожидается JSON.',415);
 const reader=request.body?.getReader();let length=0;const chunks:Uint8Array[]=[];
 if(reader)for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes){await reader.cancel();throw new StoreError('TOO_LARGE','Слишком большой запрос.',413);}chunks.push(value);}
 try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data as Record<string,unknown>;}catch{throw new StoreError('INVALID_JSON','Не удалось прочитать запрос.');}
}
export async function idempotent<T>(c:PoolClient,scope:string,key:unknown,payload:unknown,fn:()=>Promise<T>):Promise<T>{
 const requestKey=uuid(key),requestHash=hash(canonical(payload));
 await c.query('INSERT INTO ar_command_results(scope,request_key,request_hash) VALUES($1,$2,$3) ON CONFLICT(scope,request_key) DO NOTHING',[scope,requestKey,requestHash]);
 const row=(await c.query('SELECT * FROM ar_command_results WHERE scope=$1 AND request_key=$2 FOR UPDATE',[scope,requestKey])).rows[0];
 if(row.request_hash!==requestHash)throw new StoreError('KEY_REUSED','Этот запрос уже использован с другими данными.',409);
 if(row.result!==null)return row.result as T;
 const result=await fn();await c.query('UPDATE ar_command_results SET result=$3::jsonb WHERE scope=$1 AND request_key=$2',[scope,requestKey,JSON.stringify(result)]);return result;
}
export async function staff(request:Request){
 const cfg=appConfig();const raw=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cfg.cmsCookie+'='));
 if(!raw||raw.length>8192||/[\r\n]/.test(raw))throw new StoreError('STAFF_LOGIN','Войдите в кабинет сотрудника.',401);
 const headers={Cookie:raw};
 const [userRes,permissionRes]=await Promise.all([fetch(cfg.cmsBase+'/users/me?fields=id,first_name,last_name',{headers,signal:AbortSignal.timeout(5000)}),fetch(cfg.cmsBase+'/permissions/me',{headers,signal:AbortSignal.timeout(5000)})]);
 if(!userRes.ok||!permissionRes.ok)throw new StoreError('STAFF_LOGIN','Войдите в кабинет сотрудника.',401);
 const user=(await userRes.json()).data,permissions=(await permissionRes.json()).data;
 if(permissions.ar_stock?.update?.access!=='full')throw new StoreError('FORBIDDEN','У этой роли нет доступа к торговым операциям.',403);
 return{id:uuid(user.id),name:[user.first_name,user.last_name].filter(Boolean).join(' ')};
}
