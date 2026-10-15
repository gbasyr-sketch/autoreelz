import type {OrderLineSnapshot} from '../lib/commerce-types.ts';
import type {ReturnPhysicalLine} from '../lib/return-intake.ts';
import {StoreError,uuid,integer,text} from './errors.ts';
export const returnEligibility=(order:Record<string,any>)=>order.allocation_state!=='settled'?'Товары этого заказа ещё не списаны со склада или уже возвращены прежней операцией.':!['shipped','delivered'].includes(order.delivery_status)?'Приёмка возврата доступна после отправки заказа.':null;
export function returnReference(value:unknown){return text(value,'Трек возврата или номер акта',3,100).replace(/\s+/gu,' ');}
export function receiveLines(raw:unknown){
 if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new StoreError('RETURN_LINES','Укажите фактически полученные SKU и количество.');
 const seen=new Set<string>();
 return raw.map(value=>{if(!value||typeof value!=='object')throw new StoreError('RETURN_LINES','Проверьте состав возврата.');const skuId=uuid(value.skuId);if(seen.has(skuId))throw new StoreError('RETURN_LINES','SKU повторяется.');seen.add(skuId);return{skuId,quantity:integer(value.quantity,'Получено, шт.',1,1000000)};}).sort((a,b)=>a.skuId.localeCompare(b.skuId));
}
export function inspectLines(raw:unknown,received:{skuId:string;quantity:number}[]){
 if(!Array.isArray(raw)||raw.length!==received.length)throw new StoreError('RETURN_LINES','Проверьте все полученные позиции.');
 const seen=new Set<string>();
 return raw.map(value=>{if(!value||typeof value!=='object')throw new StoreError('RETURN_LINES','Проверьте результат осмотра.');const skuId=uuid(value.skuId),line=received.find(l=>l.skuId===skuId);if(!line||seen.has(skuId))throw new StoreError('RETURN_LINES','Состав осмотра не совпадает с приёмкой.');seen.add(skuId);const restockQuantity=integer(value.restockQuantity,'Пригодно к продаже, шт.',0,line.quantity);return{skuId,restockQuantity,heldQuantity:line.quantity-restockQuantity};}).sort((a,b)=>a.skuId.localeCompare(b.skuId));
}
export function physicalReturnBasis(order:Record<string,any>,components:{sku_id:string;quantity:number}[],issued:{sku_id:string;quantity:number|string}[],receipts:{sku_id:string;quantity:number|string}[],inspected:{sku_id:string;restocked:number|string;held:number|string}[]):ReturnPhysicalLine[]{
 const fail=():never=>{throw new StoreError('RETURN_BASIS','Снимок состава или история склада требуют сверки. Приёмка пока недоступна.',409);};
 const rows=order.items_snapshot as OrderLineSnapshot[];if(!Array.isArray(rows)||!rows.length||rows.length>100)return fail();
 const map=new Map<string,{quantity:number;name:string;article:string;sources:Set<string>}>();
 for(const line of rows){
  if(!line||!Number.isSafeInteger(line.quantity)||line.quantity<1||typeof line.name!=='string'||!Array.isArray(line.components)||!line.components.length)return fail();
  for(const component of line.components){
   const skuId=uuid(component.skuId);if(!Number.isSafeInteger(component.quantity)||component.quantity<1||typeof component.name!=='string'||typeof component.article!=='string')return fail();
   const count=line.quantity*component.quantity,old=map.get(skuId),quantity=(old?.quantity??0)+count;if(!Number.isSafeInteger(quantity)||quantity>2147483647)return fail();
   const name=line.skuId===skuId?[line.name,line.variantLabel].filter(Boolean).join(' · '):old?.name??component.name;
   const sources=old?.sources??new Set<string>();sources.add(line.name);map.set(skuId,{quantity,name,article:component.article,sources});
  }
 }
 if(components.length!==map.size||components.some(c=>map.get(c.sku_id)?.quantity!==c.quantity))return fail();
 return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([skuId,line])=>{
  const issuedQty=Number(issued.find(i=>i.sku_id===skuId)?.quantity??0),received=Number(receipts.find(i=>i.sku_id===skuId)?.quantity??0),decision=inspected.find(i=>i.sku_id===skuId),restocked=Number(decision?.restocked??0),held=Number(decision?.held??0);
  if(![issuedQty,received,restocked,held].every(n=>Number.isSafeInteger(n)&&n>=0))return fail();
  const capacity=Math.min(line.quantity,issuedQty);if(received>capacity||restocked+held>received)return fail();
  return{skuId,name:line.name,article:line.article,sourceLabels:[...line.sources],orderedQuantity:line.quantity,returnableQuantity:capacity,receivedQuantity:received,remainingQuantity:capacity-received,restockedQuantity:restocked,heldQuantity:held};
 });
}
