import test from 'node:test';import assert from 'node:assert/strict';
import {addWorkingDays,automaticDeliveryDeadline,moscowDate,validDate} from '../src/lib/delivery-deadline.ts';
import {testOrderTerms} from '../src/lib/checkout-confirmations.ts';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {safeRichHtml} from '../src/server/rich-content.ts';
test('deadline uses Moscow date, preparation and carrier working days; weekends and transfers',()=>{
 assert.equal(moscowDate(Date.parse('2026-10-14T21:10:00Z')),'2026-10-15');
 assert.equal(automaticDeliveryDeadline(Date.parse('2026-10-15T20:59:00Z'),2),'2026-10-22');
 assert.equal(automaticDeliveryDeadline(Date.parse('2026-10-15T21:01:00Z'),2),'2026-10-23');
 assert.equal(addWorkingDays('2026-01-01',1),'2026-01-12');
 assert.equal(addWorkingDays('2026-05-08',1),'2026-05-12');
 assert.equal(addWorkingDays('2026-11-03',1),'2026-11-05');
 assert.equal(addWorkingDays('2026-12-30',1),null);
 for(const days of [-1,NaN,2.5,121])assert.equal(automaticDeliveryDeadline(Date.now(),days),null);
 assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-02-28'),true);
});
test('saved offer version matches the complete authored document and remains explicitly test-only',async()=>{
 const html=safeRichHtml(await readFile('docs/legal-pages/offer.html','utf8')).trim();
 assert.equal(testOrderTerms.offer.sha256,createHash('sha256').update(html).digest('hex'));
 assert.match(testOrderTerms.offer.body,/9\. Персональные данные/);assert.match(testOrderTerms.body,/Реальные деньги не списываются/);
 assert.ok(testOrderTerms.version.includes(testOrderTerms.offer.sha256.slice(0,12)));
});
