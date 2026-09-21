import{requireLocalTest}from'../config.ts';
import{canonical,sign}from'../security.ts';
export interface PaymentEvent {eventId:string;paymentId:string;amountRubles:string;currency:string;status:'succeeded'|'failed'}
export const testPaymentAdapter={
 event(payment:{id:string;amountRubles:string},status:'succeeded'|'failed'='succeeded'){
  requireLocalTest();const event:PaymentEvent={eventId:`test:rubles-v1:${payment.id}:${status}`,paymentId:payment.id,amountRubles:payment.amountRubles,currency:'RUB',status};
  return{event,signature:sign(canonical(event))};
 },
};
