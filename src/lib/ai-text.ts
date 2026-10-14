import type {EditorData} from './product-editor.ts';
export type AIProvider='deepseek'|'openai';
export type AITextModel='deepseek-flash'|'gpt-6-luna'|'gpt-6.1-sol';
export type AITextRevision={requestId:string;description:string;metaDescription:string;instruction:string};
export type AITextResult={description:string;metaDescription:string};
export type AIUsage={inputTokens:number;outputTokens:number};
export type AITextStatus={actorId?:string;enabled:boolean;provider:AIProvider;model:string;providers:AIProvider[];models?:{provider:AIProvider;model:AITextModel;label:string}[];month:string;limitUsd:string;usedUpperUsd:string;remainingUsd:string;uncertainCount:number};
export type AITextRequest={id:string;state:'running'|'completed'|'failed'|'uncertain';provider:AIProvider;model:string;sourceHash:string;costUpperUsd:string;result:AITextResult|null;message:string;status:AITextStatus};
/** Only this allowlist may leave the store; never prices, stock, photos or SEO title. */
export function aiSource(data:EditorData,notes:string){return{
 name:data.name.trim(),categoryId:data.categoryId,isDemo:data.isDemo,
 attributes:data.attributes,fitment:data.fitment,
 variants:data.variants.filter(v=>v.status!=='archived').map(v=>({id:v.id,name:v.name.trim(),article:v.article.trim(),attributes:v.attributes,fitmentMode:v.fitmentMode,fitment:v.fitment})),
 notes:notes.trim(),
};}
export const aiSourceSignature=(data:EditorData,notes:string)=>JSON.stringify(aiSource(data,notes));
