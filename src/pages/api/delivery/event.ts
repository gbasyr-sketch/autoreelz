import type {APIRoute} from 'astro';
import {json,failure} from '../../../server/http';
import {jsonBody} from '../../../server/security';
import {appConfig,requireLocalTest} from '../../../server/config';
import {StoreError} from '../../../server/errors';
import {applyCarrierEvent,type CarrierEvent} from '../../../server/management';
export const POST:APIRoute=async ctx=>{try{
 requireLocalTest();if(ctx.url.host!==new URL(appConfig().origin).host)throw new StoreError('ORIGIN','Источник запроса не разрешён.',403);
 const body=await jsonBody(ctx.request);return json(await applyCarrierEvent(body as unknown as CarrierEvent,ctx.request.headers.get('X-Delivery-Signature')??''));
}catch(error){return failure(error);}};
