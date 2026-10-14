import test from 'node:test';import assert from 'node:assert/strict';
import {timewebOptions,timewebMessage,mailError,createTimewebMail} from '../src/server/adapters/timeweb-mail.ts';
process.env.STORE_MODE='local-test';process.env.APP_ORIGIN='http://127.0.0.1:14323';process.env.APP_SECRET='qa-test-secret-0000000000000000000000000000';process.env.MAIL_ALLOWED_RECIPIENTS='qa@example.invalid';process.env.SMTP_PASSWORD='qa-password-not-real';
const message={recipient:'qa@example.invalid',subject:'QA',body:'Проверка',message_id:'<ar-00000000-0000-4000-8000-000000000001@autoreelz.ru>',created_at:'2026-10-15T00:00:00Z'};
test('Timeweb uses fixed TLS465, verified certificate and bounded timeouts; no debug or files',()=>{
 const options=timewebOptions('secret');assert.equal(options.host,'smtp.timeweb.ru');assert.equal(options.port,465);assert.equal(options.secure,true);assert.equal(options.tls?.rejectUnauthorized,true);assert.equal(options.logger,false);assert.equal(options.debug,false);assert.equal(options.disableFileAccess,true);assert.equal(options.disableUrlAccess,true);
 const wire=timewebMessage(message);assert.deepEqual(wire.envelope,{from:'sales@autoreelz.ru',to:['qa@example.invalid']});assert.equal(wire.replyTo,'sales@autoreelz.ru');assert.equal(wire.messageId,message.message_id);assert.deepEqual(timewebMessage(message),wire);assert.equal((wire.date as Date).toISOString(),message.created_at.replace('Z','.000Z'));
});
test('unknown recipients, header injection and invalid snapshots cannot reach SMTP',()=>{
 for(const patch of [{recipient:'other@example.invalid'},{recipient:'a@example.invalid\r\nBcc:b@example.invalid'},{subject:'a\r\nBcc:b'},{message_id:'bad'},{created_at:'bad'},{body:'x'.repeat(65537)}])assert.throws(()=>timewebMessage({...message,...patch}));
});
test('explicit rejection is retryable; loss of DATA acknowledgement even with CONN is uncertain',()=>{
 assert.equal(mailError({responseCode:451}).state,'retry');assert.equal(mailError({responseCode:550}).state,'failed');assert.equal(mailError({code:'EAUTH'}).code,'SMTP_AUTH_FAILED');assert.equal(mailError({code:'EDNS'}).state,'retry');assert.equal(mailError({code:'ETIMEDOUT',command:'CONN',timeoutType:'CONNECT_TIMEOUT'}).state,'retry');
 for(const e of [{code:'ESOCKET',command:'CONN'},{code:'ETIMEDOUT',command:'CONN',timeoutType:'SOCKET_TIMEOUT'},{command:'DATA'},new Error('raw secret response')]){const safe=mailError(e);assert.equal(safe.state,'uncertain');assert.ok(!safe.message.includes('secret'));}
});
test('verify authenticates without sending; send reports SMTP acceptance and always closes transport',async()=>{
 let sends=0,verifies=0,closed=0;const factory=()=>({async verify(){verifies++;},async sendMail(){sends++;return{accepted:['qa@example.invalid'],rejected:[]};},close(){closed++;}});
 assert.equal((await createTimewebMail(factory).verify()).authenticated,true);assert.equal(sends,0);await createTimewebMail(factory).send(message);assert.equal(sends,1);assert.equal(verifies,1);assert.equal(closed,2);
 const failing=()=>({...factory(),async sendMail(){throw{code:'EAUTH',response:'private password'};}});await assert.rejects(createTimewebMail(failing).send(message),{code:'SMTP_AUTH_FAILED'});assert.equal(closed,3);
});
test('all-new permits valid external recipients only with a cutoff; old messages and malformed emails stay blocked',()=>{
 process.env.MAIL_RECIPIENT_POLICY='all-new';
 try{
  delete process.env.MAIL_NEW_MESSAGES_FROM;assert.throws(()=>timewebMessage({...message,recipient:'new@example.org'}),{code:'MAIL_CONFIG'});
  process.env.MAIL_NEW_MESSAGES_FROM='2026-10-15T00:00:00Z';
  assert.equal((timewebMessage({...message,recipient:'new@example.org'}).to as {address:string}).address,'new@example.org');
  assert.throws(()=>timewebMessage({...message,created_at:'2026-10-14T23:59:59Z'}),{code:'MAIL_BEFORE_ACTIVATION'});
  assert.throws(()=>timewebMessage({...message,recipient:'bad\r\nBcc:bad@example.org'}));
  process.env.MAIL_NEW_MESSAGES_FROM='bad';assert.throws(()=>timewebMessage(message),{code:'MAIL_CONFIG'});
 }finally{delete process.env.MAIL_RECIPIENT_POLICY;delete process.env.MAIL_NEW_MESSAGES_FROM;}
});
