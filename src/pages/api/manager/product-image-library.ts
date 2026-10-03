import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {listLibraryImages,changeLibraryImage} from '../../../server/product-image-library';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await listLibraryImages(ctx.url.searchParams));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request);return json(await changeLibraryImage(actor,await readBody(ctx.request,await sessionFor(ctx),4096)));}catch(e){return failure(e);}};
