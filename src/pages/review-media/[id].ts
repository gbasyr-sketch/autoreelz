import type {APIRoute} from 'astro';
import {getReviewPhoto} from '../../server/social';
import {staff} from '../../server/security';
import {failure} from '../../server/http';
export const GET:APIRoute=async ctx=>{try{
 const preview=ctx.url.searchParams.get('preview')==='1';if(preview)await staff(ctx.request);
 const photo=await getReviewPhoto(ctx.params.id,preview);
 return new Response(new Uint8Array(photo.data),{headers:{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
}catch(error){return failure(error);}};
