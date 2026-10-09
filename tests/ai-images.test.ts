import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {emptyProduct,emptyVariant} from '../src/lib/product-editor.ts';
import {normalizeImageInput,imagePrompt,estimateImage,imageConfig} from '../src/server/ai-image-studio.ts';
import {parseImageResponse,imageUsageCost,ImageProviderError} from '../src/server/adapters/ai-images.ts';
import {IMAGE_MODEL,IMAGE_SIZE,IMAGE_QUALITY,type ImagePlan} from '../src/lib/ai-images.ts';
const id=randomUUID(),source=randomUUID(),data={...emptyProduct(),name:'Панель',categoryId:randomUUID(),variants:[emptyVariant(randomUUID())]};
const settings={type:'cover',headline:'ПАНЕЛЬ',lines:'',footnote:'',facts:'',wishes:'Светлый фон',changes:'',background:'#ffffff',accent:'#ff6600',sourceIds:[source],styleId:null,coverId:null,editOf:null};
test('image settings require explicit sources and preserve reviewed copy and edit lineage',()=>{
 const valid=normalizeImageInput({productId:id,data,settings});assert.equal(valid.settings.headline,'ПАНЕЛЬ');
 for(const value of [{...settings,sourceIds:[]},{...settings,sourceIds:[source,source]},{...settings,sourceIds:Array.from({length:5},()=>randomUUID())},{...settings,type:'unknown'},{...settings,accent:'javascript:'},{...settings,editOf:randomUUID(),changes:''}])assert.throws(()=>normalizeImageInput({productId:id,data,settings:value}));
 assert.equal(valid.inputHash,normalizeImageInput({productId:id,data:{...data,seoTitle:'Manual title',description:'Other text'},settings}).inputHash);
});
test('image prompt distinguishes product, style and edit references and forbids new claims',()=>{
 const plan:ImagePlan={version:'test',productId:id,productName:'Панель',settings:settings as any,facts:{name:'Панель'},references:[{asset:{id:source,kind:'source',name:'Источник',width:1536,height:1024,digest:'qa',bytes:100},role:'product'}],model:IMAGE_MODEL,size:IMAGE_SIZE,quality:IMAGE_QUALITY,prompt:''};plan.prompt=imagePrompt(plan);
 for(const phrase of ['PRESERVE THE REAL PRODUCT','buttons','connectors','mounting tabs','composition of components','STYLE ONLY','only new text allowed'])assert.ok(plan.prompt.includes(phrase));
 assert.ok(Number(estimateImage(plan))>0.04116);assert.ok(Number(estimateImage(plan))<.5);
});
test('image usage uses separate text/image/output rates and retains billed failures',()=>{
 assert.equal(imageUsageCost({textInputTokens:1000,imageInputTokens:8000,outputTokens:1372}),'0.11016000');
 const usage={input_tokens:30,input_tokens_details:{text_tokens:10,image_tokens:20},output_tokens:1372};
 assert.throws(()=>parseImageResponse({usage,data:[{b64_json:'not-valid'}]}),e=>e instanceof ImageProviderError&&e.usage?.imageInputTokens===20&&!e.free);
 const png=Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
 assert.equal(parseImageResponse({usage,data:[{b64_json:png}]}).usage?.outputTokens,1372);
 assert.equal(parseImageResponse({data:[{b64_json:png}]}).usage,null);
 assert.equal(parseImageResponse({usage:{...usage,input_tokens:200},data:[{b64_json:png}]}).usage,null);
});
test('image budget cannot exceed the separately approved five-dollar pilot cap',()=>{
 const keys=['AI_IMAGE_PROVIDER','AI_IMAGE_BUDGET_USD','AI_IMAGE_BUDGET_KEY'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.AI_IMAGE_PROVIDER='disabled';process.env.AI_IMAGE_BUDGET_KEY='pilot-2026-10-09';for(const [value,expected]of [['5','5.00000000'],['6','0.00000000'],['-1','0.00000000'],['bad','0.00000000']]){process.env.AI_IMAGE_BUDGET_USD=value;assert.equal(imageConfig().limitUsd,expected);}}
 finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('text API credentials alone never enable or authorize image generation',()=>{
 const keys=['AI_IMAGE_PROVIDER','AI_IMAGE_BUDGET_USD','AI_IMAGE_BUDGET_KEY','AI_IMAGE_API_KEY_CONFIGURED','AI_IMAGE_OPENAI_API_KEY','OPENAI_API_KEY'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.AI_IMAGE_PROVIDER='openai';process.env.AI_IMAGE_BUDGET_USD='1';process.env.AI_IMAGE_BUDGET_KEY='qa-image-key-separation';process.env.AI_IMAGE_API_KEY_CONFIGURED='false';process.env.AI_IMAGE_OPENAI_API_KEY='';process.env.OPENAI_API_KEY='text-only-qa-key';assert.equal(imageConfig().enabled,false);process.env.AI_IMAGE_API_KEY_CONFIGURED='true';assert.equal(imageConfig().enabled,true);}
 finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
