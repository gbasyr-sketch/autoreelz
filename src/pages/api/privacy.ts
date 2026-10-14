import type {APIRoute} from 'astro';
import {sessionFor,json,failure} from '../../server/http';
import {readBody} from '../../server/security';
import {privacySettings,savePrivacy,setPrivacyCookie} from '../../server/privacy-consent';
import {PRIVACY_COOKIE} from '../../lib/privacy-consent';
export const GET:APIRoute=async ctx=>{try{return json(privacySettings(ctx.url,ctx.cookies.get(PRIVACY_COOKIE)?.value));}catch(e){return failure(e);}};
export const POST:APIRoute=async ctx=>{try{const session=await sessionFor(ctx),body=await readBody(ctx.request,session),choice=await savePrivacy(session,body);setPrivacyCookie(ctx,choice);return json({...privacySettings(ctx.url),choice:choice.choice,expiresAt:choice.expiresAt});}catch(e){return failure(e);}};
