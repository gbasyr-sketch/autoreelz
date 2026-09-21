import type{APIContext}from'astro';
import{getSession}from'./security.ts';
import{StoreError}from'./errors.ts';
export const sessionFor=(ctx:APIContext)=>ctx.locals.shopSession?Promise.resolve(ctx.locals.shopSession):getSession(ctx);
export function json(data:unknown,status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
export function failure(error:unknown){if(error instanceof StoreError)return json({error:{code:error.code,message:error.message}},error.status);console.error('Store operation failed',String((error as {code?:string})?.code??'internal'));return json({error:{code:'INTERNAL',message:'Не удалось выполнить действие. Повторите запрос с теми же данными.'}},500);}
export function peer(ctx:APIContext){try{return ctx.clientAddress??'local';}catch{return'local';}}
