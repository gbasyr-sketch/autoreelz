import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {safeRichHtml} from '../src/server/rich-content.ts';
const html=safeRichHtml(await readFile('docs/legal-pages/offer.html','utf8')).trim();
const body=html.replace(/<\/(?:p|h2)>/g,'\n\n').replace(/<br\s*\/?\s*>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const sha256=createHash('sha256').update(html).digest('hex');
await writeFile('src/lib/retail-offer.json',JSON.stringify({version:'offer-2026-10-14-'+sha256.slice(0,12),sha256,title:'Оферта AUTO REELZ — редакция 14 октября 2026 года',body},null,2)+'\n');
