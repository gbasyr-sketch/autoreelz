import type {APIRoute} from 'astro';
import {seoSettings} from '../server/seo';
import {SITE_ORIGIN} from '../lib/seo';
export const GET:APIRoute=ctx=>new Response(seoSettings(ctx.url).indexing?`User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
