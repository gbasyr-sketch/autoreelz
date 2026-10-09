import {imageWorkerTick} from '../src/server/ai-image-worker.ts';
import {getPool} from '../src/server/db.ts';
import {setting} from '../src/server/config.ts';
let running=true;process.on('SIGTERM',()=>running=false);process.on('SIGINT',()=>running=false);
while(running){try{if(['openai','simulation'].includes(setting('AI_IMAGE_PROVIDER','disabled')))await imageWorkerTick();}catch{console.error('Image worker tick failed; dispatched jobs will not be resent.');}if(running)await new Promise(r=>setTimeout(r,5000));}
await getPool().end();
