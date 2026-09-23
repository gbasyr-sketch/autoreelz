// Credentials probe only: no shipment, pickup or webhook is created.
import {readFileSync,statSync} from 'node:fs';
const path=new URL('../private/cdek.env',import.meta.url);
if(statSync(path).mode&0o077)throw Error('Set private/cdek.env permissions to 0600');
const values=Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(!values.CDEK_CLIENT_ID||!values.CDEK_CLIENT_SECRET)throw Error('CDEK credentials missing');
try{
 const response=await fetch('https://api.cdek.ru/v2/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:values.CDEK_CLIENT_ID,client_secret:values.CDEK_CLIENT_SECRET})});
 if(!response.ok)throw Error('CDEK_AUTH_HTTP_'+response.status);
 const data=await response.json();
 if(typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||!(data.expires_in>0))throw Error('CDEK_AUTH_INVALID_RESPONSE');
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),authorized:true,environment:'api.cdek.ru',shipmentsCreated:0}));
}catch(error){console.error(error instanceof Error&&error.message.startsWith('CDEK_AUTH_')?error.message:'CDEK_AUTH_UNAVAILABLE');process.exitCode=1;}
