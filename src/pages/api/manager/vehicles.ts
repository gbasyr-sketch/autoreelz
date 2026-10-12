import type {APIRoute} from 'astro';
import {staff,readBody} from '../../../server/security';
import {sessionFor,json,failure} from '../../../server/http';
import {readVehicleEntry,saveVehicleEntry} from '../../../server/vehicle-editor';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await readVehicleEntry(ctx.url.searchParams.get('kind'),ctx.url.searchParams.get('id')));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const actor=await staff(ctx.request);return json(await saveVehicleEntry(actor,await readBody(ctx.request,await sessionFor(ctx),16384)));}catch(e){return failure(e);}};
