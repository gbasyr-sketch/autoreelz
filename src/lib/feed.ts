import type {CatalogSnapshot} from './catalog-types.ts';
import {SITE_ORIGIN,absoluteUrl,xml,realImage,schemaAttributes} from './seo.ts';
export function feedOffers(c:CatalogSnapshot){
 return c.products.filter(p=>!p.isDemo).flatMap(p=>{
  const variants=p.kind==='bundle'?[null]:p.variants;
  return variants.flatMap(v=>{const offer=c.offerFor(p,v?.id),image=v?.image??p.image;
   if(!offer||!realImage(image))return[];
   const category=c.categories.find(x=>x.slug===p.category);if(!category?.feedId)return[];
   return[{id:v?.id??p.id,productId:p.id,name:p.name+(v?' — '+v.label:''),article:v?.article??null,url:absoluteUrl('/product/'+p.slug+(v?'?sku='+v.id:'')),price:offer.priceRubles,available:offer.available>0,categoryId:category.feedId,picture:absoluteUrl(image),description:p.description,attributes:schemaAttributes(v?.attributes??p.attributes,c).map(({name,value})=>({name,value}))}];
  });
 });
}
export function renderYml(c:CatalogSnapshot,company:string,generatedAt=new Date()){
 if(!company.trim()||!Number.isFinite(generatedAt.getTime()))throw new Error('Feed requires an approved company name and a valid timestamp');
 const offers=feedOffers(c);
 const numericIds=new Map(c.categories.map(cat=>[cat.id,cat.feedId]));
 if(c.categories.some(cat=>!cat.feedId||!/^([1-9][0-9]{0,17})$/.test(cat.feedId)))throw new Error('YML category requires a stable numeric feed_id');
 const categories=c.categories.map(cat=>`<category id="${xml(cat.feedId)}"${cat.parentId?` parentId="${xml(numericIds.get(cat.parentId))}"`:''}>${xml(cat.name)}</category>`).join('');
 const rows=offers.map(o=>`<offer id="${xml(o.id)}" available="${o.available}"><name>${xml(o.name)}</name><url>${xml(o.url)}</url><price>${xml(o.price)}</price><currencyId>RUB</currencyId><categoryId>${xml(o.categoryId)}</categoryId><picture>${xml(o.picture)}</picture>${o.article?`<param name="Артикул">${xml(o.article)}</param>`:''}<description>${xml(o.description)}</description>${!o.available?'<sales_notes>Предзаказ. Срок и условия согласуются до оплаты.</sales_notes>':''}${o.attributes.map(a=>`<param name="${xml(a.name)}">${xml(a.value)}</param>`).join('')}</offer>`).join('');
 return`<?xml version="1.0" encoding="UTF-8"?>\n<yml_catalog date="${generatedAt.toISOString()}"><shop><name>AUTO REELZ</name><company>${xml(company.trim())}</company><url>${SITE_ORIGIN}</url><currencies><currency id="RUB" rate="1"/></currencies><categories>${categories}</categories><offers>${rows}</offers></shop></yml_catalog>\n`;
}
