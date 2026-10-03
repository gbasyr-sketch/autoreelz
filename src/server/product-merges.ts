import type {PoolClient} from 'pg';
import {query} from './db.ts';
import type {CatalogSnapshot} from '../lib/catalog-types.ts';
export async function productMergeMap(c?:PoolClient):Promise<Record<string,string>>{
 const sql='SELECT source_product_id,target_product_id FROM ar_product_merges';
 const rows=(c?await c.query(sql):await query(sql)).rows;
 return Object.fromEntries(rows.map(r=>[r.source_product_id,r.target_product_id]));
}
export async function canonicalProductId(c:PoolClient,id:string):Promise<string>{
 return(await c.query('SELECT target_product_id FROM ar_product_merges WHERE source_product_id=$1',[id])).rows[0]?.target_product_id??id;
}
export async function mergedProductRedirect(slug:string,catalog:CatalogSnapshot){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>250)return null;
 const r=(await query('SELECT target_product_id,sku_id FROM ar_product_variant_redirects WHERE old_slug=$1',[slug])).rows[0];
 if(!r)return null;const p=catalog.products.find(p=>p.id===r.target_product_id);
 // Preserve the exact SKU even when that color was later hidden: the destination
 // returns 404 instead of silently showing another available color.
 return p?{slug:p.slug,skuId:r.sku_id as string}:null;
}
export function mergedProductUrl(target:{slug:string;skuId:string},search:string){
 const params=new URLSearchParams(search);if(!params.has('sku'))params.set('sku',target.skuId);
 return'/product/'+encodeURIComponent(target.slug)+'?'+params.toString();
}
