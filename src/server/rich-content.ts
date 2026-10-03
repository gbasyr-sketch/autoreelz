import sanitizeHtml from 'sanitize-html';
import {articleBlocks,textLinks,textParagraphs} from '../lib/content.ts';
const id='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function contentImageId(src:string){return(src.match(new RegExp(`^/media/(${id})$`,'i'))??src.match(new RegExp(`^/api/manager/product-image\\?id=(${id})$`,'i')))?.[1]?.toLowerCase()??null;}
export function safeRichHtml(body:string){return sanitizeHtml(body,{
 allowedTags:['p','br','h2','h3','strong','b','em','i','u','s','ul','ol','li','blockquote','a','img','pre','code'],
 allowedAttributes:{a:['href','target','rel'],img:['src','alt','width'],p:['class','style'],h2:['class','style'],h3:['class','style'],li:['class','style'],ol:['start']},
 allowedClasses:{'*':['ql-align-center','ql-align-right','ql-align-justify','ql-indent-1','ql-indent-2','ql-indent-3','ql-indent-4','ql-indent-5','ql-indent-6','ql-indent-7','ql-indent-8']},
 allowedStyles:{'*':{'text-align':[/^(?:left|center|right|justify)$/]}},
 allowedSchemes:['https','http','mailto','tel'],allowProtocolRelative:false,
 nonTextTags:['script','style','textarea','option','iframe','svg','math','object','embed'],
 transformTags:{a:(_tag,a)=>({tagName:'a',attribs:{href:a.href??'',target:'_blank',rel:'noopener noreferrer'}}),img:(_tag,a)=>{const file=contentImageId(a.src??'');return{tagName:'img',attribs:file?{src:'/media/'+file,alt:(a.alt??'').slice(0,500),...(['50%','75%','100%'].includes(a.width??'')?{width:a.width!}:{})}:{}};}},
 exclusiveFilter:frame=>frame.tag==='img'&&!frame.attribs.src,
});}
export function contentImageIds(body:string){return [...new Set([...safeRichHtml(body).matchAll(new RegExp(`<img\\b[^>]*\\bsrc="/media/(${id})"`,'gi'))].map(m=>m[1]!.toLowerCase()))];}
export function contentHtml(body:string,format:string='plain',kind:'page'|'article'='article'){
 if(format==='html')return safeRichHtml(body);
 const blocks=kind==='article'?articleBlocks(body):textParagraphs(body).map(text=>({text,heading:false}));
 return blocks.map(b=>{const tag=b.heading?'h2':'p',text=kind==='article'?textLinks(b.text).map(p=>p.href?`<a href="${escapeHtml(p.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.text)}</a>`:escapeHtml(p.text)).join(''):escapeHtml(b.text);return`<${tag}>${text.replace(/\n/g,'<br>')}</${tag}>`;}).join('');
}
export function previewContentHtml(body:string){return safeRichHtml(body).replace(new RegExp(`(<img\\b[^>]*\\bsrc=")/media/(${id})"`,'gi'),'$1/api/manager/product-image?id=$2"');}

export function richContentText(body:string){const stripped=sanitizeHtml(safeRichHtml(body).replace(/<\/(?:p|h2|h3|li|blockquote)>|<br\s*\/?>/g,'\n\n'),{allowedTags:[],allowedAttributes:{}});return stripped.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();}
