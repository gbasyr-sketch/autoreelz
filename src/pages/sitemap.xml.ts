import type {APIRoute} from 'astro';
import {seoSettings} from '../server/seo';
import {getCatalog} from '../server/catalog';
import {getContent} from '../server/content';
import {sitemapPaths,renderSitemap} from '../lib/seo';
export const GET:APIRoute=async ctx=>{const paths=seoSettings(ctx.url).indexing?sitemapPaths(await getCatalog(),await getContent()):[];return new Response(renderSitemap(paths),{headers:{'Content-Type':'application/xml; charset=utf-8'}});};
