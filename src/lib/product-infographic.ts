export type InfographicPhoto={sourceId:string;cutoutId:string;scale:number;x:number;y:number};
export type InfographicRecipe={version:1;style:'light'|'graphite'|'accent';accent:string;title:string;subtitle:string;detail:string;photos:InfographicPhoto[]};
export function newInfographic(title=''):InfographicRecipe{return{version:1,style:'accent',accent:'#cb181a',title:title.slice(0,70),subtitle:'',detail:'',photos:[]};}
export function normalizeInfographic(value:unknown):InfographicRecipe|null{
 if(value===undefined||value===null)return null;
 const x=value as InfographicRecipe,id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('Неверная надпись инфографики.');return v.trim();};
 if(typeof x!=='object'||x.version!==1||!['light','graphite','accent'].includes(x.style)||!/^#[a-f0-9]{6}$/i.test(x.accent)||!Array.isArray(x.photos)||x.photos.length>2)throw Error('Неверные настройки инфографики.');
 const photos=x.photos.map(p=>{if(!p||!id.test(p.sourceId)||typeof p.cutoutId!=='string'||p.cutoutId&&!id.test(p.cutoutId)||![p.scale,p.x,p.y].every(Number.isFinite)||p.scale<50||p.scale>130||Math.abs(p.x)>15||Math.abs(p.y)>15)throw Error('Неверное положение фотографии.');return{sourceId:p.sourceId,cutoutId:p.cutoutId,scale:p.scale,x:p.x,y:p.y};});
 return{version:1,style:x.style,accent:x.accent,title:text(x.title,70),subtitle:text(x.subtitle,70),detail:text(x.detail,70),photos};
}
export function infographicFileIds(recipe:InfographicRecipe|null|undefined){return [...new Set(recipe?.photos.flatMap(p=>[p.sourceId,...(p.cutoutId?[p.cutoutId]:[])])??[])];}
