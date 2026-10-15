import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {returnResolutionWorkspace,closeReturnResolution} from '../../../server/return-resolution';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await returnResolutionWorkspace(ctx.url.searchParams.get('orderId')??''));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx));return json(await closeReturnResolution(actor,body),201);}catch(e){return failure(e);}};
