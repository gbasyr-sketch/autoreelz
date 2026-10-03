import {infographicFonts,type InfographicRecipe} from './product-infographic.ts';
type Measure=(text:string,size:number)=>number;
export function infographicText(recipe:InfographicRecipe,measure:Measure){
 function wrap(value:string,size:number){const rows:string[]=[];let tooWide=false;for(const word of value.split(/\s+/).filter(Boolean)){if(measure(word,size)>515)tooWide=true;const last=rows.length-1;if(last>=0&&measure(rows[last]+' '+word,size)<=515)rows[last]+=' '+word;else rows.push(word);}return{rows,tooWide};}
 function block(key:'title'|'subtitle'|'detail'){
  const config=infographicFonts[key],requested=recipe[`${key}Size`],automatic=requested===undefined;
  let size=requested??config.size,result=wrap(key==='title'?(recipe.title||'Название товара'):recipe[key],size);
  while(automatic&&(result.tooWide||result.rows.length>config.lines)&&size>Math.min(30,config.size)){size-=2;result=wrap(key==='title'?(recipe.title||'Название товара'):recipe[key],size);}
  return{size,rows:automatic?result.rows.slice(0,config.lines):result.rows,overflow:result.tooWide||(automatic&&result.rows.length>config.lines),automatic};
 }
 const title={...block('title'),y:220};
 const underlineY=Math.max(395,title.y+Math.max(0,title.rows.length-1)*(title.size+12)+23);
 const subtitle={...block('subtitle'),y:Math.max(455,underlineY+60)};
 const detailBlock=block('detail'),detail={...detailBlock,y:Math.max(550,subtitle.y+Math.max(0,subtitle.rows.length-1)*(subtitle.size+12)+Math.max(53,detailBlock.size+12))};
 const overflow=[title,subtitle,detail].some(b=>b.overflow||(b.rows.length>0&&b.y+(b.rows.length-1)*(b.size+12)+b.size*.25>910));
 return{title,subtitle,detail,underlineY,overflow};
}
