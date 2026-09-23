import type{APIRoute}from'astro';
import{json,failure,peer,sessionFor}from'../../../server/http';
import{shippingProvider,cdekClient}from'../../../server/shipping-policy';
import{CdekError}from'../../../server/adapters/cdek';
import{integer,text,StoreError}from'../../../server/errors';
import{shippingRateLimit}from'../../../server/shipping-rate-limit';
export const GET:APIRoute=async ctx=>{try{
 await sessionFor(ctx);if(ctx.params.action==='config')return json({provider:shippingProvider()});
 if(shippingProvider()!=='cdek')return json({error:{code:'NOT_FOUND'}},404);
 await shippingRateLimit(peer(ctx));const client=cdekClient();
 switch(ctx.params.action){
  case'cities':return json({items:await client.cities(text(ctx.url.searchParams.get('q'),'Город',2,100))});
  case'points':return json(await client.offices(integer(Number(ctx.url.searchParams.get('cityCode')),'Город',1,2147483647),integer(Number(ctx.url.searchParams.get('page')??0),'Страница',0,100)));
  default:return json({error:{code:'NOT_FOUND'}},404);
 }
}catch(e){return failure(e instanceof CdekError?new StoreError('CDEK_UNAVAILABLE','Справочник СДЭК временно недоступен. Повторите запрос или укажите адрес вручную.',503):e);}};
