import test from 'node:test';
import assert from 'node:assert/strict';
import { queryCatalog as runQuery } from '../src/lib/catalog.ts';
import { products as demoProducts,categories as demoCategories,vehicles as demoVehicles,attributeDefinitions as demoAttributes } from '../src/lib/demo.ts';
import {createCatalogSnapshot,evaluateFitment,type CatalogSnapshot,type FitmentRule} from '../src/lib/catalog-types.ts';
const fixture=():CatalogSnapshot=>createCatalogSnapshot({
 products:demoProducts.map(p=>({...p,categorySlugs:[p.category],components:p.components?.map(c=>({...c})),discountBps:p.discountBps??0,isDemo:true,media:[],attributes:{},fitment:[],variants:p.variants.map(v=>({...v,image:p.image,media:[],fitment:[],attributes:{...v.attributes}}))})),
 categories:demoCategories.map(c=>({...c,parentId:null,depth:0,ancestorSlugs:[],attributes:[...c.attributes]})),
 vehicles:demoVehicles.map(v=>({...v,yearFrom:null,yearTo:null,versions:[]})),
 attributeDefinitions:Object.fromEntries(Object.entries(demoAttributes).map(([key,d])=>[key,{...d,id:key,type:'select',unit:null,filterable:true}])),
});
const catalog=fixture();const{products,offerFor}=catalog;
const queryCatalog=(params:URLSearchParams)=>runQuery(params,catalog);

test('price and color must match the same SKU, not different variants',()=>{
 const result=queryCatalog(new URLSearchParams('category=heaters&illumination=blue&max=5000'));
 assert.equal(result.items.length,0);
 const match=queryCatalog(new URLSearchParams('category=heaters&illumination=blue&max=5200'));
 assert.equal(match.items.length,1);assert.equal(match.items[0]?.offer.variant?.article,'DEMO-HEATER-B');
});
test('stock and color cannot be satisfied by separate variants',()=>{
 assert.equal(queryCatalog(new URLSearchParams('category=heaters&illumination=white&availability=in-stock')).items.length,0);
 assert.equal(queryCatalog(new URLSearchParams('category=heaters&illumination=white&availability=preorder')).items.length,1);
});
test('article search selects the requested SKU and respects its own stock',()=>{
 const result=queryCatalog(new URLSearchParams('q=DEMO-HEATER-W'));
 assert.equal(result.items.length,1);
 assert.equal(result.items[0]?.offer.variant?.article,'DEMO-HEATER-W');
 assert.equal(result.items[0]?.offer.priceRubles,'5300.00');
 assert.equal(result.items[0]?.offer.available,0);
 assert.equal(queryCatalog(new URLSearchParams('q=DEMO-HEATER-W&availability=in-stock')).items.length,0);
 assert.equal(queryCatalog(new URLSearchParams('q=DEMO-HEATER-B&max=5000')).items.length,0);
});
test('foreign or unknown variant cannot fall back to a default offer',()=>{
 const product=products.find(p=>p.slug==='heater-control')!;
 assert.equal(offerFor(product,'unknown'),null);
 assert.equal(offerFor(product,products.find(p=>p.slug==='gear-knob')!.variants[0]!.id),null);
});
test('a bundle derives price and availability from the fixed components',()=>{
 const kit=products.find(p=>p.slug==='interior-kit')!;
 assert.deepEqual(offerFor(kit),{priceRubles:'15770.00',available:4});
 assert.equal(offerFor(products.find(p=>p.slug==='multimedia-kit')!)?.available,0);
 assert.equal(offerFor(kit,'any-variant'),null);
});
test('missing compatibility never becomes an implicit fitment match',()=>{
 const result=queryCatalog(new URLSearchParams('vehicle=priora-2&year=2015&ac=yes'));
 assert.equal(result.unknownFitment,true);assert.equal(result.items.length,0);
 assert.equal(queryCatalog(new URLSearchParams('vehicle=priora-2&include_unknown=1')).items.length,products.length);
});
test('invalid price or vehicle inputs return a visible error',()=>{
 for(const q of ['min=9000&max=100','min=-1','max=wat','vehicle=not-a-car','year=2015','vehicle=priora-2&year=3000']){
  const result=queryCatalog(new URLSearchParams(q));assert.ok(result.error,q);assert.equal(result.items.length,0);
 }
});

