// Synthetic native PostgreSQL only. No CMS/provider calls or production data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
import {getSession,sign,COOKIE} from '../src/server/security.ts';
import {getPool} from '../src/server/db.ts';
import {getCart} from '../src/server/cart.ts';
import {logout} from '../src/server/auth.ts';
const qa=await createImageDatabase();Object.assign(process.env,imageEnvironment(qa.database,'private/session-rate-limit'));
const q=(s,v=[])=>qa.owner.query(s,v),checks=[];
function context(ip='192.0.2.41',token){const values=new Map(token?[[COOKIE,token]]:[]);return{values,clientAddress:ip,cookies:{get:k=>values.has(k)?{value:values.get(k)}:undefined,set:(k,v)=>values.set(k,v),delete:k=>values.delete(k)}};}
const key=(seconds,ip='192.0.2.41')=>sign(`session-create:${seconds}:${ip}`);
const counts=async()=> (await q('SELECT (SELECT count(*) FROM ar_web_sessions)::int sessions,(SELECT count(*) FROM ar_carts)::int carts')).rows[0];
const denied=e=>e.code==='SESSION_RATE_LIMIT'&&e.status===429&&e.retryAfter>=1;
try{
 const ctx=context(),active=await getSession(ctx),token=ctx.values.get(COOKIE);
 assert.equal((await getCart(active)).lines.length,0);assert.deepEqual(await counts(),{sessions:1,carts:1});checks.push('new guest receives session and cart atomically');
 await q('UPDATE ar_rate_limits SET count=59 WHERE key=$1',[key(60)]);
 const race=await Promise.allSettled(Array.from({length:12},()=>getSession(context())));
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.ok(race.filter(x=>x.status==='rejected').every(x=>denied(x.reason)));
 assert.deepEqual(await counts(),{sessions:2,carts:2});
 assert.equal((await q('SELECT count FROM ar_rate_limits WHERE key=$1',[key(3600)])).rows[0].count,2);checks.push('12 concurrent requests at minute boundary create only one pair; rejected attempts do not consume hourly quota');
 const before=await counts();const rateBefore=(await q('SELECT key,count,reset_at FROM ar_rate_limits ORDER BY key')).rows;
 assert.equal((await getSession(context('192.0.2.41',token))).id,active.id);assert.equal((await getCart(active)).version,0);
 const customer=(await q("INSERT INTO ar_customers(email) VALUES('session-qa@example.invalid') RETURNING id")).rows[0].id;
 await q('UPDATE ar_web_sessions SET customer_id=$2 WHERE id=$1',[active.id,customer]);assert.equal((await getSession(ctx)).email,'session-qa@example.invalid');
 assert.deepEqual(await counts(),before);assert.deepEqual((await q('SELECT key,count,reset_at FROM ar_rate_limits ORDER BY key')).rows,rateBefore);checks.push('valid guest and authenticated cookies bypass exhausted quota without losing cart or consuming counters');
 await assert.rejects(getSession(context('192.0.2.41','a'.repeat(43))),denied);await assert.rejects(getSession(context('192.0.2.41','malformed')),denied);assert.deepEqual(await counts(),before);checks.push('invalid and forged cookies cannot bypass quota');
 const other=await getSession(context('192.0.2.42'));assert.notEqual(other.id,active.id);checks.push('independent network continues creating sessions');
 await q("UPDATE ar_rate_limits SET reset_at=now()-interval '1 second' WHERE key=$1",[key(60)]);
 await q('UPDATE ar_rate_limits SET count=600 WHERE key=$1',[key(3600)]);
 await assert.rejects(getSession(context()),e=>denied(e)&&e.retryAfter>60);
 assert.equal((await q('SELECT count FROM ar_rate_limits WHERE key=$1',[key(60)])).rows[0].count,60);checks.push('hourly cap survives minute reset and rolls back minute consumption');
 await logout(ctx,active);assert.equal(ctx.values.has(COOKIE),false);assert.equal((await q('SELECT expires_at<=now() expired FROM ar_web_sessions WHERE id=$1',[active.id])).rows[0].expired,true);checks.push('logout revokes authenticated cookie successfully even with exhausted quota');
 await q("UPDATE ar_rate_limits SET reset_at=now()-interval '1 second' WHERE key=ANY($1::text[])",[[key(60),key(3600)]]);
 const renewed=await getSession(context('192.0.2.41',token));assert.notEqual(renewed.id,active.id);assert.equal(renewed.email,null);checks.push('after expiry both windows reset; expired cookie gets clean anonymous session');
 await q("CREATE FUNCTION qa_fail_cart() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cart failure'; END $$; CREATE TRIGGER qa_fail_cart BEFORE INSERT ON ar_carts FOR EACH ROW EXECUTE FUNCTION qa_fail_cart()");
 const countBeforeFailure=await counts(),failing=context('192.0.2.43');await assert.rejects(getSession(failing),/synthetic cart failure/);assert.deepEqual(await counts(),countBeforeFailure);assert.equal(failing.values.has(COOKIE),false);assert.equal((await q('SELECT 1 FROM ar_rate_limits WHERE key=$1',[key(60,'192.0.2.43')])).rowCount,0);
 await q('DROP TRIGGER qa_fail_cart ON ar_carts; DROP FUNCTION qa_fail_cart()');checks.push('cart failure rolls back session and both rate counters, sets no cookie');
 const missing=context(undefined);Object.defineProperty(missing,'clientAddress',{get(){throw Error('adapter has no IP');}});await getSession(missing);assert.equal((await q('SELECT count FROM ar_rate_limits WHERE key=$1',[key(60,'unknown')])).rows[0].count,1);checks.push('unavailable adapter IP uses protected fallback bucket');
 const {sessionCleanupTick}=await import('../src/server/session-cleanup.ts');const pre=await counts();await sessionCleanupTick();assert.deepEqual(await counts(),pre);checks.push('prepared retention preserves all new and existing active sessions');
 await fs.mkdir('artifacts/session-rate-limit',{recursive:true});await fs.writeFile('artifacts/session-rate-limit/database.json',JSON.stringify({passed:true,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{await getPool().end();await qa.close(true);}
