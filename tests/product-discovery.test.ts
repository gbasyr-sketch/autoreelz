import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {recentProducts,rememberProduct,recentOffers,productSuggestions,RECENT_TTL} from '../src/lib/product-discovery.ts';
import {createCatalogSnapshot,type CatalogProduct} from '../src/lib/catalog-types.ts';
const now=2000000000000;
const product=(name:string,category='heaters'):CatalogProduct=>({id:randomUUID(),name,slug:name,category,categorySlugs:[category],kind:'single',description:'',image:'',media:[],attributes:{},fitment:[],isDemo:false,variants:[{id:randomUUID(),article:name,label:'Variant',priceRubles:'100.00',stock:1,attributes:{},image:'',media:[],fitment:[]}]});
const snapshot=(products:CatalogProduct[])=>createCatalogSnapshot({products,categories:[],vehicles:[],attributeDefinitions:{}});
test('recent history is bounded, expires and remembers the last exact variant once per product',()=>{
 const id=randomUUID(),sku=randomUUID(),rows=Array.from({length:20},(_,i)=>({productId:randomUUID(),skuId:null,viewedAt:now-i}));
 const saved=rememberProduct(rows,id,sku,now);assert.equal(saved.length,12);assert.equal(saved[0]!.skuId,sku);
 const next=rememberProduct(saved,id,null,now+1);assert.equal(next.length,12);assert.equal(next.filter(r=>r.productId===id).length,1);assert.equal(next[0]!.skuId,null);
 assert.deepEqual(recentProducts([{productId:id,skuId:sku,viewedAt:now-RECENT_TTL},{productId:id,skuId:sku,viewedAt:now+1},{productId:'bad',skuId:null,viewedAt:now}],now),[]);assert.deepEqual(recentProducts({}),[]);
});
test('removed variants, unavailable products and the current product never fall back to another offer',()=>{
 const a=product('a'),b=product('b'),catalog=snapshot([a,b]);const history=[{productId:a.id,skuId:a.variants[0]!.id,viewedAt:now},{productId:b.id,skuId:randomUUID(),viewedAt:now},{productId:b.id,skuId:null,viewedAt:now}];assert.deepEqual(recentOffers(catalog,history,a.id),[]);
 b.variants[0]!.priceRubles='2350.50';const good=recentOffers(catalog,[{productId:b.id,skuId:b.variants[0]!.id,viewedAt:now}],a.id);assert.equal(good[0]!.offer.priceRubles,'2350.50');
});
test('automatic suggestions stay in related categories, exclude demos/current and select a compatible SKU',()=>{
 const a=product('a'),b=product('b'),other=product('other','knobs'),demo={...product('demo'),isDemo:true},vehicle=randomUUID();
 const rule={vehicleId:vehicle,versionId:null,yearFrom:null,yearTo:null,airConditioning:'any' as const,state:'incompatible' as const,note:null};
 b.variants[0]!.fitment=[rule];b.variants.push({...b.variants[0]!,id:randomUUID(),label:'Compatible',fitment:[{...rule,state:'compatible'}]});
 const catalog=snapshot([a,b,other,demo]);const suggested=productSuggestions(catalog,a,catalog.offerFor(a)!,{vehicleId:vehicle});assert.deepEqual(suggested.items.map(r=>r.product.id),[b.id]);assert.equal(suggested.items[0]!.offer.variant!.label,'Compatible');assert.equal(suggested.items[0]!.fitment,'compatible');
});
test('manual recommendations preserve order, skip unavailable entries and never invent fitment',()=>{
 const a=product('a'),b=product('b'),c=product('c','knobs');a.recommendedIds=[c.id,randomUUID(),a.id,b.id];const catalog=snapshot([a,b,c]);const result=productSuggestions(catalog,a,catalog.offerFor(a)!,{vehicleId:randomUUID()});assert.equal(result.manual,true);assert.deepEqual(result.items.map(r=>r.product.id),[c.id,b.id]);assert.ok(result.items.every(r=>r.fitment==='unknown'));
});
