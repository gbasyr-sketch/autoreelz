import type {PoolClient} from 'pg';
import {transaction} from './db.ts';
import {requireTestEnvironment} from './config.ts';
import {StoreError,iso} from './errors.ts';
import {dashboardWindow,dashboardPeriod,dashboardFilter,paymentSummary,type DashboardData,type DashboardFilter,type PaidDay} from '../lib/dashboard.ts';
import {rubles} from '../lib/money.ts';
// One row per order, based on accepted settlement time. Never sum payment attempts.
export const dashboardPaidSql=`WITH paid AS (
 SELECT o.id,o.kind,o.product_total_rubles,o.shipping_cost_rubles,min(e.created_at) paid_at
 FROM ar_orders o JOIN ar_payments p ON p.order_id=o.id
 JOIN ar_payment_events e ON e.payment_id=p.id AND e.outcome='paid'
 WHERE o.status='paid' AND o.payment_status='paid' AND p.status='succeeded'
 AND p.provider IN('simulation','yookassa-sandbox')
 GROUP BY o.id,o.kind,o.product_total_rubles,o.shipping_cost_rubles
) SELECT to_char(paid_at AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') AS "day",kind,count(*) orders,
 sum(product_total_rubles)::text products,coalesce(sum(shipping_cost_rubles),0)::text shipping
 FROM paid WHERE paid_at >= $1::timestamptz AND paid_at <= $2::timestamptz GROUP BY "day",kind ORDER BY "day"`;
const live=`(o.expires_at IS NULL OR o.expires_at>now() OR o.status IN('paid','manual_review'))`;
export const dashboardOrderFilters:Record<DashboardFilter,string>={all:'true',ordinary:"o.kind='ordinary'",preorder:"o.kind='preorder'",packing:`o.status='paid' AND o.payment_status='paid' AND o.delivery_status='quoted'`,quote:`o.status IN('open','preorder_pending','awaiting_payment') AND o.shipping_cost_rubles IS NULL AND ${live}`,confirm:`o.status='preorder_pending' AND ${live}`,review:"(o.status='manual_review' OR o.payment_status='review')"};
const filters=dashboardOrderFilters;
export async function readDashboard(c:PoolClient,period:ReturnType<typeof dashboardPeriod>,filter:DashboardFilter,now=new Date()):Promise<DashboardData>{
 const window=dashboardWindow(period,now);
 const payments=(await c.query<PaidDay>(dashboardPaidSql,[window.from,window.until])).rows;
 const totals=paymentSummary(payments,window.days);
 const q=(await c.query(`SELECT count(*) FILTER(WHERE ${filters.packing}) packing,count(*) FILTER(WHERE ${filters.quote}) quote,
 count(*) FILTER(WHERE ${filters.confirm}) confirm,count(*) FILTER(WHERE ${filters.review}) review,
 count(*) FILTER(WHERE o.status IN('open','preorder_pending','awaiting_payment','manual_review','paid') AND o.delivery_status<>'delivered' AND ${live}) in_work FROM ar_orders o`)).rows[0];
 const orderCount=Number((await c.query(`SELECT count(*) n FROM ar_orders o WHERE ${filters[filter]}`)).rows[0].n);
 const orders=(await c.query(`SELECT o.id,o.number,o.kind,o.status,o.payment_status,o.delivery_status,o.created_at,o.product_total_rubles,o.shipping_cost_rubles FROM ar_orders o WHERE ${filters[filter]} ORDER BY o.created_at DESC,o.id DESC LIMIT 50`)).rows.map(r=>({id:r.id,number:r.number,kind:r.kind,status:r.status,paymentStatus:r.payment_status,deliveryStatus:r.delivery_status,createdAt:iso(r.created_at)!,productTotalRubles:rubles(r.product_total_rubles),shippingCostRubles:r.shipping_cost_rubles===null?null:rubles(r.shipping_cost_rubles)}));
 const reviews=Number((await c.query("SELECT count(*) n FROM ar_reviews WHERE status='pending'")).rows[0].n);
 const stock=(await c.query(`SELECT s.id sku_id,s.product_id,s.article,s.name,p.name product_name,s.status,coalesce(st.on_hand,0) on_hand,coalesce(st.reserved,0) reserved FROM ar_skus s JOIN ar_products p ON p.id=s.product_id LEFT JOIN ar_stock st ON st.sku_id=s.id WHERE s.status<>'archived' AND p.status<>'archived' AND NOT p.is_demo ORDER BY (coalesce(st.on_hand,0)-coalesce(st.reserved,0)),s.article,s.id`)).rows.map(r=>({skuId:r.sku_id,productId:r.product_id,article:r.article,name:r.name,productName:r.product_name,status:r.status,onHand:r.on_hand,reserved:r.reserved,available:r.on_hand-r.reserved}));
 const quality=await readCatalogQuality(c);
 const bundles=(await c.query(`SELECT p.id,p.name,CASE WHEN count(b.id)=0 THEN NULL WHEN bool_or(s.id IS NULL OR s.status<>'published' OR component.status<>'published') THEN 0 ELSE min(floor(greatest(coalesce(st.on_hand-st.reserved,0),0)::numeric/b.quantity))::integer END available
 FROM ar_products p LEFT JOIN ar_bundle_components b ON b.bundle_id=p.id LEFT JOIN ar_skus s ON s.id=b.sku_id LEFT JOIN ar_products component ON component.id=s.product_id LEFT JOIN ar_stock st ON st.sku_id=s.id
 WHERE p.kind='bundle' AND p.status<>'archived' AND NOT p.is_demo GROUP BY p.id,p.name ORDER BY p.name,p.id`)).rows;
 return{generatedAt:now.toISOString(),period,filter,from:window.from,testOnly:true,metrics:{...totals.metrics,inWork:Number(q.in_work)},series:totals.series,tasks:{packing:Number(q.packing),quote:Number(q.quote),confirm:Number(q.confirm),review:Number(q.review),reviews},orders,orderCount,stock,quality,bundles};
}
export async function getDashboard(params:URLSearchParams){
 requireTestEnvironment();let period,filter;try{period=dashboardPeriod(params.get('period'));filter=dashboardFilter(params.get('filter'));}catch{throw new StoreError('DASHBOARD_FILTER','Выберите период и фильтр из списка.');}
 return transaction(c=>readDashboard(c,period,filter));
}

