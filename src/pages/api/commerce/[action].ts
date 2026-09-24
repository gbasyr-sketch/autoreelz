import{yooPayments}from'../../../server/yookassa-payments';
import type{APIRoute}from'astro';
import{sessionFor,json,failure,peer}from'../../../server/http';
import{shippingRateLimit}from'../../../server/shipping-rate-limit';
import{shippingProvider}from'../../../server/shipping-policy';
import{readBody,jsonBody}from'../../../server/security';
import{requireTestEnvironment,appConfig}from'../../../server/config';
import{StoreError}from'../../../server/errors';
import{getCart,changeCart,createQuote,estimateDelivery}from'../../../server/cart';
import{checkout,getOrder,listOrders,cancelOrder}from'../../../server/orders';
import{payOrder,applyPaymentEvent}from'../../../server/payments';
import type{PaymentEvent}from'../../../server/adapters/payment';
export const GET:APIRoute=async ctx=>{try{
 const session=await sessionFor(ctx);
 switch(ctx.params.action){
  case'session':return json(session);
  case'cart':return json(await getCart(session));
  case'orders':return json({orders:await listOrders(session)});
  case'order':return json(await getOrder(session,ctx.url.searchParams.get('id')??''));
  default:return json({error:{code:'NOT_FOUND',message:'Страница не найдена.'}},404);
 }
}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{
 requireTestEnvironment();
 if(ctx.params.action==='payment-event'){
  if(ctx.url.host!==new URL(appConfig().origin).host)throw new StoreError('ORIGIN','Источник запроса не разрешён.',403);
  const event=await jsonBody(ctx.request);return json(await applyPaymentEvent(event as unknown as PaymentEvent,ctx.request.headers.get('X-Payment-Signature')??''));
 }
 const session=await sessionFor(ctx),body=await readBody(ctx.request,session);
 switch(ctx.params.action){
  case'cart':return json(await changeCart(session,body));
  case'delivery-estimate':if(shippingProvider()==='cdek')await shippingRateLimit(peer(ctx));return json(await estimateDelivery(session,body));
  case'quote':if(shippingProvider()==='cdek')await shippingRateLimit(peer(ctx));return json(await createQuote(session,body));
  case'checkout':return json(await checkout(session,body));
  case'pay':return json(await payOrder(session,body));
  case'payment-status':return json(await yooPayments.refresh(session,String(body.orderId??'')));
  case'cancel':return json(await cancelOrder(session,body));
  default:return json({error:{code:'NOT_FOUND',message:'Действие не найдено.'}},404);
 }
}catch(e){return failure(e);}};
