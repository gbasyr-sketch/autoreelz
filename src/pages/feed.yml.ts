import type {APIRoute} from 'astro';
import {seoSettings} from '../server/seo';
import {setting} from '../server/config';
import {getCatalog} from '../server/catalog';
import {feedOffers,renderYml} from '../lib/feed';
export const GET:APIRoute=async ctx=>{
 const company=setting('YML_COMPANY_NAME');
 if(!seoSettings(ctx.url).indexing||!company.trim())return new Response('Товарный фид ещё не включён для публичного магазина.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 const catalog=await getCatalog();if(!feedOffers(catalog).length)return new Response('Нет проверенных опубликованных предложений для выгрузки.',{status:503});
 return new Response(renderYml(catalog,company),{headers:{'Content-Type':'application/xml; charset=utf-8'}});
};
