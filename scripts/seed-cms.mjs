import {client,root} from './cms-client.mjs';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const api=await client();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function insert(collection,rows){
 const ids=new Set((await api('GET',`/items/${collection}?fields=id&limit=-1`)).map(r=>r.id));
 const fresh=rows.filter(r=>!ids.has(r.id));if(fresh.length)await api('POST',`/items/${collection}`,fresh);
 console.log(`${collection}: ${fresh.length} demo records added; existing records left unchanged`);
}
for(const rows of [
 [{id:id(20),name:'Детали интерьера',slug:'interior',status:'published'},{id:id(5),name:'Готовые комплекты',slug:'bundles',status:'published'}],
 [{id:id(21),parent_id:id(20),name:'Органы управления',slug:'controls',status:'published'},{id:id(2),parent_id:id(20),name:'Автомобильные консоли',slug:'consoles',status:'published'},{id:id(4),parent_id:id(20),name:'Воздуховоды AMG',slug:'vents',status:'published'}],
 [{id:id(1),parent_id:id(21),name:'Блоки отопителя',slug:'heaters',status:'published'}],
])await insert('ar_categories',rows);
await insert('ar_vehicles',[
 {id:id(52),make:'Лада',model:'Приора',generation:'1',name:'Лада Приора 1',slug:'priora-1'},
 {id:id(53),make:'Лада',model:'Приора',generation:'2',name:'Лада Приора 2',slug:'priora-2'},
]);
await insert('ar_attributes',[
 {id:id(200),code:'illumination',name:'Подсветка',value_type:'select',filterable:true},
 {id:id(201),code:'surface',name:'Поверхность',value_type:'select',filterable:true},
 {id:id(202),code:'material',name:'Материал',value_type:'select',filterable:true},
]);
await insert('ar_attribute_values',[
 {id:id(210),attribute_id:id(200),code:'red',label:'Красная',color:'#CB181A'},
 {id:id(211),attribute_id:id(200),code:'blue',label:'Синяя',color:'#315FA5'},
 {id:id(212),attribute_id:id(200),code:'white',label:'Белая',color:'#FFFFFF'},
 {id:id(213),attribute_id:id(200),code:'rgb',label:'RGB'},
 {id:id(214),attribute_id:id(200),code:'green',label:'Зелёная',color:'#248044'},
 {id:id(215),attribute_id:id(200),code:'purple',label:'Фиолетовая',color:'#8852A8'},
 {id:id(220),attribute_id:id(201),code:'matte',label:'Матовая'},
 {id:id(221),attribute_id:id(201),code:'gloss',label:'Глянцевая'},
 {id:id(230),attribute_id:id(202),code:'demo-material',label:'Демонстрационный материал — уточнить'},
]);
await insert('ar_category_attributes',[
 ...[200,201,202].map((a,i)=>({id:id(300+i),category_id:id(1),attribute_id:id(a)})),
 ...[201,202].map((a,i)=>({id:id(310+i),category_id:id(2),attribute_id:id(a)})),
 ...[200,201].map((a,i)=>({id:id(320+i),category_id:id(4),attribute_id:id(a)})),
]);
await insert('ar_products',[
 {id:id(100),name:'ДЕМО — Блок управления отопителем',slug:'heater-control',category_id:id(1),status:'published',is_demo:true,description:'Образец для проверки CMS. Не подтверждает реальную совместимость, материал или комплектацию.',seo_title:'Блок управления отопителем — демонстрационный пример',meta_description:'Пример карточки AUTO REELZ для локальной проверки.'},
 {id:id(101),name:'ДЕМО — Автомобильная консоль',slug:'interior-console',category_id:id(2),status:'published',is_demo:true},
 {id:id(102),name:'ДЕМО — Воздуховод AMG',slug:'amg-vent',category_id:id(4),status:'published',is_demo:true},
 {id:id(106),name:'ДЕМО — Комплект интерьера',slug:'interior-kit',category_id:id(5),kind:'bundle',discount_percent:5,status:'published',is_demo:true,description:'Фиксированный демонстрационный состав. Общий склад с отдельными компонентами. Совместимость пока неизвестна.'},
]);
await insert('ar_skus',[
 {id:id(1001),product_id:id(100),article:'DEMO-HEATER-R',name:'Красная подсветка',price_rubles:'4900.00',status:'published'},
 {id:id(1002),product_id:id(100),article:'DEMO-HEATER-B',name:'Синяя подсветка',price_rubles:'5100.00',status:'published'},
 {id:id(1003),product_id:id(100),article:'DEMO-HEATER-W',name:'Белая подсветка',price_rubles:'5300.00',status:'published',media_mode:'replace'},
 {id:id(1011),product_id:id(101),article:'DEMO-CONSOLE-M',name:'Матовая поверхность',price_rubles:'6900.00',status:'published'},
 {id:id(1012),product_id:id(101),article:'DEMO-CONSOLE-G',name:'Глянцевая поверхность',price_rubles:'7200.00',status:'published'},
 {id:id(1021),product_id:id(102),article:'DEMO-VENT-R',name:'Красная подсветка',price_rubles:'2400.00',status:'published'},
 {id:id(1022),product_id:id(102),article:'DEMO-VENT-RGB',name:'RGB',price_rubles:'3200.00',status:'published'},
]);
await insert('ar_product_attributes',[
 {id:id(400),product_id:id(100),attribute_id:id(201),value_id:id(220)},
 {id:id(401),product_id:id(100),attribute_id:id(202),value_id:id(230)},
 {id:id(402),product_id:id(101),attribute_id:id(201),value_id:id(220)},
]);
await insert('ar_sku_attributes',[
 ...[[1001,210],[1002,211],[1003,212],[1021,210],[1022,213]].map(([s,v],i)=>({id:id(410+i),sku_id:id(s),attribute_id:id(200),value_id:id(v)})),
 {id:id(420),sku_id:id(1003),attribute_id:id(201),value_id:id(221)},
 {id:id(421),sku_id:id(1012),attribute_id:id(201),value_id:id(221)},
]);
await insert('ar_fitment',[
 {id:id(500),product_id:id(100),vehicle_id:id(52),state:'unknown',air_conditioning:'unknown',note:'Демонстрация неизвестной совместимости. Годы и применимость не предоставлены.'},
 {id:id(501),product_id:id(100),vehicle_id:id(53),state:'unknown',air_conditioning:'unknown',note:'Приора 2 различается с Приорой 1. Совместимость не подтверждена.'},
]);
await insert('ar_bundle_components',[
 {id:id(600),bundle_id:id(106),sku_id:id(1001),quantity:1,sort:1},
 {id:id(601),bundle_id:id(106),sku_id:id(1011),quantity:1,sort:2},
 {id:id(602),bundle_id:id(106),sku_id:id(1021),quantity:2,sort:3},
]);
async function image(filename,title){
 const files=await api('GET',`/files?filter[filename_download][_eq]=${filename}`);if(files[0])return files[0].id;
 const form=new FormData();form.append('title',title);form.append('description','Демонстрационная SVG-заглушка, не фотография реального товара.');form.append('file',new Blob([readFileSync(`${root}/public/images/${filename}`)],{type:'image/svg+xml'}),filename);
 return (await api('POST','/files',form)).id;
}
const common=await image('placeholder-console.svg','ДЕМО — общее изображение товара');
const override=await image('placeholder-interior.svg','ДЕМО — пример переопределения изображения SKU');
await insert('ar_product_media',[{id:id(700),product_id:id(100),file_id:common,alt:'Изображение-заглушка, общая фотография товара'}]);
await insert('ar_sku_media',[{id:id(701),sku_id:id(1003),file_id:override,alt:'Изображение-заглушка, пример индивидуальной фотографии SKU'}]);
const rows=[[1001,7],[1002,3],[1003,0],[1011,4],[1012,0],[1021,12],[1022,2]];
const sql=`INSERT INTO ar_stock(sku_id,on_hand) VALUES ${rows.map(([sku,qty])=>`('${id(sku)}',${qty})`).join(',')} ON CONFLICT(sku_id) DO NOTHING;`;
const result=spawnSync('docker',['compose','-p','autoreelz2026-new','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d','autoreelz2026_new'],{input:sql,encoding:'utf8',cwd:root});
if(result.status!==0)throw new Error(result.stderr);
console.log('Demo stock seeded through migration role only; existing stock unchanged.');
