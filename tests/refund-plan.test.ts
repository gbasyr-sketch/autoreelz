import test from 'node:test';
import assert from 'node:assert/strict';
import {refundBalance,planRefund,refundShipmentBlock} from '../src/server/refund-plan.ts';
import {buildPaymentReceipt} from '../src/server/yookassa-receipt-snapshot.ts';
const lines=[{name:'Деталь',variantLabel:'Чёрная',quantity:2,unitPriceRubles:'100.01',lineTotalRubles:'200.02'},
 {name:'Комплект',variantLabel:'',quantity:1,unitPriceRubles:'300.03',lineTotalRubles:'300.03'}];
const order={customer_email:'qa@example.invalid',items_snapshot:lines,product_total_rubles:'500.05',shipping_cost_rubles:'50.10'};
const payment={id:'qa',amount_rubles:'550.15'};
const partial={mode:'partial',lines:[{lineIndex:0,quantity:1}],shippingRubles:'0.00',amountRubles:'100.01'};
test('partial selection uses original unit prices, full remaining includes only unreturned quantities and shipping',()=>{
 const first=planRefund(order,payment,[],partial);assert.equal(first.amountRubles,'100.01');
 const history=[{payment_id:'qa',state:'succeeded',amount_rubles:first.amountRubles,selection_snapshot:first.selection}];
 const balance=refundBalance(order,payment,history);assert.equal(balance.remainingRubles,'450.14');assert.equal(balance.lines[0]!.remainingQuantity,1);
 const rest=planRefund(order,payment,history,{mode:'full',amountRubles:'450.14'});assert.equal(rest.selection.lines[0]!.quantity,1);assert.equal(rest.selection.shippingRubles,'50.10');
 assert.throws(()=>planRefund(order,payment,history,{...partial,lines:[{lineIndex:0,quantity:2}],amountRubles:'200.02'}));
});
test('rejects duplicate indices, non-integer/excess quantities, wrong client amounts and split shipping',()=>{
 for(const body of [{...partial,lines:[{lineIndex:0,quantity:1},{lineIndex:0,quantity:1}]},{...partial,lines:[{lineIndex:0,quantity:0.5}]},
  {...partial,lines:[{lineIndex:2,quantity:1}]},{...partial,amountRubles:'1.00'},{...partial,shippingRubles:'10.00',amountRubles:'110.01'},
  {...partial,amountRubles:100.01},{...partial,lines:[{lineIndex:0,quantity:3}]}])assert.throws(()=>planRefund(order,payment,[],body));
 const shippingOnly=planRefund(order,payment,[],{mode:'partial',lines:[],shippingRubles:'50.10',amountRubles:'50.10'});assert.equal(shippingOnly.selection.lines.length,0);
});
test('unknown/attention reserves balance, canceled releases it; legacy full record consumes its entire payment',()=>{
 const first=planRefund(order,payment,[],partial);
 for(const state of ['queued','pending','uncertain','attention']){
  const b=refundBalance(order,payment,[{payment_id:'qa',state,amount_rubles:'100.01',selection_snapshot:first.selection}]);
  assert.equal(b.reservedRubles,'100.01');assert.equal(b.canRefund,false);
 }
 const canceled=refundBalance(order,payment,[{payment_id:'qa',state:'canceled',amount_rubles:'100.01',selection_snapshot:first.selection}]);assert.equal(canceled.remainingRubles,'550.15');assert.equal(canceled.lines[0]!.remainingQuantity,2);
 const legacy=refundBalance(order,payment,[{payment_id:'qa',state:'succeeded',amount_rubles:'550.15',selection_snapshot:null}]);assert.equal(legacy.remainingRubles,'0.00');assert.equal(legacy.canRefund,false);assert.equal(legacy.partialAvailable,false);
});
test('refund receipt is the original fiscal subset, not a full payment receipt copied to partial request',()=>{
 const receipt=buildPaymentReceipt(order as any,'550.15'),p={...payment,receipt_snapshot:receipt};
 const selected=planRefund(order,p,[],{...partial,shippingRubles:'50.10',amountRubles:'150.11'});
 assert.deepEqual(selected.receipt!.items,[{...receipt.items[0],quantity:'1'},receipt.items[2]]);
 assert.equal(selected.receipt!.customer.email,'qa@example.invalid');assert.equal(receipt.items[0]!.quantity,'2');
 const corrupt=structuredClone(receipt);corrupt.items[0]!.amount.value='100.02';assert.throws(()=>planRefund(order,{...p,receipt_snapshot:corrupt},[],partial));
});
test('provider ruble minimum and residual: no sub-ruble partial or positive residual below one ruble',()=>{
 const small={...order,items_snapshot:[{...lines[0],quantity:1,unitPriceRubles:'0.50',lineTotalRubles:'0.50'},{...lines[1],unitPriceRubles:'2.00',lineTotalRubles:'2.00'}],product_total_rubles:'2.50',shipping_cost_rubles:'0.00'},p={id:'qa',amount_rubles:'2.50'};
 assert.throws(()=>planRefund(small,p,[],{...partial,amountRubles:'0.50'}));
 assert.throws(()=>planRefund(small,p,[],{...partial,lines:[{lineIndex:1,quantity:1}],amountRubles:'2.00'}));
 assert.equal(planRefund(small,p,[],{mode:'full',amountRubles:'2.50'}).amountRubles,'2.50');
});
test('only verified terminal carrier state unlocks refund, without changing or deleting shipment',()=>{
 for(const code of ['DELIVERED','POSTOMAT_RECEIVED'])assert.equal(refundShipmentBlock([{state:'ready',carrier_code:code,provider_uuid:'qa',carrier_at:'2026-10-15'}]),null);
 for(const s of [{state:'queued'},{state:'uncertain'},{state:'ready',carrier_code:'CREATED'},{state:'ready',carrier_code:'DELIVERED',provider_uuid:'qa'},
  {state:'rejected'},{state:'cancelled'}])assert.equal(Boolean(refundShipmentBlock([s])),!['rejected','cancelled'].includes(s.state));
 assert.ok(refundShipmentBlock([{state:'ready',carrier_code:'DELIVERED',provider_uuid:'qa',carrier_at:'2026-10-15'},{state:'queued'}]));
});
