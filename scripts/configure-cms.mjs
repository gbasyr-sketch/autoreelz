import {client,env,root} from './cms-client.mjs';
import {spawnSync} from 'node:child_process';
import {collections,labels,choices,relations} from '../cms/model.mjs';
const api=await client();
const translate=(name)=>[{language:'ru-RU',translation:name}];
const hiddenLinks=['ar_product_attributes','ar_sku_attributes','ar_product_media','ar_sku_media','ar_product_categories','ar_category_attributes'];
let order=1;
for(const [collection,[name,icon,template,note]]of Object.entries(collections)){
 await api('PATCH',`/collections/${collection}`,{meta:{icon,display_template:template,note,sort:order++,translations:[{language:'ru-RU',translation:name,singular:name,plural:name}],hidden:hiddenLinks.includes(collection)}});
 const fields=await api('GET',`/fields/${collection}`);let sort=1;
 for(const field of fields){
  if(field.type==='alias')continue;
  const key=field.field;
  const meta={translations:translate(labels[key]??key),sort:sort++,width:['description','note','seo_title','meta_description'].includes(key)?'full':'half',interface:'input',hidden:key==='id',conditions:[],readonly:['id','created_at','updated_at'].includes(key)||['ar_stock','ar_slug_history'].includes(collection)};
  if(key==='id')meta.special=['uuid'];
  if(['description','note','meta_description','alt'].includes(key))meta.interface='input-multiline';
  if(field.type==='boolean')meta.interface='boolean';
  if(choices[key]){meta.interface='select-dropdown';meta.options={choices:choices[key].map(([value,text])=>({value,text}))};meta.display='labels';meta.display_options={choices:choices[key].map(([value,text])=>({value,text}))};}
  const relation=relations.find(r=>r[0]===collection&&r[1]===key);
  if(relation){meta.interface=relation[2]==='directus_files'?'file-image':'select-dropdown-m2o';meta.special=[relation[2]==='directus_files'?'file':'m2o'];meta.options={template:collections[relation[2]]?.[2]??'{{title}}'};meta.display=relation[2]==='directus_files'?'image':'related-values';meta.display_options={template:collections[relation[2]]?.[2]??'{{title}}'};}
  if(['value_id','text_value','number_value','boolean_value'].includes(key))meta.note='Заполняйте ровно одно поле согласно типу выбранной характеристики.';
  if(key==='price_kopecks')meta.note='Целые копейки: 490000 = 4 900 ₽. Цена комплекта рассчитывается отдельно из состава.';
  if(key==='article')meta.note='Существующий артикул владельца. Не перенумеровывать. Регистр не различает дубли.';
  if(collection==='ar_skus'&&key==='product_id')meta.note='Выбирается при создании. После сохранения SKU перенос к другому товару запрещён базой данных.';
  if(collection==='ar_vehicle_versions'&&key==='vehicle_id')meta.note='Выбирается при создании. После сохранения модификация не переносится к другому автомобилю.';
  if(key==='discount_percent'){meta.note='Только для комплектов. Например, 5 означает скидку 5%.';meta.conditions=[{name:'single',rule:{kind:{_eq:'single'}},hidden:true}];}
  if(key==='seo_title')meta.note='Заполняется владельцем вручную; будущая генерация не меняет это поле.';
  if(['year_from','year_to'].includes(key))meta.note='Не заполняйте неизвестную применимость предположением.';
  await api('PATCH',`/fields/${collection}/${key}`,{meta});
 }
}
for(const[many,field,one,alias,label]of relations){
 if(alias){
  const fields=await api('GET',`/fields/${one}`);
  const meta={special:['o2m'],interface:'list-o2m',translations:translate(label),width:'full',sort:90,options:{template:collections[many]?.[2],enableCreate:true,enableSelect:true}};
  if(alias==='components')meta.conditions=[{name:'single',rule:{kind:{_eq:'single'}},hidden:true}];
  if(alias==='skus')meta.conditions=[{name:'bundle',rule:{kind:{_eq:'bundle'}},hidden:true}];
  if(fields.some(f=>f.field===alias))await api('PATCH',`/fields/${one}/${alias}`,{meta});
  else await api('POST',`/fields/${one}`,{field:alias,type:'alias',meta});
 }
 // Directus 12 PATCH /relations rebuilds the FK even for a metadata-only payload.
 // Preserve migration-owned constraints/permissions; update presentation metadata only.
 const lit=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
 const action=many==='ar_categories'?'nullify':'delete';
 const sql=`UPDATE directus_relations SET one_collection=${lit(one)},one_field=${lit(alias)},one_deselect_action=${lit(action)} WHERE many_collection=${lit(many)} AND many_field=${lit(field)};
 INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_deselect_action)
 SELECT ${lit(many)},${lit(field)},${lit(one)},${lit(alias)},${lit(action)} WHERE NOT EXISTS(SELECT 1 FROM directus_relations WHERE many_collection=${lit(many)} AND many_field=${lit(field)});`;
 const result=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:sql,encoding:'utf8',cwd:root});
 if(result.status!==0)throw new Error(result.stderr);
}
for(const collection of ['ar_migrations','ar_slug_registry'])await api('PATCH',`/collections/${collection}`,{meta:{hidden:true,note:'Internal migration/slug integrity; not editable in CMS.'}});
await api('PATCH','/settings',{project_name:'AUTO REELZ — новый магазин',project_color:'#CB181A',default_language:'ru-RU'});
const me=await api('GET','/users/me');await api('PATCH',`/users/${me.id}`,{first_name:'Владелец',last_name:'AUTO REELZ',language:'ru-RU'});
let policies=await api('GET','/policies?filter[name][_eq]=AUTO%20REELZ%20Content');
const policy=policies[0]??await api('POST','/policies',{name:'AUTO REELZ Content',icon:'edit_note',admin_access:false,app_access:true});
let roles=await api('GET','/roles?filter[name][_eq]=Контент-менеджер');
const role=roles[0]??await api('POST','/roles',{name:'Контент-менеджер',icon:'edit_note',description:'Каталог и контент. Нет управления ролями, заказами или складом.',policies:[{policy:policy.id}]});
const existing=await api('GET',`/permissions?filter[policy][_eq]=${policy.id}&limit=-1`);
const grants=[];
const removableLinks=['ar_bundle_components','ar_category_attributes','ar_product_attributes','ar_sku_attributes','ar_product_media','ar_sku_media','ar_product_categories','ar_fitment','ar_attribute_values'];
for(const collection of Object.keys(collections))for(const action of ['ar_stock','ar_slug_history'].includes(collection)?['read']:['read','create','update',...(removableLinks.includes(collection)?['delete']:[])]){
 if(!existing.some(p=>p.collection===collection&&p.action===action))grants.push({policy:policy.id,collection,action,permissions:{},validation:{},fields:['*']});
}
for(const action of ['read','create','update'])if(!existing.some(p=>p.collection==='directus_files'&&p.action===action))grants.push({policy:policy.id,collection:'directus_files',action,permissions:{},fields:['*']});
if(grants.length)await api('POST','/permissions',grants);
const users=await api('GET',`/users?filter[email][_eq]=${encodeURIComponent(env.EDITOR_EMAIL)}`);
if(!users.length)await api('POST','/users',{email:env.EDITOR_EMAIL,password:env.EDITOR_PASSWORD,first_name:'Контент',last_name:'Менеджер',role:role.id,status:'active',language:'ru-RU'});
const layouts={ar_products:['name','kind','status','category_id','is_demo'],ar_skus:['article','name','product_id','price_kopecks','status'],ar_categories:['name','parent_id','status','slug'],ar_fitment:['product_id','sku_id','vehicle_id','state','year_from','year_to','air_conditioning'],ar_bundle_components:['bundle_id','sku_id','quantity'],ar_attributes:['name','code','value_type','filterable'],ar_attribute_values:['attribute_id','label','code'],ar_vehicles:['name','make','model','generation'],ar_stock:['sku_id','on_hand','reserved']};
const presets=await api('GET','/presets?limit=-1');
for(const[collection,fields]of Object.entries(layouts)){
 const preset=presets.find(p=>p.collection===collection&&!p.user&&!p.role&&!p.bookmark);
 const data={collection,layout:'tabular',layout_query:{tabular:{fields,sort:[fields[0]]}},layout_options:{tabular:{spacing:'comfortable'}}};
 if(preset)await api('PATCH',`/presets/${preset.id}`,data);else await api('POST','/presets',data);
}
console.log(`Configured ${Object.keys(collections).length} Russian collections, relations and content-editor policy. No public grants.`);
