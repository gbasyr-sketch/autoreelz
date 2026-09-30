import type {APIRoute} from 'astro';
import {staff} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {uploadEditorImage,editorImage} from '../../../server/product-editor-images';
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request);return json(await uploadEditorImage(ctx.request,await sessionFor(ctx),actor));}catch(e){return failure(e);}};
export const GET:APIRoute=async ctx=>{try{return await editorImage(ctx.request,await staff(ctx.request),ctx.url.searchParams.get('id'),ctx.url.searchParams.get('thumbnail')==='1');}catch(e){return failure(e);}};
