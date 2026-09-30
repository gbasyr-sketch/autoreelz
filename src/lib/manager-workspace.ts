import type {Rubles} from './money.ts';
export const orderTasks=['all','packing','quote','confirm','review'] as const;
export const paymentStates=['all','unpaid','pending','paid','failed','review'] as const;
export const deliveryStates=['all','pending_quote','quoted','packing','shipped','delivered'] as const;
export const orderKinds=['all','ordinary','preorder'] as const;
export interface OrderListQuery {q:string;kind:typeof orderKinds[number];payment:typeof paymentStates[number];delivery:typeof deliveryStates[number];task:typeof orderTasks[number];from:string;to:string;page:number}
export interface OrderListRow {id:string;number:string;kind:string;status:string;paymentStatus:string;deliveryStatus:string;createdAt:string;customerName:string;productTotalRubles:Rubles;shippingCostRubles:Rubles|null;totalRubles:Rubles|null}
export interface OrderList {items:OrderListRow[];total:number;page:number;pages:number;pageSize:number;query:OrderListQuery}
export interface InventoryItem {skuId:string;productId:string;article:string;name:string;productName:string;status:string;productStatus:string;isDemo:boolean;onHand:number;reserved:number;available:number}
export interface StockHistory {items:{id:string;at:string;stockDelta:number;reservedDelta:number;reason:string;orderId:string|null;orderNumber:string|null;byManager:boolean}[];total:number;page:number;pages:number}
function choice<T extends readonly string[]>(raw:string|null,options:T):T[number]{const value=raw??options[0]!;if(!options.includes(value))throw Error('Выберите значение из списка.');return value;}
export function managerPage(raw:string|null){if(raw===null)return 1;if(!/^[1-9]\d{0,4}$/.test(raw))throw Error('Некорректная страница.');return Number(raw);}
export function calendarDate(raw:string|null){if(!raw)return'';if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number(raw.slice(0,4))<1900||Number(raw.slice(0,4))>2100)throw Error('Некорректная дата.');const date=new Date(raw+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==raw)throw Error('Некорректная дата.');return raw;}
export function orderListQuery(params:URLSearchParams):OrderListQuery {const q=(params.get('q')??'').trim();if(q.length>100||/[\u0000-\u001f]/.test(q))throw Error('Поиск: не более 100 символов.');const from=calendarDate(params.get('from')),to=calendarDate(params.get('to'));if(from&&to&&from>to)throw Error('Начало периода должно быть не позже окончания.');return{q,kind:choice(params.get('kind'),orderKinds),payment:choice(params.get('payment'),paymentStates),delivery:choice(params.get('delivery'),deliveryStates),task:choice(params.get('task'),orderTasks),from,to,page:managerPage(params.get('page'))};}
export function safeOrderReturn(raw:string|null){try{const url=new URL(raw??'/manager/orders','https://autoreelz.ru');if(url.origin!=='https://autoreelz.ru'||url.pathname!=='/manager/orders')return'/manager/orders';return url.pathname+url.search;}catch{return'/manager/orders';}}
export function escapeLike(value:string){return value.replace(/[\\%_]/g,'\\$&');}
export const paymentLabels:Record<string,string>={unpaid:'Не оплачен',pending:'Ожидается оплата',paid:'Оплачен · тест',failed:'Ошибка оплаты',review:'Проверка оплаты'};
export const deliveryLabels:Record<string,string>={pending_quote:'Уточнить доставку',quoted:'Доставка рассчитана',packing:'Сборка',shipped:'Отправлен',delivered:'Получен'};
export const taskLabels:Record<string,string>={all:'Все задачи',packing:'Ждут сборки',quote:'Уточнить доставку',confirm:'Подтвердить предзаказ',review:'Проверить оплату'};
