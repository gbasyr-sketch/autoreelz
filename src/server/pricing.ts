import type{PoolClient}from'pg';
import type{CheckoutInput,OrderLineSnapshot,QuoteGroup}from'../lib/commerce-types.ts';
import{StoreError,text,email,integer}from'./errors.ts';
import{quoteLocalShipping}from'./adapters/shipping.ts';
export function safeMoney(value:bigint|number|string){const n=typeof value==='bigint'?Number(value):Number(value);if(!Number.isSafeInteger(n)||n<0)throw new StoreError('PRICE_RANGE','Сумма заказа выходит за допустимый диапазон.');return n;}
export function customerInput(body:Record<string,unknown>):CheckoutInput{
 const customer=body.customer as Record<string,unknown>|undefined,delivery=body.delivery as Record<string,unknown>|undefined;
 if(!customer||!delivery)throw new StoreError('INVALID_INPUT','Заполните контактные данные и доставку.');
 const phone=text(customer.phone,'Телефон',10,25);if(!/^[+0-9 ()-]+$/.test(phone)||phone.replace(/\D/g,'').length<10||phone.replace(/\D/g,'').length>15)throw new StoreError('PHONE','Укажите корректный телефон.');
 if(!['pickup_point','courier'].includes(String(delivery.method)))throw new StoreError('DELIVERY','Выберите способ доставки.');
 return{customer:{name:text(customer.name,'Имя',2,100),phone,email:email(customer.email)},delivery:{method:delivery.method as 'pickup_point'|'courier',city:text(delivery.city,'Город',2,100),address:text(delivery.address,'Адрес / пункт выдачи',3,300)},cartVersion:integer(body.cartVersion,'Версия корзины')};
}
export async function snapshotLine(c:PoolClient,productId:string,skuId:string|null,quantity:number):Promise<OrderLineSnapshot>{
 const product=(await c.query(`SELECT p.* FROM ar_products p WHERE p.id=$1 AND p.status='published' AND NOT EXISTS (
 WITH RECURSIVE parents AS (SELECT * FROM ar_categories WHERE id=p.category_id UNION ALL SELECT x.* FROM ar_categories x JOIN parents a ON x.id=a.parent_id)
 SELECT 1 FROM parents WHERE status<>'published')`,[productId])).rows[0];
 if(!product)throw new StoreError('UNAVAILABLE','Товар больше не доступен. Удалите его из корзины.',409);
 let rows;
 if(product.kind==='single'){
  if(!skuId)throw new StoreError('SKU_REQUIRED','Выберите исполнение товара.');
  rows=(await c.query("SELECT id,article,name,price_kopecks,1 quantity FROM ar_skus WHERE id=$1 AND product_id=$2 AND status='published'",[skuId,productId])).rows;
  if(rows.length!==1)throw new StoreError('UNAVAILABLE','Выбранное исполнение больше не доступно.',409);
 }else{
  if(skuId)throw new StoreError('FIXED_BUNDLE','У комплекта фиксированный состав.');
  rows=(await c.query(`SELECT s.id,s.article,s.name,s.price_kopecks,b.quantity,s.status,p.status parent_status,
   NOT EXISTS(WITH RECURSIVE parents AS (SELECT * FROM ar_categories WHERE id=p.category_id UNION ALL SELECT x.* FROM ar_categories x JOIN parents a ON x.id=a.parent_id) SELECT 1 FROM parents WHERE status<>'published') category_visible
   FROM ar_bundle_components b JOIN ar_skus s ON s.id=b.sku_id JOIN ar_products p ON p.id=s.product_id WHERE b.bundle_id=$1 ORDER BY s.id`,[productId])).rows;
  if(!rows.length||rows.some(r=>r.status!=='published'||r.parent_status!=='published'||!r.category_visible))throw new StoreError('UNAVAILABLE','Состав комплекта временно недоступен.',409);
 }
 const components=rows.map(r=>({skuId:r.id,article:r.article,name:r.name,quantity:Number(r.quantity),unitPriceKopecks:safeMoney(r.price_kopecks)}));
 const sum=components.reduce((n,x)=>n+BigInt(x.unitPriceKopecks)*BigInt(x.quantity),0n);
 const bps=Math.round(Number(product.discount_percent)*100);
 const unitPriceKopecks=safeMoney((sum*BigInt(10000-bps)+5000n)/10000n);
 let image=product.kind==='bundle'?'/images/placeholder-kit.svg':'/images/placeholder-console.svg';
 if(skuId){const r=await c.query("SELECT ar_effective_sku($1)->'media'->0->>'file_id' file_id",[skuId]);if(r.rows[0]?.file_id)image='/media/'+r.rows[0].file_id;}
 return{productId,skuId,name:product.name,article:skuId?components[0]!.article:'',variantLabel:skuId?components[0]!.name:'Фиксированный состав',quantity,unitPriceKopecks,lineTotalKopecks:safeMoney(BigInt(unitPriceKopecks)*BigInt(quantity)),image,components};
}
export function requirements(lines:OrderLineSnapshot[]){const result=new Map<string,number>();for(const l of lines)for(const c of l.components)result.set(c.skuId,(result.get(c.skuId)??0)+l.quantity*c.quantity);return result;}
export async function lockStock(c:PoolClient,requirementsMap:Map<string,number>){
 const ids=[...requirementsMap.keys()].sort();
 for(const id of ids)await c.query('INSERT INTO ar_stock(sku_id,on_hand,reserved) VALUES($1,0,0) ON CONFLICT(sku_id) DO NOTHING',[id]);
 return(await c.query('SELECT sku_id,on_hand,reserved FROM ar_stock WHERE sku_id=ANY($1::uuid[]) ORDER BY sku_id FOR UPDATE',[ids])).rows;
}
export function splitLines(lines:OrderLineSnapshot[],stocks:{sku_id:string;on_hand:number;reserved:number}[]){
 const available=new Map(stocks.map(s=>[s.sku_id,s.on_hand-s.reserved]));const ordinary:OrderLineSnapshot[]=[],preorder:OrderLineSnapshot[]=[];
 for(const l of lines){const need=requirements([l]);if([...need].every(([id,q])=>(available.get(id)??0)>=q)){ordinary.push(l);for(const[id,q]of need)available.set(id,(available.get(id)??0)-q);}else preorder.push(l);}
 return{ordinary,preorder};
}
export async function shippingQuote(c:PoolClient,lines:OrderLineSnapshot[],delivery:CheckoutInput['delivery'],fail=false){return quoteLocalShipping(c,requirements(lines),delivery,fail);}
export async function quoteGroups(c:PoolClient,lines:OrderLineSnapshot[],input:CheckoutInput,lock=false):Promise<QuoteGroup[]>{
 const need=requirements(lines);const stocks=lock?await lockStock(c,need):(await c.query('SELECT sku_id,on_hand,reserved FROM ar_stock WHERE sku_id=ANY($1::uuid[])',[[...need.keys()]])).rows;
 const groups=splitLines(lines,stocks);const result:QuoteGroup[]=[];
 for(const kind of ['ordinary','preorder'] as const){const items=groups[kind];if(!items.length)continue;const productTotalKopecks=safeMoney(items.reduce((a,l)=>a+BigInt(l.lineTotalKopecks),0n));const shipping=await shippingQuote(c,items,input.delivery);result.push({kind,lines:items,productTotalKopecks,shipping,totalKopecks:shipping.costKopecks===null?null:safeMoney(productTotalKopecks+shipping.costKopecks)});}
 return result;
}
