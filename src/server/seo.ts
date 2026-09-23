import {setting} from './config.ts';
import {indexingAllowed,SITE_ORIGIN} from '../lib/seo.ts';
import type {CatalogSnapshot} from '../lib/catalog-types.ts';
import {query} from './db.ts';
export function seoSettings(url?:URL){return{indexing:(!url||url.origin===SITE_ORIGIN)&&indexingAllowed({enabled:setting('SEO_INDEXING_ENABLED','false'),mode:setting('STORE_MODE','local-test'),appOrigin:setting('APP_ORIGIN','http://127.0.0.1:14323')})};}
export async function catalogAlias(kind:'product'|'category',slug:string,catalog:CatalogSnapshot){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>250)return null;
 const row=(await query('SELECT entity_id FROM ar_slug_history WHERE entity_type=$1 AND old_slug=$2 LIMIT 1',[kind,slug])).rows[0];
 if(!row)return null;const list=kind==='product'?catalog.products:catalog.categories;
 const current=list.find(p=>p.id===row.entity_id);return current?.slug!==slug?current?.slug??null:null;
}
