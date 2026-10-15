import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID as key} from 'node:crypto';
import {createImageDatabase,imageEnvironment} from './helpers/ai-image-qa.mjs';
const qa=await createImageDatabase('ar_qa_ai_images_return_intake_'+key().replaceAll('-','').slice(0,12));
Object.assign(process.env,imageEnvironment(qa.database,'private/return-intake/qa'),{MAIL_PROVIDER:'simulation',MAIL_OWNER_RECIPIENT:'',PAYMENT_PROVIDER:'simulation',SHIPPING_PROVIDER:'simulation'});
let externalCalls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalCalls++;throw Error('External calls prohibited in intake QA');};
const {getPool}=await import('../src/server/db.ts'),security=await import('../src/server/security.ts'),cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts'),management=await import('../src/server/management.ts');
const {returnIntakeWorkspace,receiveReturn,inspectReturn}=await import('../src/server/return-intake.ts');
const q=(s,v=[])=>qa.owner.query(s,v),actor={id:key()},checks=[];
const readStocks=async f=>(await q('SELECT sku_id,on_hand,reserved FROM ar_stock WHERE sku_id=ANY($1::uuid[]) ORDER BY sku_id',[[f.a,f.b]])).rows;
async function buy({pay=true,ship=true,supplier=false}={}){
 const category=key(),pa=key(),pb=key(),kit=key(),a=key(),b=key();
 await q("INSERT INTO ar_categories(id,name,slug,status) VALUES($1,'QA',$2,'published')",[category,'qa-'+category]);
 for(const [id,name,kind]of [[pa,'QA одиночная деталь','single'],[pb,'QA вторая деталь','single'],[kit,'QA комплект','bundle']])await q("INSERT INTO ar_products(id,name,slug,category_id,status,kind,discount_percent) VALUES($1,$2,$3,$4,'published',$5,CASE WHEN $5='bundle' THEN 10 ELSE 0 END)",[id,name,'qa-'+id,category,kind]);
 for(const [sku,p,price]of [[a,pa,'100.01'],[b,pb,'50.02']]){await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA цвет',$4,'published')",[sku,p,'QA-'+sku,price]);await q('INSERT INTO ar_stock(sku_id,on_hand) VALUES($1,$2)',[sku,supplier?0:20]);}
 await q('INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES($1,$2,2),($1,$3,1)',[kit,a,b]);
 const jar=new Map(),session=await security.getSession({cookies:{get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v)}});
 let view=await cart.changeCart(session,{productId:pa,skuId:a,quantity:1,mode:'add',cartVersion:0,idempotencyKey:key()});view=await cart.changeCart(session,{productId:kit,skuId:null,quantity:2,mode:'add',cartVersion:view.version,idempotencyKey:key()});
 const quote=await cart.createQuote(session,{cartVersion:view.version,customer:{name:'QA покупатель',phone:'+79990000000',email:'qa@example.invalid'},delivery:{method:'pickup_point',city:'QA город',address:'QA адрес',provider:'manual',manual:true}});
 let order=(await orders.checkout(session,{quoteId:quote.id,cartVersion:view.version,confirmation:{accepted:true,version:quote.confirmation.version},idempotencyKey:key()})).orders[0];
 order=await orders.quoteShipping(actor,{orderId:order.id,costRubles:'100.00',note:'QA доставка',deliveryDeadline:'2099-12-31',idempotencyKey:key()});
 if(supplier)order=await orders.confirmPreorder(actor,{orderId:order.id,supplierConfirmed:true,terms:'QA подтверждено поставщиком',deliveryDeadline:'2099-12-31',idempotencyKey:key()});
 if(pay)order=await payments.payOrder(session,{orderId:order.id,shippingVersion:order.shippingVersion,method:'card',idempotencyKey:key()});
 if(ship){order=await management.fulfill(actor,{orderId:order.id,status:'packing',reason:'QA сборка',idempotencyKey:key()});order=await management.fulfill(actor,{orderId:order.id,status:'shipped',trackingNumber:'QA-OUTBOUND',reason:'QA отправка',idempotencyKey:key()});}
 return{orderId:order.id,a,b,kit,session};
}
const receive=(f,patch={})=>({orderId:f.orderId,trackingNumber:'QA-RETURN-1',note:'QA фактически получено',confirmed:true,lines:[{skuId:f.a,quantity:3},{skuId:f.b,quantity:1}],idempotencyKey:key(),...patch});
const inspect=(f,receiptId,patch={})=>({orderId:f.orderId,receiptId,note:'QA A пригодны частично, B повреждена',confirmed:true,lines:[{skuId:f.a,restockQuantity:2},{skuId:f.b,restockQuantity:0}],idempotencyKey:key(),...patch});
const count=async table=>(await q('SELECT count(*)::int n FROM '+table)).rows[0].n;
async function ownerTransaction(work){const c=await qa.owner.connect();try{await c.query('BEGIN');await work(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
try{
 const f=await buy();let ws=await returnIntakeWorkspace(f.orderId);assert.equal(ws.canReceive,true);assert.equal(ws.lines.find(l=>l.skuId===f.a).orderedQuantity,5);assert.equal(ws.lines.find(l=>l.skuId===f.b).orderedQuantity,2);
 await q('UPDATE ar_bundle_components SET quantity=9 WHERE bundle_id=$1 AND sku_id=$2',[f.kit,f.a]);assert.equal((await returnIntakeWorkspace(f.orderId)).lines.find(l=>l.skuId===f.a).orderedQuantity,5);
 checks.push('real checkout/payment/dispatch yields snapshot physical SKU capacity; later bundle edits do not change it');
 await q("UPDATE ar_orders SET status='manual_review',payment_status='review',review_reason='QA отдельный финансовый разбор' WHERE id=$1",[f.orderId]);
 const before=await readStocks(f),mailBefore=await count('ar_mail_outbox'),paymentsBefore=await count('ar_payments'),refundsBefore=await count('ar_yookassa_refunds');
 const body=receive(f),result=await Promise.all([receiveReturn(actor,body),receiveReturn(actor,body),receiveReturn({id:key()},{...body,trackingNumber:'  qa-return-1  ',idempotencyKey:key()})]);const receipt=result[0].id;assert.equal(new Set(result.map(r=>r.id)).size,1);
 assert.deepEqual(await readStocks(f),before);assert.equal((await returnIntakeWorkspace(f.orderId)).receipts.length,1);checks.push('reception credits no stock; same parcel across keys/operators is registered once');
 await assert.rejects(receiveReturn(actor,receive(f,{lines:[{skuId:f.a,quantity:2}]})),{code:'RETURN_RECEIPT_EXISTS'});
 await assert.rejects(receiveReturn(actor,receive(f,{trackingNumber:'QA-RETURN-2',lines:[{skuId:f.a,quantity:3}]})),{code:'RETURN_QUANTITY'});
 await assert.rejects(receiveReturn(actor,receive(f,{trackingNumber:'QA-OTHER',lines:[{skuId:key(),quantity:1}]})),{code:'RETURN_QUANTITY'});
 checks.push('duplicate parcel edits, excess quantities and foreign SKU cannot inflate reception');
 // Preserve a reservation belonging to another transaction while adding inspected goods.
 await q('UPDATE ar_stock SET reserved=2 WHERE sku_id=$1',[f.a]);const decision=inspect(f,receipt);
 const inspections=await Promise.all([inspectReturn(actor,decision),inspectReturn(actor,decision),inspectReturn({id:key()},{...decision,idempotencyKey:key()})]);assert.equal(new Set(inspections.map(r=>r.id)).size,1);
 const stocks=await readStocks(f);assert.deepEqual(stocks.find(s=>s.sku_id===f.a),{sku_id:f.a,on_hand:17,reserved:2});assert.deepEqual(stocks.find(s=>s.sku_id===f.b),{sku_id:f.b,on_hand:18,reserved:0});
 assert.equal((await q("SELECT count(*)::int n FROM ar_stock_movements WHERE order_id=$1 AND operation_key LIKE 'return-intake:%'",[f.orderId])).rows[0].n,1);
 await assert.rejects(inspectReturn(actor,{...decision,lines:[{skuId:f.a,restockQuantity:3},{skuId:f.b,restockQuantity:1}],idempotencyKey:key()}),{code:'RETURN_INSPECTED'});
 checks.push('one inspection atomically credits approved physical SKU once; held components and existing reservations stay unchanged');
 const second=(await receiveReturn(actor,receive(f,{trackingNumber:'QA-RETURN-2',lines:[{skuId:f.a,quantity:2},{skuId:f.b,quantity:1}]}))).id;
 await inspectReturn(actor,inspect(f,second,{lines:[{skuId:f.a,restockQuantity:0},{skuId:f.b,restockQuantity:0}]}));assert.deepEqual(await readStocks(f),stocks);
 ws=await returnIntakeWorkspace(f.orderId);assert.equal(ws.canReceive,false);assert.equal(ws.lines.find(l=>l.skuId===f.a).heldQuantity,3);assert.equal(ws.lines.find(l=>l.skuId===f.b).heldQuantity,2);assert.ok(ws.receipts.every(r=>r.inspection));
 await assert.rejects(receiveReturn(actor,receive(f,{trackingNumber:'QA-RETURN-3',lines:[{skuId:f.a,quantity:1}]})),{code:'RETURN_QUANTITY'});
 checks.push('later partial parcels share a bounded budget; all-held inspection never adds saleable stock');
 assert.equal(await count('ar_mail_outbox'),mailBefore);assert.equal(await count('ar_payments'),paymentsBefore);assert.equal(await count('ar_yookassa_refunds'),refundsBefore);
 const order=(await q('SELECT status,payment_status,allocation_state FROM ar_orders WHERE id=$1',[f.orderId])).rows[0];assert.deepEqual(order,{status:'manual_review',payment_status:'review',allocation_state:'settled'});checks.push('reception/inspection do not send mail, refund money, change payment facts or close order review');
 for(const [table,idColumn,id]of [['ar_return_receipts','id',receipt],['ar_return_inspections','id',inspections[0].id]]){
  await assert.rejects(getPool().query('DELETE FROM '+table+' WHERE '+idColumn+'=$1',[id]),e=>e.code==='42501');await assert.rejects(qa.owner.query('UPDATE '+table+" SET note='changed' WHERE "+idColumn+'=$1',[id]),/immutable/);
 }
 checks.push('journal is append-only for app and immutable even to ordinary owner UPDATE');
 await assert.rejects(q("INSERT INTO ar_return_receipt_lines(receipt_id,order_id,sku_id,quantity,name,article,source_labels) VALUES($1,$2,$3,1,'QA','QA','[]')",[receipt,f.orderId,f.a]),/only be inserted during reception/);
 await assert.rejects(q('INSERT INTO ar_return_inspection_lines(inspection_id,receipt_id,order_id,sku_id,restock_quantity,held_quantity) VALUES($1,$2,$3,$4,0,1)',[inspections[0].id,receipt,f.orderId,f.b]),/only be inserted during inspection/);
 await assert.rejects(q("INSERT INTO ar_stock_movements(sku_id,order_id,operation_key,stock_delta,reserved_delta,reason,actor_id) VALUES($1,$2,$3,1,0,'QA late credit',$4)",[f.b,f.orderId,'return-intake:'+inspections[0].id,actor.id]),/must match current inspection/);
 await assert.rejects(q("UPDATE ar_stock_movements SET stock_delta=3 WHERE operation_key=$1",['return-intake:'+inspections[0].id]),/immutable/);
 checks.push('committed receipts, inspections and return stock operations reject late INSERT or rewrite');

 const fresh=await buy();const pending=(await receiveReturn(actor,receive(fresh))).id;const original=await readStocks(fresh),movementCount=await count('ar_stock_movements');
 const failedSku=[fresh.a,fresh.b].sort()[1];await q(`CREATE FUNCTION qa_intake_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sku_id='${failedSku}'::uuid THEN RAISE EXCEPTION 'QA second SKU failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_intake_fail BEFORE UPDATE ON ar_stock FOR EACH ROW EXECUTE FUNCTION qa_intake_fail()`);
 const both=inspect(fresh,pending,{lines:[{skuId:fresh.a,restockQuantity:3},{skuId:fresh.b,restockQuantity:1}]});
 try{await assert.rejects(inspectReturn(actor,both),/QA second SKU failure/);}finally{await q('DROP TRIGGER qa_intake_fail ON ar_stock; DROP FUNCTION qa_intake_fail()');}
 assert.deepEqual(await readStocks(fresh),original);assert.equal(await count('ar_stock_movements'),movementCount);assert.equal((await returnIntakeWorkspace(fresh.orderId)).receipts[0].inspection,null);
 await inspectReturn(actor,both);assert.equal((await q('SELECT payment_status FROM ar_orders WHERE id=$1',[fresh.orderId])).rows[0].payment_status,'paid');checks.push('failure on second physical SKU rolls back inspection and first credit; same request safely retries after rollback');
 checks.push('physical processing works during separate financial review and preserves both reviewed and paid payment states');
 const unpaid=await buy({pay:false,ship:false});await assert.rejects(receiveReturn(actor,receive(unpaid)),{code:'RETURN_ORDER'});
 const unshipped=await buy({ship:false});await assert.rejects(receiveReturn(actor,receive(unshipped)),{code:'RETURN_ORDER'});
 const supplier=await buy({supplier:true,ship:false});await assert.rejects(receiveReturn(actor,receive(supplier)),{code:'RETURN_ORDER'});checks.push('unpaid/reserved, unshipped and supplier-paid unallocated goods cannot produce returned stock');
 await assert.rejects(ownerTransaction(async c=>{const id=key();await c.query('INSERT INTO ar_return_receipts(id,order_id,tracking_number,note,actor_id) VALUES($1,$2,$3,$4,$5)',[id,f.orderId,'QA-BYPASS','QA direct insert',actor.id]);await c.query("INSERT INTO ar_return_receipt_lines(receipt_id,order_id,sku_id,quantity,name,article,source_labels) VALUES($1,$2,$3,1,'QA','QA','[]')",[id,f.orderId,f.a]);}),/exceeds issued goods/);
 const guard=await buy();const guardReceipt=(await receiveReturn(actor,receive(guard))).id;
 await assert.rejects(ownerTransaction(async c=>{const id=key();await c.query('INSERT INTO ar_return_inspections(id,receipt_id,order_id,note,actor_id) VALUES($1,$2,$3,$4,$5)',[id,guardReceipt,guard.orderId,'QA no movement',actor.id]);for(const sku of [guard.a,guard.b])await c.query('INSERT INTO ar_return_inspection_lines(inspection_id,receipt_id,order_id,sku_id,restock_quantity,held_quantity) VALUES($1,$2,$3,$4,$5,0)',[id,guardReceipt,guard.orderId,sku,sku===guard.a?3:1]);}),/stock movement mismatch/);
 checks.push('database budget and deferred inspection/stock coupling reject direct bypass outside application validation');
 process.env.STORE_MODE='production';for(const command of [()=>receiveReturn(actor,receive(guard)),()=>inspectReturn(actor,inspect(guard,guardReceipt))])await assert.rejects(command(),/Commerce is available only/);assert.equal((await returnIntakeWorkspace(f.orderId)).enabled,false);
 assert.equal(externalCalls,0);checks.push('noncanonical production origin is closed; history remains readable and external calls stay zero');
 process.env.APP_ORIGIN='https://autoreelz.ru';process.env.MAIL_PROVIDER='timeweb-smtp';
 const beforeProduction=await readStocks(guard);await inspectReturn(actor,inspect(guard,guardReceipt));const afterProduction=await readStocks(guard);assert.notDeepEqual(afterProduction,beforeProduction);assert.equal((await returnIntakeWorkspace(guard.orderId)).enabled,true);assert.equal(externalCalls,0);checks.push('canonical production permits explicit return inspection exactly once without money or external calls');
 await fs.mkdir('artifacts/yookassa-production',{recursive:true});await fs.writeFile(process.env.AR_RETURN_INTAKE_OUTPUT||'artifacts/return-intake/database.json',JSON.stringify({passed:true,isolated:true,externalCalls,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{globalThis.fetch=originalFetch;await getPool().end();await qa.close(true);}
