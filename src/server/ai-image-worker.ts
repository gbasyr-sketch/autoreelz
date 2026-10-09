import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import Decimal from 'decimal.js';
import {getPool,query,transaction} from './db.ts';
import {hash} from './security.ts';
import {imageConfig,imageBudget,imageStoragePath,immutableImageFile} from './ai-image-studio.ts';
import {generateImage,ImageProviderError,imageUsageCost,type GeneratedImage} from './adapters/ai-images.ts';
import type {ImagePlan} from '../lib/ai-images.ts';

type Receipt={pngDigest:string;digest:string;width:number;height:number;bytes:number;usage:GeneratedImage['usage'];requestId:string|null;chargedUsd:string|null;errorCode:string|null};
async function receiptFor(id:string):Promise<Receipt|null>{try{return JSON.parse(await readFile(imageStoragePath(id,'json',true),'utf8'));}catch(error){if((error as any).code==='ENOENT')return null;throw error;}}
async function finish(id:string,receipt:Receipt){
 const png=await readFile(imageStoragePath(id,'png')),webp=await readFile(imageStoragePath(id,'webp'));if(hash(png.toString('base64'))!==receipt.pngDigest||hash(webp.toString('base64'))!==receipt.digest)throw Error('Receipt image mismatch');
 await transaction(async c=>{
  const row=(await c.query('SELECT * FROM ar_ai_image_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row||row.state==='completed')return;if(!['running','uncertain'].includes(row.state))throw Error('Invalid image completion');
  await c.query("INSERT INTO ar_ai_image_assets(id,actor_id,product_id,kind,name,digest,original_digest,width,height,bytes) VALUES($1,$2,$3,'result',$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",[id,row.actor_id,row.product_id,row.plan.settings.headline,receipt.digest,receipt.pngDigest,receipt.width,receipt.height,receipt.bytes]);
  const exceeds=receipt.chargedUsd!==null&&new Decimal(receipt.chargedUsd).gt(row.reserved_usd);
  await c.query("UPDATE ar_ai_image_jobs SET state='completed',result_id=$1,charged_usd=$2,usage=$3,provider_request_id=$4,error_code=$5,finished_at=now() WHERE id=$1",[id,receipt.chargedUsd,JSON.stringify(receipt.usage),receipt.requestId,exceeds?'IMAGE_USAGE':receipt.errorCode]);
 },false);
}
async function simulation(_plan:ImagePlan,images:Buffer[]):Promise<GeneratedImage>{
 // QA only: clearly labelled deterministic fixture, never presented as AI output.
 const wait=Number(process.env.AI_IMAGE_SIMULATION_DELAY_MS??0);if(Number.isFinite(wait)&&wait>0)await new Promise(resolve=>setTimeout(resolve,Math.min(wait,10000)));
 const image=await sharp(images[0]).resize({width:850,height:800,fit:'inside'}).toBuffer();const meta=await sharp(image).metadata();
 const label=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#f6f4ef"/><text x="80" y="120" font-size="54" fill="#222">ПРОВЕРКА ИНТЕРФЕЙСА — НЕ ИИ</text></svg>');
 return{png:await sharp(label).composite([{input:image,left:Math.floor((1536-meta.width!)/2),top:180}]).png().toBuffer(),usage:{textInputTokens:1000,imageInputTokens:4000,outputTokens:1372},requestId:'simulation'};
}
export async function imageWorkerTick(adapter:typeof generateImage=generateImage){
 const client=await getPool().connect();const lock="hashtextextended('ai-image-worker',0)";let locked=false;
 try{
  locked=!!(await client.query(`SELECT pg_try_advisory_lock(${lock}) locked`)).rows[0].locked;if(!locked)return{busy:true};
  // Holding the global session lock means no other connected image worker owns these jobs.
  const interrupted=(await query("SELECT id,state FROM ar_ai_image_jobs WHERE state IN ('preparing','running','uncertain') ORDER BY created_at")).rows;
  for(const job of interrupted){try{const receipt=await receiptFor(job.id);if(receipt){await finish(job.id,receipt);continue;}if(job.state==='preparing')await query("UPDATE ar_ai_image_jobs SET state='queued' WHERE id=$1 AND state='preparing'",[job.id]);else if(job.state==='running')await query("UPDATE ar_ai_image_jobs SET state='uncertain',error_code='IMAGE_UNCERTAIN',finished_at=now() WHERE id=$1 AND state='running'",[job.id]);}catch{await query("UPDATE ar_ai_image_jobs SET state='uncertain',error_code='IMAGE_USAGE',finished_at=now() WHERE id=$1 AND state IN ('preparing','running','uncertain')",[job.id]);}}
  const claimed=await transaction(async c=>{const row=(await c.query("SELECT * FROM ar_ai_image_jobs WHERE state='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;await c.query("UPDATE ar_ai_image_jobs SET state='preparing',started_at=now() WHERE id=$1",[row.id]);return row;},false);if(!claimed)return{idle:true};
  const cfg=imageConfig(),plan=claimed.plan as ImagePlan;let sent=false,knownUsage:GeneratedImage['usage']=null;
  try{
   if(!cfg.enabled||claimed.provider!==cfg.provider||claimed.budget_key!==cfg.budgetKey)throw new ImageProviderError('IMAGE_LOCAL',true);
   const budget=await imageBudget();if(budget.needsAudit||new Decimal(budget.usedUsd).gt(budget.limitUsd))throw new ImageProviderError('IMAGE_LOCAL',true);
   const images:Buffer[]=[];for(const ref of plan.references){const bytes=await readFile(imageStoragePath(ref.asset.id,'webp'));if(hash(bytes.toString('base64'))!==ref.asset.digest)throw new ImageProviderError('IMAGE_LOCAL',true);images.push(bytes);}
   const dispatched=await query("UPDATE ar_ai_image_jobs SET state='running',sent_at=now() WHERE id=$1 AND state='preparing' RETURNING id",[claimed.id]);if(!dispatched.rowCount)return{cancelled:true};sent=true;
   const generated=claimed.provider==='simulation'?await simulation(plan,images):await adapter(plan,images,AbortSignal.timeout(180000));
   knownUsage=generated.usage;
   const meta=await sharp(generated.png,{limitInputPixels:2000000}).metadata();if(meta.format!=='png'||meta.width!==1536||meta.height!==1024||(meta.pages??1)!==1)throw new ImageProviderError('IMAGE_FORMAT');
   const webp=await sharp(generated.png).webp({quality:82,effort:3}).toBuffer();if(webp.length>2*1024*1024)throw new ImageProviderError('IMAGE_FORMAT');
   const receipt:Receipt={pngDigest:hash(generated.png.toString('base64')),digest:hash(webp.toString('base64')),width:1536,height:1024,bytes:webp.length,usage:generated.usage,requestId:generated.requestId,chargedUsd:generated.usage?imageUsageCost(generated.usage):null,errorCode:generated.usage?null:'IMAGE_USAGE'};
   await immutableImageFile(imageStoragePath(claimed.id,'png'),generated.png);await immutableImageFile(imageStoragePath(claimed.id,'webp'),webp);await immutableImageFile(imageStoragePath(claimed.id,'json',true),Buffer.from(JSON.stringify(receipt)));
   await finish(claimed.id,receipt);return{id:claimed.id,completed:true};
  }catch(error){
   const receipt=await receiptFor(claimed.id);if(receipt){await finish(claimed.id,receipt);return{id:claimed.id,recovered:true};}
   knownUsage=knownUsage??(error instanceof ImageProviderError?error.usage:null);
   const free=!sent||error instanceof ImageProviderError&&error.free;
   const code=error instanceof ImageProviderError?error.code:sent?'IMAGE_UNCERTAIN':'IMAGE_LOCAL';
   const charged=free?'0.00000000':knownUsage?imageUsageCost(knownUsage):null;
   await query("UPDATE ar_ai_image_jobs SET state=$2,charged_usd=$3,error_code=$4,usage=$5,finished_at=now() WHERE id=$1 AND state IN ('preparing','running')",[claimed.id,free||knownUsage?'failed':'uncertain',charged,charged&&new Decimal(charged).gt(claimed.reserved_usd)?'IMAGE_USAGE':code,JSON.stringify(knownUsage)]);return{id:claimed.id,error:code};
  }
 }finally{if(locked)await client.query(`SELECT pg_advisory_unlock(${lock})`).catch(()=>{});client.release();}
}
