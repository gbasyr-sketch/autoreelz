// Explicit target only. Invalid commands exercise HTTP guards without orders, payments or email.
import assert from 'node:assert/strict';
const base=process.env.AR_PRODUCTION_HTTP_URL;if(!base)throw Error('Set AR_PRODUCTION_HTTP_URL to a production-mode preview or the approved store');
const target=new URL(base);assert.ok(target.origin===base&&['127.0.0.1','localhost','autoreelz.ru'].includes(target.hostname));
const initial=await fetch(base+'/api/commerce/session',{headers:{Host:'autoreelz.ru','X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https'}});assert.equal(initial.status,200);const session=await initial.json();assert.equal(typeof session.csrfToken,'string');
const cookie=initial.headers.getSetCookie().find(v=>v.startsWith('autoreelz2026_shop='))?.split(';')[0];assert.ok(cookie);
const common={Host:'autoreelz.ru','X-Forwarded-Host':'autoreelz.ru','X-Forwarded-Proto':'https',Origin:'https://autoreelz.ru','Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrfToken};const checks=[];
for(const [path,body,status,extra]of [
 ['/api/commerce/cart',{},403,{'X-CSRF-Token':'wrong'}],
 ['/api/commerce/cart',{},403,{Origin:'https://invalid.example'}],
 ['/api/commerce/cart',{},400,{}],
 ['/api/commerce/delivery-estimate',{},400,{}],
 ['/api/commerce/quote',{},400,{}],
 ['/api/commerce/checkout',{},400,{}],
 ['/api/commerce/pay',{},403,{'X-CSRF-Token':'wrong'}],
 ['/api/commerce/payment-event',{},404,{}],
 ['/api/commerce/payment-status',{orderId:'invalid'},400,{}],
 ['/api/commerce/cancel',{},400,{}],
 ['/api/auth/request',{email:'invalid'},400,{}],
 ['/api/auth/verify',{},400,{}],
]){
 const response=await fetch(base+path,{method:'POST',headers:{...common,...extra},body:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,path+':'+data.error?.code);assert.ok(data.error?.code);assert.notEqual(data.error.code,'INTERNAL');checks.push({path,status,passed:true});
}
console.log(JSON.stringify({passed:true,checks,invalidCommandsOnly:true,ordersCreated:0,paymentsCreated:0,refundsCreated:0,receiptsCreated:0,messagesSent:0}));
