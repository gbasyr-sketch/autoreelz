import{query}from'./db.ts';import{sign}from'./security.ts';import{StoreError}from'./errors.ts';
export async function shippingRateLimit(ip:string){
 const key=sign('shipping-api:'+ip);
 const r=await query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 minute')
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,
 reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+interval '1 minute' ELSE ar_rate_limits.reset_at END
 WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<60 RETURNING id`,[key]);
 if(!r.rowCount)throw new StoreError('RATE_LIMIT','Слишком много расчётов. Повторите через минуту.',429);
}
