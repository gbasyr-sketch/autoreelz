import Decimal from 'decimal.js';
import {rubles,sumRubles,multiplyRubles,compareRubles} from '../lib/money.ts';
import {StoreError} from './errors.ts';
import {refundShipmentBlock,refundUnresolved} from './refund-plan.ts';
import type {ReturnPhysicalLine,ReturnReceipt} from '../lib/return-intake.ts';
import type {ReturnResolutionSummary} from '../lib/return-resolution.ts';
type Row=Record<string,any>;
const fail=(message:string):never=>{throw new StoreError('RETURN_RESOLUTION_BLOCKED',message,409);};
/** Cumulative matching avoids allocating an overlapping bundle SKU twice between review batches. */
export function resolutionPlan(order:Row,payments:Row[],refunds:Row[],physical:ReturnPhysicalLine[],receipts:ReturnReceipt[],shipments:Row[],receiptsRequired=false):ReturnResolutionSummary {
 if(!['manual_review','return_closed'].includes(order.status)||order.allocation_state!=='settled'||!['shipped','delivered'].includes(order.delivery_status))fail('Закрыть можно разбор возвращённых товаров после отправки и списания заказа.');
 if(!receipts.length)fail('Сначала зарегистрируйте полученную посылку и проверьте товар.');
 if(receipts.some(r=>!r.inspection))fail('Не все полученные посылки осмотрены. Завершите проверку каждой посылки.');
 if(physical.some(l=>l.receivedQuantity!==l.restockedQuantity+l.heldQuantity))fail('Количество после осмотра требует сверки.');
 const carrier=refundShipmentBlock(shipments);if(carrier)fail(carrier);
 const successful=payments.filter(p=>p.status==='succeeded');
 if(successful.length!==1||payments.some(p=>!['succeeded','failed'].includes(p.status)))fail('Оплаты заказа требуют сверки: нужен один подтверждённый платёж без незавершённых или спорных оплат.');
 const payment=successful[0];
 if(!['yookassa-sandbox','yookassa-live'].includes(payment.provider)||payment.provider_status!=='succeeded'||!payment.provider_id||payment.currency!=='RUB'||payment.shipping_version!==order.shipping_version)fail('Исходная оплата не подтверждена или не совпадает с заказом.');
 if(refunds.some(r=>refundUnresolved(r.state)||!['succeeded','canceled'].includes(r.state)))fail('Дождитесь подтверждения всех возвратов денег. Неопределённые результаты требуют сверки.');
 const returned=refunds.filter(r=>r.state==='succeeded');if(!returned.length)fail('Нет подтверждённого возврата денег за полученные товары.');
 const raw=order.items_snapshot;
 if(!Array.isArray(raw)||!raw.length)fail('Состав заказа требует сверки.');
 const quantities=new Map<number,number>(),expected=new Map<string,number>();let shipping='0.00';
 try{
  if(sumRubles(raw.map((l:Row)=>multiplyRubles(l.unitPriceRubles,l.quantity)))!==rubles(order.product_total_rubles)||sumRubles([order.product_total_rubles,order.shipping_cost_rubles])!==rubles(payment.amount_rubles))fail('Сумма исходной оплаты не совпадает с заказом.');
  for(const refund of returned){
   if(refund.payment_id!==payment.id||refund.provider_payment_id!==payment.provider_id||refund.shop_id!==payment.provider_shop_id||!refund.provider_id||!refund.checked_at||refund.payment_amount_rubles!==payment.amount_rubles)fail('Подтверждение возврата денег требует сверки.');
   const selection=refund.selection_snapshot;
   if(!selection||selection.version!==1||selection.opaque||!Array.isArray(selection.lines)||!['full','partial'].includes(selection.mode))fail('У возврата денег нет подтверждённого состава. Требуется отдельная сверка.');
   const seen=new Set<number>(),amounts:string[]=[];
   for(const line of selection.lines){
    const item=raw[line.lineIndex];
    if(!Number.isSafeInteger(line.lineIndex)||!item||seen.has(line.lineIndex)||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.unitPriceRubles!==item.unitPriceRubles)fail('Позиции возврата денег требуют сверки.');
    seen.add(line.lineIndex);const count=(quantities.get(line.lineIndex)??0)+line.quantity;
    if(count>item.quantity)fail('Возвращено больше оплаченного количества.');quantities.set(line.lineIndex,count);
    amounts.push(multiplyRubles(line.unitPriceRubles,line.quantity));
    if(!Array.isArray(item.components)||!item.components.length)fail('Состав физических товаров требует сверки.');
    for(const component of item.components){const count=line.quantity*component.quantity;if(!Number.isSafeInteger(count)||count<1)fail('Состав физических товаров требует сверки.');expected.set(component.skuId,(expected.get(component.skuId)??0)+count);}
   }
   const service=rubles(selection.shippingRubles);if(service!=='0.00'&&service!==rubles(order.shipping_cost_rubles))fail('Возврат доставки требует сверки.');
   shipping=sumRubles([shipping,service]);if(sumRubles([...amounts,service])!==rubles(refund.amount_rubles))fail('Сумма возврата денег не совпадает с его составом.');
  }
  if(compareRubles(shipping,rubles(order.shipping_cost_rubles))>0)fail('Доставка возвращена повторно.');
  const received=new Map(physical.filter(l=>l.receivedQuantity>0).map(l=>[l.skuId,l.receivedQuantity]));
  if(received.size!==expected.size||[...expected].some(([id,count])=>received.get(id)!==count))fail('Состав успешных возвратов денег не совпадает с полученными товарами. Проверьте позиции и количество, включая составляющие комплектов.');
  if(receiptsRequired&&[payment,...returned].some(r=>r.receipt_snapshot&&r.receipt_registration!=='succeeded'))fail('Регистрация чеков ещё не подтверждена. Проверьте результат в ЮKassa.');
  const amount=rubles(payment.amount_rubles),refunded=sumRubles(returned.map(r=>r.amount_rubles));
  if(compareRubles(refunded,amount)>0)fail('Сумма возвратов больше исходной оплаты.');
  return{kind:refunded===amount?'full':'partial',paymentAmountRubles:amount,refundedRubles:refunded,remainingRubles:rubles(new Decimal(amount).minus(refunded).toFixed(2)),receivedQuantity:physical.reduce((n,l)=>n+l.receivedQuantity,0),restockedQuantity:physical.reduce((n,l)=>n+l.restockedQuantity,0),heldQuantity:physical.reduce((n,l)=>n+l.heldQuantity,0)};
 }catch(e){if(e instanceof StoreError&&e.code==='RETURN_RESOLUTION_BLOCKED')throw e;return fail('Данные товаров и оплаты требуют сверки перед закрытием.');}
}
