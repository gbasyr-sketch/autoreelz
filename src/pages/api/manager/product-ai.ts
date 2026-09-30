import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {getAIStatus,readAIRequest,generateProductText} from '../../../server/product-ai';
export const GET:APIRoute=async ctx=>{try{const actor=await staff(ctx.request);return json(ctx.url.searchParams.has('request')?await readAIRequest(actor,ctx.url.searchParams.get('request')):await getAIStatus());}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx),65536);return json(await generateProductText(actor,body));}catch(e){return failure(e);}};
