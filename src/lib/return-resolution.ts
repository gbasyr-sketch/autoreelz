export interface ReturnResolutionSummary {
 kind:'full'|'partial';paymentAmountRubles:string;refundedRubles:string;remainingRubles:string;
 receivedQuantity:number;restockedQuantity:number;heldQuantity:number;
}
export interface ReturnResolutionRecord {id:string;note:string;actorId:string;createdAt:string;summary:ReturnResolutionSummary}
export interface ReturnResolutionWorkspace {
 orderId:string;enabled:boolean;canClose:boolean;reason:string|null;revision:string;
 summary:ReturnResolutionSummary|null;history:ReturnResolutionRecord[];
}
