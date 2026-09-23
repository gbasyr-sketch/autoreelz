import {testOrderTerms} from '../src/lib/checkout-confirmations.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {qaDatabase} from './helpers/qa-db.mjs';
import type {ShopSession} from '../src/lib/commerce-types.ts';

// These cases fill acceptance gaps, using only an ephemeral clone of the new store.
test('stage 6 bundle repricing, atomic preorder and separate delivery payments', {skip:process.env.AR_STAGE6_TESTS!=='1',timeout:120000},async t=>{
 const qa=await qaDatabase('acceptance_commerce'),q=qa.query;
 const cart=await import('../src/server/cart.ts'),orders=await import('../src/server/orders.ts'),payments=await import('../src/server/payments.ts'),{getPool}=await import('../src/server/db.ts');
 const category='00000000-0000-4000-8000-000000000001',actor={id:randomUUID()},key=()=>randomUUID();
 const rejects=(code:string)=>(e:unknown)=>typeof e==='object'&&e!==null&&'code'in e&&e.code===code;
 async function item(price:string,stock:number){const productId=key(),skuId=key();await q("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo) VALUES($1,'QA приёмка',$2,$3,'published',true)",[productId,'qa-six-'+productId,category]);await q("INSERT INTO ar_skus(id,product_id,article,name,price_rubles,status) VALUES($1,$2,$3,'QA исполнение',$4,'published')",[skuId,productId,'QA-'+skuId,price]);await q('INSERT INTO ar_stock(sku_id,on_hand) VALUES($1,$2)',[skuId,stock]);return{productId,skuId};}
 async function kit(parts:{skuId:string;quantity:number}[],discount:number){const productId=key();await q("INSERT INTO ar_products(id,name,slug,category_id,status,is_demo,kind,discount_percent) VALUES($1,'QA комплект',$2,$3,'published',true,'bundle',$4)",[productId,'qa-six-'+productId,category,discount]);for(const part of parts)await q('INSERT INTO ar_bundle_components(bundle_id,sku_id,quantity) VALUES($1,$2,$3)',[productId,part.skuId,part.quantity]);return{productId,skuId:null};}
 async function session(){const s:ShopSession={id:key(),csrfToken:key(),email:null,expiresAt:new Date(Date.now()+3600000).toISOString()};await q("INSERT INTO ar_web_sessions(id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[s.id,key(),s.csrfToken]);return s;}
 async function add(s:ShopSession,item:{productId:string;skuId:string|null}){return cart.changeCart(s,{...item,quantity:1,mode:'add',cartVersion:(await cart.getCart(s)).version,idempotencyKey:key()});}
 async function quote(s:ShopSession){return cart.createQuote(s,{cartVersion:(await cart.getCart(s)).version,customer:{name:'QA покупатель',phone:'+79990000000',email:'stage6@example.invalid'},delivery:{method:'pickup_point',city:'QA город',address:'QA пункт'}});}
 const balance=async(skuId:string)=>(await q('SELECT on_hand,reserved FROM ar_stock WHERE sku_id=$1',[skuId])).rows[0];
 try{
  await t.test('each kit keeps its discount and reprices on component change; stale checkout changes nothing',async()=>{
   const a=await item('100.00',20),b=await item('200.00',20),first=await kit([{skuId:a.skuId,quantity:2},{skuId:b.skuId,quantity:1}],10),second=await kit([{skuId:a.skuId,quantity:2},{skuId:b.skuId,quantity:1}],25),s=await session();
   await add(s,first);await add(s,second);const old=await quote(s);assert.deepEqual(old.groups[0].lines.map(l=>l.unitPriceRubles),['360.00','300.00']);
   await q('UPDATE ar_skus SET price_rubles=150.25 WHERE id=$1',[a.skuId]);
   await assert.rejects(orders.checkout(s,{confirmation:{accepted:true,version:testOrderTerms.version},quoteId:old.id,cartVersion:old.cartVersion,idempotencyKey:key()}),rejects('QUOTE_CHANGED'));
   assert.equal((await orders.listOrders(s)).length,0);assert.deepEqual(await balance(a.skuId),{on_hand:20,reserved:0});
   const fresh=await quote(s);assert.deepEqual(fresh.groups[0].lines.map(l=>l.unitPriceRubles),['450.45','375.38']);assert.equal(fresh.groups[0].productTotalRubles,'825.83');
   for(const [k,price]of [[first,'450.45'],[second,'375.38']] as const)assert.equal((await q('SELECT price_rubles FROM ar_bundle_offer($1)',[k.productId])).rows[0].price_rubles,price);
  });
  await t.test('whole kit waits for every component; ordinary/preorder shipping and payment stay separate',async()=>{
   const a=await item('30.00',2),b=await item('40.00',0),single=await item('50.00',1),bundle=await kit([{skuId:a.skuId,quantity:2},{skuId:b.skuId,quantity:1}],10),s=await session();
   await add(s,single);await add(s,bundle);const quoteResult=await quote(s),body={confirmation:{accepted:true,version:testOrderTerms.version},quoteId:quoteResult.id,cartVersion:quoteResult.cartVersion,idempotencyKey:key()};
   const result=await orders.checkout(s,body);assert.deepEqual((await orders.checkout(s,body)).orderIds,result.orderIds);assert.equal(result.orders.length,2);
   const ordinary=result.orders.find(o=>o.kind==='ordinary')!,preorder=result.orders.find(o=>o.kind==='preorder')!;
   assert.equal(preorder.shippingCostRubles,null);assert.equal(preorder.canPay,false);assert.deepEqual(await balance(a.skuId),{on_hand:2,reserved:0});
   await assert.rejects(orders.confirmPreorder(actor,{orderId:preorder.id,terms:'QA согласовано',idempotencyKey:key()}),rejects('DELIVERY_PENDING'));
   await orders.quoteShipping(actor,{orderId:preorder.id,costRubles:'202.22',note:'QA отдельная доставка',idempotencyKey:key()});
   await assert.rejects(orders.confirmPreorder(actor,{orderId:preorder.id,terms:'QA согласовано',idempotencyKey:key()}),rejects('INSUFFICIENT_STOCK'));
   assert.deepEqual(await balance(a.skuId),{on_hand:2,reserved:0});assert.equal((await q('SELECT count(*)::int n FROM ar_stock_movements WHERE order_id=$1',[preorder.id])).rows[0].n,0);
   const normal=await orders.quoteShipping(actor,{orderId:ordinary.id,costRubles:'101.11',note:'QA обычная доставка',idempotencyKey:key()});
   await payments.payOrder(s,{orderId:normal.id,shippingVersion:normal.shippingVersion,method:'card',idempotencyKey:key()});assert.equal((await orders.getOrder(s,preorder.id)).paymentStatus,'unpaid');
   await orders.receiveStock(actor,{skuId:b.skuId,quantity:1,reason:'QA приход',idempotencyKey:key()});
   const shipping=await orders.quoteShipping(actor,{orderId:preorder.id,costRubles:'202.22',note:'QA отдельная доставка',idempotencyKey:key()});assert.equal(shipping.totalRubles,'292.22');assert.equal(shipping.canPay,false);
   const confirmation={orderId:preorder.id,terms:'QA согласовано',idempotencyKey:key()};const confirmed=await orders.confirmPreorder(actor,confirmation);await orders.confirmPreorder(actor,confirmation);
   assert.deepEqual(await balance(a.skuId),{on_hand:0,reserved:0});assert.deepEqual(await balance(b.skuId),{on_hand:0,reserved:0});
   const pay={orderId:preorder.id,shippingVersion:confirmed.shippingVersion,method:'sbp',idempotencyKey:key()};await payments.payOrder(s,pay);await payments.payOrder(s,pay);
   assert.deepEqual(await balance(a.skuId),{on_hand:0,reserved:0});assert.deepEqual(await balance(b.skuId),{on_hand:0,reserved:0});
   const amounts=(await q('SELECT order_id,amount_rubles FROM ar_payments WHERE order_id=ANY($1::uuid[]) ORDER BY amount_rubles',[result.orderIds])).rows;
   assert.deepEqual(amounts.map(x=>x.amount_rubles),['151.11','292.22']);assert.equal(new Set(amounts.map(x=>x.order_id)).size,2);
  });
 }finally{await getPool().end();await qa.close();}
});
