import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,failure} from '../../../server/http';
import {removeProductBackground} from '../../../server/product-background';
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx),1024);return await removeProductBackground(ctx.request,actor,body);}catch(e){return failure(e);}};
