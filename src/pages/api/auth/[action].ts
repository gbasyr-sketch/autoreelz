import type{APIRoute}from'astro';
import{sessionFor,json,failure,peer}from'../../../server/http';
import{readBody}from'../../../server/security';
import{requestCode,verifyCode,logout}from'../../../server/auth';
import{requireLocalTest}from'../../../server/config';
export const POST:APIRoute=async ctx=>{try{
 requireLocalTest();const session=await sessionFor(ctx),body=await readBody(ctx.request,session);
 switch(ctx.params.action){
  case'request':return json(await requestCode(session,body.email,peer(ctx)));
  case'verify':return json(await verifyCode(ctx,session,body.challengeId,body.code));
  case'logout':return json(await logout(ctx,session));
  default:return json({error:{code:'NOT_FOUND',message:'Действие не найдено.'}},404);
 }
}catch(e){return failure(e);}};
