import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {refundWorkspace,queueRefund} from '../../../server/yookassa-refunds';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await refundWorkspace(ctx.url.searchParams.get('orderId')??''));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx));return json(await queueRefund(actor,body),202);}catch(e){return failure(e);}};
