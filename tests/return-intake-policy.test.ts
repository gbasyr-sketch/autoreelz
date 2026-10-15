import test from 'node:test';import assert from 'node:assert/strict';
import {physicalReturnBasis,receiveLines,inspectLines,returnEligibility,returnReference} from '../src/server/return-intake-policy.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const order={allocation_state:'settled',delivery_status:'shipped',items_snapshot:[
 {name:'Деталь',variantLabel:'Белая',skuId:a,quantity:1,components:[{skuId:a,name:'Белая',article:'A',quantity:1}]},
 {name:'Комплект',variantLabel:'',skuId:null,quantity:2,components:[{skuId:a,name:'Белая',article:'A',quantity:2},{skuId:b,name:'Чёрная',article:'B',quantity:1}]}]};
const components=[{sku_id:a,quantity:5},{sku_id:b,quantity:2}],issued=components;
test('physical SKU combines single line and bundle components; partial reception and held stock remain separate',()=>{
 const lines=physicalReturnBasis(order,components,issued,[{sku_id:a,quantity:'3'},{sku_id:b,quantity:'1'}],[{sku_id:a,restocked:'1',held:'1'}]);
 assert.equal(lines.length,2);assert.equal(lines[0]!.orderedQuantity,5);assert.equal(lines[0]!.remainingQuantity,2);assert.equal(lines[0]!.restockedQuantity,1);assert.equal(lines[0]!.heldQuantity,1);assert.deepEqual(lines[0]!.sourceLabels,['Деталь','Комплект']);assert.equal(lines[1]!.remainingQuantity,1);
});
test('cannot create capacity from unissued goods, changed snapshot, excess receipts or fabricated inspection totals',()=>{
 assert.equal(physicalReturnBasis(order,components,[],[],[])[0]!.remainingQuantity,0);
 assert.throws(()=>physicalReturnBasis(order,[{sku_id:a,quantity:6},components[1]!],issued,[],[]));
 assert.throws(()=>physicalReturnBasis(order,components,issued,[{sku_id:a,quantity:6}],[]));
 assert.throws(()=>physicalReturnBasis(order,components,issued,[{sku_id:a,quantity:1}],[{sku_id:a,restocked:1,held:1}]));
 assert.equal(physicalReturnBasis(order,components,[{sku_id:a,quantity:3},{sku_id:b,quantity:2}],[],[])[0]!.returnableQuantity,3);
});
test('receipt and inspection validate all quantities and prevent duplicate or foreign SKU decisions',()=>{
 assert.deepEqual(receiveLines([{skuId:a,quantity:2}]),[{skuId:a,quantity:2}]);
 for(const lines of [[],[{skuId:a,quantity:0}],[{skuId:a,quantity:1.5}],[{skuId:a,quantity:1},{skuId:a,quantity:1}]])assert.throws(()=>receiveLines(lines));
 const received=[{skuId:a,quantity:2},{skuId:b,quantity:1}];assert.deepEqual(inspectLines([{skuId:a,restockQuantity:1},{skuId:b,restockQuantity:0}],received),[{skuId:a,restockQuantity:1,heldQuantity:1},{skuId:b,restockQuantity:0,heldQuantity:1}]);
 for(const lines of [[],[{skuId:a,restockQuantity:3},{skuId:b,restockQuantity:0}],[{skuId:a,restockQuantity:1},{skuId:a,restockQuantity:0}],[{skuId:a,restockQuantity:-1},{skuId:b,restockQuantity:0}]])assert.throws(()=>inspectLines(lines,received));
});
test('only settled dispatched goods qualify; money review does not falsely require another payment',()=>{
 assert.equal(returnEligibility(order),null);assert.equal(returnEligibility({...order,status:'manual_review',payment_status:'review'}),null);
 for(const state of ['none','reserved','debited','released','supplier_pending','supplier_paid'])assert.ok(returnEligibility({...order,allocation_state:state}));
 assert.ok(returnEligibility({...order,delivery_status:'packing'}));assert.equal(returnEligibility({...order,delivery_status:'delivered'}),null);
});
test('parcel reference is explicit and whitespace normalized, never an implicit new random parcel',()=>{
 assert.equal(returnReference('  QA-1   part  '),'QA-1 part');for(const ref of ['',null,'AA','A\nB'])assert.throws(()=>returnReference(ref));
});
