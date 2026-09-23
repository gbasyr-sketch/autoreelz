import {rubles} from '../lib/money.ts';
import {transaction} from './db.ts';
import {createCatalogSnapshot,type CatalogSnapshot,type CatalogProduct,type CatalogVariant,type Category,type CatalogMedia,type FitmentRule,type AttributeDefinition} from '../lib/catalog-types.ts';

type Row=Record<string,any>;
const fallbackImage='/images/placeholder-console.svg';
/** One repeatable-read request snapshot: CMS changes are visible on the next request. */
export async function getCatalog():Promise<CatalogSnapshot>{
 return transaction(async client=>{
  const tables=['ar_categories','ar_products','ar_skus','ar_stock','ar_attributes','ar_attribute_values','ar_category_attributes','ar_product_attributes','ar_sku_attributes','ar_product_media','ar_sku_media','ar_fitment','ar_bundle_components','ar_vehicles','ar_vehicle_versions','ar_product_categories'] as const;
  const rows={} as Record<typeof tables[number],Row[]>;
  // One pg client executes sequentially; the transaction keeps all tables consistent.
  for(const table of tables)rows[table]=(await client.query(`SELECT * FROM ${table}`)).rows;
  const categories:Category[]=[];
  const categorySource=rows.ar_categories.filter(r=>r.status==='published');
  const visit=(parentId:string|null,ancestors:string[])=>{if(ancestors.length>=3)return;for(const r of categorySource.filter(r=>r.parent_id===parentId).sort(bySort)){
   categories.push({feedId:r.feed_id?String(r.feed_id):undefined,id:r.id,parentId:r.parent_id,slug:r.slug,name:r.name,shortName:r.name,icon:'box',depth:ancestors.length,ancestorSlugs:ancestors,attributes:[],seoTitle:r.seo_title??undefined,metaDescription:r.meta_description??undefined});visit(r.id,[...ancestors,r.slug]);
  }};visit(null,[]);
  const attributeDefinitions:Record<string,AttributeDefinition>=Object.create(null);
  for(const r of rows.ar_attributes.sort(bySort))attributeDefinitions[r.code]={id:r.id,label:r.name,type:r.value_type,unit:r.unit,filterable:r.filterable,values:rows.ar_attribute_values.filter(v=>v.attribute_id===r.id).sort(bySort).map(v=>({value:v.code,label:v.label,...(v.color?{color:v.color}:{})}))};
  for(const category of categories){const ids=categories.filter(c=>c.id===category.id||category.ancestorSlugs.includes(c.slug)).map(c=>c.id);category.attributes=[...new Set(rows.ar_category_attributes.filter(r=>ids.includes(r.category_id)&&r.show_filter).sort(bySort).map(r=>rows.ar_attributes.find(a=>a.id===r.attribute_id)).filter(r=>r?.filterable).map(r=>r!.code))];}
  const attributes=(source:Row[])=>Object.fromEntries(source.flatMap(r=>{const def=rows.ar_attributes.find(a=>a.id===r.attribute_id);if(!def)return[];const value=r.value_id?rows.ar_attribute_values.find(v=>v.id===r.value_id)?.code:r.text_value??r.number_value??r.boolean_value;return value===null||value===undefined?[]:[[def.code,String(value)]];}));
  const media=(source:Row[]):CatalogMedia[]=>source.sort(bySort).map(r=>({id:r.file_id,src:`/media/${r.file_id}`,alt:r.alt}));
  const fitment=(source:Row[]):FitmentRule[]=>source.map(r=>({vehicleId:r.vehicle_id,versionId:r.version_id,yearFrom:r.year_from,yearTo:r.year_to,airConditioning:r.air_conditioning,state:r.state,note:r.note}));
  const products:CatalogProduct[]=rows.ar_products.filter(r=>r.status==='published'&&categories.some(c=>c.id===r.category_id)).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id)).map(p=>{
   const category=categories.find(c=>c.id===p.category_id)!;
   const productMedia=media(rows.ar_product_media.filter(m=>m.product_id===p.id));
   const productAttributes=attributes(rows.ar_product_attributes.filter(a=>a.product_id===p.id));
   const productFitment=fitment(rows.ar_fitment.filter(f=>f.product_id===p.id&&f.sku_id===null));
   const variants:CatalogVariant[]=rows.ar_skus.filter(s=>s.product_id===p.id&&s.status==='published').sort(bySort).map(s=>{
    const images=s.media_mode==='replace'?media(rows.ar_sku_media.filter(m=>m.sku_id===s.id)):productMedia;
    const stock=rows.ar_stock.find(st=>st.sku_id===s.id);
    return{id:s.id,article:s.article,label:s.name,priceRubles:rubles(s.price_rubles),stock:Math.max(0,(stock?.on_hand??0)-(stock?.reserved??0)),attributes:{...productAttributes,...attributes(rows.ar_sku_attributes.filter(a=>a.sku_id===s.id))},image:images[0]?.src??fallbackImage,media:images,fitment:s.fitment_mode==='replace'?fitment(rows.ar_fitment.filter(f=>f.sku_id===s.id)):productFitment};
   });
   return{id:p.id,slug:p.slug,name:p.name,category:category.slug,categorySlugs:[category.slug,...rows.ar_product_categories.filter(c=>c.product_id===p.id).flatMap(c=>categories.filter(cat=>cat.id===c.category_id).map(cat=>cat.slug))],kind:p.kind,description:p.description??'',image:productMedia[0]?.src??fallbackImage,media:productMedia,attributes:productAttributes,fitment:productFitment,variants,components:p.kind==='bundle'?rows.ar_bundle_components.filter(c=>c.bundle_id===p.id).sort(bySort).map(c=>({skuId:c.sku_id,quantity:c.quantity})):undefined,discountBps:Math.round(Number(p.discount_percent)*100),isDemo:p.is_demo,seoTitle:p.seo_title??undefined,metaDescription:p.meta_description??undefined};
  });
  const vehicles=rows.ar_vehicles.map(v=>({id:v.id,slug:v.slug,name:v.name,yearFrom:v.year_from,yearTo:v.year_to,versions:rows.ar_vehicle_versions.filter(ver=>ver.vehicle_id===v.id).map(ver=>({id:ver.id,name:ver.name}))}));
  return createCatalogSnapshot({products,categories,attributeDefinitions,vehicles});
 });
}
function bySort(a:Row,b:Row){return Number(a.sort??0)-Number(b.sort??0)||String(a.id).localeCompare(String(b.id));}
