import type {ShippingPackage} from './commerce-types.ts';
export type ShipmentMode='disabled'|'test'|'live';
export interface ShipmentInput {weightG:number;lengthMm:number;widthMm:number;heightMm:number;itemWeights:number[]}
export interface ShipmentSummary {
 id:string;state:string;environment:'test'|'live';number:string;trackingNumber:string|null;carrierCode:string|null;
 error:string|null;updatedAt:string;canCancel:boolean;canPrint:boolean;
 print:{id:string;state:string;error:string|null}|null;
 history:{kind:string;at:string;message:string}[];
}
export interface ShipmentWorkspace {
 mode:ShipmentMode;enabled:boolean;reason:string|null;orderId:string;package:ShippingPackage|null;
 shipments:ShipmentSummary[];
}
export interface ShipmentPreview {
 token:string;expiresAt:string;environment:'test'|'live';recipient:string;phone:string;destination:string;origin:string;
 tariff:number;parcel:ShipmentInput;items:{name:string;quantity:number;unitPrice:string;weightG:number}[];
 declaredValue:string;collectionAmount:string;
}
export const shipmentLabels:Record<string,string>={queued:'Ожидает отправки запроса',sending:'Запрос передаётся в СДЭК',uncertain:'Проверяем результат запроса',accepted:'СДЭК проверяет данные',ready:'Накладная создана',attention:'Требует внимания',rejected:'СДЭК отклонил данные',cancel_queued:'Ожидает отмены',cancelling:'Запрос на отмену отправлен',cancel_uncertain:'Проверяем отмену',cancelled:'Отправление отменено'};
export const cdekStatusLabels:Record<string,string>={CREATED:'Создано в СДЭК',ACCEPTED:'Проверка СДЭК',RECEIVED_AT_SHIPMENT_WAREHOUSE:'Принято на склад отправления',DELIVERED:'Вручено получателю',NOT_DELIVERED:'Не вручено — требуется решение',REMOVED:'Отменено в СДЭК',INVALID:'Ошибка данных',ACCEPTED_AT_PICK_UP_POINT:'Ожидает получателя в ПВЗ',TAKEN_BY_COURIER:'Передано курьеру',SENT_TO_RECIPIENT_CITY:'В пути к получателю'};
