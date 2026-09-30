import{managerOrders,managerOrder,addNote,adjustStock,cancelByManager,fulfill,overrideDelivery,simulateCarrier}from'../../../server/management';
import{ownerNotifications,retryNotification}from'../../../server/notifications';
import{generationProducts,generateDescription,applyDescription}from'../../../server/description-generation';
import type{APIRoute}from'astro';
import{sessionFor,json,failure,peer}from'../../../server/http';
import{staff,readBody}from'../../../server/security';
import{staffLogin,staffLogout}from'../../../server/auth';
import{stockList,quoteShipping,confirmPreorder,receiveStock}from'../../../server/orders';
import{query}from'../../../server/db';
import{iso}from'../../../server/errors';
import{requireTestEnvironment}from'../../../server/config';
import{getDashboard,managerCatalogReadiness}from'../../../server/dashboard';
import{listManagerOrders,managerInventory,managerStockHistory}from'../../../server/manager-workspace';
import{uuid}from'../../../server/errors';
export const GET:APIRoute=async ctx=>{try{
 await staff(ctx.request);
 switch(ctx.params.action){
  case'access':return json({ok:true});
  case'order-list':return json(await listManagerOrders(ctx.url.searchParams));
  case'order':return json(await managerOrder(uuid(ctx.url.searchParams.get('id'))));
  case'inventory':return json(await managerInventory());
  case'stock-history':return json(await managerStockHistory(ctx.url.searchParams));
  case'catalog-readiness':return json(await managerCatalogReadiness());
  case'dashboard':return json(await getDashboard(ctx.url.searchParams));
  case'orders':return json({orders:await managerOrders(ctx.url.searchParams.get('id'))});
  case'notifications':return json({notifications:await ownerNotifications()});
  case'products':return json({products:await generationProducts()});
  case'stock':return json(await stockList());
  case'mail':requireTestEnvironment();return json({messages:(await query("SELECT id,recipient,subject,body,created_at FROM ar_mail_outbox WHERE status='delivered' ORDER BY created_at DESC LIMIT 100")).rows.map(r=>({id:r.id,to:r.recipient,subject:r.subject,body:r.body,createdAt:iso(r.created_at)}))});
  default:return json({error:{code:'NOT_FOUND',message:'Раздел не найден.'}},404);
 }
}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{
 const session=await sessionFor(ctx),body=await readBody(ctx.request,session,ctx.params.action==='apply-description'?49152:16384);
 if(ctx.params.action==='logout'){const{cookie}=await staffLogout(ctx.request);return json({ok:true},200,{'Set-Cookie':cookie});}
 requireTestEnvironment();
 if(ctx.params.action==='login'){const{cookie}=await staffLogin(session,body.email,body.password,peer(ctx));return json({ok:true},200,{'Set-Cookie':cookie});}
 const actor=await staff(ctx.request);
 switch(ctx.params.action){
  case'shipping':return json(await quoteShipping(actor,body));
  case'confirm':return json(await confirmPreorder(actor,body));
  case'stock':return json(await receiveStock(actor,body));
  case'note':return json(await addNote(actor,body));
  case'stock-adjust':return json(await adjustStock(actor,body));
  case'order-cancel':return json(await cancelByManager(actor,body));
  case'fulfillment':return json(await fulfill(actor,body));
  case'delivery-override':return json(await overrideDelivery(actor,body));
  case'carrier-test':return json(await simulateCarrier(actor,body));
  case'notification-retry':return json(await retryNotification(actor,body));
  case'generate':return json(await generateDescription(actor,body));
  case'apply-description':return json(await applyDescription(actor,body));
  default:return json({error:{code:'NOT_FOUND',message:'Действие не найдено.'}},404);
 }
}catch(e){return failure(e);}};
