export const refundLabels={queued:'Ожидает отправки',pending:'ЮKassa обрабатывает возврат',uncertain:'Результат запроса уточняется',succeeded:'Возврат подтверждён ЮKassa',canceled:'ЮKassa отменила возврат',attention:'Требуется ручная сверка'};
export interface RefundSelection {
 version:1;mode:'full'|'partial';opaque:boolean;
 lines:{lineIndex:number;quantity:number;unitPriceRubles:string}[];
 shippingRubles:string;
}
export interface RefundPayment {
 id:string;amountRubles:string;refundedRubles:string;reservedRubles:string;remainingRubles:string;
 shippingRemainingRubles:string;canRefund:boolean;partialAvailable:boolean;blockReason:string|null;
 lines:{lineIndex:number;name:string;variantLabel:string;quantity:number;remainingQuantity:number;unitPriceRubles:string}[];
}
export interface RefundWorkspace {
 enabled:boolean;
 payments:RefundPayment[];
 refunds:{id:string;paymentId:string;amountRubles:string;state:keyof typeof refundLabels;reason:string;createdAt:string;providerId:string|null;selection:RefundSelection|null}[];
}
