import {base} from './cms-client.mjs';
let ready=false;
for(let i=0;i<60;i++){
 try{const r=await fetch(`${base}/server/ping`,{signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!ready)throw new Error('New CMS did not become ready within 60 seconds');
console.log('New CMS is ready.');