const vehicleId=catalog.vehicles[3]!.id;
const rule=(changes:Partial<FitmentRule>={}):FitmentRule=>({vehicleId,versionId:null,yearFrom:2010,yearTo:2020,airConditioning:'any',state:'compatible',note:null,...changes});
test('fitment needs complete conditions and never promotes conflicts or unknown data',()=>{
 assert.equal(evaluateFitment([rule()],{vehicleId,year:2015,ac:'yes'}),'compatible');
 assert.equal(evaluateFitment([rule()],{vehicleId}),'unknown');
 assert.equal(evaluateFitment([rule({airConditioning:'yes'})],{vehicleId,year:2015,ac:'unknown'}),'unknown');
 assert.equal(evaluateFitment([rule(),rule({state:'incompatible'})],{vehicleId,year:2015,ac:'yes'}),'incompatible');
 assert.equal(evaluateFitment([rule(),rule({state:'unknown'})],{vehicleId,year:2015,ac:'yes'}),'unknown');
 assert.equal(evaluateFitment([rule({versionId:'v1'})],{vehicleId,year:2015,ac:'yes'}),'unknown');
});
test('bundle fitment is the conjunction of the exact component SKU rules',()=>{
 const c=fixture(),kit=c.products.find(p=>p.slug==='interior-kit')!,offer=c.offerFor(kit)!;
 for(const component of kit.components!)c.findSku(component.skuId)!.variant.fitment=[rule()];
 assert.equal(c.fitmentFor(kit,offer,{vehicleId,year:2015}),'compatible');
 c.findSku(kit.components![0]!.skuId)!.variant.fitment=[];
 assert.equal(c.fitmentFor(kit,offer,{vehicleId,year:2015}),'unknown');
 c.findSku(kit.components![0]!.skuId)!.variant.fitment=[rule({state:'incompatible'})];
 assert.equal(c.fitmentFor(kit,offer,{vehicleId,year:2015}),'incompatible');
});
test('confirmed and unknown fitment can coexist, incompatible never included',()=>{
 const c=fixture(),p=c.products[0]!;p.variants.forEach(v=>v.fitment=[rule()]);
 const result=runQuery(new URLSearchParams('vehicle=priora-2&year=2015'),c);
 assert.equal(result.items.length,1);assert.equal(result.unknownFitment,true);assert.equal(result.items[0]?.fitment,'compatible');
 p.variants.forEach(v=>v.fitment=[rule({state:'incompatible'})]);
 assert.ok(!runQuery(new URLSearchParams('vehicle=priora-2&year=2015&include_unknown=1'),c).items.some(i=>i.product.id===p.id));
});
test('CMS can add text, number and boolean filters without a code whitelist',()=>{
 const c=fixture();const p=c.products[0]!;
 for(const[key,type]of [['revision','text'],['width','number'],['heated','boolean']] as const){c.attributeDefinitions[key]={id:key,label:key,type,unit:null,filterable:true,values:[]};c.categories[0]!.attributes.push(key);}
 p.variants[0]!.attributes={...p.variants[0]!.attributes,revision:'custom',width:'12.00',heated:'false'};
 assert.equal(runQuery(new URLSearchParams('category=heaters&attr.revision=custom&attr.width=12&attr.heated=false'),c).items.length,1);
 assert.equal(runQuery(new URLSearchParams('category=heaters&attr.heated=true'),c).items.length,0);
 assert.ok(runQuery(new URLSearchParams('category=heaters&attr.width=no'),c).error);
});
test('parent category includes descendants and published secondary categories',()=>{
 const c=fixture();const child=c.categories[0]!;child.parentId=c.categories[1]!.id;child.ancestorSlugs=[c.categories[1]!.slug];child.depth=1;
 assert.ok(runQuery(new URLSearchParams('category=consoles'),c).items.some(i=>i.product.id===c.products[0]!.id));
 c.products[0]!.categorySlugs.push('knobs');
 assert.ok(runQuery(new URLSearchParams('category=knobs'),c).items.some(i=>i.product.id===c.products[0]!.id));
});
test('bundle with a missing unpublished component has no offer',()=>{
 const c=fixture(),kit=c.products.find(p=>p.slug==='interior-kit')!;
 kit.components!.push({skuId:'unpublished-sku',quantity:1});assert.equal(c.offerFor(kit),null);
});

test('ruble fractions filter one exact SKU without float rounding',()=>{
 const c=fixture(),p=c.products[0]!;p.variants[0]!.priceRubles='4900.05';p.variants[1]!.priceRubles='4900.10';
 const result=runQuery(new URLSearchParams('category=heaters&min=4900,05&max=4900.09'),c);
 assert.equal(result.items.length,1);assert.equal(result.items[0]!.offer.priceRubles,'4900.05');
 assert.equal(runQuery(new URLSearchParams('q=DEMO-HEATER-B&max=4900.09'),c).items.length,0);
 assert.equal(runQuery(new URLSearchParams('q=DEMO-HEATER-B&min=4900.10&max=4900.10'),c).items[0]!.offer.priceRubles,'4900.10');
 assert.ok(runQuery(new URLSearchParams('min=1.001'),c).error);
});
test('bundle sums decimal rubles and rounds discount once to two decimals',()=>{
 const c=fixture(),kit=c.products.find(p=>p.slug==='interior-kit')!;
 kit.components=kit.components!.slice(0,2);kit.discountBps=0;
 c.findSku(kit.components[0]!.skuId)!.variant.priceRubles='0.10';
 c.findSku(kit.components[1]!.skuId)!.variant.priceRubles='0.20';
 assert.equal(c.offerFor(kit)?.priceRubles,'0.30');
 kit.discountBps=5000;c.findSku(kit.components[1]!.skuId)!.variant.priceRubles='0.05';
 assert.equal(c.offerFor(kit)?.priceRubles,'0.08');
});
test('sorting preserves a one-hundredth ruble difference near the maximum',()=>{
 const c=fixture();c.products=c.products.filter(p=>p.kind==='single').slice(0,2);
 c.products[0]!.variants=c.products[0]!.variants.slice(0,1);c.products[1]!.variants=c.products[1]!.variants.slice(0,1);
 c.products[0]!.variants[0]!.priceRubles='90071992547409.91';c.products[1]!.variants[0]!.priceRubles='90071992547409.90';
 assert.deepEqual(runQuery(new URLSearchParams('sort=price-asc'),c).items.map(i=>i.offer.priceRubles),['90071992547409.90','90071992547409.91']);
 assert.deepEqual(runQuery(new URLSearchParams('sort=price-desc'),c).items.map(i=>i.offer.priceRubles),['90071992547409.91','90071992547409.90']);
});
test('bundle amounts outside the permitted ruble range do not produce an offer',()=>{
 const c=fixture(),kit=c.products.find(p=>p.slug==='interior-kit')!;kit.discountBps=0;
 c.findSku(kit.components![0]!.skuId)!.variant.priceRubles='90071992547409.91';
 assert.equal(c.offerFor(kit),null);
});
