import type{PoolClient}from'pg';
import type{CheckoutInput,ShippingQuote}from'../../lib/commerce-types.ts';
import{requireLocalTest}from'../config.ts';

// Test rates only; dimensions always come from an explicit package/rule.
export async function quoteLocalShipping(c:PoolClient,need:Map<string,number>,delivery:CheckoutInput['delivery'],fail=false):Promise<ShippingQuote>{
 requireLocalTest();
 const pending=(reason:string):ShippingQuote=>({status:'pending_quote',costRubles:null,label:'Стоимость уточнит менеджер',reason,packageSnapshot:null});
 try{
  if(fail)throw Error('Test provider outage');
  let pack;
  if(need.size===1){const[[skuId,qty]]=Array.from(need);if(qty===1)pack=(await c.query('SELECT p.* FROM ar_skus s JOIN ar_packages p ON p.id=s.package_id WHERE s.id=$1',[skuId])).rows[0];}
  if(!pack){const rules=(await c.query('SELECT r.components,p.* FROM ar_packing_rules r JOIN ar_packages p ON p.id=r.package_id WHERE r.active=true ORDER BY r.id')).rows;pack=rules.find(r=>{if(!r.components||typeof r.components!=='object')return false;const entries=Object.entries(r.components);return entries.length===need.size&&entries.every(([id,q])=>Number.isInteger(q)&&need.get(id)===q);});}
  if(!pack)return pending('Нет подтверждённого правила упаковки для этого состава.');
  if(![pack.weight_g,pack.length_mm,pack.width_mm,pack.height_mm].every(n=>Number(n)>0))return pending('Данные упаковки требуют уточнения.');
  return{status:'quoted',costRubles:delivery.method==='courier'?'800.00':'500.00',label:delivery.method==='courier'?'Тестовая доставка курьером':'Тестовая доставка до ПВЗ',reason:null,packageSnapshot:{id:pack.id,name:pack.name,weightG:pack.weight_g,lengthMm:pack.length_mm,widthMm:pack.width_mm,heightMm:pack.height_mm}};
 }catch{return pending('Расчёт доставки временно недоступен. Стоимость уточнит менеджер.');}
}
