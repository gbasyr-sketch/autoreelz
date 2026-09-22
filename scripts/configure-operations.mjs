import {client,env} from './cms-client.mjs';
const api=await client(),origin=env.APP_ORIGIN||'http://127.0.0.1:14323';
const groups={ar_reviews:['Отзывы — модерация','rate_review','{{author_name}}'],ar_order_notes:['Заметки по заказам','sticky_note_2','{{body}}'],ar_delivery_events:['История доставки','local_shipping','{{status}}'],ar_owner_notifications:['Тестовые уведомления','notifications','{{subject}}'],ar_description_drafts:['Черновики описаний','edit_note','{{product_id}}']};
const labels={id:'ID',customer_id:'Покупатель',product_id:'Товар',order_id:'Заказ',author_name:'Имя автора',body:'Текст',status:'Состояние',moderation_note:'Комментарий модератора',moderated_by:'Сотрудник',moderated_at:'Рассмотрено',created_at:'Создано',updated_at:'Обновлено',actor_id:'Сотрудник',provider_event_id:'ID события',payload_hash:'Хеш события',occurred_at:'Время у источника',source:'Источник',reason:'Причина',applied:'Применено',event_key:'Ключ события',channel:'Канал',subject:'Тема',attempts:'Попытки',last_error:'Последняя ошибка',delivered_at:'Тестовая доставка',source_fingerprint:'Версия исходных фактов',description:'Описание',meta_description:'Meta description',state:'Состояние черновика',applied_at:'Применено'};
let sort=60;
for(const[collection,[name,icon,template]]of Object.entries(groups)){
 await api('PATCH',`/collections/${collection}`,{meta:{icon,display_template:template,sort:sort++,note:'Только просмотр. Безопасные команды доступны в кабинете владельца.',translations:[{language:'ru-RU',translation:name,singular:name,plural:name}]}});
 const fields=await api('GET',`/fields/${collection}`);let position=1;
 for(const f of fields){if(f.type==='alias')continue;await api('PATCH',`/fields/${collection}/${f.field}`,{meta:{translations:[{language:'ru-RU',translation:labels[f.field]??f.field}],readonly:true,hidden:['id','payload_hash','source_fingerprint','customer_id'].includes(f.field),sort:position++,width:['body','reason','description','meta_description','moderation_note'].includes(f.field)?'full':'half',interface:f.type==='boolean'?'boolean':['body','description','meta_description'].includes(f.field)?'input-multiline':'input'}});}
}
for(const[collection,field,label,url]of [['ar_products','description_tools','Сгенерировать описание',origin+'/manager/content?product={{id}}'],['ar_reviews','moderation_tools','Рассмотреть отзывы',origin+'/manager/reviews'],['ar_owner_notifications','notification_tools','Уведомления владельца',origin+'/manager#manager-notifications']]){
 const fields=await api('GET',`/fields/${collection}`);const meta={interface:'presentation-links',special:['alias','no-data'],width:'full',sort:85,options:{links:[{label,icon:'open_in_new',type:'primary',actionType:'url',url}]}};
 if(fields.some(f=>f.field===field))await api('PATCH',`/fields/${collection}/${field}`,{meta});else await api('POST',`/fields/${collection}`,{field,type:'alias',meta});
}
// No editor/public grants to personal data, moderation, generator drafts, or order commands.
console.log('Stage 5 owner views and operation links configured.');
