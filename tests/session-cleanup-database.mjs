// Isolated native PostgreSQL, synthetic data only; no provider/network calls.
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import fs from 'node:fs/promises';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase();Object.assign(process.env,imageEnvironment(qa.database,'private/session-cleanup'));
const {getPool}=await import('../src/server/db.ts');
const {sessionCleanupTick,sessionCleanupPreview}=await import('../src/server/session-cleanup.ts');
const app=getPool(),q=(s,v=[])=>qa.owner.query(s,v),checks=[];
async function visit(expiry="now()-interval '31 days'",version=0){
 const id=uuid(),cart=uuid();await q(`INSERT INTO ar_web_sessions(id,token_hash,csrf_token,created_at,expires_at) VALUES($1,$2,$3,now()-interval '61 days',${expiry})`,[id,uuid(),uuid()]);
 await q('INSERT INTO ar_carts(id,session_id,version) VALUES($1,$2,$3)',[cart,id,version]);return{id,cart};
}
async function reset(){await q('UPDATE ar_session_cleanup_state SET last_run_at=NULL');}
async function exists(id){return (await q('SELECT 1 FROM ar_web_sessions WHERE id=$1',[id])).rowCount>0;}
async function history(){const result={};for(const {tablename:t} of (await q("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ar_%' AND tablename NOT IN ('ar_web_sessions','ar_carts','ar_session_cleanup_state') ORDER BY tablename")).rows){result[t]=(await q(`SELECT md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${t}" t`)).rows[0].hash;}return result;}
try{
 const category=uuid(),product=uuid(),sku=uuid();
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA','qa','published')",[category]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status) VALUES($1,'QA','qa',$2,'published')",[product,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,'QA','QA','10.00','published')",[sku,product]);
 const addLine=v=>q("INSERT INTO ar_cart_lines(cart_id,product_id,sku_id,quantity,last_name,last_price_rubles,last_image) VALUES($1,$2,$3,1,'QA','10.00','')",[v.cart,product,sku]);
 const removable=await visit(),active=await visit("now()+interval '1 day'"),recent=await visit("now()-interval '29 days'"),changed=await visit(undefined,1),filled=await visit(),customer=await visit();
 await addLine(filled);const customerId=uuid();await q("INSERT INTO ar_customers(id,email) VALUES($1,'qa@example.invalid')",[customerId]);await q('UPDATE ar_web_sessions SET customer_id=$2 WHERE id=$1',[customer.id,customerId]);
 const protectedIds=[active,recent,changed,filled,customer];
 const quoteVisit=await visit(),quoteId=uuid();protectedIds.push(quoteVisit);
 await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','{}','qa',now()-interval '31 days')",[quoteId,quoteVisit.id]);
 const batchVisit=await visit(),batch=uuid();protectedIds.push(batchVisit);await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,batchVisit.id,quoteId]);
 const orderVisit=await visit(),order=uuid();protectedIds.push(orderVisit);
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,payment_status,delivery_status,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles,shipping_cost_rubles) VALUES($1,$2,$3,'ordinary','cancelled','unpaid','quoted','QA','+79990000000','qa@example.invalid','{}','[]','10.00','0.00')",[order,batch,orderVisit.id]);
 await q("INSERT INTO ar_order_events(order_id,event_type,note) VALUES($1,'qa','History must remain')",[order]);
 await q("INSERT INTO ar_payments(order_id,amount_rubles,currency,method,status,shipping_version) VALUES($1,'10.00','RUB','card','failed',0)",[order]);
 const login=await visit(),privacy=await visit(),consent=await visit();protectedIds.push(login,privacy,consent);
 await q("INSERT INTO ar_login_challenges(session_id,email,code_hash,ip_hash,expires_at,consumed_at) VALUES($1,'qa@example.invalid','qa','qa',now()-interval '31 days',now()-interval '31 days')",[login.id]);
 await q("INSERT INTO ar_privacy_events(id,session_id,choice,version,consent_text,expires_at) VALUES($1,$2,'rejected','qa','qa',now()-interval '31 days')",[uuid(),privacy.id]);
 await q("INSERT INTO ar_service_consents(session_id,service,version,snapshot) VALUES($1,'yandex-pickup-map','qa','{}')",[consent.id]);
 for(const prefix of ['cart','checkout','pay','cancel','privacy']){const v=await visit();protectedIds.push(v);await q("INSERT INTO ar_command_results(scope,request_key,request_hash,result) VALUES($1,$2,'qa','{}')",[prefix+':'+v.id,uuid()]);}
 const oldHistory=await history(),oldSessions=(await q('SELECT * FROM ar_web_sessions ORDER BY id')).rows;
 assert.equal((await sessionCleanupPreview()).eligibleSessions,'1');assert.deepEqual((await q('SELECT * FROM ar_web_sessions ORDER BY id')).rows,oldSessions);checks.push('preview is read-only and excludes every protected relation');
 assert.deepEqual(await sessionCleanupTick(),{deleted_sessions:1,deleted_carts:1,skipped:false});assert.equal(await exists(removable.id),false);assert.equal((await q('SELECT 1 FROM ar_carts WHERE id=$1',[removable.cart])).rowCount,0);
 for(const v of protectedIds)assert.ok(await exists(v.id));assert.deepEqual(await history(),oldHistory);checks.push('expired untouched empty visit removed; active/recent/customer/nonempty/versioned sessions and all history byte-identical');
 const due=await visit();assert.equal((await sessionCleanupTick()).skipped,true);assert.ok(await exists(due.id));checks.push('database hourly schedule survives subsequent callers');
 await reset();const tx=await app.connect();await tx.query('BEGIN');const rolled=await tx.query('SELECT * FROM ar_cleanup_empty_sessions()');assert.equal(rolled.rows[0].deleted_sessions,1);await tx.query('ROLLBACK');tx.release();assert.ok(await exists(due.id));assert.equal((await q('SELECT last_run_at FROM ar_session_cleanup_state')).rows[0].last_run_at,null);checks.push('rollback restores both parents and run state');
 const lock=await qa.owner.connect();await lock.query('BEGIN');await lock.query('SELECT * FROM ar_carts WHERE id=$1 FOR UPDATE',[due.cart]);
 assert.equal((await sessionCleanupTick()).deleted_sessions,0);assert.ok(await exists(due.id));await lock.query("INSERT INTO ar_cart_lines(cart_id,product_id,sku_id,quantity,last_name,last_price_rubles,last_image) VALUES($1,$2,$3,1,'QA','10.00','')",[due.cart,product,sku]);await lock.query('COMMIT');lock.release();await reset();assert.equal((await sessionCleanupTick()).deleted_sessions,0);checks.push('concurrent cart mutation skipped; committed cart line retained');
 const renewed=await visit();const sl=await qa.owner.connect();await sl.query('BEGIN');await sl.query("UPDATE ar_web_sessions SET expires_at=now()+interval '30 days' WHERE id=$1",[renewed.id]);await reset();assert.equal((await sessionCleanupTick()).deleted_sessions,0);await sl.query('COMMIT');sl.release();await reset();assert.equal((await sessionCleanupTick()).deleted_sessions,0);checks.push('concurrent session renewal retained');
 await reset();const boundary=await visit("now()-interval '30 days'+interval '2 seconds'");assert.equal((await sessionCleanupTick()).deleted_sessions,0);await q('UPDATE ar_web_sessions SET expires_at=now() WHERE id=$1',[boundary.id]);checks.push('grace-period boundary retained');
 await reset();const rr=await app.connect();await rr.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await assert.rejects(rr.query('SELECT * FROM ar_cleanup_empty_sessions()'),/READ COMMITTED/);await rr.query('ROLLBACK');rr.release();checks.push('stale snapshot isolation rejected');
 await assert.rejects(app.query('DELETE FROM ar_carts WHERE false'),{code:'42501'});await assert.rejects(app.query('DELETE FROM ar_web_sessions WHERE false'),{code:'42501'});await assert.rejects(app.query('UPDATE ar_session_cleanup_state SET last_run_at=NULL'),{code:'42501'});checks.push('application has narrow function permission, no direct parent delete or schedule reset');
 const publicExecute=(await q("SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='ar_cleanup_empty_sessions' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS yes")).rows[0].yes;assert.equal(publicExecute,false);checks.push('PUBLIC cannot execute privileged cleanup');
 // An unexpected restrictive dependency must fail atomically, never delete its history.
 const unknown=await visit();await q('CREATE TABLE qa_history(session_id uuid REFERENCES ar_web_sessions(id))');await q('INSERT INTO qa_history VALUES($1)',[unknown.id]);await reset();await assert.rejects(sessionCleanupTick(),{code:'23503'});assert.ok(await exists(unknown.id));assert.equal((await q('SELECT 1 FROM ar_carts WHERE id=$1',[unknown.cart])).rowCount,1);await q('DROP TABLE qa_history');checks.push('new restrictive FK fails closed with cart/session rollback');
 await q('CREATE TABLE qa_cascade(session_id uuid REFERENCES ar_web_sessions(id) ON DELETE CASCADE)');await q('INSERT INTO qa_cascade VALUES($1)',[unknown.id]);await assert.rejects(sessionCleanupTick(),/Unexpected cascading/);assert.ok(await exists(unknown.id));assert.equal((await q('SELECT count(*) FROM qa_cascade')).rows[0].count,'1');await q('DROP TABLE qa_cascade');checks.push('unexpected cascading relation prevents deletion of future history');
 await q("INSERT INTO ar_web_sessions(token_hash,csrf_token,expires_at) SELECT gen_random_uuid()::text,'qa',now()-interval '31 days' FROM generate_series(1,205)");await q('INSERT INTO ar_carts(session_id) SELECT s.id FROM ar_web_sessions s WHERE NOT EXISTS(SELECT 1 FROM ar_carts c WHERE c.session_id=s.id)');await reset();
 const parallel=await Promise.all([sessionCleanupTick(),sessionCleanupTick()]);assert.equal(parallel.reduce((n,r)=>n+r.deleted_sessions,0),200);assert.equal(parallel.filter(r=>r.skipped).length,1);assert.equal((await sessionCleanupPreview()).eligibleSessions,'6');await reset();assert.equal((await sessionCleanupTick()).deleted_sessions,6);checks.push('200-row batch cap and concurrent/repeated calls do not double-delete');
 const finalHistory=await history();delete finalHistory.ar_cart_lines;delete oldHistory.ar_cart_lines;assert.deepEqual(finalHistory,oldHistory);for(const v of protectedIds)assert.ok(await exists(v.id));checks.push('orders/payments/events/consents/commands remain byte-identical after all batches');
 const record=(await q('SELECT * FROM ar_session_cleanup_state')).rows[0];assert.equal(Number(record.total_deleted_sessions),207);
 const {getSession}=await import('../src/server/security.ts');const {getCart}=await import('../src/server/cart.ts');const cookies=new Map();const context={cookies:{get:n=>cookies.has(n)?{value:cookies.get(n)}:undefined,set:(n,v)=>cookies.set(n,v)}};const oldVisit=await getSession(context);await q("UPDATE ar_web_sessions SET expires_at=now()-interval '31 days' WHERE id=$1",[oldVisit.id]);await reset();assert.equal((await sessionCleanupTick()).deleted_sessions,1);const newVisit=await getSession(context);assert.notEqual(newVisit.id,oldVisit.id);assert.deepEqual((await getCart(newVisit)).lines,[]);assert.ok(await exists(newVisit.id));checks.push('expired deleted cookie receives fresh session/cart; active visitor still works');
 await q('DELETE FROM ar_session_cleanup_state');await assert.rejects(sessionCleanupTick(),/schedule is missing/);assert.ok(await exists(newVisit.id));checks.push('missing schedule fails closed instead of running every tick');
 console.log(JSON.stringify({passed:true,checks}));await fs.mkdir('artifacts/session-cleanup',{recursive:true});await fs.writeFile('artifacts/session-cleanup/database.json',JSON.stringify({passed:true,checks,historyTablesCompared:Object.keys(oldHistory).length},null,2)+'\n');
}finally{await app.end();await qa.close(true);}
