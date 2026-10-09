import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {imageHistory,importImageSource,previewImage,enqueueImage,markImageCover,cancelImage,applyImage} from '../../../server/ai-image-studio';
import {uuid,StoreError} from '../../../server/errors';
export const GET:APIRoute=async ctx=>{try{return json(await imageHistory(await staff(ctx.request),uuid(ctx.url.searchParams.get('productId')),{all:ctx.url.searchParams.get('scope')==='all',before:ctx.url.searchParams.get('before')}));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),session=await sessionFor(ctx),body=await readBody(ctx.request,session,65536);
 switch(body.action){case'import':return json(await importImageSource(ctx.request,actor,body));case'preview':return json(await previewImage(actor,body));case'generate':return json(await enqueueImage(actor,body));case'cover':return json(await markImageCover(actor,body));case'cancel':return json(await cancelImage(actor,body));case'apply':return json(await applyImage(ctx.request,session,actor,body));default:throw new StoreError('IMAGE_ACTION','Неизвестное действие.');}
 }catch(e){return failure(e);}};
