import {isIP} from 'node:net';
import type {PoolClient} from 'pg';
import {StoreError} from './errors.ts';

// Only new sessions consume this quota. Existing carts and signed-in customers
// bypass it, including when they share an IP with a blocked visitor.
export const SESSION_CREATION_WINDOWS=[{seconds:60,limit:60},{seconds:3600,limit:600}] as const;
export class SessionCreationLimitError extends StoreError {
 readonly retryAfter:number;
 constructor(retryAfter:number){super('SESSION_RATE_LIMIT','Слишком много новых посещений с вашей сети. Подождите и повторите попытку.',429);this.retryAfter=retryAfter;}
}
export function sessionNetwork(ip:string){
 if(ip.includes('%'))return 'unknown';
 if(isIP(ip)===4)return ip;
 if(isIP(ip)===6){
  const address=new URL(`http://[${ip}]/`).hostname.slice(1,-1);
  const [left,right]=address.split('::');
  const start=left?left.split(':'):[],end=right?right.split(':'):[];
  const words=(right===undefined?start:[...start,...Array(8-start.length-end.length).fill('0'),...end]).map(x=>parseInt(x,16));
  // IPv4-mapped IPv6 must share the IPv4 quota. Other IPv6 addresses are
  // grouped by /64 so rotating an interface address cannot reset the quota.
  if(words.slice(0,5).every(x=>x===0)&&words[5]===65535)return `${words[6]!>>>8}.${words[6]!&255}.${words[7]!>>>8}.${words[7]!&255}`;
  return words.slice(0,4).map(x=>x.toString(16)).join(':')+'::/64';
 }
 // Missing clientAddress never disables the protection; do not trust raw XFF.
 return 'unknown';
}
export async function takeSessionCreation(client:PoolClient,ip:string,sign:(value:string)=>string){
 const network=sessionNetwork(ip);
 for(const {seconds,limit} of SESSION_CREATION_WINDOWS){
  const key=sign(`session-create:${seconds}:${network}`);
  const result=await client.query(`INSERT INTO ar_rate_limits(key,count,reset_at) VALUES($1,1,now()+$3*interval '1 second')
   ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ar_rate_limits.reset_at<=now() THEN 1 ELSE ar_rate_limits.count+1 END,
   reset_at=CASE WHEN ar_rate_limits.reset_at<=now() THEN now()+$3*interval '1 second' ELSE ar_rate_limits.reset_at END
   WHERE ar_rate_limits.reset_at<=now() OR ar_rate_limits.count<$2 RETURNING id`,[key,limit,seconds]);
  if(!result.rowCount){
   const row=(await client.query('SELECT ceil(extract(epoch FROM reset_at-now()))::int AS seconds FROM ar_rate_limits WHERE key=$1',[key])).rows[0];
   throw new SessionCreationLimitError(Math.max(1,Math.min(seconds,Number(row?.seconds)||seconds)));
  }
 }
}
