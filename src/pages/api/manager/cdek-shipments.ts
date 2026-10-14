import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {StoreError} from '../../../server/errors';
import {shipmentWorkspace,previewShipment,queueShipment,shipmentCommand,shipmentPdf} from '../../../server/cdek-shipments';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);
 if(ctx.url.searchParams.has('printId')){const pdf=await shipmentPdf(ctx.url.searchParams.get('printId')!);return new Response(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="cdek-waybill.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});}
 return json(await shipmentWorkspace(ctx.url.searchParams.get('orderId')??''));
 }catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx));
 switch(body.action){case'preview':return json(await previewShipment(body));case'create':return json(await queueShipment(actor,body),202);case'cancel':case'refresh':case'print':return json(await shipmentCommand(actor,body),202);default:throw new StoreError('CDEK_ACTION','Неизвестное действие.');}
 }catch(e){return failure(e);}};
