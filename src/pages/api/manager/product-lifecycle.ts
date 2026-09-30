import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {readProductLifecycle,changeProductLifecycle,archivedProducts} from '../../../server/product-lifecycle';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(ctx.url.searchParams.has('archived')?{products:await archivedProducts()}:await readProductLifecycle(ctx.url.searchParams.get('id')));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request);return json(await changeProductLifecycle(actor,await readBody(ctx.request,await sessionFor(ctx),4096)));}catch(e){return failure(e);}};
