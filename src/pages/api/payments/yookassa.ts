import type{APIRoute}from'astro';
import{json,failure,peer}from'../../../server/http';
import{jsonBody,sign}from'../../../server/security';
import{query}from'../../../server/db';
import{StoreError}from'../../../server/errors';
import{isYooKassa,liveOperationsPaused}from'../../../server/payment-policy';
import{yooPayments}from'../../../server/yookassa-payments';
import{yooRefunds}from'../../../server/yookassa-refunds';
export const POST:APIRoute=async ctx=>{try{
 if(!isYooKassa()||liveOperationsPaused())return json({error:{code:'NOT_FOUND'}},404);
 const key=sign('yookassa-webhook:'+peer(ctx));
 const rate=await query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 minute')
  ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,
  reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+interval '1 minute' ELSE ar_rate_limits.reset_at END
  WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<120 RETURNING id`,[key]);
 if(!rate.rowCount)throw new StoreError('RATE_LIMIT','Повторите запрос позже.',429);
 const body=await jsonBody(ctx.request,16384);
 return json(await (body.event==='refund.succeeded'?yooRefunds:yooPayments).webhook(body));
}catch(error){return failure(error);}};
