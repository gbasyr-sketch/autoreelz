import type {OrderView} from './commerce-types.ts';
export interface OrderNote {id:string;body:string;actorId:string;createdAt:string}
export interface DeliveryEvent {id:string;status:string;source:'carrier'|'manager';occurredAt:string;createdAt:string;applied:boolean;reason:string}
export interface ManagerOrderView extends OrderView {notes:OrderNote[];deliveryEvents:DeliveryEvent[]}
export interface OwnerNotification {id:string;orderId:string;channel:'max'|'email';subject:string;body:string;status:'pending'|'delivered'|'failed';attempts:number;lastError:string|null;createdAt:string;deliveredAt:string|null}
export interface GenerationProduct {id:string;name:string;isDemo:boolean;description:string;metaDescription:string;seoTitle:string}
export interface DescriptionDraft {id:string;productId:string;description:string;metaDescription:string;state:'preview'|'applied';createdAt:string;sourceFingerprint:string}
