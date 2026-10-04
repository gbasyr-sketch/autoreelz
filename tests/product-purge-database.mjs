import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {getPool} from '../src/server/db.ts';
import {readProductEditor,saveProductEditor,editorDrafts} from '../src/server/product-editor.ts';
import {readProductLifecycle,changeProductLifecycle,archivedProducts,readProductTrash,purgeProductTrash} from '../src/server/product-lifecycle.ts';
import {getCatalog} from '../src/server/catalog.ts';
assert.match(process.env.AR_DATABASE_NAME??'',/^ar_qa_product_editor_/);
const owner=new pg.Pool({host:process.env.AR_DB_HOST,port:Number(process.env.AR_DB_PORT),database:process.env.AR_DATABASE_NAME,user:'ar_migrator',password:process.env.QA_OWNER_PASSWORD});
const q=(s,v=[])=>owner.query(s,v),key=()=>randomUUID(),actor={id:key()},checks=[];
const id=key(),sku=key(),category=key(),session=key(),quote=key(),batch=key(),order=key();
const action=async(id,action)=>changeProductLifecycle(actor,{id,action,token:(await readProductLifecycle(id)).token,idempotencyKey:key()});
const command=(s)=>({id:s.id,version:s.version,baseHash:s.baseHash,data:s.data,action:'publish',idempotencyKey:key()});
const purged=e=>e.code==='PRODUCT_PURGED'&&e.status===410;
async function check(name,fn){await fn();checks.push(name);}
try{
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA Purge','qa-purge','published')",[category]);
 await q("INSERT INTO ar_products(id,name,slug,category_id,status,kind) VALUES($1,'QA Purge','qa-purge',$2,'published','single')",[id,category]);
 await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,'QA-PURGE','SKU','100.00','published')",[sku,id]);
 await q('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,7,2)',[sku]);
 await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,'qa',now()+interval '1 day')",[session,key()]);
 await q("INSERT INTO ar_cart_quotes(id,session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,0,'{}','{}','qa',now()+interval '1 day')",[quote,session]);
 await q('INSERT INTO ar_checkout_batches(id,session_id,quote_id) VALUES($1,$2,$3)',[batch,session,quote]);
 await q("INSERT INTO ar_orders(id,batch_id,session_id,kind,status,delivery_status,allocation_state,customer_name,customer_phone,customer_email,delivery_snapshot,items_snapshot,product_total_rubles) VALUES($1,$2,$3,'ordinary','awaiting_payment','pending_quote','reserved','QA','00000000000','qa@example.invalid','{}',$4::jsonb,'200.00')",[order,batch,session,JSON.stringify([{productId:id,skuId:sku,name:'History',quantity:2}])]);
 await q('INSERT INTO ar_order_components(order_id,sku_id,quantity) VALUES($1,$2,2)',[order,sku]);
 await check('only archived products may be purged',async()=>{await assert.rejects(()=>action(id,'purge'),e=>e.code==='PRODUCT_NOT_ARCHIVED');assert.equal((await q('SELECT 1 FROM ar_product_purges WHERE product_id=$1',[id])).rowCount,0);});
 await action(id,'archive');
 await check('stale purge preview cannot delete after restoration',async()=>{const preview=await readProductLifecycle(id);await action(id,'restore');await assert.rejects(()=>changeProductLifecycle(actor,{id,action:'purge',token:preview.token,idempotencyKey:key()}),e=>e.code==='PRODUCT_CONFLICT');await action(id,'archive');});
 const editor=await readProductEditor(id),before={order:(await q('SELECT * FROM ar_orders WHERE id=$1',[order])).rows,sku:(await q('SELECT * FROM ar_skus WHERE id=$1',[sku])).rows,stock:(await q('SELECT * FROM ar_stock WHERE sku_id=$1',[sku])).rows,components:(await q('SELECT * FROM ar_order_components WHERE order_id=$1',[order])).rows};
 await check('concurrent purge retries are idempotent and preserve commerce history',async()=>{const input={id,action:'purge',token:(await readProductLifecycle(id)).token,idempotencyKey:key()};const [a,b]=await Promise.all([changeProductLifecycle(actor,input),changeProductLifecycle(actor,input)]);assert.deepEqual(a,b);assert.deepEqual(await changeProductLifecycle(actor,input),a);assert.equal((await q("SELECT count(*)::int n FROM ar_product_editor_events WHERE product_id=$1 AND action='purge'",[id])).rows[0].n,1);for(const [name,sql,value] of [['order','SELECT * FROM ar_orders WHERE id=$1',order],['sku','SELECT * FROM ar_skus WHERE id=$1',sku],['stock','SELECT * FROM ar_stock WHERE sku_id=$1',sku],['components','SELECT * FROM ar_order_components WHERE order_id=$1',order]])assert.deepEqual((await q(sql,[value])).rows,before[name]);});
 await check('purged products cannot reopen, restore or publish a stale editor',async()=>{await assert.rejects(()=>readProductEditor(id),purged);await assert.rejects(()=>readProductLifecycle(id),purged);await assert.rejects(()=>saveProductEditor(actor,command(editor)),purged);assert.equal((await archivedProducts()).some(p=>p.id===id),false);assert.equal((await editorDrafts()).some(p=>p.id===id),false);});
 await check('CMS publication cannot resurrect a purged product on storefront',async()=>{await assert.rejects(()=>q("UPDATE ar_products SET status='published' WHERE id=$1",[id]),/Permanently removed product/);assert.equal((await getCatalog()).products.some(p=>p.id===id),false);await assert.rejects(()=>readProductEditor(id),purged);});
 await check('draft-only purge clears payload and cannot recreate editor',async()=>{const draftId=key(),s=await readProductEditor(draftId);s.data.name='QA Purged Draft';await saveProductEditor(actor,{...command(s),action:'draft'});await action(draftId,'archive');await action(draftId,'purge');assert.equal((await q('SELECT payload FROM ar_product_editor_drafts WHERE id=$1',[draftId])).rows[0].payload,null);await assert.rejects(()=>readProductEditor(draftId),purged);assert.equal((await archivedProducts()).some(p=>p.id===draftId),false);});
 await check('bulk preview rejects changed membership atomically; retry preserves result',async()=>{
  const ids=[key(),key()];
  for(const pid of ids){const state=await readProductEditor(pid);state.data.name='QA Bulk '+pid;await saveProductEditor(actor,{...command(state),action:'draft'});await action(pid,'archive');}
  const preview=await readProductTrash();await action(ids[1],'restore');
  await assert.rejects(()=>purgeProductTrash(actor,{token:preview.token,idempotencyKey:key()}),e=>e.code==='PRODUCT_CONFLICT');
  assert.equal((await q('SELECT 1 FROM ar_product_purges WHERE product_id=ANY($1::uuid[])',[ids])).rowCount,0);
  await action(ids[1],'archive');const snapshot=await readProductTrash(),input={token:snapshot.token,idempotencyKey:key()};
  assert.ok(snapshot.items.some(p=>p.id===ids[0]));assert.ok(snapshot.items.some(p=>p.id===ids[1]));
  const [a,b]=await Promise.all([purgeProductTrash(actor,input),purgeProductTrash(actor,input)]);assert.deepEqual(a,b);assert.equal(a.count,snapshot.count);assert.deepEqual(await purgeProductTrash(actor,input),a);
  assert.equal((await readProductTrash()).count,0);for(const pid of ids){await assert.rejects(()=>readProductEditor(pid),purged);assert.equal((await q("SELECT count(*)::int n FROM ar_product_editor_events WHERE product_id=$1 AND action='purge'",[pid])).rows[0].n,1);}
 });
 console.log(JSON.stringify({passed:true,isolated:true,externalCalls:0,checks}));
}finally{await getPool().end();await owner.end();}
