export interface ShopSession {id:string;csrfToken:string;email:string|null;expiresAt:string}
export interface CartInput {productId:string;skuId:string|null;quantity:number}
export interface CartLineView extends CartInput {id:string;name:string;article:string;variantLabel:string;image:string;url:string;unitPriceKopecks:number;lineTotalKopecks:number;available:number;kind:'ordinary'|'preorder';blocked:boolean;message?:string}
export interface CartView {version:number;lines:CartLineView[];productTotalKopecks:number;csrfToken:string}
export interface CustomerInput {name:string;phone:string;email:string}
export interface DeliveryInput {method:'pickup_point'|'courier';city:string;address:string}
export interface CheckoutInput {customer:CustomerInput;delivery:DeliveryInput;cartVersion:number}
export interface ShippingQuote {status:'quoted'|'pending_quote';costKopecks:number|null;label:string;reason:string|null;packageSnapshot:unknown}
export interface OrderLineSnapshot {productId:string;skuId:string|null;name:string;article:string;variantLabel:string;quantity:number;unitPriceKopecks:number;lineTotalKopecks:number;image:string;components:{skuId:string;article:string;name:string;quantity:number;unitPriceKopecks:number}[]}
export interface QuoteGroup {kind:'ordinary'|'preorder';lines:OrderLineSnapshot[];productTotalKopecks:number;shipping:ShippingQuote;totalKopecks:number|null}
export interface CheckoutQuote {id:string;cartVersion:number;expiresAt:string;customer:CustomerInput;delivery:DeliveryInput;groups:QuoteGroup[];csrfToken:string}
export interface OrderView {id:string;number:string;kind:'ordinary'|'preorder';status:string;paymentStatus:string;deliveryStatus:string;createdAt:string;expiresAt:string|null;customer:CustomerInput;delivery:DeliveryInput;lines:OrderLineSnapshot[];productTotalKopecks:number;shippingCostKopecks:number|null;totalKopecks:number|null;shippingReason:string|null;shippingVersion:number;terms:string|null;canPay:boolean;canCancel:boolean;reviewReason:string|null;events:{type:string;at:string;note:string}[]}
export interface CheckoutResult {orderIds:string[];orders:OrderView[]}
export interface ApiError {error:{code:string;message:string}}