export async function managerCatalogReadiness(){return transaction(async c=>{
 const quality=await readCatalogQuality(c);
 const products=(await c.query("SELECT id,name,slug,status,kind,is_demo FROM ar_products WHERE status<>'archived' ORDER BY name,id")).rows;return{products,quality};});}

async function readCatalogQuality(c:PoolClient):Promise<DashboardData['quality']>{
 return(await c.query(`WITH checks AS (
 SELECT s.id,s.product_id,s.status,
 CASE WHEN s.media_mode='replace' THEN EXISTS(SELECT 1 FROM ar_sku_media m WHERE m.sku_id=s.id) ELSE EXISTS(SELECT 1 FROM ar_product_media m WHERE m.product_id=s.product_id) END photo,
 s.package_id IS NOT NULL package,
 EXISTS(SELECT 1 FROM ar_fitment f WHERE f.product_id=s.product_id AND f.state='compatible' AND ((s.fitment_mode='inherit' AND f.sku_id IS NULL) OR (s.fitment_mode='replace' AND f.sku_id=s.id))) fitment
 FROM ar_skus s WHERE s.status<>'archived'
 ) SELECT p.id,p.name,p.status,
 coalesce(length(btrim(p.description)),0)=0 missing_description,
 CASE WHEN p.kind='single' THEN NOT EXISTS(SELECT 1 FROM checks s WHERE s.product_id=p.id AND s.status='published') ELSE NOT EXISTS(SELECT 1 FROM ar_bundle_components b WHERE b.bundle_id=p.id) END missing_offer,
 CASE WHEN p.kind='single' THEN EXISTS(SELECT 1 FROM checks s WHERE s.product_id=p.id AND NOT s.photo) ELSE NOT EXISTS(SELECT 1 FROM ar_product_media m WHERE m.product_id=p.id) END missing_photo,
 CASE WHEN p.kind='single' THEN EXISTS(SELECT 1 FROM checks s WHERE s.product_id=p.id AND NOT s.package) ELSE EXISTS(SELECT 1 FROM ar_bundle_components b LEFT JOIN checks s ON s.id=b.sku_id WHERE b.bundle_id=p.id AND (s.id IS NULL OR NOT s.package)) END missing_package,
 CASE WHEN p.kind='single' THEN EXISTS(SELECT 1 FROM checks s WHERE s.product_id=p.id AND NOT s.fitment) ELSE EXISTS(SELECT 1 FROM ar_bundle_components b LEFT JOIN checks s ON s.id=b.sku_id WHERE b.bundle_id=p.id AND (s.id IS NULL OR NOT s.fitment)) END missing_fitment,p.kind
 FROM ar_products p WHERE NOT p.is_demo AND p.status<>'archived' ORDER BY p.name,p.id`)).rows.flatMap(r=>{const issues=[r.missing_photo&&'Нет фото',r.missing_package&&'Нет упаковки',r.missing_fitment&&'Совместимость не подтверждена',r.missing_description&&'Нет описания',r.missing_offer&&(r.kind==='bundle'?'Не задан состав':'Нет опубликованного исполнения')].filter(Boolean) as string[];return issues.length?[{id:r.id,name:r.name,status:r.status,issues}]:[];});
}
