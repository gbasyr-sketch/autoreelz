import type {Rubles} from './money.ts';
export interface ShopSession {id:string;csrfToken:string;email:string|null;expiresAt:string}
export interface CartInput {productId:string;skuId:string|null;quantity:number}
export interface CartLineView extends CartInput {id:string;name:string;article:string;variantLabel:string;image:string;url:string;unitPriceRubles:Rubles;lineTotalRubles:Rubles;available:number;kind:'ordinary'|'preorder';blocked:boolean;message?:string}
export interface CartView {version:number;lines:CartLineView[];productTotalRubles:Rubles;csrfToken:string}
export interface CustomerInput {name:string;phone:string;email:string}
export interface DeliveryInput {method:'pickup_point'|'courier';city:string;address:string}
export interface CheckoutInput {customer:CustomerInput;delivery:DeliveryInput;cartVersion:number}
export interface ShippingQuote {status:'quoted'|'pending_quote';costRubles:Rubles|null;label:string;reason:string|null;packageSnapshot:unknown}
export interface OrderLineSnapshot {productId:string;skuId:string|null;name:string;article:string;variantLabel:string;quantity:number;unitPriceRubles:Rubles;lineTotalRubles:Rubles;image:string;components:{skuId:string;article:string;name:string;quantity:number;unitPriceRubles:Rubles}[]}
export interface QuoteGroup {kind:'ordinary'|'preorder';lines:OrderLineSnapshot[];productTotalRubles:Rubles;shipping:ShippingQuote;totalRubles:Rubles|null}
export interface CheckoutQuote {id:string;cartVersion:number;expiresAt:string;customer:CustomerInput;delivery:DeliveryInput;groups:QuoteGroup[];csrfToken:string}
export interface OrderView {id:string;number:string;kind:'ordinary'|'preorder';status:string;paymentStatus:string;deliveryStatus:string;createdAt:string;expiresAt:string|null;customer:CustomerInput;delivery:DeliveryInput;lines:OrderLineSnapshot[];productTotalRubles:Rubles;shippingCostRubles:Rubles|null;totalRubles:Rubles|null;shippingReason:string|null;shippingVersion:number;terms:string|null;canPay:boolean;canCancel:boolean;reviewReason:string|null;events:{type:string;at:string;note:string}[]}
export interface CheckoutResult {orderIds:string[];orders:OrderView[]}
export interface ApiError {error:{code:string;message:string}}
