import test from 'node:test';import assert from 'node:assert/strict';
import {resolutionPlan} from '../src/server/return-resolution-policy.ts';
import type {ReturnPhysicalLine,ReturnReceipt} from '../src/lib/return-intake.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const order={status:'manual_review',allocation_state:'settled',delivery_status:'shipped',shipping_version:2,product_total_rubles:'500.05',shipping_cost_rubles:'50.10',items_snapshot:[
 {name:'Деталь',skuId:a,quantity:2,unitPriceRubles:'100.01',components:[{skuId:a,quantity:1}]},
 {name:'Комплект',skuId:null,quantity:1,unitPriceRubles:'300.03',components:[{skuId:a,quantity:2},{skuId:b,quantity:1}]}]};
const payment={id:'payment',status:'succeeded',provider:'yookassa-sandbox',provider_status:'succeeded',provider_id:'provider-payment',provider_shop_id:'123456',currency:'RUB',shipping_version:2,amount_rubles:'550.15'};
const receipt={id:'receipt',inspection:{id:'inspection'}} as ReturnReceipt;
const physical=(skuId:string,receivedQuantity:number,restockedQuantity=receivedQuantity):ReturnPhysicalLine=>({skuId,name:'QA',article:'QA',sourceLabels:['QA'],orderedQuantity:skuId===a?4:1,returnableQuantity:skuId===a?4:1,receivedQuantity,remainingQuantity:0,restockedQuantity,heldQuantity:receivedQuantity-restockedQuantity});
const refund=(lines=[{lineIndex:0,quantity:1,unitPriceRubles:'100.01'}],amount='100.01',shipping='0.00',patch:Record<string,unknown>={})=>({id:'refund',payment_id:payment.id,provider_payment_id:payment.provider_id,shop_id:payment.provider_shop_id,state:'succeeded',provider_id:'confirmed-refund',checked_at:new Date(),payment_amount_rubles:payment.amount_rubles,amount_rubles:amount,selection_snapshot:{version:1,mode:'partial',opaque:false,lines,shippingRubles:shipping},...patch});
const blocked=(fn:()=>unknown)=>assert.throws(fn,{code:'RETURN_RESOLUTION_BLOCKED'});
test('partial resolution counts confirmed financial composition, not product names or physical saleability',()=>{
 const summary=resolutionPlan(order,[payment,{status:'failed'}],[refund()],[physical(a,1,0)],[receipt],[]);
 assert.deepEqual(summary,{kind:'partial',paymentAmountRubles:'550.15',refundedRubles:'100.01',remainingRubles:'450.14',receivedQuantity:1,restockedQuantity:0,heldQuantity:1});
});
test('cumulative bundle and standalone overlap expands physical SKU once, including later return batches',()=>{
 const lines=[{lineIndex:0,quantity:2,unitPriceRubles:'100.01'},{lineIndex:1,quantity:1,unitPriceRubles:'300.03'}];
 const summary=resolutionPlan(order,[payment],[refund(lines,'550.15','50.10')],[physical(a,4,2),physical(b,1,0)],[receipt],[]);
 assert.equal(summary.kind,'full');assert.equal(summary.remainingRubles,'0.00');assert.equal(summary.heldQuantity,3);
 blocked(()=>resolutionPlan(order,[payment],[refund(lines,'550.15','50.10')],[physical(a,3),physical(b,1)],[receipt],[]));
 blocked(()=>resolutionPlan(order,[payment],[refund()],[physical(a,1),physical(b,1)],[receipt],[]));
});
test('uninspected receipt, no receipt, unmatched inspection totals, and unsuitable order allocation block',()=>{
 for(const receipts of [[],[{...receipt,inspection:null}]])blocked(()=>resolutionPlan(order,[payment],[refund()],[physical(a,1)],receipts,[]));
 blocked(()=>resolutionPlan(order,[payment],[refund()],[{...physical(a,1),heldQuantity:1}],[receipt],[]));
 for(const patch of [{status:'paid'},{allocation_state:'supplier_paid'},{delivery_status:'packing'}])blocked(()=>resolutionPlan({...order,...patch},[payment],[refund()],[physical(a,1)],[receipt],[]));
});
test('pending or disputed payments, duplicate success and wrong provider or payment snapshot block',()=>{
 for(const extras of [[{status:'pending'}],[{status:'review'}],[payment]])blocked(()=>resolutionPlan(order,[payment,...extras],[refund()],[physical(a,1)],[receipt],[]));
 for(const patch of [{provider:'simulation'},{provider_status:'pending'},{provider_id:null},{currency:'USD'},{shipping_version:1},{amount_rubles:'550.14'}])blocked(()=>resolutionPlan(order,[{...payment,...patch}],[refund()],[physical(a,1)],[receipt],[]));
});
test('only confirmed succeeded refunds count; pending states, opaque allocations and missing identities block',()=>{
 for(const state of ['queued','pending','uncertain','attention'])blocked(()=>resolutionPlan(order,[payment],[refund(undefined,undefined,undefined,{state})],[physical(a,1)],[receipt],[]));
 for(const patch of [{provider_id:null},{checked_at:null},{payment_id:'foreign'},{provider_payment_id:'foreign'},{shop_id:'other'},{payment_amount_rubles:'550.14'},{selection_snapshot:null},{selection_snapshot:{version:1,opaque:true,mode:'full',lines:[],shippingRubles:'0.00'}}])blocked(()=>resolutionPlan(order,[payment],[refund(undefined,undefined,undefined,patch)],[physical(a,1)],[receipt],[]));
 assert.equal(resolutionPlan(order,[payment],[refund(),refund(undefined,undefined,undefined,{state:'canceled'})],[physical(a,1)],[receipt],[]).refundedRubles,'100.01');
});
test('selection must use original exact prices, bounded whole quantities, no repeated lines and exact amounts',()=>{
 const original={lineIndex:0,quantity:1,unitPriceRubles:'100.01'};
 for(const lines of [[{...original,quantity:3}],[{...original,quantity:0.5}],[{...original,lineIndex:9}],[{...original,unitPriceRubles:'99.00'}],[original,original]])blocked(()=>resolutionPlan(order,[payment],[refund(lines)],[physical(a,1)],[receipt],[]));
 blocked(()=>resolutionPlan(order,[payment],[refund(undefined,'100.00')],[physical(a,1)],[receipt],[]));
 blocked(()=>resolutionPlan(order,[payment],[refund(undefined,'101.01','1.00')],[physical(a,1)],[receipt],[]));
 const two=[refund(undefined,'150.11','50.10'),refund(undefined,'150.11','50.10',{id:'second'})];
 blocked(()=>resolutionPlan(order,[payment],two,[physical(a,2)],[receipt],[]));
});
test('carrier completion must be verified independently of manual delivery status',()=>{
 const shipment={state:'ready',provider_uuid:'shipment',carrier_code:'DELIVERED',carrier_at:new Date()};
 assert.equal(resolutionPlan(order,[payment],[refund()],[physical(a,1)],[receipt],[shipment]).kind,'partial');
 for(const patch of [{carrier_at:null},{provider_uuid:null},{carrier_code:'CREATED'},{state:'uncertain'}])blocked(()=>resolutionPlan({...order,delivery_status:'delivered'},[payment],[refund()],[physical(a,1)],[receipt],[{...shipment,...patch}]));
});
test('receipt registration is independently required only when enabled; failed fiscalization cannot be hidden',()=>{
 const p={...payment,receipt_snapshot:{},receipt_registration:'pending'};
 assert.equal(resolutionPlan(order,[p],[refund()],[physical(a,1)],[receipt],[],false).kind,'partial');
 blocked(()=>resolutionPlan(order,[p],[refund()],[physical(a,1)],[receipt],[],true));
 blocked(()=>resolutionPlan(order,[payment],[refund(undefined,undefined,undefined,{receipt_snapshot:{},receipt_registration:'canceled'})],[physical(a,1)],[receipt],[],true));
});
