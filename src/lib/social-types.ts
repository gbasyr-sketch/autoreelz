export interface FavoritesView {authenticated:boolean;productIds:string[]}
export interface ReviewView {
 id:string;productId:string;productName:string;authorName:string;body:string;
 status:'pending'|'approved'|'rejected';moderationNote?:string;createdAt:string;
 media:{id:string;url:string;width:number;height:number}[];
}
export interface ReviewsView {reviews:ReviewView[];canReview:boolean;eligibleOrders:{id:string;number:string}[]}
