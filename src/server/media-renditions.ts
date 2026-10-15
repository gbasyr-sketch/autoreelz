import sharp from 'sharp';
// Process-local bounded cache, keyed by source fingerprint; permissions are checked by
// the route before calling this function, including on cache hits. No files are written.
const cache=new Map<string,Buffer>();
const pending=new Map<string,Promise<Buffer>>();
const maxBytes=32*1024*1024,maxJobs=2,maxWaiting=24;
let bytes=0,running=0,pendingBytes=0;
const waiting:Array<()=>void>=[];
export class MediaBusy extends Error{}
export async function mediaRendition(key:string,source:Uint8Array,width:number):Promise<Buffer>{
 const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached;}
 const existing=pending.get(key);if(existing)return existing;
 if(pendingBytes+source.byteLength>64*1024*1024||(running>=maxJobs&&waiting.length>=maxWaiting))throw new MediaBusy('Image queue is full');
 pendingBytes+=source.byteLength;
 const job=(async()=>{
  if(running>=maxJobs)await new Promise<void>(resolve=>waiting.push(resolve));else running++;
  try{
   const input=sharp(source,{limitInputPixels:40_000_000});
   if(((await input.metadata()).pages??1)>1)throw new Error('Preserve animated original');
   const result=await input.rotate().resize({width,withoutEnlargement:true}).webp({quality:82,effort:4}).toBuffer();
   while(bytes+result.length>maxBytes&&cache.size){const first=cache.keys().next().value!;bytes-=cache.get(first)!.length;cache.delete(first);}
   if(result.length<=maxBytes){cache.set(key,result);bytes+=result.length;}
   return result;
  }finally{pendingBytes-=source.byteLength;const next=waiting.shift();if(next)next();else running--;}
 })();
 pending.set(key,job);
 try{return await job;}finally{pending.delete(key);}
}
