import {validatePaymentReceipt,type PaymentReceipt,type ReceiptItem} from './yookassa-receipt-snapshot.ts';
import {planRefund,refundBalance,refundUnresolved} from './refund-plan.ts';
import {StoreError} from './errors.ts';
export type ClosingReceipt=Omit<PaymentReceipt,'items'>&{items:(Omit<ReceiptItem,'payment_mode'>&{payment_mode:'full_payment'})[];type:'payment';send:true;payment_id:string;settlements:[{type:'prepayment';amount:{value:string;currency:'RUB'}}]};
export function validateClosingReceipt(value:unknown,total:string):ClosingReceipt {
 const r=value as ClosingReceipt,receipt=validatePaymentReceipt(value,total,'full_payment');
 if(r.type!=='payment'||r.send!==true||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.payment_id)||!Array.isArray(r.settlements)||r.settlements.length!==1||r.settlements[0]?.type!=='prepayment'||r.settlements[0]?.amount?.currency!=='RUB'||r.settlements[0].amount.value!==total)throw new StoreError('CLOSING_RECEIPT_SNAPSHOT','Не удалось подготовить чек полного расчёта.',409);
 return{...receipt,items:receipt.items.map(i=>({...i,payment_mode:'full_payment'})),type:'payment',send:true,payment_id:r.payment_id,settlements:[{type:'prepayment',amount:{value:total,currency:'RUB'}}]};
}
export function buildClosingReceipt(order:Record<string,any>,payment:Record<string,any>,refunds:Record<string,any>[]){
 if(refunds.some(r=>refundUnresolved(r.state)))throw new StoreError('CLOSING_REFUND_PENDING','Сначала завершите сверку возврата оплаты.',409);
 const balance=refundBalance(order,payment,refunds);
 if(balance.remainingRubles==='0.00')return null;
 const plan=planRefund(order,payment,refunds,{mode:'full',amountRubles:balance.remainingRubles});
 if(!plan.receipt||!balance.partialAvailable)throw new StoreError('CLOSING_RECEIPT_SNAPSHOT','Исходный чек или состав возвратов требует ручной сверки.',409);
 return{amountRubles:balance.remainingRubles,receipt:validateClosingReceipt({...plan.receipt,items:plan.receipt.items.map(i=>({...i,payment_mode:'full_payment'})),payment_id:payment.provider_id,type:'payment',send:true,settlements:[{type:'prepayment',amount:{value:balance.remainingRubles,currency:'RUB'}}]},balance.remainingRubles)};
}
