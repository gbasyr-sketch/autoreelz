// Read-only probe; explicit invocation after the owner supplies sandbox credentials.
import {readFileSync,statSync} from 'node:fs';
import {createYooKassaSandbox} from '../src/server/adapters/yookassa-sandbox.ts';
import {requireLocalTest} from '../src/server/config.ts';
requireLocalTest();
const path=new URL('../private/yookassa-sandbox.env',import.meta.url);
if(statSync(path).mode&0o077)throw Error('Set private/yookassa-sandbox.env permissions to 0600');
const values=Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const client=createYooKassaSandbox({shopId:values.YOOKASSA_SHOP_ID??'',secretKey:values.YOOKASSA_SECRET_KEY??'',returnOrigin:'http://127.0.0.1:14323'});
console.log(JSON.stringify(await client.checkShop()));
