import assert from 'node:assert/strict';
import {getDashboard} from '../src/server/dashboard.ts';
import {getPool} from '../src/server/db.ts';
assert.match(process.env.AR_DATABASE_NAME||'',/^ar_qa_dashboard_/);
try{
 const d=await getDashboard(new URLSearchParams('period=7&filter=all'));
 assert.equal(d.metrics.productRubles,'3800.50');assert.equal(d.metrics.shippingRubles,'500.10');assert.equal(d.metrics.paidOrders,2);assert.equal(d.metrics.averageRubles,'1900.25');assert.equal(d.metrics.ordinary,1);assert.equal(d.metrics.preorder,1);
 assert.equal(d.metrics.inWork,3);assert.deepEqual(d.tasks,{packing:1,quote:1,confirm:1,review:1,reviews:1});
 assert.equal(d.stock.length,2);assert.equal(d.stock.find(s=>s.article==='QA-1').available,2);
 assert.ok(!d.quality.some(p=>p.name==='QA complete'||p.name==='QA archived'||p.name==='QA demo'));
 const incomplete=d.quality.find(p=>p.name==='QA incomplete');assert.deepEqual(incomplete.issues,['Нет фото','Нет упаковки','Совместимость не подтверждена','Нет описания']);
 assert.equal(d.bundles.find(b=>b.name==='QA bundle').available,1);assert.equal(d.bundles.find(b=>b.name==='QA empty bundle').available,null);
 const packing=await getDashboard(new URLSearchParams('period=30&filter=packing'));assert.equal(packing.orderCount,1);assert.equal(packing.orders[0].number,'QA-1');
 assert.ok(!JSON.stringify(d).includes('customer'));await assert.rejects(()=>getDashboard(new URLSearchParams('period=garbage')),e=>e.code==='DASHBOARD_FILTER');
 console.log(JSON.stringify({passed:true,checks:['accepted payment time instead of order creation','duplicate events and failed retries counted once','test provider only','cancelled/review excluded','exact rubles and kind breakdown','expired waiting orders excluded','stock subtracts reservations','inherit/replace quality rules','demo and archived excluded','bundle availability from components','task filtering and validated periods','no customer contacts in response']}));
}finally{await getPool().end();}
