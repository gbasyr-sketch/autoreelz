import test from 'node:test';import assert from 'node:assert/strict';import {readdir,readFile} from 'node:fs/promises';
import {safeRichHtml} from '../src/server/rich-content.ts';
test('legal drafts retain readable content and only supported safe links after CMS sanitization',async()=>{
 const names=(await readdir('docs/legal-pages')).filter(n=>n.endsWith('.html'));
 for(const name of names){const raw=await readFile('docs/legal-pages/'+name,'utf8'),html=safeRichHtml(raw);assert.ok(html.length>300,name);assert.doesNotMatch(html,/<script|<iframe|onerror=|javascript:/i);assert.match(html,/in@autoreelz\.ru/,name);assert.doesNotMatch(raw,/\[(?:TODO|указать|адрес|реквизиты)\]/i);}
 const contacts=await readFile('docs/legal-pages/contacts.html','utf8');assert.match(contacts,/057102311218/);assert.match(contacts,/323050000008776/);assert.match(contacts,/MKHCH13/);assert.doesNotMatch(contacts,/408028|CVC|паспорт/i);
});
