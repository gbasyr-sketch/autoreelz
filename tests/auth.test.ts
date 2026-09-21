import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {APIContext} from 'astro';
import {requestCode,verifyCode,logout,staffLogin} from '../src/server/auth.ts';
import {COOKIE,getSession,hash,sign} from '../src/server/security.ts';
import {getPool,query} from '../src/server/db.ts';

type CookieContext=Pick<APIContext,'cookies'>;
function cookies(){
 const values=new Map<string,string>();let lastOptions:Record<string,unknown>={};
 const ctx={cookies:{get:(name:string)=>values.has(name)?{value:values.get(name)!}:undefined,set:(name:string,value:string,options:Record<string,unknown>)=>{values.set(name,value);lastOptions=options;},delete:(name:string)=>values.delete(name)}} as unknown as CookieContext;
 return{ctx,values,options:()=>lastOptions};
}
const rejectsCode=(code:string)=>(error:unknown)=>error instanceof Error&&'code'in error&&error.code===code;

test('OTP and staff auth in isolated PostgreSQL', {skip:process.env.AR_AUTH_TESTS!=='1',timeout:60000},async t=>{
 const database=`ar_qa_auth_${process.pid}_${Date.now()}`;
 assert.match(database,/^ar_qa_auth_\d+_\d+$/);
 const sql=(db:string,input:string)=>{assert.ok(db===database||db==='autoreelz2026_new');const r=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d',db],{input,encoding:'utf8',timeout:15000});if(r.status!==0)throw new Error(r.stderr||'Auth QA database command failed');};
 sql('autoreelz2026_new',`CREATE DATABASE ${database} OWNER ar_migrator;`);
 const previousDatabase=process.env.AR_DATABASE_NAME;process.env.AR_DATABASE_NAME=database;
 t.after(async()=>{await getPool().end();sql('autoreelz2026_new',`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);if(previousDatabase===undefined)delete process.env.AR_DATABASE_NAME;else process.env.AR_DATABASE_NAME=previousDatabase;});
 const source=readFileSync(new URL('../migrations/004_commerce.sql',import.meta.url),'utf8');
 const tables=['ar_customers','ar_web_sessions','ar_carts','ar_login_challenges','ar_mail_outbox'];
 const schema=tables.map(table=>{const match=source.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match,table);return match[0];}).join('\n');
 sql(database,`${schema}\nCREATE TABLE ar_rate_limits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text NOT NULL UNIQUE,count integer NOT NULL,reset_at timestamptz NOT NULL);\nGRANT SELECT,INSERT,UPDATE ON ${[...tables,'ar_rate_limits'].join(',')} TO ar_app;`);
 const fresh=async()=>{const jar=cookies();return{...jar,session:await getSession(jar.ctx)};};
 const codeFor=async(id:string)=>{const mail=(await query('SELECT body FROM ar_mail_outbox WHERE deduplication_key=$1',[`login:${id}`])).rows[0];const code=mail?.body.match(/код входа: (\d{6})/i)?.[1];assert.ok(code,'Code is confined to the protected test outbox');return code as string;};

 await t.test('request normalizes email, stores HMAC and returns no code',async()=>{
  const s=await fresh();const result=await requestCode(s.session,' Customer@Example.invalid ','192.0.2.1');
  assert.deepEqual(Object.keys(result).sort(),['challengeId','expiresAt']);
  const row=(await query('SELECT * FROM ar_login_challenges WHERE id=$1',[result.challengeId])).rows[0];
  assert.equal(row.email,'customer@example.invalid');assert.equal(row.code_hash.length,64);assert.equal(row.ip_hash.length,64);
  assert.equal(row.code_hash,sign(`otp:${result.challengeId}:${s.session.id}:${row.email}:${await codeFor(result.challengeId)}`));
  assert.ok(new Date(result.expiresAt).getTime()>Date.now()+590000);
 });
 await t.test('challenge cannot be used from another browser session',async()=>{
  const owner=await fresh(),other=await fresh();const result=await requestCode(owner.session,'ownership@example.invalid','192.0.2.2');
  await assert.rejects(verifyCode(other.ctx,other.session,result.challengeId,await codeFor(result.challengeId)),rejectsCode('LOGIN_CODE'));
  assert.equal((await query('SELECT attempts FROM ar_login_challenges WHERE id=$1',[result.challengeId])).rows[0].attempts,0);
 });
 await t.test('five incorrect attempts commit and exhaust even the correct code',async()=>{
  const s=await fresh(),result=await requestCode(s.session,'attempts@example.invalid','192.0.2.3');
  const code=await codeFor(result.challengeId);const wrong=code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)await assert.rejects(verifyCode(s.ctx,s.session,result.challengeId,wrong),rejectsCode('LOGIN_CODE'));
  assert.equal((await query('SELECT attempts FROM ar_login_challenges WHERE id=$1',[result.challengeId])).rows[0].attempts,5);
  await assert.rejects(verifyCode(s.ctx,s.session,result.challengeId,code),rejectsCode('LOGIN_CODE'));
 });
 await t.test('successful verification rotates credentials, keeps ownership, blocks replay and logs out cleanly',async()=>{
  const s=await fresh(),oldToken=s.values.get(COOKIE)!;const result=await requestCode(s.session,'verified@example.invalid','192.0.2.4'),code=await codeFor(result.challengeId);
  const race=await Promise.allSettled([verifyCode(s.ctx,s.session,result.challengeId,code),verifyCode(s.ctx,s.session,result.challengeId,code)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const verified=await getSession(s.ctx);assert.equal(verified.id,s.session.id);assert.equal(verified.email,'verified@example.invalid');assert.notEqual(verified.csrfToken,s.session.csrfToken);assert.notEqual(s.values.get(COOKIE),oldToken);
  assert.equal((await query('SELECT 1 FROM ar_web_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(oldToken)])).rowCount,0);
  assert.equal(s.options().httpOnly,true);assert.equal(s.options().sameSite,'lax');
  await assert.rejects(verifyCode(s.ctx,verified,result.challengeId,code),rejectsCode('LOGIN_CODE'));
  await logout(s.ctx,verified);const loggedOut=await getSession(s.ctx);assert.notEqual(loggedOut.id,verified.id);assert.equal(loggedOut.email,null);
  assert.equal((await query('SELECT expires_at<=now() AS expired FROM ar_web_sessions WHERE id=$1',[verified.id])).rows[0].expired,true);
 });
 await t.test('concurrent resend across browsers sends one code; a session cannot change email to bypass cooldown',async()=>{
  const a=await fresh(),b=await fresh();const address='resend@example.invalid';
  const race=await Promise.allSettled([requestCode(a.session,address,'192.0.2.5'),requestCode(b.session,address,'192.0.2.5')]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await query('SELECT 1 FROM ar_mail_outbox WHERE recipient=$1',[address])).rowCount,1);
  const winner=race[0]?.status==='fulfilled'?a:b;
  await assert.rejects(requestCode(winner.session,'changed@example.invalid','192.0.2.6'),rejectsCode('RATE_LIMIT'));
 });
 await t.test('expired challenges and superseded codes cannot authenticate',async()=>{
  const s=await fresh(),result=await requestCode(s.session,'expiry@example.invalid','192.0.2.7');const old=await codeFor(result.challengeId);
  await query("UPDATE ar_login_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[result.challengeId]);
  await assert.rejects(verifyCode(s.ctx,s.session,result.challengeId,old),rejectsCode('LOGIN_CODE'));
  await query('UPDATE ar_rate_limits SET reset_at=now() WHERE key=ANY($1::text[])',[[sign('rate:otp:email:resend:expiry@example.invalid'),sign(`rate:otp:session:resend:${s.session.id}`)]]);
  const next=await requestCode(s.session,'expiry@example.invalid','192.0.2.7');assert.notEqual(next.challengeId,result.challengeId);
  assert.ok((await query('SELECT consumed_at FROM ar_login_challenges WHERE id=$1',[result.challengeId])).rows[0].consumed_at);
  await assert.rejects(verifyCode(s.ctx,s.session,result.challengeId,old),rejectsCode('LOGIN_CODE'));
 });
 await t.test('persistent email daily and IP hourly limits reject without creating mail',async()=>{
  const a=await fresh(),b=await fresh();
  for(const[key,count]of [[sign('rate:otp:email:day:limited@example.invalid'),10],[sign(`rate:otp:ip:hour:${sign('ip:192.0.2.9')}`),20]] as const)await query("INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,$2,now()+interval '1 day')",[key,count]);
  await assert.rejects(requestCode(a.session,'limited@example.invalid','192.0.2.8'),rejectsCode('RATE_LIMIT'));
  await assert.rejects(requestCode(b.session,'ip-limited@example.invalid','192.0.2.9'),rejectsCode('RATE_LIMIT'));
  assert.equal((await query("SELECT 1 FROM ar_mail_outbox WHERE recipient IN ('limited@example.invalid','ip-limited@example.invalid')")).rowCount,0);
 });
 await t.test('staff login forwards only the configured cookie, preserves password and persists failed rate counts',async()=>{
  const s=await fresh(),originalFetch=globalThis.fetch;
  try{
   let passwordUnchanged=false,sessionMode=false;
   globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options?.body as string);passwordUnchanged=body.password===' test-password ';sessionMode=body.mode==='session';const headers=new Headers();headers.append('Set-Cookie','unrelated=discard; Path=/');headers.append('Set-Cookie','autoreelz2026_new_session=test-staff-token; Path=/; HttpOnly; SameSite=Lax');return new Response('{}',{headers});};
   const result=await staffLogin(s.session,'staff@example.invalid',' test-password ','192.0.2.10');
   assert.ok(passwordUnchanged&&sessionMode);assert.ok(result.cookie.startsWith('autoreelz2026_new_session='));assert.ok(!result.cookie.includes('unrelated'));
   globalThis.fetch=async()=>new Response('{}',{status:401});
   for(let i=0;i<10;i++)await assert.rejects(staffLogin(s.session,'staff@example.invalid','test-password','192.0.2.11'),rejectsCode('STAFF_LOGIN'));
   await assert.rejects(staffLogin(s.session,'staff@example.invalid','test-password','192.0.2.11'),rejectsCode('RATE_LIMIT'));
  }finally{globalThis.fetch=originalFetch;}
 });
 await t.test('test mail generation is blocked outside the local adapter mode',async()=>{
  const s=await fresh(),before=process.env.STORE_MODE;process.env.STORE_MODE='production';
  try{await assert.rejects(requestCode(s.session,'blocked@example.invalid','192.0.2.12'));}finally{if(before===undefined)delete process.env.STORE_MODE;else process.env.STORE_MODE=before;}
 });
});
