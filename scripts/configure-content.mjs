import {spawnSync} from 'node:child_process';
import {client,env,root} from './cms-client.mjs';
const api=await client();
const translate=label=>[{language:'ru-RU',translation:label}];
const definitions={
 ar_pages:['Информационные страницы','article','{{title}}'],
 ar_blog_categories:['Темы блога','category','{{name}}'],
 ar_blog_tags:['Теги блога','tag','{{name}}'],
 ar_articles:['Статьи блога','newspaper','{{title}}'],
 ar_article_tags:['Теги статей','label','{{tag_id.name}}'],
};
const labels={id:'ID',slug:'Адрес',title:'Заголовок',name:'Название',body:'Текст',summary:'Краткое вступление',excerpt:'Краткое описание статьи',status:'Публикация',seo_title:'SEO-заголовок',meta_description:'Описание для поиска',is_legal:'Юридический документ',is_draft_text:'Текст — проект документа',is_demo:'Демонстрационный материал',sort:'Порядок',created_at:'Создано',updated_at:'Изменено',category_id:'Тема блога',video_url:'Ссылка на видео',cover_file_id:'Обложка',published_at:'Дата публикации',article_id:'Статья',tag_id:'Тег'};
const relations=[['ar_articles','category_id','ar_blog_categories',null],['ar_articles','cover_file_id','directus_files',null],['ar_article_tags','article_id','ar_articles','tags'],['ar_article_tags','tag_id','ar_blog_tags',null]];
let collectionSort=40;
for(const[collection,[label,icon,template]]of Object.entries(definitions)){
 await api('PATCH',`/collections/${collection}`,{meta:{status:'active',icon,display_template:template,sort:collectionSort++,hidden:collection==='ar_article_tags',note:collection==='ar_articles'?'Статья видна после публикации и при опубликованной теме. Видео — только ссылка VK Видео/RUTUBE; видеозагрузка не нужна.':'Тексты выводятся безопасными абзацами. Черновики не видны на сайте.',translations:[{language:'ru-RU',translation:label,singular:label,plural:label}]}});
 const fields=await api('GET',`/fields/${collection}`);let sort=1;
 for(const field of fields){if(field.type==='alias')continue;const key=field.field;
  const meta={interface:'input',options:{},width:['body','summary','excerpt','seo_title','meta_description','video_url','cover_file_id'].includes(key)?'full':'half',sort:sort++,translations:translate(labels[key]??key),hidden:key==='id',readonly:['id','created_at','updated_at'].includes(key),required:['title','name','slug','category_id','article_id','tag_id'].includes(key)};
  if(key==='id')meta.special=['uuid'];
  if(field.type==='boolean')meta.interface='boolean';
  if(['body','summary','excerpt','meta_description'].includes(key)){meta.interface='input-multiline';meta.options={placeholder:key==='body'?'Разделяйте абзацы пустой строкой. HTML отображается как текст.':''};}
  if(key==='status'){const choices=[{value:'draft',text:'Черновик'},{value:'published',text:'Опубликовано'},{value:'archived',text:'Архив'}];meta.interface='select-dropdown';meta.options={choices};meta.display='labels';meta.display_options={choices};}
  if(key==='seo_title')meta.note='Ручной SEO-заголовок. Не заполняйте одинаковыми ключевыми словами вместо понятного названия.';
  if(key==='slug')meta.note='Латиница, цифры и дефисы. После смены адреса старый перенаправляет на новый.';
  if(key==='is_draft_text')meta.note='На странице появится заметное предупреждение: это проект, а не окончательные условия.';
  if(key==='video_url'){meta.note='Только HTTPS-ссылка. VK/VK Видео: скопируйте src из кода экспорта video_ext.php с oid, id и hash. RUTUBE: публичная ссылка /video/, /shorts/ или /play/embed/. Не вставляйте HTML. Плеер загрузится по нажатию покупателя.';meta.options={placeholder:'https://rutube.ru/video/…/'};}
  if(['published_at','created_at','updated_at'].includes(key)){meta.interface='datetime';meta.display='datetime';}
  if(key==='published_at')meta.note='Будущая дата скрывает статью до указанного времени; пустая дата не препятствует публикации.';
  const relation=relations.find(r=>r[0]===collection&&r[1]===key);
  if(relation){const image=relation[2]==='directus_files';meta.interface=image?'file-image':'select-dropdown-m2o';meta.special=[image?'file':'m2o'];meta.options={template:image?'{{title}}':definitions[relation[2]][2]};meta.display=image?'image':'related-values';meta.display_options={template:meta.options.template};}
  await api('PATCH',`/fields/${collection}/${key}`,{meta});
 }
 if(['ar_pages','ar_articles'].includes(collection)){
  const prefix=collection==='ar_pages'?'info':'blog',meta={interface:'presentation-links',special:['alias','no-data'],width:'full',sort:0,options:{links:[{label:'Открыть опубликованный материал',icon:'open_in_new',type:'normal',actionType:'url',url:`${env.APP_ORIGIN||'http://127.0.0.1:14323'}/${prefix}/{{slug}}`}]}};
  if(fields.some(f=>f.field==='preview'))await api('PATCH',`/fields/${collection}/preview`,{meta});else await api('POST',`/fields/${collection}`,{field:'preview',type:'alias',meta});
 }
}
for(const[many,field,one,alias]of relations){
 if(alias){const fields=await api('GET',`/fields/${one}`),meta={special:['o2m'],interface:'list-o2m',translations:translate('Теги статьи'),width:'full',sort:90,options:{template:'{{tag_id.name}}',enableCreate:true,enableSelect:true}};if(fields.some(f=>f.field===alias))await api('PATCH',`/fields/${one}/${alias}`,{meta});else await api('POST',`/fields/${one}`,{field:alias,type:'alias',meta});}
 const lit=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
 const statement=`UPDATE directus_relations SET one_collection=${lit(one)},one_field=${lit(alias)},one_deselect_action='delete' WHERE many_collection=${lit(many)} AND many_field=${lit(field)};
 INSERT INTO directus_relations(many_collection,many_field,one_collection,one_field,one_deselect_action) SELECT ${lit(many)},${lit(field)},${lit(one)},${lit(alias)},'delete' WHERE NOT EXISTS(SELECT 1 FROM directus_relations WHERE many_collection=${lit(many)} AND many_field=${lit(field)});`;
 const result=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:statement,encoding:'utf8',cwd:root});if(result.status!==0)throw new Error(result.stderr);
}
await api('PATCH','/collections/ar_content_slugs',{meta:{hidden:true,note:'История адресов. Изменяется автоматически; не редактировать.'}});
const policies=await api('GET','/policies?filter[name][_eq]=AUTO%20REELZ%20Content');if(!policies[0])throw new Error('Run configure-cms before configure-content');
const policy=policies[0].id,permissions=await api('GET',`/permissions?filter[policy][_eq]=${policy}&limit=-1`),grants=[];
for(const collection of Object.keys(definitions))for(const action of ['read','create','update',...(collection==='ar_article_tags'?['delete']:[])])if(!permissions.some(p=>p.collection===collection&&p.action===action))grants.push({policy,collection,action,permissions:{},validation:{},fields:['*']});
if(grants.length)await api('POST','/permissions',grants);
const presets=await api('GET','/presets?limit=-1');
for(const[collection,fields]of Object.entries({ar_pages:['title','status','is_draft_text','slug'],ar_articles:['title','category_id','status','is_demo','published_at'],ar_blog_categories:['name','status','slug'],ar_blog_tags:['name','slug']})){
 const existing=presets.find(p=>p.collection===collection&&!p.role&&!p.user&&!p.bookmark),payload={collection,layout:'tabular',layout_query:{tabular:{fields,sort:[fields[0]]}}};if(existing)await api('PATCH',`/presets/${existing.id}`,payload);else await api('POST','/presets',payload);
}
console.log('Russian content forms, editor grants and relation metadata configured; SQL constraints preserved.');
