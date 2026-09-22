import{managerOrders,addNote,adjustStock,cancelByManager,fulfill,overrideDelivery,simulateCarrier}from'../../../server/management';
import{ownerNotifications,retryNotification}from'../../../server/notifications';
import{generationProducts,generateDescription,applyDescription}from'../../../server/description-generation';
import type{APIRoute}from'astro';
import{sessionFor,json,failure,peer}from'../../../server/http';
import{staff,readBody}from'../../../server/security';
import{staffLogin}from'../../../server/auth';
import{stockList,quoteShipping,confirmPreorder,receiveStock}from'../../../server/orders';
import{query}from'../../../server/db';
import{iso}from'../../../server/errors';
import{requireLocalTest}from'../../../server/config';
export const GET:APIRoute=async ctx=>{try{
 await staff(ctx.request);
 switch(ctx.params.action){
  case'orders':return json({orders:await managerOrders()});
  case'notifications':return json({notifications:await ownerNotifications()});
  case'products':return json({products:await generationProducts()});
  case'stock':return json(await stockList());
  case'mail':requireLocalTest();return json({messages:(await query("SELECT id,recipient,subject,body,created_at FROM ar_mail_outbox WHERE status='delivered' ORDER BY created_at DESC LIMIT 100")).rows.map(r=>({id:r.id,to:r.recipient,subject:r.subject,body:r.body,createdAt:iso(r.created_at)}))});
  default:return json({error:{code:'NOT_FOUND',message:'Раздел не найден.'}},404);
 }
}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{
 requireLocalTest();const session=await sessionFor(ctx),body=await readBody(ctx.request,session,ctx.params.action==='apply-description'?49152:16384);
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
