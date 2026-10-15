import {workerTick} from '../src/server/worker.ts';
import {sessionCleanupTick} from '../src/server/session-cleanup.ts';
import {getPool} from '../src/server/db.ts';
let running=true,cleanupRetryAfter=0;
process.on('SIGTERM',()=>{running=false;});
process.on('SIGINT',()=>{running=false;});
while(running){
 try{await workerTick();}
 catch(e){console.error('Commerce worker tick failed',String((e as {code?:string}).code??'internal'));}
 // Maintenance is independent of commerce reconciliation/heartbeat. A failed
 // batch rolls back and backs off, rather than delaying every commerce tick.
 if(running&&Date.now()>=cleanupRetryAfter){
  try{
   const result=await sessionCleanupTick();
   if(result.deleted_sessions)console.log('Session cleanup',JSON.stringify(result));
  }catch(e){
   cleanupRetryAfter=Date.now()+60*60_000;
   console.error('Session cleanup failed',String((e as {code?:string}).code??'internal'));
  }
 }
 if(running)await new Promise(r=>setTimeout(r,5000));
}
await getPool().end();
