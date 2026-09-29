import test from 'node:test';import assert from 'node:assert/strict';
import {dashboardPeriod,dashboardFilter,dashboardWindow,paymentSummary} from '../src/lib/dashboard.ts';
test('dashboard periods use Moscow calendar boundaries, including month/year changes',()=>{
 const w=dashboardWindow('7',new Date('2026-12-31T21:05:00Z'));assert.equal(w.from,'2026-12-25T21:00:00.000Z');assert.equal(w.days.length,7);assert.equal(w.days.at(-1),'2027-01-01');
 assert.equal(dashboardWindow('today',new Date('2026-09-29T20:59:59Z')).from,'2026-09-28T21:00:00.000Z');assert.equal(dashboardWindow('today',new Date('2026-09-29T21:00:00Z')).from,'2026-09-29T21:00:00.000Z');
});
test('money metrics keep decimal accuracy, exclude out-of-window rows and fill empty days',()=>{
 const value=paymentSummary([{day:'2026-09-29',kind:'ordinary',orders:2,products:'0.30',shipping:'0.10'},{day:'2026-09-29',kind:'preorder',orders:1,products:'1000.01',shipping:'200.20'},{day:'2026-09-20',kind:'ordinary',orders:1,products:'999999.99',shipping:'0.00'}],['2026-09-28','2026-09-29']);
 assert.deepEqual(value.metrics,{productRubles:'1000.31',shippingRubles:'200.30',paidOrders:3,averageRubles:'333.44',ordinary:2,preorder:1});assert.equal(value.series[0]!.productRubles,'0.00');assert.equal(paymentSummary([],['2026-09-29']).metrics.averageRubles,'0.00');
});
test('only bounded predefined period and filter values are accepted',()=>{for(const bad of ['-1','0','999999','30; DROP TABLE ar_orders','all'])assert.throws(()=>dashboardPeriod(bad));for(const bad of ['paid OR true','unknown',''])assert.throws(()=>dashboardFilter(bad));assert.equal(dashboardPeriod(null),'7');assert.equal(dashboardFilter(null),'all');});
