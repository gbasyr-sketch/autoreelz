export {formatRubles as money} from './money.ts';
export function productHref(product:{slug:string},variant?:{id:string}){return `/product/${encodeURIComponent(product.slug)}${variant?`?sku=${encodeURIComponent(variant.id)}`:''}`;}
export function attributeParam(key:string){return `attr.${key}`;}

const reservedFilterKeys=new Set(['category','q','vehicle','version','year','ac','min','max','availability','sort','include_unknown']);
export function attributeValue(params:URLSearchParams,key:string){return params.get(attributeParam(key))??(reservedFilterKeys.has(key)?null:params.get(key));}
