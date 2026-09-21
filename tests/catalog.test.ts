import test from 'node:test';
import assert from 'node:assert/strict';
import { queryCatalog } from '../src/lib/catalog.ts';
import { products,offerFor } from '../src/lib/demo.ts';

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
 assert.equal(result.items[0]?.offer.priceKopecks,530000);
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
 assert.deepEqual(offerFor(kit),{priceKopecks:1577000,available:4});
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
