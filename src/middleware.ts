import { defineMiddleware } from 'astro:middleware';
import {getSession} from './server/security';

export const onRequest = defineMiddleware(async (context, next) => {
  const path=context.url.pathname;
  if(!/^\/(?:_astro|images|fonts|brand|media)(?:\/|$)/.test(path)&&!['/health','/robots.txt','/favicon.ico'].includes(path)){
    try{context.locals.shopSession=await getSession(context);}
    catch{console.error('Store session database unavailable');return new Response(path.startsWith('/api/')?JSON.stringify({error:{code:'UNAVAILABLE',message:'Магазин временно недоступен. Повторите запрос позже.'}}):'Магазин временно недоступен. Повторите запрос позже.',{status:503,headers:{'Content-Type':path.startsWith('/api/')?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
  }
  const response = await next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
});
