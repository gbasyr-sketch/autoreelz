// Verify the real editor entry's module graph, not a version-number exception.
// This is a local build only; no browser, database or external services are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'vite';
const modules=new Set();
await build({configFile:false,logLevel:'error',build:{
 lib:{entry:'src/scripts/content-editor.ts',formats:['es'],fileName:'editor'},
 outDir:'private/dependency-security/editor-bundle',emptyOutDir:true,
},plugins:[{name:'check-editor-security-modules',generateBundle(){
 for(const id of this.getModuleIds())modules.add(id.replaceAll('\\','/'));
}}]});
for(const name of ['formula','video'])assert.equal([...modules].some(id=>id.endsWith(`/quill/formats/${name}.js`)),false,`${name} export code must not ship`);
assert.equal([...modules].some(id=>id.endsWith('/quill/quill.js')),false,'full Quill entry re-registers unsafe embeds');
for(const name of ['header','bold','italic','underline','strike','list','blockquote','align','link','image'])assert.ok([...modules].some(id=>id.endsWith(`/quill/formats/${name}.js`)),`missing supported format ${name}`);
const result={passed:true,entry:'src/scripts/content-editor.ts',excluded:['formula','video','full Quill entry'],supportedFormats:10};
await fs.mkdir('private/dependency-security',{recursive:true});
await fs.writeFile('private/dependency-security/editor-bundle.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
