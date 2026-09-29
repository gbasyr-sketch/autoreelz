import Decimal from 'decimal.js';
import {rubles,sumRubles,type Rubles} from './money.ts';
export type DashboardPeriod='today'|'7'|'30';
export type DashboardFilter='all'|'ordinary'|'preorder'|'packing'|'quote'|'confirm'|'review';
export interface DashboardOrder {id:string;number:string;kind:string;status:string;paymentStatus:string;deliveryStatus:string;createdAt:string;productTotalRubles:Rubles;shippingCostRubles:Rubles|null}
export interface DashboardStock {skuId:string;productId:string;article:string;name:string;productName:string;status:string;onHand:number;reserved:number;available:number}
export interface DashboardQuality {id:string;name:string;status:string;issues:string[]}
export interface DashboardData {
 generatedAt:string;period:DashboardPeriod;filter:DashboardFilter;from:string;testOnly:true;
 metrics:{productRubles:Rubles;shippingRubles:Rubles;paidOrders:number;averageRubles:Rubles;ordinary:number;preorder:number;inWork:number};
 series:{day:string;productRubles:Rubles;shippingRubles:Rubles;orders:number}[];
 tasks:{packing:number;quote:number;confirm:number;review:number;reviews:number};
 orders:DashboardOrder[];orderCount:number;stock:DashboardStock[];quality:DashboardQuality[];
 bundles:{id:string;name:string;available:number|null}[];
}
export function dashboardPeriod(value:string|null):DashboardPeriod {if(value===null)return'7';if(['today','7','30'].includes(value))return value as DashboardPeriod;throw new Error('Некорректный период.');}
export function dashboardFilter(value:string|null):DashboardFilter {if(value===null)return'all';if(['all','ordinary','preorder','packing','quote','confirm','review'].includes(value))return value as DashboardFilter;throw new Error('Некорректный фильтр.');}
export function dashboardWindow(period:DashboardPeriod,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(today+'T00:00:00+03:00'),days=period==='today'?1:Number(period),start=new Date(end.getTime()-(days-1)*86400000);
 return{from:start.toISOString(),until:now.toISOString(),days:Array.from({length:days},(_,i)=>new Date(start.getTime()+i*86400000+3*3600000).toISOString().slice(0,10))};
}
export interface PaidDay {day:string;kind:string;orders:string|number;products:string;shipping:string}
export function paymentSummary(rows:PaidDay[],days:string[]){
 const series=days.map(day=>{const group=rows.filter(r=>r.day===day);return{day,productRubles:sumRubles(group.map(r=>r.products)),shippingRubles:sumRubles(group.map(r=>r.shipping)),orders:group.reduce((n,r)=>n+Number(r.orders),0)};});
 const productRubles=sumRubles(series.map(s=>s.productRubles)),shippingRubles=sumRubles(series.map(s=>s.shippingRubles)),paidOrders=series.reduce((n,s)=>n+s.orders,0);
 const included=rows.filter(r=>days.includes(r.day));
 return{series,metrics:{productRubles,shippingRubles,paidOrders,averageRubles:paidOrders?rubles(new Decimal(productRubles).div(paidOrders).toFixed(2)):'0.00',ordinary:included.filter(r=>r.kind==='ordinary').reduce((n,r)=>n+Number(r.orders),0),preorder:included.filter(r=>r.kind==='preorder').reduce((n,r)=>n+Number(r.orders),0)}};
}
export const dashboardLabels:Record<DashboardFilter,string>={all:'Последние заказы',ordinary:'Заказы из наличия',preorder:'Предзаказы',packing:'Оплачены, ждут сборки',quote:'Нужно уточнить доставку',confirm:'Подтвердить предзаказ',review:'Проверить оплату'};
