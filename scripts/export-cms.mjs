import{client,env,root}from'./cms-client.mjs';
import{writeFileSync}from'node:fs';
const api=await client();const schema=await api('GET','/schema/snapshot');const text=JSON.stringify(schema,null,2)+'\n';
if(/\bD[A-Z0-9]{4}(?:-[A-Z0-9]{5}){4}\b/.test(text))throw new Error('Refusing to export a license key');
for(const[k,v]of Object.entries(env))if((k.endsWith('_PASSWORD')||k.endsWith('_SECRET'))&&v&&text.includes(v))throw new Error('Refusing to export a secret');
writeFileSync(`${root}/cms/schema.snapshot.json`,text);
console.log(`Saved CMS metadata snapshot (${schema.collections.length} collections). No account data exported.`);
