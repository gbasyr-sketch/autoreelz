import{client,env}from'./cms-client.mjs';
const api=await client();
// Component snapshots are read by the store server, not edited in Studio.
// Disable this optional legacy Studio view through Directus' native status API;
// keep its SQL table and data intact and stay within Core's 25 active collections.
const componentView=await api('GET','/collections/ar_order_components');
if(componentView.meta?.status==='active')await api('PATCH','/collections/ar_order_components',{meta:{status:'inactive'}});
const groups={ar_orders:['Заказы и предзаказы','shopping_cart','{{number}}'],ar_payments:['Тестовые платежи','payments','{{id}}'],ar_stock_movements:['Движения склада','inventory','{{reason}}'],ar_order_events:['История заказов','history','{{event_type}}'],ar_packing_rules:['Правила упаковки','package_2','{{name}}']};
const labels={provider:'Провайдер оплаты',provider_shop_id:'ID тестового магазина',provider_id:'ID платежа провайдера',provider_status:'Статус ЮKassa',provider_checked_at:'Последняя проверка',provider_last_error:'Код ошибки проверки',provider_confirmation_url:'Страница тестовой оплаты',tracking_number:'Трек-номер',delivery_source:'Источник статуса',delivery_override:'Ручное управление',carrier_status:'Последний статус перевозчика',carrier_updated_at:'Время события перевозчика',carrier_tracking_number:'Трек перевозчика',delivery_updated_at:'Статус обновлён',delivered_at:'Получение подтверждено',id:'ID',number:'Номер заказа',kind:'Вид заказа',status:'Состояние',payment_status:'Оплата',delivery_status:'Доставка',customer_name:'Покупатель',customer_phone:'Телефон',customer_email:'Email',delivery_snapshot:'Адрес и способ доставки',items_snapshot:'Неизменяемый состав заказа',product_total_rubles:'Товары, ₽',shipping_cost_rubles:'Доставка, ₽',shipping_reason:'Расчёт доставки',shipping_version:'Версия расчёта',shipping_package:'Упаковка',terms:'Срок и условия',review_reason:'Причина проверки',expires_at:'Оплатить до',created_at:'Создано',updated_at:'Обновлено',order_id:'ID заказа',amount_rubles:'Сумма, ₽',currency:'Валюта',method:'Способ оплаты',sku_id:'Физический SKU',stock_delta:'Изменение физического остатка',reserved_delta:'Изменение резерва',reason:'Причина',actor_id:'ID сотрудника',event_type:'Событие',note:'Примечание',quantity:'Количество',name:'Название',package_id:'Упаковка',active:'Активно',components:'Точный состав (SKU → количество)',is_demo:'Демонстрационные данные'};
const states={open:'Ожидает доставки',preorder_pending:'Предзаказ: ждёт подтверждения',awaiting_payment:'Ожидает оплаты',paid:'Оплачен',expired:'Срок истёк',cancelled:'Отменён',manual_review:'Ручная проверка',pending:'Ожидается',succeeded:'Успешно',failed:'Не прошёл',review:'Проверяется'};
let sort=30;
for(const [collection,[name,icon,template]]of Object.entries(groups)){
 await api('PATCH',`/collections/${collection}`,{meta:{icon,display_template:template,sort:sort++,hidden:false,note:collection==='ar_packing_rules'?'Укажите измеренную упаковку и точные количества физических SKU. При отсутствии правила доставка требует ручного расчёта.':'Только просмотр. Команды выполняются в разделе управления заказами, а не через прямое редактирование записей.',translations:[{language:'ru-RU',translation:name,singular:name,plural:name}]}});
 const fields=await api('GET',`/fields/${collection}`);let position=1;
 for(const field of fields){if(field.type==='alias')continue;const key=field.field;const meta={interface:field.type==='json'?'input-code':field.type==='boolean'?'boolean':'input',options:field.type==='json'?{language:'json'}:{},sort:position++,width:field.type==='json'?'full':'half',hidden:['id','batch_id','session_id','allocation_state','operation_key','provider_key','provider_return_url','provider_requested_at','provider_lease_id','provider_lease_until','provider_next_check_at'].includes(key),readonly:collection!=='ar_packing_rules'||key==='id',translations:[{language:'ru-RU',translation:labels[key]??key}]};
  if(key==='id')meta.special=['uuid'];
  if(key.endsWith('_rubles')){meta.interface='input';meta.options={min:0,step:0.01,iconRight:'currency_ruble'};meta.display='formatted-value';meta.display_options={suffix:' ₽'};}
  if(key==='kind'){meta.display='labels';meta.display_options={choices:[{value:'ordinary',text:'Обычный заказ'},{value:'preorder',text:'Предзаказ'}]};}
  if(key==='status'){meta.display='labels';meta.display_options={choices:Object.entries(states).map(([value,text])=>({value,text}))};}
  if(['created_at','updated_at','expires_at','provider_checked_at'].includes(key))meta.display='datetime';
  await api('PATCH',`/fields/${collection}/${key}`,{meta});
 }
 if(collection==='ar_orders'){
  const meta={interface:'presentation-links',special:['alias','no-data'],width:'full',sort:0,options:{links:[{label:'Управление заказами',icon:'open_in_new',type:'primary',actionType:'url',url:`${env.APP_ORIGIN||'http://127.0.0.1:14323'}/manager`}]}};
  if(fields.some(f=>f.field==='operations'))await api('PATCH','/fields/ar_orders/operations',{meta});else await api('POST','/fields/ar_orders',{field:'operations',type:'alias',meta});
 }
}
const presets=await api('GET','/presets?limit=-1');
for(const[collection,fields]of Object.entries({ar_orders:['number','kind','status','customer_name','product_total_rubles','created_at'],ar_stock_movements:['sku_id','stock_delta','reserved_delta','reason','created_at'],ar_payments:['order_id','amount_rubles','method','status','created_at']})){
 const existing=presets.find(p=>p.collection===collection&&!p.role&&!p.user&&!p.bookmark);const payload={collection,layout:'tabular',layout_query:{tabular:{fields,sort:['-created_at']}}};
 if(existing)await api('PATCH',`/presets/${existing.id}`,payload);else await api('POST','/presets',payload);
}
console.log('Read-only trade views and safe operation link configured. No public/editor trade grants.');
