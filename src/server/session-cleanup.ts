import {transaction,query} from './db.ts';
import {requireCommerceEnvironment} from './config.ts';
export interface SessionCleanupResult {deleted_sessions:number;deleted_carts:number;skipped:boolean}
/** Read-only preview uses exactly the same policy as the database routine. */
export async function sessionCleanupPreview(){
 requireCommerceEnvironment();
 const result=await query<{eligible:string}>("SELECT count(*)::text AS eligible FROM ar_session_cleanup_candidates");
 return {eligibleSessions:result.rows[0]!.eligible,graceDays:30,batchLimit:200,intervalHours:1};
}
export async function sessionCleanupTick():Promise<SessionCleanupResult>{
 requireCommerceEnvironment();
 return transaction(async client=>{
  await client.query("SET LOCAL statement_timeout='5s'");
  await client.query("SET LOCAL lock_timeout='500ms'");
  const result=await client.query<SessionCleanupResult>('SELECT * FROM ar_cleanup_empty_sessions()');
  return result.rows[0]!;
 },false);
}
