import { defineMiddleware } from 'astro:middleware';
import {seoSettings} from './server/seo';
import {getSession} from './server/security';

export const onRequest = defineMiddleware(async (context, next) => {
  const path=context.url.pathname;
  if(!/^\/(?:_astro|images|fonts|brand|media)(?:\/|$)/.test(path)&&!['/health','/robots.txt','/sitemap.xml','/feed.yml','/favicon.ico','/api/payments/yookassa'].includes(path)){
    try{context.locals.shopSession=await getSession(context);}
    catch{console.error('Store session database unavailable');return new Response(path.startsWith('/api/')?JSON.stringify({error:{code:'UNAVAILABLE',message:'Магазин временно недоступен. Повторите запрос позже.'}}):'Магазин временно недоступен. Повторите запрос позже.',{status:503,headers:{'Content-Type':path.startsWith('/api/')?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
  }
  const response = await next();
  const publicSeo=seoSettings(context.url).indexing;
  const asset=/^\/(?:_astro|fonts|images|brand|media)(?:\/|$)/.test(path);
  if(!publicSeo||!asset)response.headers.set('X-Robots-Tag',publicSeo&&context.locals.seoIndexable&&response.status<400?'index, follow':'noindex, follow');
  response.headers.set('Cache-Control',path.startsWith('/_astro/')?'public, max-age=31536000, immutable':/^\/(?:fonts|images|brand)\//.test(path)?'public, max-age=86400':'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
});
