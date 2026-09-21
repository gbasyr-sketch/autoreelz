import{workerTick}from'../src/server/worker.ts';
import{getPool}from'../src/server/db.ts';
let running=true;process.on('SIGTERM',()=>{running=false;});process.on('SIGINT',()=>{running=false;});
while(running){try{await workerTick();}catch(e){console.error('Commerce worker tick failed',String((e as {code?:string}).code??'internal'));}if(running)await new Promise(r=>setTimeout(r,5000));}
await getPool().end();
