import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {analyticsPage,analyticsReferrer,validCounterId,PRIVACY_VERSION,PRIVACY_DAYS} from '../src/lib/privacy-consent.ts';
process.env.APP_SECRET='qa-privacy-secret-not-real-0000000000000000000000';
const {encodePrivacy,decodePrivacy,privacySettings}=await import('../src/server/privacy-consent.ts');
test('analytics excludes private routes and any query or fragment',()=>{
 for(const path of ['/','/catalog','/product/test-item','/info/contacts','/blog/article'])assert.equal(analyticsPage(new URL('https://autoreelz.ru'+path)),true);
 for(const path of ['/account','/cart','/checkout','/orders/abc','/manager','/api/privacy','/catalog?q=email%40example.com','/product/item?sku=123','/info/contacts#email','/unknown','/product/name%40mail'])assert.equal(analyticsPage(new URL('https://autoreelz.ru'+path)),false,path);
});
test('counter id allows only a bounded positive integer',()=>{assert.ok(validCounterId('123456'));for(const v of ['0','-1','123;alert(1)','123.4','1e3','1234567890123',''])assert.equal(validCounterId(v),false);});
test('referrer preserves the source origin without paths, identifiers or query values',()=>{assert.equal(analyticsReferrer('https://www.google.com/search?q=personal','https://autoreelz.ru'),'https://www.google.com/');assert.equal(analyticsReferrer('https://autoreelz.ru/orders/private-id?email=x','https://autoreelz.ru'),'https://autoreelz.ru/');assert.equal(analyticsReferrer('javascript:alert(1)','https://autoreelz.ru'),'https://autoreelz.ru/');});
test('signed choice rejects tampering, old version, expiry and malformed cookie',()=>{
 const now=Date.now(),value={id:randomUUID(),choice:'accepted' as const,version:PRIVACY_VERSION,expiresAt:now+PRIVACY_DAYS*86400000};const signed=encodePrivacy(value);assert.deepEqual(decodePrivacy(signed,now),value);
 for(const cookie of [signed+'x',signed.split('.')[0]+'.wrong','x'.repeat(1025),undefined,encodePrivacy({...value,version:'old'}),encodePrivacy({...value,expiresAt:now-1}),encodePrivacy({...value,expiresAt:now+181*86400000})])assert.equal(decodePrivacy(cookie,now),null);
});
test('analytics is explicit opt-in configuration and cannot run on another origin',()=>{
 Object.assign(process.env,{APP_ORIGIN:'https://autoreelz.ru',STORE_MODE:'staging',METRIKA_ENABLED:'false',METRIKA_COUNTER_ID:'123456'});assert.equal(privacySettings(new URL('https://autoreelz.ru')).enabled,false);
 process.env.METRIKA_ENABLED='true';assert.equal(privacySettings(new URL('https://autoreelz.ru')).enabled,true);assert.equal(privacySettings(new URL('https://evil.invalid')).enabled,false);
 process.env.METRIKA_COUNTER_ID='not-a-counter';assert.equal(privacySettings(new URL('https://autoreelz.ru')).counterId,null);
});
