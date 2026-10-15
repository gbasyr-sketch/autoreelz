import Decimal from 'decimal.js';
import {rubles,sumRubles,multiplyRubles,compareRubles} from '../lib/money.ts';
import type {RefundSelection,RefundPayment} from '../lib/payment-refunds.ts';
import type {OrderLineSnapshot} from '../lib/commerce-types.ts';
import {StoreError,integer} from './errors.ts';
import {validatePaymentReceipt,type PaymentReceipt} from './yookassa-receipt-snapshot.ts';

type Row=Record<string,any>;
const subtract=(a:string,b:string)=>rubles(new Decimal(a).minus(b).toFixed(2));
const fail=(message:string):never=>{throw new StoreError('REFUND_AMOUNT',message,409);};
export const refundUnresolved=(state:string)=>['queued','pending','uncertain','attention'].includes(state);
function amount(value:unknown){
 if(typeof value!=='string'||!/^\d+\.\d{2}$/.test(value))return fail('Укажите точную сумму с двумя знаками после точки.');
 try{return rubles(value);}catch{return fail('Сумма возврата вне допустимого диапазона.');}
}
export function refundBalance(order:Row,payment:Row,history:Row[]):RefundPayment {
 const refunds=history.filter(r=>r.payment_id===payment.id),paid=rubles(payment.amount_rubles);
 const returned=sumRubles(refunds.filter(r=>r.state==='succeeded').map(r=>r.amount_rubles));
 const reserved=sumRubles(refunds.filter(r=>refundUnresolved(r.state)).map(r=>r.amount_rubles));
 const used=sumRubles([returned,reserved]);if(compareRubles(used,paid)>0)fail('История возвратов требует сверки.');
 const remaining=subtract(paid,used),consumed=refunds.filter(r=>r.state!=='canceled');
 const raw=order.items_snapshot as OrderLineSnapshot[];
 let valid=Array.isArray(raw)&&raw.length>0&&raw.length<=80;
 try{valid=valid&&raw.every(l=>Number.isSafeInteger(l.quantity)&&l.quantity>0&&typeof l.name==='string'&&typeof l.variantLabel==='string'&&multiplyRubles(l.unitPriceRubles,l.quantity)===rubles(l.lineTotalRubles))
  &&sumRubles(raw.map(l=>l.lineTotalRubles))===rubles(order.product_total_rubles)
  &&sumRubles([order.product_total_rubles,order.shipping_cost_rubles])===paid;}catch{valid=false;}
 if(consumed.some(r=>!r.selection_snapshot||r.selection_snapshot.opaque))valid=false;
 let shippingUsed='0.00';const quantities=new Map<number,number>();
 for(const r of consumed){
  if(!r.selection_snapshot)continue;
  shippingUsed=sumRubles([shippingUsed,r.selection_snapshot.shippingRubles]);
  for(const l of r.selection_snapshot.lines)quantities.set(l.lineIndex,(quantities.get(l.lineIndex)??0)+l.quantity);
 }
 const shipping=valid?subtract(rubles(order.shipping_cost_rubles),shippingUsed):'0.00';
 const lines=valid?raw.map((l,lineIndex)=>{
  const remainingQuantity=l.quantity-(quantities.get(lineIndex)??0);
  if(remainingQuantity<0)fail('Количество ранее возвращённых товаров требует сверки.');
  return{lineIndex,name:l.name,variantLabel:l.variantLabel,quantity:l.quantity,remainingQuantity,unitPriceRubles:rubles(l.unitPriceRubles)};
 }):[];
 return{id:payment.id,amountRubles:paid,refundedRubles:returned,reservedRubles:reserved,remainingRubles:remaining,
  shippingRemainingRubles:shipping,canRefund:compareRubles(remaining,'0.00')>0&&!refunds.some(r=>refundUnresolved(r.state)),
  partialAvailable:valid,blockReason:null,lines};
}
export function planRefund(order:Row,payment:Row,history:Row[],body:Row){
 const balance=refundBalance(order,payment,history),mode=body.mode??'full';
 if(!['full','partial'].includes(mode))fail('Выберите полный или частичный возврат.');
 let lines:RefundSelection['lines']=[],shipping='0.00';
 if(mode==='partial'){
  if(!balance.partialAvailable)fail('Состав этого платежа не подтверждён для частичного возврата.');
  if(!Array.isArray(body.lines)||body.lines.length>balance.lines.length)fail('Выберите товары для возврата.');
  const seen=new Set<number>();
  for(const entry of body.lines){
   if(!entry||typeof entry!=='object')fail('Проверьте возвращаемые позиции.');
   const index=integer(entry.lineIndex,'Позиция',0,balance.lines.length-1),line=balance.lines[index]!;
   if(seen.has(index))fail('Позиция повторяется.');seen.add(index);
   const quantity=integer(entry.quantity,'Количество',1,line.remainingQuantity);
   lines.push({lineIndex:index,quantity,unitPriceRubles:line.unitPriceRubles});
  }
  lines.sort((a,b)=>a.lineIndex-b.lineIndex);shipping=amount(body.shippingRubles??'0.00');
  if(shipping!=='0.00'&&shipping!==balance.shippingRemainingRubles)fail('Доставку можно вернуть отдельной услугой целиком или не включать в этот возврат.');
 }else if(balance.partialAvailable){
  lines=balance.lines.filter(l=>l.remainingQuantity>0).map(l=>({lineIndex:l.lineIndex,quantity:l.remainingQuantity,unitPriceRubles:l.unitPriceRubles}));
  shipping=balance.shippingRemainingRubles;
 }
 const calculated=mode==='full'?balance.remainingRubles:sumRubles([...lines.map(l=>multiplyRubles(l.unitPriceRubles,l.quantity)),shipping]);
 const requested=amount(body.amountRubles);
 if(requested!==calculated||compareRubles(calculated,'0.00')<=0||compareRubles(calculated,balance.remainingRubles)>0)fail('Сумма не совпадает с составом или доступным остатком. Обновите заказ.');
 const left=subtract(balance.remainingRubles,calculated);
 if(calculated!==balance.amountRubles&&(compareRubles(calculated,'1.00')<0||compareRubles(left,'0.00')>0&&compareRubles(left,'1.00')<0))fail('Для частичного возврата сумма и ненулевой остаток должны быть не меньше 1 ₽.');
 const selection:RefundSelection={version:1,mode,opaque:!balance.partialAvailable,lines,shippingRubles:shipping};
 let receipt:PaymentReceipt|null=null;
 if(payment.receipt_snapshot){
  const original=validatePaymentReceipt(payment.receipt_snapshot,balance.amountRubles);
  if(calculated===balance.amountRubles)receipt=original;
  else{
   if(!balance.partialAvailable||original.items.length!==balance.lines.length+(compareRubles(rubles(order.shipping_cost_rubles),'0.00')>0?1:0))fail('Исходный чек требует сверки перед частичным возвратом.');
   const items=lines.map(l=>{
    const item=original.items[l.lineIndex]!;
    if(item.amount.value!==l.unitPriceRubles||Number(item.quantity)!==balance.lines[l.lineIndex]!.quantity||item.payment_subject!=='commodity')fail('Позиции исходного чека не совпадают с оплатой.');
    return{...item,quantity:String(l.quantity)};
   });
   if(compareRubles(shipping,'0.00')>0){
    const item=original.items.at(-1)!;
    if(item.payment_subject!=='service'||item.quantity!=='1'||item.amount.value!==rubles(order.shipping_cost_rubles))fail('Доставка исходного чека требует сверки.');
    items.push({...item,quantity:'1',amount:{value:shipping,currency:'RUB'}});
   }
   receipt=validatePaymentReceipt({...original,items},calculated);
  }
 }
 return{amountRubles:calculated,paymentAmountRubles:balance.amountRubles,selection,receipt};
}

export function refundShipmentBlock(shipments:Row[]):string|null {
 const blocked=shipments.some(s=>!['rejected','cancelled'].includes(s.state)&&!(s.state==='ready'&&['DELIVERED','POSTOMAT_RECEIVED'].includes(s.carrier_code)&&s.provider_uuid&&s.carrier_at));
 return blocked?'Сначала отмените накладную до передачи или дождитесь подтверждённого СДЭК завершения доставки. Ручной статус заказа не заменяет подтверждение перевозчика.':null;
}
