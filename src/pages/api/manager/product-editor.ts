import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {readProductEditor,productEditorOptions,saveProductEditor,editorDrafts,EditorError} from '../../../server/product-editor';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);if(ctx.url.searchParams.has('options'))return json(await productEditorOptions());if(ctx.url.searchParams.has('drafts'))return json({drafts:await editorDrafts()});return json(await readProductEditor(ctx.url.searchParams.get('id'),ctx.url.searchParams.get('kind')??'single'));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request),body=await readBody(ctx.request,await sessionFor(ctx),65536);return json(await saveProductEditor(actor,body));}catch(e){if(e instanceof EditorError)return json({error:{code:e.code,message:e.message,issues:e.issues}},e.status);return failure(e);}};
