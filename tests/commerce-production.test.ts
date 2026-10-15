import test from 'node:test';
import assert from 'node:assert/strict';
import {isCommerceEnvironment,isTestEnvironment,requireCommerceEnvironment,requireTestEnvironment} from '../src/server/config.ts';
import {mailProvider,mailRecipientAllowed,mailMessageIsNew} from '../src/server/mail-policy.ts';
import {shipmentConfig} from '../src/server/cdek-shipment-policy.ts';
import {renderLoginMail,renderOrderMail,type MailOrder} from '../src/server/mail-templates.ts';
process.env.APP_SECRET='qa-production-secret-0000000000000000000000';
const configure=(mode='production',origin='https://autoreelz.ru')=>{process.env.STORE_MODE=mode;process.env.APP_ORIGIN=origin;};
test('commerce trusts only canonical configured production domain; test gates remain closed',()=>{
 for(const [mode,origin] of [['local-test','http://127.0.0.1:14323'],['staging','https://autoreelz.ru'],['production','https://autoreelz.ru']])assert.equal(isCommerceEnvironment(mode!,origin!),true);
 for(const origin of ['http://autoreelz.ru','https://www.autoreelz.ru','https://autoreelz.ru/','https://autoreelz.ru:443','https://autoreelz.ru/orders','https://autoreelz.ru?x=1','https://user@autoreelz.ru','https://autoreelz.ru.evil.test','http://localhost'])assert.equal(isCommerceEnvironment('production',origin),false,origin);
 configure();assert.doesNotThrow(requireCommerceEnvironment);assert.equal(isTestEnvironment('production','https://autoreelz.ru'),false);assert.throws(requireTestEnvironment);
 configure('production','https://another.example');assert.throws(requireCommerceEnvironment);configure();
});
test('production SMTP preserves fixed activation cutoff and recipient policy, rejects simulation',()=>{
 configure();process.env.MAIL_PROVIDER='simulation';assert.throws(mailProvider,{code:'MAIL_SIMULATION_DISABLED'});
 process.env.MAIL_PROVIDER='timeweb-smtp';assert.equal(mailProvider(),'timeweb-smtp');process.env.MAIL_RECIPIENT_POLICY='all-new';process.env.MAIL_NEW_MESSAGES_FROM='2026-10-14T23:37:31.373Z';
 assert.equal(mailRecipientAllowed('new@example.invalid'),true);assert.equal(mailMessageIsNew('2026-10-14T23:37:31.372Z'),false);assert.equal(mailMessageIsNew('2026-10-14T23:37:31.373Z'),true);
 process.env.MAIL_RECIPIENT_POLICY='allowlist';process.env.MAIL_ALLOWED_RECIPIENTS='allowed@example.invalid';assert.equal(mailRecipientAllowed('new@example.invalid'),false);assert.equal(mailRecipientAllowed('allowed@example.invalid'),true);
 delete process.env.MAIL_NEW_MESSAGES_FROM;delete process.env.MAIL_ALLOWED_RECIPIENTS;delete process.env.MAIL_RECIPIENT_POLICY;delete process.env.MAIL_PROVIDER;
});
test('production cannot create CDEK test shipments and live shipment opt-in stays explicit',()=>{
 configure();process.env.CDEK_SHIPMENTS_MODE='test';assert.throws(shipmentConfig);
 process.env.CDEK_SHIPMENTS_MODE='live';process.env.CDEK_SHIPMENTS_ALLOW_LIVE='false';assert.throws(shipmentConfig,{code:'CDEK_LIVE_DISABLED'});
 delete process.env.CDEK_SHIPMENTS_MODE;delete process.env.CDEK_SHIPMENTS_ALLOW_LIVE;
});
test('production login and all customer order templates contain no test claims',()=>{
 const order:MailOrder={id:'00000000-0000-4000-8000-000000000001',number:'QA-1',customer_name:'Покупатель',customer_email:'buyer@example.invalid',customer_phone:'+70000000000',created_at:'2026-10-15T00:00:00Z',expires_at:null,status:'paid',kind:'standard',items_snapshot:[],delivery_snapshot:{provider:'manual',method:'courier',city:'Город',address:'Адрес'},product_total_rubles:'100.00',shipping_cost_rubles:'10.00',delivery_deadline:null};
 for(const rendered of [renderLoginMail('123456',{test:false}),...(['created','ready','paid','shipped'] as const).map(kind=>renderOrderMail(kind,order,{test:false}))])assert.doesNotMatch(rendered.subject+rendered.body+rendered.html,/тестов/i);
});
