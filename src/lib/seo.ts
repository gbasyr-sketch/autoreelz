import type {CatalogSnapshot,CatalogProduct,Offer} from './catalog-types.ts';
import type {ContentSnapshot,Article} from './content.ts';
import {queryCatalog} from './catalog.ts';
import {paginate} from './pagination.ts';
import {articlePage} from './content.ts';
export const SITE_ORIGIN='https://autoreelz.ru';
export interface SeoSettings {indexing:boolean}
export interface SeoResult {canonical:string|null;indexable:boolean;title?:string;description?:string;structuredData:Record<string,unknown>[]}
export function indexingAllowed(input:{enabled:string;mode:string;appOrigin:string}){
 try{const url=new URL(input.appOrigin);return input.enabled==='true'&&input.mode==='production'&&url.origin===SITE_ORIGIN;}catch{return false;}
}
export function absoluteUrl(path:string){const u=new URL(path,SITE_ORIGIN);if(u.origin!==SITE_ORIGIN)throw Error('Foreign canonical origin');return u.href;}
export const safeJsonLd=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const clean=(s:string|undefined|null)=>s?.trim()||undefined;
const snippet=(s:string)=>s.replace(/\s+/g,' ').trim().slice(0,320);
export const realImage=(src:string|undefined)=>Boolean(src?.startsWith('/media/'));
export function realProduct(p:CatalogProduct,c:CatalogSnapshot){const offer=c.offerFor(p);return!p.isDemo&&Boolean(offer)&&realImage(offer?.variant?.image??p.image);}
export function breadcrumbs(items:{name:string;path:string}[]){return{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:items.map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:absoluteUrl(x.path)}))};}
export function schemaAttributes(attributes:Record<string,string>,c:CatalogSnapshot){return Object.entries(attributes).map(([key,value])=>({key,name:c.attributeDefinitions[key]?.label??key,value:c.attributeLabel(key,value)})).filter(a=>!/(?:неизвест|уточнить|демонстрацион)/i.test(a.value)&&a.value.trim()!=='');}
const productPath=(p:CatalogProduct)=>'/product/'+encodeURIComponent(p.slug);
function productNode(p:CatalogProduct,c:CatalogSnapshot,offer:Offer){
 const v=offer.variant,path=productPath(p)+(v?'?sku='+encodeURIComponent(v.id):'');
 const attrs=schemaAttributes(v?.attributes??p.attributes,c).map(a=>({'@type':'PropertyValue',name:a.name,value:a.value}));
 const image=v?.image??p.image;
 const standard=Object.fromEntries(schemaAttributes(v?.attributes??p.attributes,c).filter(a=>['color','size','material','pattern'].includes(a.key)).map(a=>[a.key,a.value]));
 return{...standard,'@type':'Product','@id':absoluteUrl(path)+'#product',name:p.name+(v?' — '+v.label:''),url:absoluteUrl(path),productID:v?.id??p.id,...(v?{sku:v.article}:{}),...(clean(p.description)?{description:p.description}:{}),...(realImage(image)?{image:absoluteUrl(image)}:{}),...(attrs.length?{additionalProperty:attrs}:{}),offers:{'@type':'Offer','@id':absoluteUrl(path)+'#offer',url:absoluteUrl(path),price:offer.priceRubles,priceCurrency:'RUB',availability:'https://schema.org/'+(offer.available>0?'InStock':'BackOrder')}};
}
export function productSchema(p:CatalogProduct,c:CatalogSnapshot,offer:Offer){
 if(p.kind==='single'&&p.variants.length>1){
  const variants=p.variants.flatMap(v=>{const o=c.offerFor(p,v.id);return o?[productNode(p,c,o)]:[];});
  const keys=[...new Set(p.variants.flatMap(v=>Object.keys(v.attributes)))].filter(k=>['color','size','material','pattern'].includes(k)&&new Set(p.variants.map(v=>v.attributes[k]??'')).size>1);
  return{'@context':'https://schema.org','@type':'ProductGroup','@id':absoluteUrl(productPath(p))+'#group',url:absoluteUrl(productPath(p)),name:p.name,productGroupID:p.id,...(clean(p.description)?{description:p.description}:{}),...(keys.length?{variesBy:keys.map(k=>'https://schema.org/'+k)}:{}),hasVariant:variants};
 }
 return{'@context':'https://schema.org',...productNode(p,c,offer)};
}
export function articleSchema(a:Article){return{'@context':'https://schema.org','@type':'Article','@id':absoluteUrl('/blog/'+a.slug)+'#article',url:absoluteUrl('/blog/'+a.slug),mainEntityOfPage:absoluteUrl('/blog/'+a.slug),headline:a.title,description:snippet(a.excerpt||a.body),inLanguage:'ru-RU',...(a.publishedAt?{datePublished:a.publishedAt}:{}),...(a.coverUrl?{image:absoluteUrl(a.coverUrl)}:{})};}
export function videoSchema(a:Article){
 const v=a.videoMetadata;if(!a.video||!v?.title||!v.description||!v.thumbnailUrl||!v.uploadedAt)return null;
 return{'@context':'https://schema.org','@type':'VideoObject',name:v.title,description:v.description,thumbnailUrl:[absoluteUrl(v.thumbnailUrl)],uploadDate:v.uploadedAt,embedUrl:a.video.embedUrl,...(v.durationSeconds?{duration:`PT${v.durationSeconds}S`}:{})};
}
function pagePath(path:string,page:number){return path+(page>1?(path.includes('?')?'&':'?')+'page='+page:'');}
export function pageSeo(url:URL,c:CatalogSnapshot,content:ContentSnapshot,settings:SeoSettings):SeoResult{
 const path=url.pathname.replace(/\/$/,'')||'/',params=url.searchParams;
 const result:SeoResult={canonical:null,indexable:false,structuredData:[]};
 let eligible=false;
 const set=(p:string)=>result.canonical=absoluteUrl(p);
 if(path==='/'){set('/');eligible=true;}
 else if(path==='/catalog'){
  const data=queryCatalog(params,c),page=paginate(data.items,params.get('page'));
  if(data.error||page.invalid)return result;
  const base='/catalog'+(data.category?'?category='+encodeURIComponent(data.category.slug):'');
  const filtered=[...params.keys()].some(k=>!['category','page'].includes(k));
  set(pagePath(base,page.page));eligible=!filtered&&page.items.some(x=>realProduct(x.product,c));
  result.title=clean(data.category?.seoTitle);result.description=clean(data.category?.metaDescription)??(data.category?`${data.category.name} — каталог AUTO REELZ. Исполнения, цены и проверка совместимости.`:undefined);
  result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:'Каталог',path:'/catalog'},...(data.category?[{name:data.category.name,path:base}]:[])]));
 }else if(path.startsWith('/product/')){
  const p=c.products.find(p=>productPath(p)===path),offer=p?c.offerFor(p,params.get('sku')):null;if(!p||!offer)return result;
  set(productPath(p));eligible=realProduct(p,c)&&[...params.keys()].every(k=>k==='sku');
  result.title=clean(p.seoTitle);result.description=clean(p.metaDescription)??snippet(p.description||`${p.name}. Исполнения, цена и совместимость в AUTO REELZ.`);
  const cat=c.categories.find(x=>x.slug===p.category),parents=cat?[...cat.ancestorSlugs,cat.slug].flatMap(slug=>{const a=c.categories.find(x=>x.slug===slug);return a?[{name:a.name,path:'/catalog?category='+a.slug}]:[]}):[];
  result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:'Каталог',path:'/catalog'},...parents,{name:p.name,path:productPath(p)}]),productSchema(p,c,offer));
 }else if(path.startsWith('/info/')){
  const p=content.pages.find(p=>'/info/'+p.slug===path);if(!p)return result;set(path);eligible=!p.isDraftText&&!params.size;result.title=clean(p.seoTitle);result.description=clean(p.metaDescription)??snippet(p.summary||p.body);result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:p.title,path}]));
 }else if(path==='/blog'||path.startsWith('/blog/category/')||path.startsWith('/blog/tag/')){
  const cat=path.startsWith('/blog/category/')?content.categories.find(x=>'/blog/category/'+x.slug===path):null;
  const tag=path.startsWith('/blog/tag/')?content.tags.find(x=>'/blog/tag/'+x.slug===path):null;
  if(path!=='/blog'&&!cat&&!tag)return result;
  const matching=content.articles.filter(a=>(!cat||a.category.id===cat.id)&&(!tag||a.tags.some(t=>t.id===tag.id))),page=articlePage(matching,params.get('page'));
  if(page.error)return result;set(pagePath(path,page.page));eligible=[...params.keys()].every(k=>k==='page')&&page.items.some(a=>!a.isDemo&&clean(a.body));
  result.description=`${cat?.name??(tag?'Материалы с тегом «'+tag.name+'»':'Блог AUTO REELZ')}: статьи о подборе деталей и работе магазина.`;
  result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:'Блог',path:'/blog'},...(cat||tag?[{name:cat?.name??tag!.name,path}]:[])]));
 }else if(path.startsWith('/blog/')){
  const a=content.articles.find(a=>'/blog/'+a.slug===path);if(!a)return result;set(path);eligible=!a.isDemo&&Boolean(clean(a.body))&&!params.size;result.title=clean(a.seoTitle);result.description=clean(a.metaDescription)??snippet(a.excerpt||a.body);
  result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:'Блог',path:'/blog'},{name:a.category.name,path:'/blog/category/'+a.category.slug},{name:a.title,path}]),articleSchema(a));
  const video=videoSchema(a);if(video)result.structuredData.push(video);
 }else if(path==='/cars'){set(path);eligible=false;}
 else if(path.startsWith('/cars/')){
  const v=c.vehicles.find(v=>'/cars/'+v.slug===path);if(!v)return result;set(path);
  // Current vehicle pages are filter tools, not editorial SEO landing pages.
  eligible=false;result.description=`Подбор деталей для ${v.name}: уточните год, модификацию и кондиционер. Неподтверждённая совместимость требует проверки.`;
  result.structuredData.push(breadcrumbs([{name:'Главная',path:'/'},{name:'Автомобили',path:'/cars'},{name:v.name,path}]));
 }
 result.indexable=settings.indexing&&eligible;return result;
}
export function sitemapPaths(c:CatalogSnapshot,content:ContentSnapshot){
 const candidates=new Set<string>(['/','/catalog','/blog']);
 const catBases=['/catalog',...c.categories.map(x=>'/catalog?category='+x.slug)];
 for(const path of catBases){const data=queryCatalog(new URL(path,SITE_ORIGIN).searchParams,c),pages=paginate(data.items,null).totalPages;for(let n=1;n<=pages;n++)candidates.add(pagePath(path,n));}
 for(const p of c.products)candidates.add(productPath(p));for(const p of content.pages)candidates.add('/info/'+p.slug);for(const a of content.articles)candidates.add('/blog/'+a.slug);
 const blogBases=['/blog',...content.categories.map(x=>'/blog/category/'+x.slug),...content.tags.map(x=>'/blog/tag/'+x.slug)];
 for(const path of blogBases){const cat=content.categories.find(x=>path==='/blog/category/'+x.slug),tag=content.tags.find(x=>path==='/blog/tag/'+x.slug);const list=content.articles.filter(a=>(!cat||a.category.id===cat.id)&&(!tag||a.tags.some(t=>t.id===tag.id)));for(let n=1;n<=articlePage(list,null).totalPages;n++)candidates.add(pagePath(path,n));}
 return [...candidates].filter(path=>pageSeo(new URL(path,SITE_ORIGIN),c,content,{indexing:true}).indexable).sort();
}
export function xml(value:unknown){return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[ch]!));}
export function renderSitemap(paths:string[]){return'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map(path=>'<url><loc>'+xml(absoluteUrl(path))+'</loc></url>').join('')+'</urlset>\n';}
