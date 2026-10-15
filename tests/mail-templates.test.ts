import test from 'node:test';import assert from 'node:assert/strict';
import {mailSamples} from '../src/server/mail-samples.ts';
import {renderOrderMail,renderLoginMail,type MailOrder} from '../src/server/mail-templates.ts';
import {timewebMessage} from '../src/server/adapters/timeweb-mail.ts';
process.env.STORE_MODE='local-test';process.env.APP_ORIGIN='http://127.0.0.1:14323';process.env.APP_SECRET='qa-only-0000000000000000000000000000000000';process.env.MAIL_ALLOWED_RECIPIENTS='qa@example.invalid';
const order:MailOrder={id:'00000000-0000-4000-8000-000000000001',number:'QA-001',customer_name:'<img src=x onerror=bad()>',customer_email:'qa@example.invalid',customer_phone:'+79990000000',created_at:new Date(),expires_at:null,status:'preorder_pending',kind:'preorder',items_snapshot:[{productId:'qa',skuId:null,name:'<script>alert(1)</script>',variantLabel:'" onclick="bad()',article:'QA',quantity:3,unitPriceRubles:'100.01',lineTotalRubles:'300.03',image:'https://evil.example/track',components:[]}],delivery_snapshot:{method:'pickup_point',provider:'cdek',city:'QA',address:'<img src=x>'},product_total_rubles:'300.03',shipping_cost_rubles:null,delivery_deadline:null};
const options={test:true};
test('unknown shipping/preorder has full details, escaped customer fields, no payment button and no external image source',()=>{
 const mail=renderOrderMail('created',order,options);assert.ok(mail.html.includes('&lt;script&gt;'));assert.ok(mail.html.includes('&quot; onclick=&quot;bad()'));assert.ok(!mail.html.includes('<script>'));assert.ok(!mail.html.includes('evil.example'));assert.ok(mail.html.includes('Оплачивать пока не нужно'));assert.ok(!mail.html.includes('>Оплатить заказ'));assert.ok(mail.html.includes('Уточняется'));assert.ok(mail.html.includes('После подтверждения'));assert.ok(mail.body.includes('300,03'));assert.ok(mail.html.includes('<table'));assert.ok(!/display:(flex|grid)/.test(mail.html));
});
test('ready mail reads saved expiry, exact RUB and safe order link; paid/tracking stay compact',()=>{
 const ready={...order,status:'awaiting_payment',expires_at:new Date(Date.now()+1800000),shipping_cost_rubles:'10.00',delivery_deadline:'2099-12-31'};
 const mail=renderOrderMail('ready',ready,options);assert.ok(mail.html.includes('310,03'));assert.ok(mail.html.includes('Оплатить до'));assert.ok(mail.html.includes('МСК'));assert.ok(mail.html.includes('https://autoreelz.ru/orders/'+order.id));assert.ok(mail.html.includes('31.12.2099'));
 const expired=renderOrderMail('ready',{...ready,expires_at:new Date(Date.now()-1000)},options);assert.ok(!expired.html.includes('>Оплатить заказ'));
 for(const kind of ['paid','shipped'] as const){const compact=renderOrderMail(kind,{...ready,tracking_number:'QA<track>'},options);assert.ok(!compact.html.includes('Ваш заказ</p>'));assert.ok(!compact.html.includes('&lt;script&gt;'));assert.ok(compact.html.includes('Тестовый режим'));if(kind==='shipped')assert.ok(compact.html.includes('QA&lt;track&gt;'));}
});
test('five samples are explicitly synthetic, use embedded raster logo and have safe demonstration links',()=>{
 const samples=mailSamples();assert.equal(samples.length,5);assert.equal(new Set(samples.map(s=>s.name)).size,5);
 for(const {mail} of samples){assert.ok(mail.subject.startsWith('[Макет'));assert.ok(mail.html.includes('Демонстрационный пример'));assert.ok(mail.body.includes('Демонстрацион'));assert.equal(mail.assets[0]!.contentType,'image/png');assert.ok(mail.html.includes('cid:'+mail.assets[0]!.cid));assert.ok(!mail.html.includes('/orders/00000000'));}
 assert.ok(samples.find(s=>s.name==='login')!.mail.body.includes('вход по нему недоступен'));
});
test('SMTP sends multipart alternative with validated CID buffers; malformed assets are never loaded',()=>{
 const mail=renderLoginMail('123456',options);const input={recipient:'qa@example.invalid',subject:mail.subject,body:mail.body,message_id:'<ar-00000000-0000-4000-8000-000000000001@autoreelz.ru>',created_at:new Date(),html_body:mail.html,template_version:mail.version,inline_assets:mail.assets};
 const mime=timewebMessage(input);assert.equal(mime.html,mail.html);assert.equal(mime.text,mail.body);assert.equal(mime.attachments?.length,1);assert.ok(Buffer.isBuffer(mime.attachments?.[0]?.content));assert.equal(mime.disableUrlAccess,true);assert.equal(mime.disableFileAccess,true);
 assert.throws(()=>timewebMessage({...input,inline_assets:[{...mail.assets[0]!,base64:'http://evil.example/image'}]}),{code:'MAIL_INVALID_ASSETS'});
 assert.throws(()=>renderLoginMail('<img>',options));
});
