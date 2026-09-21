import{sumRubles,multiplyRubles}from'./pricing.ts';
import type{PoolClient}from'pg';
import type{ShopSession,CartView,CartLineView,CheckoutQuote,OrderLineSnapshot}from'../lib/commerce-types.ts';
import{transaction}from'./db.ts';
import{StoreError,uuid,integer,iso}from'./errors.ts';
import{idempotent,hash,canonical}from'./security.ts';
import{snapshotLine,requirements,splitLines,safeMoney,customerInput,quoteGroups}from'./pricing.ts';

export async function cartRecord(c:PoolClient,session:ShopSession,lock=false){
 await c.query('INSERT INTO ar_carts(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',[session.id]);
 return(await c.query(`SELECT * FROM ar_carts WHERE session_id=$1 ${lock?'FOR UPDATE':''}`,[session.id])).rows[0];
}
export async function rawCart(c:PoolClient,cartId:string){return(await c.query('SELECT * FROM ar_cart_lines WHERE cart_id=$1 ORDER BY ordinal,id',[cartId])).rows;}
export async function completeLines(c:PoolClient,cartId:string){const rows=await rawCart(c,cartId);if(!rows.length)throw new StoreError('EMPTY_CART','Корзина пуста.');const lines:OrderLineSnapshot[]=[];for(const r of rows)lines.push(await snapshotLine(c,r.product_id,r.sku_id,r.quantity));return lines;}
export async function cartView(c:PoolClient,session:ShopSession):Promise<CartView>{
 const cart=await cartRecord(c,session);const rows=await rawCart(c,cart.id);
 const snapshots=new Map<string,OrderLineSnapshot>();
 for(const row of rows){try{snapshots.set(row.id,await snapshotLine(c,row.product_id,row.sku_id,row.quantity));}catch(e){if(!(e instanceof StoreError))throw e;}}
 const need=requirements([...snapshots.values()]);const stocks=(await c.query('SELECT sku_id,on_hand,reserved FROM ar_stock WHERE sku_id=ANY($1::uuid[])',[[...need.keys()]])).rows;
 const groups=splitLines([...snapshots.values()],stocks);const ordinary=new Set(groups.ordinary);
 const free=new Map(stocks.map(s=>[s.sku_id,Number(s.on_hand)-Number(s.reserved)]));
 const lines:CartLineView[]=rows.map(row=>{
  const l=snapshots.get(row.id);
  if(!l)return{id:row.id,productId:row.product_id,skuId:row.sku_id,quantity:row.quantity,name:row.last_name,article:'',variantLabel:'Недоступно',image:row.last_image,url:'/catalog',unitPriceRubles:safeMoney(row.last_price_rubles),lineTotalRubles:multiplyRubles(row.last_price_rubles,row.quantity),available:0,kind:'preorder',blocked:true,message:'Товар или исполнение больше не опубликованы. Удалите эту позицию.'};
  const available=Math.min(...l.components.map(x=>Math.floor((free.get(x.skuId)??0)/x.quantity)));
  return{id:row.id,productId:l.productId,skuId:l.skuId,quantity:l.quantity,name:l.name,article:l.article,variantLabel:l.variantLabel,image:l.image,url:`/product/${row.product_slug??''}`,unitPriceRubles:l.unitPriceRubles,lineTotalRubles:l.lineTotalRubles,available,kind:ordinary.has(l)?'ordinary':'preorder',blocked:false};
 });
 if(lines.length){const names=(await c.query('SELECT id,slug FROM ar_products WHERE id=ANY($1::uuid[])',[lines.map(l=>l.productId)])).rows;for(const l of lines){const p=names.find(x=>x.id===l.productId);if(p&&!l.blocked)l.url=`/product/${p.slug}${l.skuId?'?sku='+l.skuId:''}`;}}
 return{version:cart.version,lines,productTotalRubles:sumRubles(lines.map(l=>l.lineTotalRubles)),csrfToken:session.csrfToken};
}
export const getCart=(session:ShopSession)=>transaction(c=>cartView(c,session));
export async function changeCart(session:ShopSession,body:Record<string,unknown>){
 const productId=uuid(body.productId),skuId=body.skuId?uuid(body.skuId):null;
 const mode=String(body.mode);if(!['add','set','remove'].includes(mode))throw new StoreError('CART_MODE','Некорректное действие с корзиной.');
 const quantity=mode==='remove'?0:integer(body.quantity,'Количество',1,99),version=integer(body.cartVersion,'Версия корзины');
 return transaction(c=>idempotent(c,`cart:${session.id}`,body.idempotencyKey,{productId,skuId,mode,quantity,version},async()=>{
  const cart=await cartRecord(c,session,true);if(cart.version!==version)throw new StoreError('CART_CHANGED','Корзина изменилась в другой вкладке. Обновите её и повторите действие.',409);
  const existing=(await c.query('SELECT * FROM ar_cart_lines WHERE cart_id=$1 AND product_id=$2 AND sku_id IS NOT DISTINCT FROM $3::uuid',[cart.id,productId,skuId])).rows[0];
  if(mode==='remove'){if(existing)await c.query('DELETE FROM ar_cart_lines WHERE id=$1',[existing.id]);}
  else{
   const qty=mode==='add'?(existing?.quantity??0)+quantity:quantity;integer(qty,'Количество',1,99);
   const snapshot=await snapshotLine(c,productId,skuId,qty);
   if(!existing&&Number((await c.query('SELECT count(*) n FROM ar_cart_lines WHERE cart_id=$1',[cart.id])).rows[0].n)>=100)throw new StoreError('CART_LIMIT','В корзине слишком много разных позиций.');
   if(existing)await c.query('UPDATE ar_cart_lines SET quantity=$2,last_name=$3,last_price_rubles=$4,last_image=$5 WHERE id=$1',[existing.id,qty,snapshot.name,snapshot.unitPriceRubles,snapshot.image]);
   else await c.query('INSERT INTO ar_cart_lines(cart_id,product_id,sku_id,quantity,last_name,last_price_rubles,last_image) VALUES($1,$2,$3,$4,$5,$6,$7)',[cart.id,productId,skuId,qty,snapshot.name,snapshot.unitPriceRubles,snapshot.image]);
  }
  await c.query('UPDATE ar_carts SET version=version+1 WHERE id=$1',[cart.id]);return cartView(c,session);
 }));
}
export async function createQuote(session:ShopSession,body:Record<string,unknown>):Promise<CheckoutQuote>{
 const input=customerInput(body);
 return transaction(async c=>{
  const cart=await cartRecord(c,session,true);if(cart.version!==input.cartVersion)throw new StoreError('CART_CHANGED','Корзина изменилась. Обновите состав.',409);
  const lines=await completeLines(c,cart.id);const groups=await quoteGroups(c,lines,input);
  const row=(await c.query("INSERT INTO ar_cart_quotes(session_id,cart_version,input,snapshot,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes') RETURNING id,expires_at",[session.id,cart.version,input,JSON.stringify(groups),hash(canonical(groups))])).rows[0];
  return{id:row.id,cartVersion:cart.version,expiresAt:iso(row.expires_at)!,customer:input.customer,delivery:input.delivery,groups,csrfToken:session.csrfToken};
 });
}
