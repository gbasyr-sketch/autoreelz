import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import type {APIContext} from 'astro';
import type {PoolClient} from 'pg';
import type {ShopSession} from '../lib/commerce-types.ts';
import {transaction} from './db.ts';
import {appConfig,requireLocalTest} from './config.ts';
import {COOKIE,equal,getSession,hash,setSessionCookie,sign} from './security.ts';
import {StoreError,email,iso,uuid} from './errors.ts';

type CookieContext=Pick<APIContext,'cookies'>;
const codeError=()=>new StoreError('LOGIN_CODE','Код неверный или больше не действует. Запросите новый код.',400);

async function lockSession(client:PoolClient,session:ShopSession){
 const row=(await client.query('SELECT csrf_token FROM ar_web_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE',[session.id])).rows[0];
 if(!row||!equal(row.csrf_token,session.csrfToken))throw new StoreError('SESSION_CHANGED','Сессия обновилась. Обновите страницу и повторите действие.',401);
}
/** A bounded persistent counter. Concurrent requests serialize on its unique HMAC key. */
async function takeRate(client:PoolClient,key:string,limit:number,seconds:number,message:string){
 const result=await client.query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+$3*interval '1 second')
  ON CONFLICT(key) DO UPDATE SET
   count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,
   reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+$3*interval '1 second' ELSE ar_rate_limits.reset_at END
  WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<$2 RETURNING id`,[sign(`rate:${key}`),limit,seconds]);
 if(!result.rowCount)throw new StoreError('RATE_LIMIT',message,429);
}

export async function requestCode(session:ShopSession,emailInput:unknown,ip:string):Promise<{challengeId:string;expiresAt:string}>{
 requireLocalTest();
 const address=email(emailInput),challengeId=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
 const ipHash=sign(`ip:${ip}`);
 return transaction(async client=>{
  await lockSession(client,session);
  // Fixed lock order across sessions, so a shared IP/email cannot create a lock cycle.
  const limits:[string,number,number,string][]=[
   [`otp:email:day:${address}`,10,86400,'Лимит кодов для этого email исчерпан. Попробуйте позже.'],
   [`otp:email:resend:${address}`,1,60,'Повторный код можно запросить через 60 секунд.'],
   [`otp:ip:hour:${ipHash}`,20,3600,'Слишком много запросов кода. Попробуйте позже.'],
   [`otp:session:resend:${session.id}`,1,60,'Повторный код можно запросить через 60 секунд.'],
  ];
  for(const[key,limit,seconds,message]of limits)await takeRate(client,key,limit,seconds,message);
  await client.query('UPDATE ar_login_challenges SET consumed_at=now() WHERE session_id=$1 AND consumed_at IS NULL',[session.id]);
  const challenge=(await client.query(`INSERT INTO ar_login_challenges(id,session_id,email,code_hash,ip_hash,expires_at)
   VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes') RETURNING expires_at`,[challengeId,session.id,address,sign(`otp:${challengeId}:${session.id}:${address}:${code}`),ipHash])).rows[0];
  await client.query('INSERT INTO ar_mail_outbox(recipient,subject,body,deduplication_key) VALUES($1,$2,$3,$4)',[
   address,'Код входа в AUTO REELZ',`Ваш код входа: ${code}\n\nКод действует 10 минут. Не сообщайте его другим людям.\nЕсли вы не запрашивали вход, проигнорируйте письмо.\n\nЭто письмо из локального тестового магазина; оно сохранено только в тестовом почтовом ящике.`,`login:${challengeId}`,
  ]);
  return{challengeId,expiresAt:iso(challenge.expires_at)!};
 });
}

export async function verifyCode(ctx:CookieContext,session:ShopSession,challengeIdInput:unknown,codeInput:unknown):Promise<{ok:true}>{
 const challengeId=uuid(challengeIdInput);
 const formatValid=typeof codeInput==='string'&&/^\d{6}$/.test(codeInput);
 const newToken=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');
 const accepted=await transaction(async client=>{
  await lockSession(client,session);
  const challenge=(await client.query('SELECT *,expires_at>now() AS live FROM ar_login_challenges WHERE id=$1 AND session_id=$2 FOR UPDATE',[challengeId,session.id])).rows[0];
  if(!challenge||!challenge.live||challenge.consumed_at||challenge.attempts>=5)return false;
  const matches=formatValid&&equal(challenge.code_hash,sign(`otp:${challengeId}:${session.id}:${challenge.email}:${codeInput}`));
  if(!matches){
   await client.query('UPDATE ar_login_challenges SET attempts=attempts+1 WHERE id=$1',[challengeId]);
   return false; // Commit the failed attempt before throwing at the API boundary.
  }
  const customer=(await client.query('INSERT INTO ar_customers(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id',[challenge.email])).rows[0];
  await client.query(`UPDATE ar_web_sessions SET customer_id=$2,token_hash=$3,csrf_token=$4,expires_at=now()+interval '30 days' WHERE id=$1`,[session.id,customer.id,hash(newToken),csrfToken]);
  await client.query('UPDATE ar_login_challenges SET consumed_at=now() WHERE session_id=$1 AND consumed_at IS NULL',[session.id]);
  return true;
 });
 if(!accepted)throw codeError();
 setSessionCookie(ctx,newToken);
 return{ok:true};
}

export async function logout(ctx:CookieContext,session:ShopSession):Promise<{ok:true}>{
 await transaction(async client=>{
  await client.query('UPDATE ar_web_sessions SET expires_at=now() WHERE id=$1',[session.id]);
  await client.query('UPDATE ar_login_challenges SET consumed_at=now() WHERE session_id=$1 AND consumed_at IS NULL',[session.id]);
 });
 ctx.cookies.delete(COOKIE,{path:'/'});
 await getSession(ctx);
 return{ok:true};
}

export async function staffLogin(session:ShopSession,emailInput:unknown,passwordInput:unknown,ip:string):Promise<{cookie:string}>{
 const address=email(emailInput);
 if(typeof passwordInput!=='string'||passwordInput.length<1||passwordInput.length>512)throw new StoreError('INVALID_INPUT','Укажите пароль сотрудника.');
 await transaction(async client=>{
  await lockSession(client,session);
  await takeRate(client,`staff:ip:${ip}`,10,600,'Слишком много попыток входа. Попробуйте через 10 минут.');
 });
 const cfg=appConfig();let response:Response;
 try{response=await fetch(cfg.cmsBase+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,password:passwordInput,mode:'session'}),redirect:'error',signal:AbortSignal.timeout(8000)});}
 catch{throw new StoreError('CMS_UNAVAILABLE','Не удалось связаться с админкой. Повторите вход позже.',503);}
 if(!response.ok)throw new StoreError('STAFF_LOGIN','Не удалось войти. Проверьте email и пароль.',401);
 const cookie=response.headers.getSetCookie().find(value=>value.startsWith(cfg.cmsCookie+'='));
 if(!cookie||cookie.length>8192||/[\r\n]/.test(cookie))throw new StoreError('CMS_SESSION','Админка не выдала сессию. Повторите вход позже.',502);
 return{cookie};
}
