import type {OrderLineSnapshot} from '../lib/commerce-types.ts';
import {rubles,sumRubles,multiplyRubles,compareRubles} from '../lib/money.ts';
import {StoreError} from './errors.ts';

export type ReceiptRegistration='pending'|'succeeded'|'canceled';
export interface ReceiptItem {
 description:string;quantity:string;amount:{value:string;currency:'RUB'};
 vat_code:1;payment_mode:'full_prepayment';payment_subject:'commodity'|'service';measure:'piece';
}
export interface PaymentReceipt {customer:{email:string};items:ReceiptItem[];internet:true;timezone:3}
const invalid=():never=>{throw new StoreError('RECEIPT_SNAPSHOT','Не удалось подготовить чек. Проверьте состав заказа и email.',409);};
function money(value:unknown){try{if(typeof value!=='string'||!/^\d+\.\d{2}$/.test(value))return invalid();return rubles(value);}catch{return invalid();}}
function description(value:string){
 const clean=value.replace(/\s+/gu,' ').trim();
 if(!clean||/[\u0000-\u001f\u007f]/u.test(clean))return invalid();
 return Array.from(clean).slice(0,128).join('');
}
export function validatePaymentReceipt(value:unknown,total:string):PaymentReceipt {
 const r=value as PaymentReceipt;
 if(!r||typeof r.customer?.email!=='string'||r.customer.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.customer.email)||r.internet!==true||r.timezone!==3||!Array.isArray(r.items)||!r.items.length||r.items.length>80)return invalid();
 const items=r.items.map(i=>{
  if(!i||typeof i.description!=='string'||description(i.description)!==i.description||typeof i.quantity!=='string'||!/^\d+$/.test(i.quantity)||!Number.isSafeInteger(Number(i.quantity))||Number(i.quantity)<=0||i.amount?.currency!=='RUB'||i.vat_code!==1||i.payment_mode!=='full_prepayment'||!['commodity','service'].includes(i.payment_subject)||i.measure!=='piece')return invalid();
  const amount=money(i.amount.value);if(compareRubles(amount,'0.00')<=0)return invalid();
  return{description:i.description,quantity:i.quantity,amount:{value:amount,currency:'RUB' as const},vat_code:1 as const,payment_mode:'full_prepayment' as const,payment_subject:i.payment_subject,measure:'piece' as const};
 });
 if(sumRubles(items.map(i=>multiplyRubles(i.amount.value,Number(i.quantity))))!==money(total))return invalid();
 // Rebuild the wire object: no caller-supplied arbitrary fiscal fields.
 return{customer:{email:r.customer.email},items,internet:true,timezone:3};
}
export function buildPaymentReceipt(order:{customer_email:string;items_snapshot:OrderLineSnapshot[];product_total_rubles:string;shipping_cost_rubles:string},total:string):PaymentReceipt {
 if(!Array.isArray(order.items_snapshot)||!order.items_snapshot.length)return invalid();
 const items:ReceiptItem[]=order.items_snapshot.map(line=>{
  if(!line||typeof line.name!=='string'||typeof line.variantLabel!=='string'||!Number.isSafeInteger(line.quantity)||line.quantity<=0)return invalid();
  const price=money(line.unitPriceRubles);
  if(multiplyRubles(price,line.quantity)!==money(line.lineTotalRubles))return invalid();
  return{description:description([line.name,line.variantLabel].filter(Boolean).join(' — ')),quantity:String(line.quantity),amount:{value:price,currency:'RUB'},vat_code:1,payment_mode:'full_prepayment',payment_subject:'commodity',measure:'piece'};
 });
 if(sumRubles(order.items_snapshot.map(l=>money(l.lineTotalRubles)))!==money(order.product_total_rubles))return invalid();
 const shipping=money(order.shipping_cost_rubles);
 if(compareRubles(shipping,'0.00')>0)items.push({description:'Доставка заказа',quantity:'1',amount:{value:shipping,currency:'RUB'},vat_code:1,payment_mode:'full_prepayment',payment_subject:'service',measure:'piece'});
 return validatePaymentReceipt({customer:{email:order.customer_email},items,internet:true,timezone:3},total);
}
