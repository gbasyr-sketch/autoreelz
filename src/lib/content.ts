export interface VideoEmbed {provider:'VK Видео'|'RUTUBE';embedUrl:string;watchUrl:string}
/** Only URL data is accepted; pasted HTML is never parsed or rendered. */
export function normalizeVideoUrl(input:unknown):VideoEmbed|null {
 if(typeof input!=='string'||input.length>2048||/[<>\\\u0000-\u0020]/.test(input.trim()))return null;
 let url:URL;try{url=new URL(input.trim());}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
 if(['vk.com','vk.ru','vkvideo.ru'].includes(url.hostname)&&url.pathname==='/video_ext.php'){
  const oid=url.searchParams.get('oid'),id=url.searchParams.get('id'),hash=url.searchParams.get('hash');
  if(!oid||!/^-[1-9]\d{0,19}$|^[1-9]\d{0,19}$/.test(oid)||!id||!/^[1-9]\d{0,19}$/.test(id)||!hash||!/^[A-Za-z0-9_-]{8,128}$/.test(hash))return null;
  if(['oid','id','hash'].some(key=>url.searchParams.getAll(key).length!==1))return null;
  const embed=new URL(`https://${url.hostname}/video_ext.php`);embed.searchParams.set('oid',oid);embed.searchParams.set('id',id);embed.searchParams.set('hash',hash);embed.searchParams.set('autoplay','0');
  return{provider:'VK Видео',embedUrl:embed.href,watchUrl:`https://${url.hostname}/video${oid}_${id}`};
 }
 if(url.hostname==='rutube.ru'){
  const match=url.pathname.match(/^\/(?:video|shorts|play\/embed)\/([a-fA-F0-9]{32})\/?$/);if(!match)return null;
  const id=match[1]!.toLowerCase();
  return{provider:'RUTUBE',embedUrl:`https://rutube.ru/play/embed/${id}?autoplay=false`,watchUrl:`https://rutube.ru/video/${id}/`};
 }
 return null;
}
export function textParagraphs(body:string):string[]{return body.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);}
export interface ContentPage {id:string;slug:string;title:string;body:string;summary:string;seoTitle:string|null;metaDescription:string|null;isLegal:boolean;isDraftText:boolean}
export interface BlogCategory {id:string;slug:string;name:string}
export interface BlogTag {id:string;slug:string;name:string}
export interface Article {id:string;slug:string;title:string;excerpt:string;body:string;category:BlogCategory;tags:BlogTag[];video:VideoEmbed|null;invalidVideo:boolean;coverUrl:string|null;seoTitle:string|null;metaDescription:string|null;isDemo:boolean;publishedAt:string|null}
export type ContentEntity='page'|'article'|'blog_category'|'blog_tag';
export interface ContentSnapshot {pages:ContentPage[];articles:Article[];categories:BlogCategory[];tags:BlogTag[];slugs:{entity_type:ContentEntity;entity_id:string;slug:string}[]}
export function resolveContent(content:ContentSnapshot,type:ContentEntity,slug:string){
 const records=type==='page'?content.pages:type==='article'?content.articles:type==='blog_category'?content.categories:content.tags;
 const current=records.find(item=>item.slug===slug);if(current)return{id:current.id,slug:current.slug,redirect:false};
 const claimed=content.slugs.find(item=>item.entity_type===type&&item.slug===slug);const target=claimed&&records.find(item=>item.id===claimed.entity_id);
 return target?{id:target.id,slug:target.slug,redirect:true}:null;
}
export function articlePage(articles:Article[],raw:string|null,size=12){
 if(raw!==null&&!/^[1-9]\d{0,5}$/.test(raw))return{items:[],page:1,totalPages:1,error:true};
 const page=raw?Number(raw):1,totalPages=Math.max(1,Math.ceil(articles.length/size));
 return{items:articles.slice((page-1)*size,page*size),page,totalPages,error:page>totalPages};
}
export const contentDate=(iso:string)=>new Intl.DateTimeFormat('ru-RU',{year:'numeric',month:'long',day:'numeric',timeZone:'Europe/Moscow'}).format(new Date(iso));
