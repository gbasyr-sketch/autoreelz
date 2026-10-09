import type {APIRoute} from 'astro';
import {staff} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {uploadImageSource,readPrivateImage} from '../../../server/ai-image-studio';
export const POST:APIRoute=async ctx=>{try{return json(await uploadImageSource(ctx.request,await sessionFor(ctx),await staff(ctx.request)));}catch(e){return failure(e);}};
export const GET:APIRoute=async ctx=>{try{const download=ctx.url.searchParams.get('download')==='1',value=await readPrivateImage(await staff(ctx.request),ctx.url.searchParams.get('id'),download||ctx.url.searchParams.get('full')==='1');return new Response(new Uint8Array(value.data),{headers:{'Content-Type':'image/'+value.format,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...(download?{'Content-Disposition':`attachment; filename="autoreelz-${value.row.id}.${value.format}"`}:{})}});}catch(e){return failure(e);}};
