import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {json,failure,sessionFor} from '../../../server/http';
import {closingReceiptWorkspace,queueClosingReceipt,yooClosingReceipts} from '../../../server/yookassa-closing';
import {query} from '../../../server/db';
import {uuid,StoreError} from '../../../server/errors';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await closingReceiptWorkspace(uuid(ctx.url.searchParams.get('orderId'))));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{
 const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx),4096);
 if(body.action==='check'){
  const id=uuid(body.id),orderId=uuid(body.orderId);const row=(await query('SELECT provider_id FROM ar_yookassa_closing_receipts WHERE id=$1 AND order_id=$2',[id,orderId])).rows[0];
  if(!row?.provider_id)throw new StoreError('CLOSING_CHECK','Неизвестный результат проверяется worker с прежним ключом. Новый запрос вручную не отправляется.',409);
  await yooClosingReceipts.process(id,true);return json(await closingReceiptWorkspace(orderId));
 }
 return json(await queueClosingReceipt(actor,body));
}catch(e){return failure(e);}};
