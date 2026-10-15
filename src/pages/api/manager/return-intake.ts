import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {returnIntakeWorkspace,receiveReturn,inspectReturn} from '../../../server/return-intake';
import {StoreError} from '../../../server/errors';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await returnIntakeWorkspace(ctx.url.searchParams.get('orderId')??''));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx));switch(body.action){case'receive':return json(await receiveReturn(actor,body),201);case'inspect':return json(await inspectReturn(actor,body),201);default:throw new StoreError('RETURN_ACTION','Неизвестная операция приёмки.');}}catch(e){return failure(e);}};
