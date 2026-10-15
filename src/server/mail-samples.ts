// Synthetic mail previews only. No orders, login challenges, payments or shipments are created.
import {renderLoginMail,renderOrderMail,type MailOrder} from './mail-templates.ts';
export function mailSamples(now=new Date()){
 const order:MailOrder={id:'00000000-0000-4000-8000-000000000014',number:'DEMO-014',customer_name:'Покупатель',customer_email:'sales@autoreelz.ru',customer_phone:'+7 *** ***-**-**',created_at:now,expires_at:null,status:'preorder_pending',kind:'preorder',items_snapshot:[{productId:'00000000-0000-4000-8000-000000000001',skuId:null,name:'Автомобильная консоль',variantLabel:'Матовая, чёрная · демоисполнение',article:'DEMO-01',quantity:1,unitPriceRubles:'6900.00',lineTotalRubles:'6900.00',image:'',components:[]},{productId:'00000000-0000-4000-8000-000000000002',skuId:null,name:'Комплект дефлекторов',variantLabel:'Чёрный · демонстрационный комплект',article:'DEMO-02',quantity:1,unitPriceRubles:'3200.00',lineTotalRubles:'3200.00',image:'',components:[]}],delivery_snapshot:{method:'pickup_point',provider:'cdek',city:'Демонстрационный город',address:'Пример пункта выдачи · не адрес реального заказа'},product_total_rubles:'10100.00',shipping_cost_rubles:null,delivery_deadline:null};
 const ready={...order,status:'awaiting_payment',expires_at:new Date(now.getTime()+1800000),shipping_cost_rubles:'590.00'};
 const options={test:true,demo:true};
 return[
  {name:'created',mail:renderOrderMail('created',order,options)},
  {name:'ready',mail:renderOrderMail('ready',ready,options)},
  {name:'paid',mail:renderOrderMail('paid',{...ready,status:'paid'},options)},
  {name:'shipped',mail:renderOrderMail('shipped',{...ready,status:'paid',tracking_number:'DEMO-TRACK-014'},options)},
  {name:'login',mail:renderLoginMail('481726',options)}
 ].map((sample,index)=>({...sample,mail:{...sample.mail,subject:`[Макет ${index+1}/5] ${sample.mail.subject}`}}));
}
