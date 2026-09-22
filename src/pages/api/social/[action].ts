import type {APIRoute} from 'astro';
import {sessionFor,json,failure} from '../../../server/http';
import {staff,readBody} from '../../../server/security';
import {getFavorites,changeFavorites,getReviews,authorizeReviewUpload,createReview,getModeration,moderateReview} from '../../../server/social';
import {assertMultipartOrigin,readReviewMultipart,processReviewPhoto,withReviewUpload} from '../../../server/social-photos';
export const GET:APIRoute=async ctx=>{try{
 if(ctx.params.action==='moderation'){await staff(ctx.request);return json(await getModeration());}
 const session=await sessionFor(ctx);
 if(ctx.params.action==='favorites')return json(await getFavorites(session));
 if(ctx.params.action==='reviews')return json(await getReviews(session,ctx.url.searchParams.get('productId')));
 return json({error:{code:'NOT_FOUND',message:'Раздел не найден.'}},404);
}catch(error){return failure(error);}};
export const POST:APIRoute=async ctx=>{try{
 const session=await sessionFor(ctx);
 if(ctx.params.action==='reviews'){
  assertMultipartOrigin(ctx.request,session);await authorizeReviewUpload(session);
  return await withReviewUpload(async()=>{const{fields,files}=await readReviewMultipart(ctx.request,session);const photos=[];for(const file of files)photos.push(await processReviewPhoto(file));return json(await createReview(session,fields,photos),201);});
 }
 const body=await readBody(ctx.request,session,ctx.params.action==='favorites'?32768:16384);
 if(ctx.params.action==='favorites')return json(await changeFavorites(session,body));
 if(ctx.params.action==='moderation')return json(await moderateReview(await staff(ctx.request),body));
 return json({error:{code:'NOT_FOUND',message:'Действие не найдено.'}},404);
}catch(error){return failure(error);}};
