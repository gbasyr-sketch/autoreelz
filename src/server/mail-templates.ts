import type {OrderLineSnapshot,DeliveryInput} from '../lib/commerce-types.ts';
import {formatRubles,sumRubles} from '../lib/money.ts';
import {uuid} from './errors.ts';
import {mailLogo} from './mail-brand.ts';
export const MAIL_TEMPLATE_VERSION='2026-10-15.1';
export type OrderMailKind='created'|'ready'|'paid'|'shipped';
export interface InlineMailAsset {cid:string;contentType:string;filename:string;base64:string}
export interface RenderedMail {subject:string;body:string;html:string;version:string;assets:InlineMailAsset[]}
export interface MailOrder {
 id:string;number:string;customer_name:string;customer_email:string;customer_phone:string;
 created_at:Date|string;expires_at:Date|string|null;status:string;kind:string;
 items_snapshot:OrderLineSnapshot[];delivery_snapshot:DeliveryInput;
 product_total_rubles:string;shipping_cost_rubles:string|null;delivery_deadline:string|null;
 tracking_number?:string|null;terms?:string|null;
}
export interface MailRenderOptions {test:boolean;demo?:boolean}
const ORIGIN='https://autoreelz.ru';
export const escapeMail=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const text=(v:unknown)=>String(v??'').replace(/[\r\n]+/g,' ').trim();
const money=(v:string)=>formatRubles(v);
const td='padding:7px 0;font:14px/1.5 Arial,Helvetica,sans-serif;color:#33332d;vertical-align:top;';
function row(label:string,value:string){return`<tr><td width="105" style="${td}color:#62625c;padding-right:14px;">${escapeMail(label)}</td><td style="${td}word-break:break-word;">${value}</td></tr>`;}
const table=(s:string)=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${s}</table>`;
const section=(s:string)=>`<p style="margin:24px 0 8px;font:700 14px/1.5 Arial,sans-serif;color:#1d1d1b;">${escapeMail(s)}</p>`;
function button(label:string,url:string){return`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr><td align="center" bgcolor="#CB181A" style="border-radius:8px;"><a href="${escapeMail(url)}" style="display:block;padding:15px 18px;font:700 15px/1.4 Arial,sans-serif;color:#ffffff;text-decoration:none;">${escapeMail(label)}</a></td></tr></table>`;}
const paragraph=(s:string)=>`<p style="margin:0 0 18px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#3b3b35;">${escapeMail(s)}</p>`;
function imageUrl(input:string){
 if(/^\/media\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input))return ORIGIN+input;
 if(/^\/images\/[a-z0-9_/-]+\.(png|jpe?g|webp)$/i.test(input)&&!input.includes('..'))return ORIGIN+input;
 return null;
}
function products(lines:OrderLineSnapshot[]){return section('Ваш заказ')+table(lines.map(l=>{
 const image=imageUrl(l.image),name=escapeMail(l.name),variant=escapeMail(l.variantLabel);
 const photo=image?`<img src="${escapeMail(image)}" width="48" alt="${name}" style="display:block;width:48px;max-width:48px;height:auto;border:0;">`:'<span style="font:11px Arial;color:#77776e;">Фото</span>';
 return`<tr><td width="48" align="center" style="padding:16px 0;border-bottom:1px solid #e7e7e1;vertical-align:top;">${photo}</td><td style="padding:16px 9px;border-bottom:1px solid #e7e7e1;vertical-align:top;font:14px/1.45 Arial,sans-serif;word-break:break-word;"><strong>${name}</strong>${variant?`<br><span style="font-size:12px;color:#62625c;">${variant}</span>`:''}</td><td width="90" align="right" style="padding:16px 0;border-bottom:1px solid #e7e7e1;vertical-align:top;font:700 14px/1.45 Arial,sans-serif;">${escapeMail(money(l.lineTotalRubles))}<br><span style="font:11px/1.5 Arial;color:#62625c;">${l.quantity} × ${escapeMail(money(l.unitPriceRubles))}</span></td></tr>`;
 }).join(''));}
function deadline(value:Date|string|null){return value?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' МСК':null;}
function delivery(o:MailOrder){const d=o.delivery_snapshot;return[d.provider==='manual'?'Доставка по согласованию':d.carrier?.provider==='cdek'||d.provider==='cdek'?'СДЭК':d.method==='courier'?'Курьерская доставка':'Пункт выдачи',d.city,d.address].filter(Boolean).join(' · ');}
function deliveryDate(o:MailOrder){return o.delivery_deadline?o.delivery_deadline.split('-').reverse().join('.') :null;}
function details(o:MailOrder,full:boolean){return table((full?row('Получатель',escapeMail(o.customer_name)+`<br><span style="font-size:12px;color:#62625c;">${escapeMail(o.customer_email)} · ${escapeMail(o.customer_phone)}</span>`):'')+row('Доставка',escapeMail(delivery(o)))+(deliveryDate(o)?row('Получение',escapeMail('Не позднее '+deliveryDate(o))):''));}
function total(o:MailOrder){return o.shipping_cost_rubles===null?null:sumRubles([o.product_total_rubles,o.shipping_cost_rubles]);}
function totals(o:MailOrder){return`<div style="margin-top:16px;">${table(row('Товары',escapeMail(money(o.product_total_rubles)))+row('Доставка',escapeMail(o.shipping_cost_rubles===null?'Уточняется':money(o.shipping_cost_rubles)))+`<tr><td style="${td}border-top:1px solid #deded7;padding-top:14px;font-weight:700;">Итого</td><td align="right" style="${td}border-top:1px solid #deded7;padding-top:14px;font-size:18px;font-weight:700;">${escapeMail(total(o)===null?'После подтверждения':money(total(o)!))}</td></tr>`)}</div>`;}
function wrap(title:string,content:string,options:MailRenderOptions,login=false){
 const banner=options.demo?'Демонстрационный пример. Заказ и платёж не создавались.':options.test?'Тестовый режим магазина. Оплата остаётся тестовой.':'';
 return`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMail(title)}</title></head><body style="margin:0;padding:0;background:#f7f7f4;word-wrap:break-word;">${table(`<tr><td align="center" style="padding:20px 8px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #deded7;"><tr><td bgcolor="#1d1d1b" style="padding:24px;border-bottom:4px solid #cb181a;"><img src="cid:${mailLogo.cid}" alt="AUTO REELZ" width="190" height="27" style="display:block;max-width:100%;height:auto;border:0;"></td></tr>${banner?`<tr><td style="padding:12px 24px;background:#f5ebdc;color:#62431a;font:12px/1.5 Arial;">${escapeMail(banner)}</td></tr>`:''}<tr><td style="padding:24px;font:16px/1.6 Arial,sans-serif;color:#1d1d1b;">${content}</td></tr><tr><td bgcolor="#f7f7f4" style="padding:20px 24px;border-top:1px solid #e7e7e1;font:12px/1.6 Arial;color:#62625c;"><strong style="font-size:14px;color:#33332d;">${login?'Вопрос по входу?':'Вопрос по заказу?'}</strong><br>Ответьте на это письмо — <a href="mailto:sales@autoreelz.ru" style="color:#a90e11;">sales@autoreelz.ru</a><p style="margin:14px 0 4px;">${login?'Если вы не запрашивали вход, просто проигнорируйте письмо.':'Вы получили это письмо в связи с заказом в AUTO REELZ.'}</p>AUTO REELZ · <a href="https://autoreelz.ru" style="color:#62625c;">autoreelz.ru</a></td></tr></table></td></tr>`)}</body></html>`;
}
const heading=(s:string)=>`<h1 style="margin:0 0 18px;font:700 27px/1.22 Arial,sans-serif;color:#1d1d1b;">${escapeMail(s)}</h1>`;
export function renderLoginMail(code:string,options:MailRenderOptions):RenderedMail {
 if(!/^\d{6}$/.test(code))throw new Error('INVALID_MAIL_CODE');
 const subject='AUTO REELZ — код входа';
 const body=`Ваш код входа: ${code}\n\nКод действует 10 минут. Не сообщайте его другим людям.\nЕсли вы не запрашивали вход, проигнорируйте письмо.\n\nAUTO REELZ · sales@autoreelz.ru${options.demo?'\nДемонстрационный код, вход по нему недоступен.':''}`;
 const html=wrap(subject,heading('Ваш код входа')+paragraph('Введите код на сайте AUTO REELZ, чтобы войти в личный кабинет.')+`<div style="margin:24px 0;padding:22px 8px;background:#f7f7f4;text-align:center;font:700 34px/1.3 Arial;letter-spacing:6px;">${code}<br><span style="font:12px/1.5 Arial;letter-spacing:0;color:#62625c;">${options.demo?'Демонстрационный код':'Действует 10 минут'}</span></div>`+paragraph('Никому не сообщайте код, в том числе тем, кто представляется сотрудником магазина.'),options,true);
 return{subject,body,html,version:MAIL_TEMPLATE_VERSION,assets:[{...mailLogo}]};
}
export function renderOrderMail(kind:OrderMailKind,o:MailOrder,options:MailRenderOptions):RenderedMail {
 const id=uuid(o.id),url=ORIGIN+(options.demo?'/orders':'/orders/'+id),payable=o.status==='awaiting_payment'&&o.shipping_cost_rubles!==null&&Boolean(o.expires_at)&&new Date(o.expires_at!).getTime()>Date.now();
 const name=text(o.customer_name),no=text(o.number),amount=total(o),until=deadline(o.expires_at);
 let title='',intro='',subject='',more='',action='',extraText='';
 const date=escapeMail(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric'}).format(new Date(o.created_at)));
 const orderMeta=table(`<tr><td style="font:12px/1.5 Arial;color:#62625c;vertical-align:top;">Номер заказа<br><strong style="font-size:18px;color:#1d1d1b;">${escapeMail(no)}</strong></td><td align="right" style="font:12px/1.5 Arial;color:#62625c;vertical-align:top;">Дата оформления<br>${date}</td></tr>`)+ '<div style="border-top:1px solid #e7e7e1;margin:18px 0 24px;"></div>';
 if(kind==='created'||kind==='ready'){
  title=kind==='created'?'Спасибо за заказ!':payable?'Заказ можно оплатить':'Условия заказа обновлены';subject=`AUTO REELZ — заказ ${no} ${kind==='created'?'оформлен':'подтверждён'}`;
  intro=payable?`${name?name+', ':''}наличие товаров и условия доставки подтверждены. Проверьте состав, адрес получения и итоговую сумму перед оплатой.`:o.kind==='preorder'?`${name?name+', ':''}ваш заказ получили. В составе есть позиции под заказ. Проверим наличие и подтвердим условия отдельным письмом.`:`${name?name+', ':''}ваш заказ получили. Уточним условия доставки и дату получения, затем сообщим о готовности к оплате.`;
  if(!payable)more=`<div style="padding:14px 16px;background:#f7f7f4;border-left:3px solid #cb181a;margin:18px 0;"><strong>Оплачивать пока не нужно.</strong><br>Сначала подтвердим наличие, доставку и итоговую сумму.</div>`;
  more+=products(o.items_snapshot)+section('Детали заказа')+details(o,true)+totals(o);
  if(o.terms){more+=paragraph(o.terms);extraText+='\nУсловия: '+o.terms;}
  if(payable&&until){more+=`<p style="margin:20px 0 8px;font:13px/1.5 Arial;color:#62625c;">Оплатить до ${escapeMail(until)}</p>`;extraText+='\nОплатить до '+until;}
  action=button(payable?'Оплатить заказ'+(amount?' · '+money(amount):''):'Посмотреть заказ',url);
 }else if(kind==='paid'){
  title=options.test?'Тестовая оплата подтверждена':'Спасибо за оплату!';subject=`AUTO REELZ — ${options.test?'тестовая оплата':'оплата'} заказа ${no} получена`;
  intro=options.test?'Тестовая оплата подтверждена. Реальные деньги не списывались.':'Оплата подтверждена. Подготовим заказ к отправке.';
  more=`<div style="padding:20px;background:#f7f7f4;margin:20px 0;font:14px Arial;">${options.test?'Сумма тестовой оплаты':'Оплачено, включая доставку'}<br><strong style="font-size:27px;line-height:1.8;">${escapeMail(amount?money(amount):money(o.product_total_rubles))}</strong></div>`+paragraph(options.test?'В рабочем режиме после передачи заказа в СДЭК здесь придёт отдельное письмо с трек-номером.':'После передачи заказа в СДЭК пришлём отдельное письмо с трек-номером.')+details(o,false);action=button('Открыть заказ',url);
 }else{
  title='Заказ отправлен';subject=`AUTO REELZ — заказ ${no} отправлен`;intro='Передали посылку в службу доставки. Информация об отправлении доступна в заказе.';
  more=o.tracking_number?`<div style="padding:18px 20px;margin:20px 0;border:1px solid #deded7;font:13px Arial;color:#62625c;">Трек-номер<br><strong style="font-size:20px;line-height:1.8;color:#1d1d1b;word-break:break-all;">${escapeMail(o.tracking_number)}</strong></div>`:'';
  more+=details(o,false);action=button(o.tracking_number?'Отследить посылку':'Открыть заказ',url);extraText=o.tracking_number?'\nТрек-номер: '+o.tracking_number:'';
 }
 const body=[options.demo?'Демонстрационный пример. Заказ и платёж не создавались.':options.test?'Тестовый режим магазина.':'',`Заказ ${no}`,title,intro,...(['created','ready'].includes(kind)?o.items_snapshot.map(l=>`${l.name}${l.variantLabel?' · '+l.variantLabel:''}: ${l.quantity} × ${money(l.unitPriceRubles)} = ${money(l.lineTotalRubles)}`):[]),...(kind!=='shipped'?[`Товары: ${money(o.product_total_rubles)}`,`Доставка: ${o.shipping_cost_rubles===null?'Уточняется':money(o.shipping_cost_rubles)}`,`Итого: ${amount===null?'После подтверждения':money(amount)}`]:[]),...(['created','ready'].includes(kind)?[`Получатель: ${o.customer_name}`,`Email: ${o.customer_email}`,`Телефон: ${o.customer_phone}`]:[]),`Доставка: ${delivery(o)}`,deliveryDate(o)?'Получение не позднее '+deliveryDate(o):'',extraText,'Открыть заказ: '+url,'Ответить: sales@autoreelz.ru'].filter(Boolean).join('\n\n');
 return{subject,body,html:wrap(subject,orderMeta+heading(title)+paragraph(intro)+more+action,options),version:MAIL_TEMPLATE_VERSION,assets:[{...mailLogo}]};
}
