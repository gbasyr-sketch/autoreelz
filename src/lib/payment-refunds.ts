export const refundLabels={queued:'Ожидает отправки',pending:'ЮKassa обрабатывает возврат',uncertain:'Результат запроса уточняется',succeeded:'Возврат подтверждён ЮKassa',canceled:'ЮKassa отменила возврат',attention:'Требуется ручная сверка'};
export interface RefundWorkspace {
 enabled:boolean;
 payments:{id:string;amountRubles:string;canRefund:boolean}[];
 refunds:{id:string;paymentId:string;amountRubles:string;state:keyof typeof refundLabels;reason:string;createdAt:string;providerId:string|null}[];
}
