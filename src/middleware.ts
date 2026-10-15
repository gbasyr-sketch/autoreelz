import { defineMiddleware } from 'astro:middleware';
import {seoSettings} from './server/seo';
import {getSession} from './server/security';
import {SessionCreationLimitError} from './server/session-rate-limit';
import {failure} from './server/http';

export const onRequest = defineMiddleware(async (context, next) => {
  const path=context.url.pathname;
  if(!/^\/(?:_astro|images|fonts|brand|media)(?:\/|$)/.test(path)&&!['/health','/robots.txt','/sitemap.xml','/feed.yml','/favicon.ico','/api/payments/yookassa'].includes(path)){
    try{context.locals.shopSession=await getSession(context);}
    catch(error){
      if(error instanceof SessionCreationLimitError){
        if(path.startsWith('/api/')){const response=failure(error);response.headers.set('X-Robots-Tag','noindex, nofollow');return response;}
        return new Response(error.message,{status:429,headers:{'Content-Type':'text/plain; charset=utf-8','Retry-After':String(error.retryAfter),'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
      }
      console.error('Store session database unavailable');return new Response(path.startsWith('/api/')?JSON.stringify({error:{code:'UNAVAILABLE',message:'Магазин временно недоступен. Повторите запрос позже.'}}):'Магазин временно недоступен. Повторите запрос позже.',{status:503,headers:{'Content-Type':path.startsWith('/api/')?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
    }
  }
  const response = await next();
  const publicSeo=seoSettings(context.url).indexing;
  const asset=/^\/(?:_astro|fonts|images|brand|media)(?:\/|$)/.test(path);
  // Astro can return a streaming HTML response before a nested layout sets locals.
  // In production HTML, the layout's robots meta is authoritative; an unset
  // local must not add a conflicting noindex header to an indexable document.
  const html=response.headers.get('Content-Type')?.includes('text/html');
  const discovery=path==='/robots.txt'||path==='/sitemap.xml';
  if(!publicSeo||response.status>=400||(!asset&&!html&&!discovery))response.headers.set('X-Robots-Tag','noindex, follow');
  else response.headers.delete('X-Robots-Tag');
  response.headers.set('Cache-Control',path.startsWith('/_astro/')?'public, max-age=31536000, immutable':/^\/(?:fonts|images|brand)\//.test(path)?'public, max-age=86400':'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
});
