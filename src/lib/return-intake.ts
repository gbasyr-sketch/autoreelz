export interface ReturnPhysicalLine {
 skuId:string;name:string;article:string;sourceLabels:string[];
 orderedQuantity:number;returnableQuantity:number;receivedQuantity:number;remainingQuantity:number;
 restockedQuantity:number;heldQuantity:number;
}
export interface ReturnReceiptLine {skuId:string;name:string;article:string;sourceLabels:string[];quantity:number}
export interface ReturnInspection {
 id:string;note:string;actorId:string;createdAt:string;
 lines:{skuId:string;restockQuantity:number;heldQuantity:number}[];
}
export interface ReturnReceipt {
 id:string;orderId:string;trackingNumber:string;note:string;actorId:string;createdAt:string;
 lines:ReturnReceiptLine[];inspection:ReturnInspection|null;
}
export interface ReturnIntakeWorkspace {
 enabled:boolean;canReceive:boolean;reason:string|null;orderId:string;
 lines:ReturnPhysicalLine[];receipts:ReturnReceipt[];
}
