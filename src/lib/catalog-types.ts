import {rubles,sumRubles,multiplyRubles,discountRubles,type Rubles} from './money.ts';
export type AttributeKey = string;
export type FitmentState = 'compatible' | 'incompatible' | 'unknown';
export interface FitmentRule { vehicleId:string; versionId:string|null; yearFrom:number|null; yearTo:number|null; airConditioning:'yes'|'no'|'any'|'unknown'; state:FitmentState; note:string|null }
export interface VehicleSelection { vehicleId:string; versionId?:string; year?:number; ac?:string }
export interface CatalogMedia { id:string; src:string; alt:string }
export interface CatalogVariant { id:string; article:string; label:string; priceRubles:Rubles; stock:number; attributes:Record<string,string>; image:string; media:CatalogMedia[]; fitment:FitmentRule[] }
export interface CatalogProduct { id:string; slug:string; name:string; category:string; categorySlugs:string[]; kind:'single'|'bundle'; description:string; image:string; media:CatalogMedia[]; variants:CatalogVariant[]; attributes:Record<string,string>; fitment:FitmentRule[]; components?:{skuId:string;quantity:number}[]; discountBps:number; isDemo:boolean; seoTitle?:string; metaDescription?:string }
export interface Category { id:string; parentId:string|null; slug:string; name:string; shortName:string; icon:string; attributes:string[]; depth:number; ancestorSlugs:string[]; seoTitle?:string; metaDescription?:string }
export interface Vehicle { id:string; slug:string; name:string; yearFrom:number|null; yearTo:number|null; versions:{id:string;name:string}[] }
export interface AttributeDefinition { id:string; label:string; type:'select'|'text'|'number'|'boolean'; unit:string|null; filterable:boolean; values:{value:string;label:string;color?:string}[] }
export interface Offer {priceRubles:Rubles;available:number;variant?:CatalogVariant}
export interface CatalogSnapshot { products:CatalogProduct[]; categories:Category[]; vehicles:Vehicle[]; attributeDefinitions:Record<string,AttributeDefinition>; offerFor:(product:CatalogProduct,skuId?:string|null)=>Offer|null; findSku:(skuId:string)=>{product:CatalogProduct;variant:CatalogVariant}|undefined; attributeLabel:(key:string,value:string)=>string; fitmentFor:(product:CatalogProduct,offer:Offer,selection:VehicleSelection)=>FitmentState }
/** Build the pure public view from already publication-filtered records. */
export function createCatalogSnapshot(data:Pick<CatalogSnapshot,'products'|'categories'|'vehicles'|'attributeDefinitions'>):CatalogSnapshot {
 const skuIndex=new Map(data.products.flatMap(product=>product.variants.map(variant=>[variant.id,{product,variant}] as const)));
 const findSku=(id:string)=>skuIndex.get(id);
 const offerFor=(product:CatalogProduct,skuId?:string|null):Offer|null=>{
  if(product.kind==='single') { const variant=skuId?product.variants.find(v=>v.id===skuId):product.variants[0];return variant?{variant,priceRubles:rubles(variant.priceRubles),available:variant.stock}:null; }
  if(skuId||!product.components?.length)return null;
  const required=new Map<string,number>();for(const c of product.components)required.set(c.skuId,(required.get(c.skuId)??0)+c.quantity);
  const totals:Rubles[]=[];let available=Infinity;
  try {
   for(const[id,quantity]of required){const row=findSku(id);if(!row||quantity<=0)return null;totals.push(multiplyRubles(row.variant.priceRubles,quantity));available=Math.min(available,Math.floor(row.variant.stock/quantity));}
   return{priceRubles:discountRubles(sumRubles(totals),product.discountBps),available};
  } catch(error) {if(error instanceof RangeError)return null;throw error;}
 };
 const attributeLabel=(key:string,value:string)=>{const def=data.attributeDefinitions[key];return def?.values.find(v=>v.value===value)?.label??(def?.type==='boolean'?(value==='true'?'Да':'Нет'):value)+(def?.unit?` ${def.unit}`:'');};
 const fitmentFor=(product:CatalogProduct,offer:Offer,selection:VehicleSelection):FitmentState=>{
  if(product.kind==='single')return evaluateFitment(offer.variant?.fitment??[],selection);
  const states=(product.components??[]).map(c=>evaluateFitment(findSku(c.skuId)?.variant.fitment??[],selection));
  if(product.fitment.length)states.push(evaluateFitment(product.fitment,selection));
  return states.includes('incompatible')?'incompatible':states.length&&states.every(s=>s==='compatible')?'compatible':'unknown';
 };
 return{...data,findSku,offerFor,attributeLabel,fitmentFor};
}
/** Only complete applicable rules confirm fitment; conflicts fail closed. */
export function evaluateFitment(rules:FitmentRule[],selection:VehicleSelection):FitmentState {
 const relevant=rules.filter(r=>r.vehicleId===selection.vehicleId&&(!r.versionId||!selection.versionId||r.versionId===selection.versionId)&&(!selection.year||((r.yearFrom===null||selection.year>=r.yearFrom)&&(r.yearTo===null||selection.year<=r.yearTo)))&&(r.airConditioning==='any'||r.airConditioning==='unknown'||!selection.ac||selection.ac==='unknown'||r.airConditioning===selection.ac));
 const complete=(r:FitmentRule)=>!(r.versionId&&!selection.versionId)&&!((r.yearFrom!==null||r.yearTo!==null)&&!selection.year)&&(r.airConditioning==='any'||(r.airConditioning!=='unknown'&&r.airConditioning===selection.ac));
 if(relevant.some(r=>complete(r)&&r.state==='incompatible'))return'incompatible';
 if(relevant.some(r=>r.state==='unknown'||!complete(r)))return'unknown';
 return relevant.some(r=>r.state==='compatible')?'compatible':'unknown';
}
