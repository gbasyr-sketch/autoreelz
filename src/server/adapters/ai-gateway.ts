import {request} from 'node:https';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setting} from '../config.ts';

export const OPENAI_GATEWAY='https://89.124.96.238:14446/v1/responses';
/** Only the private gateway trusts this certificate; normal HTTPS keeps system CAs. */
export const aiFetch:typeof fetch=async(input,init)=>{
 if(String(input)!==OPENAI_GATEWAY)return fetch(input,init);
 const token=setting('AI_TEXT_GATEWAY_TOKEN');
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Gateway configuration is missing');
 const headers=new Headers(init?.headers);headers.set('X-AutoReelz-Gateway',token);
 const ca=readFileSync(join(process.cwd(),'src/server/ai-gateway.crt'));
 return new Promise<Response>((resolve,reject)=>{
  const req=request(OPENAI_GATEWAY,{method:'POST',headers:Object.fromEntries(headers),ca,rejectUnauthorized:true,signal:init?.signal??undefined,timeout:32000},res=>{
   const chunks:Buffer[]=[];let bytes=0;
   res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>131072){req.destroy(Error('Oversized gateway response'));return;}chunks.push(chunk);});
   res.on('error',reject);
   res.on('end',()=>{try{resolve(new Response(Buffer.concat(chunks),{status:res.statusCode??502,headers:{'Content-Type':'application/json'}}));}catch(error){reject(error);}});
  });
  req.on('timeout',()=>req.destroy(Error('Gateway timeout')));req.on('error',reject);
  const body=String(init?.body??'');req.setHeader('Content-Length',Buffer.byteLength(body));req.end(body);
 });
};
