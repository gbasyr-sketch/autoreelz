import{requireLocalTest}from'../config.ts';
import{canonical,sign}from'../security.ts';
export interface PaymentEvent {eventId:string;paymentId:string;amountKopecks:number;currency:string;status:'succeeded'|'failed'}
export const testPaymentAdapter={
 event(payment:{id:string;amountKopecks:number},status:'succeeded'|'failed'='succeeded'){
  requireLocalTest();const event:PaymentEvent={eventId:`test:${payment.id}:${status}`,paymentId:payment.id,amountKopecks:payment.amountKopecks,currency:'RUB',status};
  return{event,signature:sign(canonical(event))};
 },
};
