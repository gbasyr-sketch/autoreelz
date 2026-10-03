import type {InfographicRecipe} from './product-infographic.ts';
import Decimal from 'decimal.js';
import {sumRubles,multiplyRubles,discountRubles,parseRublesInput} from './money.ts';

export type EditorPhoto={id:string;alt:string};
export type EditorAttribute={attributeId:string;value:string};
export type EditorFitment={vehicleId:string;versionId:string;yearFrom:string;yearTo:string;ac:string;state:string;note:string};
export type EditorPackage={weightG:string;lengthCm:string;widthCm:string;heightCm:string};
export type EditorVariant={id:string;name:string;article:string;price:string;status:'published'|'draft'|'archived';package:EditorPackage;initialStock:string;stockReason:string;photos:EditorPhoto[];mediaMode:'inherit'|'replace';attributes:EditorAttribute[];fitment:EditorFitment[];fitmentMode:'inherit'|'replace'};
export type BundleComponent={skuId:string;quantity:string};
export type BundleSku={id:string;productId:string;productName:string;name:string;article:string;price:string;available:number;published:boolean;imageId:string|null;hasPackage:boolean};
export type EditorData={kind?:'single'|'bundle';components?:BundleComponent[];discountPercent?:string;recommendedProductIds?:string[];infographic?:InfographicRecipe|null;name:string;slug:string;categoryId:string;description:string;seoTitle:string;metaDescription:string;isDemo:boolean;photos:EditorPhoto[];attributes:EditorAttribute[];fitment:EditorFitment[];variants:EditorVariant[]};
export type EditorIssue={path:string;message:string};
export type EditorOptions={bundleSkus?:BundleSku[];products?:{id:string;name:string;status:string}[];categories:{id:string;name:string;parentId:string|null;status:string}[];attributes:{id:string;name:string;type:string;unit:string|null;categoryIds:string[];values:{id:string;label:string}[]}[];vehicles:{id:string;name:string;versions:{id:string;name:string}[]}[]};
export type EditorState={archived?:boolean;liveStatus?:string;id:string;version:number;baseHash:string|null;data:EditorData;hasDraft:boolean;live:boolean;liveSlug?:string;existingSkuIds:string[];stock:Record<string,{onHand:number;reserved:number}>};
export const emptyPackage=():EditorPackage=>({weightG:'',lengthCm:'',widthCm:'',heightCm:''});
export const emptyVariant=(id:string):EditorVariant=>({id,name:'',article:'',price:'',status:'published',package:emptyPackage(),initialStock:'0',stockReason:'',photos:[],mediaMode:'inherit',attributes:[],fitment:[],fitmentMode:'inherit'});
export const emptyProduct=():EditorData=>({recommendedProductIds:[],infographic:null,name:'',slug:'',categoryId:'',description:'',seoTitle:'',metaDescription:'',isDemo:false,photos:[],attributes:[],fitment:[],variants:[]});
export function productSlug(value:string){const letters:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};return [...value.toLowerCase()].map(c=>letters[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150).replace(/-$/,'');}
export function packageValues(p:EditorPackage){
 const positive=(raw:string,scale:number,max:number)=>{if(!/^\d+(?:[.,]\d)?$/.test(raw.trim()))throw new Error('Укажите положительное число');const n=new Decimal(raw.replace(',','.')).times(scale);if(!n.isInteger()||n.lte(0)||n.gt(max))throw new Error('Некорректный размер');return n.toNumber();};
 return {weightG:positive(p.weightG,1,1000000),lengthMm:positive(p.lengthCm,10,100000),widthMm:positive(p.widthCm,10,100000),heightMm:positive(p.heightCm,10,100000)};
}
export const hasPackage=(p:EditorPackage)=>Object.values(p).some(v=>v.trim());
export function publicationIssues(data:EditorData,existingIds:string[]=[]):EditorIssue[]{
 const issues:EditorIssue[]=[];const add=(path:string,message:string)=>issues.push({path,message});
 if(!data.name.trim())add('name','Укажите название товара.');
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.slug))add('slug','Адрес: латинские буквы, цифры и дефисы.');
 if(!data.categoryId)add('categoryId','Выберите категорию.');
 if(!data.photos.length)add('photos','Добавьте хотя бы одну общую фотографию товара.');
 if(data.kind==='bundle'){
  if(data.variants.length)add('components','У комплекта нет собственных исполнений и остатков.');
  if(!data.components?.length)add('components','Добавьте хотя бы одно исполнение в состав комплекта.');
  const ids=new Set<string>();for(const [i,c] of (data.components??[]).entries()){if(!c.skuId||ids.has(c.skuId))add('components','Исполнения в составе не должны повторяться.');ids.add(c.skuId);if(!/^\d+$/.test(c.quantity)||Number(c.quantity)<1||Number(c.quantity)>10000)add(`components.${i}.quantity`,'Укажите целое количество от 1 до 10 000.');}
  try{bundleDiscount(data.discountPercent??'0');}catch{add('discountPercent','Скидка — от 0 до 100%, до двух знаков после запятой.');}
 }
 if(data.kind!=='bundle'&&!data.variants.some(v=>v.status==='published'))add('variants','Добавьте хотя бы одно опубликованное исполнение.');
 const articles=new Set<string>();
 data.variants.forEach((v,i)=>{const path=`variants.${i}`;
  if(!v.name.trim())add(path+'.name','Укажите название исполнения.');
  if(!v.article.trim())add(path+'.article','Укажите ваш артикул.');else if(articles.has(v.article.trim().toLowerCase()))add(path+'.article','Артикулы исполнений должны различаться.');articles.add(v.article.trim().toLowerCase());
  try{const price=parseRublesInput(v.price);if(v.status==='published'&&new Decimal(price).lte(0))throw Error();}catch{add(path+'.price','Укажите цену в рублях больше нуля, до двух знаков после запятой.');}
  if(hasPackage(v.package))try{packageValues(v.package);}catch{add(path+'.package','Заполните все размеры в сантиметрах и целый вес в граммах; значения должны быть больше нуля.');}
  if(!/^\d+$/.test(v.initialStock)||Number(v.initialStock)>100000)add(path+'.initialStock','Укажите целое количество от 0 до 100 000.');
  else if(existingIds.includes(v.id)&&Number(v.initialStock)!==0)add(path+'.initialStock','Остаток существующего исполнения изменяется на складе.');
  else if(Number(v.initialStock)>0&&v.stockReason.trim().length<3)add(path+'.stockReason','Укажите причину начального прихода.');
  if(v.mediaMode==='replace'&&!v.photos.length)add(path+'.photos','Добавьте фотографии исполнения или выберите общую галерею.');
 });
 const fit=(rows:EditorFitment[],prefix:string)=>rows.forEach((f,i)=>{if(!f.vehicleId)add(`${prefix}.${i}.vehicleId`,'Выберите автомобиль.');const a=f.yearFrom,b=f.yearTo;for(const[key,value]of [['yearFrom',a],['yearTo',b]])if(value&&(!/^\d{4}$/.test(value)||Number(value)<1970||Number(value)>2100))add(`${prefix}.${i}.${key}`,'Укажите год от 1970 до 2100 или оставьте пустым.');if(a&&b&&Number(a)>Number(b))add(`${prefix}.${i}.yearTo`,'Конечный год не может быть меньше начального.');});
 fit(data.fitment,'fitment');data.variants.forEach((v,i)=>fit(v.fitment,`variants.${i}.fitment`));
 const attrs=(rows:EditorAttribute[],prefix:string)=>rows.forEach((a,i)=>{if(!a.attributeId)add(`${prefix}.${i}.attributeId`,'Выберите характеристику.');if(!a.value)add(`${prefix}.${i}.value`,'Укажите значение характеристики.');});attrs(data.attributes,'attributes');data.variants.forEach((v,i)=>attrs(v.attributes,`variants.${i}.attributes`));return issues;
}

export function bundleDiscount(value:string){if(!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim()))throw Error('Некорректная скидка');const n=new Decimal(value.replace(',','.'));if(n.gt(100))throw Error('Некорректная скидка');return n.times(100).toNumber();}
export function bundleTotals(data:Pick<EditorData,'components'|'discountPercent'>,skus:BundleSku[]){
 const components=data.components??[];if(!components.length)throw Error('Добавьте состав');
 const selected=components.map(c=>{const sku=skus.find(s=>s.id===c.skuId);if(!sku||!/^\d+$/.test(c.quantity)||Number(c.quantity)<1||Number(c.quantity)>10000)throw Error('Проверьте состав');return{sku,quantity:Number(c.quantity)};});
 const subtotal=sumRubles(selected.map(c=>multiplyRubles(c.sku.price,c.quantity)));
 return{subtotal,total:discountRubles(subtotal,bundleDiscount(data.discountPercent??'0')),available:Math.min(...selected.map(c=>c.sku.published?Math.max(0,Math.floor(c.sku.available/c.quantity)):0)),published:selected.every(c=>c.sku.published),packaged:selected.every(c=>c.sku.hasPackage)};
}
