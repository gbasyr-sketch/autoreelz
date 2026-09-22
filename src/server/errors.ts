export class StoreError extends Error {code:string;status:number;constructor(code:string,message:string,status=400){super(message);this.code=code;this.status=status;}}
export const uuid=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new StoreError('INVALID_ID','Некорректный идентификатор.');return value.toLowerCase();};
export function text(value:unknown,label:string,min=1,max=250){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u001f]/.test(value))throw new StoreError('INVALID_INPUT',`Проверьте поле «${label}».`);return value.trim();}
export function multilineText(value:unknown,label:string,min=1,max=10000){
 if(typeof value!=='string')throw new StoreError('INVALID_INPUT',`Проверьте поле «${label}».`);
 const result=value.replace(/\r\n?/g,'\n').trim();
 if(result.length<min||result.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result))throw new StoreError('INVALID_INPUT',`Проверьте поле «${label}».`);
 return result;
}
export function integer(value:unknown,label:string,min=0,max=Number.MAX_SAFE_INTEGER){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new StoreError('INVALID_INPUT',`Проверьте поле «${label}».`);return value;}
export function email(value:unknown){const e=text(value,'Email',3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw new StoreError('INVALID_EMAIL','Укажите корректный email.');return e;}
export const iso=(value:Date|string|null)=>value===null?null:new Date(value).toISOString();
