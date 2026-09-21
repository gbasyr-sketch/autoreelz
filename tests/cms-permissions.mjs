import assert from 'node:assert/strict';
import{writeFileSync}from'node:fs';
import{client,env,base,root}from'../scripts/cms-client.mjs';
const admin=await client();
const editor=await client(env.EDITOR_EMAIL,env.EDITOR_PASSWORD);
const report=[];
async function pass(name,fn){await fn();report.push(name);console.log(`PASS ${name}`);}
await pass('Public policy has no domain grants',async()=>{
 const policies=await admin('GET','/policies?limit=-1');
 const pub=policies.find(p=>p.name==='$t:public_label');assert.ok(pub);
 const permissions=await admin('GET',`/permissions?filter[policy][_eq]=${pub.id}&limit=-1`);
 assert.equal(permissions.filter(p=>p.collection.startsWith('ar_')).length,0);
});
for(const collection of ['ar_products','ar_stock','ar_orders'])await pass(`Anonymous ${collection} CRUD denied`,async()=>{
 for(const method of ['GET','POST','PATCH','DELETE']){
  const url=base+'/items/'+collection+(['PATCH','DELETE'].includes(method)?'/f9999999-9999-4999-8999-999999999999':'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(['POST','PATCH'].includes(method)?{body:JSON.stringify({id:'f9999999-9999-4999-8999-999999999999',on_hand:0})}:{})});
  assert.equal(r.status,403,`${method} ${collection}: ${r.status}`);
 }
});
await pass('Editor can read catalog and relationships',async()=>{
 const rows=await editor('GET','/items/ar_products?fields=id,name,category_id.name,skus.article&limit=-1');assert.ok(rows.length>=4);assert.ok(rows.some(p=>p.skus?.length));
});
await pass('Editor stock writes and schema administration denied',async()=>{
 await assert.rejects(editor('POST','/items/ar_stock',{sku_id:'f9999999-9999-4999-8999-999999999999',on_hand:0}),/403/);
 await assert.rejects(editor('GET','/schema/snapshot'),/403/);
 await assert.rejects(editor('POST','/roles',{name:'QA forbidden'}),/403/);
});
await pass('Domain IDs are UUID; article and slug are strings',async()=>{
 for(const name of ['ar_products','ar_skus','ar_fitment','ar_bundle_components']){
  const fields=await admin('GET',`/fields/${name}`);assert.equal(fields.find(f=>f.field==='id')?.type,'uuid');
  for(const key of ['slug','article'])if(fields.some(f=>f.field===key))assert.equal(fields.find(f=>f.field===key).type,'text');
 }
});
writeFileSync(`${root}/artifacts/stage-3/permissions-check.json`,JSON.stringify({passed:true,checks:report},null,2));
