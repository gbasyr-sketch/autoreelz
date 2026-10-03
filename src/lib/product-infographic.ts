import {backgroundShapes,type BackgroundShape} from './infographic-background.ts';
export type InfographicPhoto={sourceId:string;cutoutId:string;scale:number;x:number;y:number};
export const infographicFonts={title:{size:64,max:120,lines:3},subtitle:{size:30,max:80,lines:2},detail:{size:26,max:80,lines:2}} as const;
export const photoScale={min:10,max:300},photoOffsetLimit=500;
export type InfographicRecipe={version:1;style:'light'|'graphite'|'accent';shape?:BackgroundShape;accent:string;title:string;subtitle:string;detail:string;titleSize?:number;subtitleSize?:number;detailSize?:number;photos:InfographicPhoto[]};
export function newInfographic(title=''):InfographicRecipe{return{version:1,style:'accent',accent:'#cb181a',title:title.slice(0,70),subtitle:'',detail:'',photos:[]};}
export function normalizeInfographic(value:unknown):InfographicRecipe|null{
 if(value===undefined||value===null)return null;
 const x=value as InfographicRecipe,id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('Неверная надпись инфографики.');return v.trim();};
 if(typeof x!=='object'||x.version!==1||!['light','graphite','accent'].includes(x.style)||!/^#[a-f0-9]{6}$/i.test(x.accent)||!Array.isArray(x.photos)||x.photos.length>2||x.shape!==undefined&&!backgroundShapes.some(s=>s.value===x.shape))throw Error('Неверные настройки инфографики.');
 const sizes:Partial<Pick<InfographicRecipe,'titleSize'|'subtitleSize'|'detailSize'>>={};
 for(const key of ['title','subtitle','detail'] as const){const field=`${key}Size` as const,value=x[field];if(value!==undefined){if(!Number.isInteger(value)||value<12||value>infographicFonts[key].max)throw Error('Неверный размер текста.');sizes[field]=value;}}
 const photos=x.photos.map(p=>{if(!p||!id.test(p.sourceId)||typeof p.cutoutId!=='string'||p.cutoutId&&!id.test(p.cutoutId)||![p.scale,p.x,p.y].every(Number.isFinite)||p.scale<photoScale.min||p.scale>photoScale.max||Math.abs(p.x)>photoOffsetLimit||Math.abs(p.y)>photoOffsetLimit)throw Error('Неверное положение фотографии.');return{sourceId:p.sourceId,cutoutId:p.cutoutId,scale:p.scale,x:p.x,y:p.y};});
 return{version:1,style:x.style,...(x.shape!==undefined?{shape:x.shape}:{}),accent:x.accent,title:text(x.title,70),subtitle:text(x.subtitle,70),detail:text(x.detail,70),...sizes,photos};
}
export function infographicFileIds(recipe:InfographicRecipe|null|undefined){return [...new Set(recipe?.photos.flatMap(p=>[p.sourceId,...(p.cutoutId?[p.cutoutId]:[])])??[])];}
