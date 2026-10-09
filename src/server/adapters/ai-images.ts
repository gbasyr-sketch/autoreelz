import {request as httpsRequest} from 'node:https';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import Decimal from 'decimal.js';
import {setting,requireLocalTest} from '../config.ts';
import type {ImagePlan} from '../../lib/ai-images.ts';

export type ImageUsage={textInputTokens:number;imageInputTokens:number;outputTokens:number};
export type GeneratedImage={png:Buffer;usage:ImageUsage|null;requestId:string|null};
export class ImageProviderError extends Error{code:string;free:boolean;usage:ImageUsage|null;constructor(code:string,free=false,usage:ImageUsage|null=null){super(code);this.code=code;this.free=free;this.usage=usage;}}
export function imageUsageCost(usage:ImageUsage){return new Decimal(usage.textInputTokens).times(5).plus(new Decimal(usage.imageInputTokens).times(8)).plus(new Decimal(usage.outputTokens).times(30)).div(1000000).toDecimalPlaces(8,Decimal.ROUND_CEIL).toFixed(8);}
function imageUsage(u:any):ImageUsage|null{
 let usage:ImageUsage|null=null;
 const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=1000000;
 if(u&&integer(u.input_tokens_details?.text_tokens)&&integer(u.input_tokens_details?.image_tokens)&&integer(u.output_tokens)&&u.input_tokens===u.input_tokens_details.text_tokens+u.input_tokens_details.image_tokens)usage={textInputTokens:u.input_tokens_details.text_tokens,imageInputTokens:u.input_tokens_details.image_tokens,outputTokens:u.output_tokens};
 return usage;
}
export function parseImageResponse(value:any):GeneratedImage{
 const usage=imageUsage(value?.usage);
 if(!value||!Array.isArray(value.data)||value.data.length!==1||typeof value.data[0]?.b64_json!=='string'||value.data[0].b64_json.length>14*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.data[0].b64_json))throw new ImageProviderError('IMAGE_FORMAT',false,usage);
 const png=Buffer.from(value.data[0].b64_json,'base64');if(png.length>10*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new ImageProviderError('IMAGE_FORMAT',false,usage);
 return{png,usage,requestId:null};
}
async function bounded(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new ImageProviderError('IMAGE_UNCERTAIN');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16*1024*1024){await reader.cancel();throw new ImageProviderError('IMAGE_UNCERTAIN');}chunks.push(part.value);}return Buffer.concat(chunks);
}
function gatewayCall(body:string,key:string,signal:AbortSignal){
 const token=setting('AI_IMAGE_GATEWAY_TOKEN');if(!/^[a-f0-9]{64}$/.test(token))throw new ImageProviderError('IMAGE_LOCAL',true);
 return new Promise<Response>((resolve,reject)=>{const req=httpsRequest('https://89.124.96.238:14447/v1/images/edits',{method:'POST',ca:readFileSync(join(process.cwd(),'src/server/ai-gateway.crt')),rejectUnauthorized:true,signal,timeout:180000,headers:{Authorization:'Bearer '+key,'X-AutoReelz-Image-Gateway':token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16*1024*1024)req.destroy(Error('oversized'));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{try{resolve(new Response(Buffer.concat(chunks),{status:res.statusCode??502,headers:{'x-request-id':String(res.headers['x-request-id']??'')}}));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end(body);});
}
export async function generateImage(plan:ImagePlan,images:Buffer[],signal:AbortSignal):Promise<GeneratedImage>{
 const key=setting('AI_IMAGE_OPENAI_API_KEY');if(!key)throw new ImageProviderError('IMAGE_LOCAL',true);
 let response:Response;
 try{
  if(setting('AI_IMAGE_TRANSPORT','gateway')==='direct'){
   requireLocalTest();const body=new FormData();for(const [key,value]of Object.entries({model:plan.model,prompt:plan.prompt,size:plan.size,quality:plan.quality,n:'1',output_format:'png',background:'opaque'}))body.append(key,value);
   images.forEach((image,i)=>body.append('image[]',new Blob([new Uint8Array(image)],{type:'image/webp'}),`reference-${i+1}.webp`));
   response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+key},body,redirect:'error',signal});
  }else response=await gatewayCall(JSON.stringify({model:plan.model,prompt:plan.prompt,size:plan.size,quality:plan.quality,images:images.map(i=>i.toString('base64'))}),key,signal);
 }catch(error){if(error instanceof ImageProviderError)throw error;throw new ImageProviderError('IMAGE_UNCERTAIN');}
 if(!response.ok){let usage:ImageUsage|null=null;try{usage=imageUsage(JSON.parse((await bounded(response)).toString('utf8'))?.usage);}catch{}throw new ImageProviderError(response.status===401||response.status===403?'IMAGE_ACCESS':response.status===429?'IMAGE_RATE':'IMAGE_REJECTED',usage===null&&[401,403,404,413,415,422,429].includes(response.status),usage);}
 let payload;try{payload=JSON.parse((await bounded(response)).toString('utf8'));}catch{throw new ImageProviderError('IMAGE_UNCERTAIN');}
 const value=parseImageResponse(payload);value.requestId=response.headers.get('x-request-id')?.slice(0,200)??null;return value;
}
