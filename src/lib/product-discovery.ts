import Decimal from 'decimal.js';
import type {CatalogSnapshot,CatalogProduct,Offer,VehicleSelection,FitmentState} from './catalog-types.ts';
export const RECENT_KEY='autoreelz.recent-products.v1',RECENT_LIMIT=12,RECENT_TTL=30*24*60*60*1000;
export type RecentProduct={productId:string;skuId:string|null;viewedAt:number};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function recentProducts(value:unknown,now=Date.now()):RecentProduct[]{
 if(!Array.isArray(value))return[];
 const seen=new Set<string>();return value.slice(0,100).filter((row):row is RecentProduct=>!!row&&typeof row==='object'&&validId(row.productId)&&(row.skuId===null||validId(row.skuId))&&Number.isSafeInteger(row.viewedAt)&&row.viewedAt<=now&&row.viewedAt>now-RECENT_TTL).sort((a,b)=>b.viewedAt-a.viewedAt).filter(row=>{if(seen.has(row.productId))return false;seen.add(row.productId);return true;}).slice(0,RECENT_LIMIT).map(({productId,skuId,viewedAt})=>({productId,skuId,viewedAt}));
}
export function rememberProduct(rows:unknown,productId:string,skuId:string|null,now=Date.now()){
 return recentProducts([{productId,skuId,viewedAt:now},...recentProducts(rows,now).filter(r=>r.productId!==productId)],now);
}
export function recentOffers(catalog:CatalogSnapshot,rows:RecentProduct[],exclude:string){
 return rows.filter(row=>row.productId!==exclude).flatMap(row=>{const product=catalog.products.find(p=>p.id===row.productId);if(!product||product.isDemo||product.kind==='single'&&!row.skuId)return[];const offer=catalog.offerFor(product,row.skuId);return offer?[{product,offer}]:[];});
}
export type SuggestedProduct={product:CatalogProduct;offer:Offer;fitment?:FitmentState};
export function productSuggestions(catalog:CatalogSnapshot,current:CatalogProduct,currentOffer:Offer,selection?:VehicleSelection):{manual:boolean;items:SuggestedProduct[]}{
 const manual=!!current.recommendedIds?.length,order=new Map((current.recommendedIds??[]).map((id,i)=>[id,i]));
 const rank=(entry:SuggestedProduct)=>entry.fitment==='compatible'?0:1;
 const distance=(entry:SuggestedProduct)=>new Decimal(entry.offer.priceRubles).minus(currentOffer.priceRubles).abs();
 const compare=(a:SuggestedProduct,b:SuggestedProduct)=>rank(a)-rank(b)||Number(b.offer.available>0)-Number(a.offer.available>0)||distance(a).cmp(distance(b));
 const items=catalog.products.filter(p=>p.id!==current.id&&!p.isDemo&&(manual?order.has(p.id):p.categorySlugs.some(c=>current.categorySlugs.includes(c)))).flatMap(product=>{
  const offers=(product.kind==='single'?product.variants.map(v=>catalog.offerFor(product,v.id)):[catalog.offerFor(product)]).filter((o):o is Offer=>!!o);
  const candidates=offers.map(offer=>({product,offer,...(selection?{fitment:catalog.fitmentFor(product,offer,selection)}:{})})).filter(entry=>entry.fitment!=='incompatible').sort(compare);
  return candidates.length?[candidates[0]!]:[];
 });
 items.sort((a,b)=>manual?order.get(a.product.id)!-order.get(b.product.id)!:compare(a,b)||a.product.id.localeCompare(b.product.id));
 return{manual,items:items.slice(0,8)};
}
