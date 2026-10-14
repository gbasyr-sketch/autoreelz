import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {analyticsConsentText,PRIVACY_VERSION} from '../src/lib/privacy-consent.ts';
import {safeRichHtml} from '../src/server/rich-content.ts';
export const legalPages=[
 {slug:'contacts',title:'Контакты и реквизиты',summary:'Связь с AUTO REELZ, сведения о продавце и адрес возврата товаров.'},
 {slug:'delivery',title:'Доставка и оплата',summary:'Доставка СДЭК, сроки отправки, оформление предзаказов и оплата.'},
 {slug:'returns',title:'Возврат товаров',summary:'Как отказаться от покупки, сообщить о недостатке и оформить возврат.'},
 {slug:'warranty',title:'Гарантии',summary:'Гарантийные условия и обращение по качеству товара.'},
 {slug:'offer',title:'Публичная оферта',summary:'Условия оформления, оплаты, доставки и возврата покупок в AUTO REELZ.'},
 {slug:'personal-data',title:'Политика обработки персональных данных',summary:'Цели и основания обработки данных, получатели и ваши права.'},
 {slug:'privacy',title:'Конфиденциальность и cookies',summary:'Для чего нужны cookies и как управлять аналитикой на сайте.'},
 {slug:'analytics-consent',title:'Согласие на аналитику',summary:'Отдельное добровольное согласие на использование Яндекс.Метрики.'},
 {slug:'review-consent',title:'Согласие на публикацию отзыва — проект',summary:'Проект отдельного согласия. Требует завершения формы и условий публикации.'},
];
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const pages=[];
for(const [index,page]of legalPages.entries()){
 const raw=page.slug==='analytics-consent'?`<p>Редакция ${PRIVACY_VERSION}.</p><p>${escape(analyticsConsentText)}</p><p>Согласие предоставляется кнопкой «Разрешить аналитику». Продолжение просмотра, закрытие окна или принятие условий заказа не являются согласием на Метрику.</p><p>Отозвать согласие можно через «Настройки cookies» внизу сайта. Подробнее: <a href="/info/personal-data">Политика обработки персональных данных</a> и <a href="/info/privacy">Конфиденциальность и cookies</a>.</p>`:await readFile(`docs/legal-pages/${page.slug}.html`,'utf8');
 const body=safeRichHtml(raw).trim();
 if(!body||body.length<100)throw Error('Empty legal page '+page.slug);
 pages.push({...page,body,sort:String(index+1),isLegal:true,isDraftText:page.slug!=='offer'});
}
await mkdir('output/legal',{recursive:true});
await writeFile('output/legal/pages.json',JSON.stringify({preparedDate:'2026-10-14',published:false,pages},null,2)+'\n');
const navigation=pages.map(p=>`<a href="#${p.slug}">${escape(p.title)}</a>`).join('');
const content=pages.map(p=>`<article id="${p.slug}"><div class="kicker">AUTO REELZ · ${p.isDraftText?'Проект на согласование':'Итоговая редакция · ещё не опубликована'}</div><h1>${escape(p.title)}</h1><p class="summary">${escape(p.summary)}</p><div class="copy">${p.body.replaceAll('href="/info/','href="#')}</div></article>`).join('');
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>AUTO REELZ — документы на согласование</title><style>body{margin:0;background:#f7f7f4;color:#1d1d1b;font:16px/1.7 system-ui,sans-serif}header{padding:28px max(24px,calc((100vw - 1160px)/2));background:#1d1d1b;color:white}header h1{margin:0;font-size:26px}header p{max-width:850px}main{display:grid;grid-template-columns:230px minmax(0,1fr);gap:36px;max-width:1160px;margin:32px auto;padding:0 24px}nav{position:sticky;top:20px;align-self:start;display:grid;gap:12px}a{color:#9e1416;text-underline-offset:3px}article{background:white;border:1px solid #deded7;border-radius:16px;padding:36px;margin-bottom:28px;scroll-margin-top:24px}article h1{font-size:30px;line-height:1.25;margin:8px 0 18px}h2{font-size:21px;line-height:1.4;margin:28px 0 12px}.kicker{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#62625c}.summary{color:#62625c}.copy{overflow-wrap:anywhere}.note{padding:16px;border-left:4px solid #cb181a;background:#fff4e8}button{min-height:44px}@media(max-width:800px){main{display:block;padding:0 16px}nav{position:static;margin-bottom:24px}article{padding:22px}article h1{font-size:25px}}@media print{header,nav{display:none}main{display:block;margin:0;padding:0}article{border:0;padding:0;break-before:page}article:first-child{break-before:auto}a{color:inherit}}</style></head><body><header><h1>AUTO REELZ — документы для сайта</h1><p>Подготовлено 14 октября 2026 года. Это комплект для проверки владельцем; страницы ещё не опубликованы. Контакты и срок отправки подтверждены. Реальные платежи и чеки, уведомление РКН, процесс удаления данных и согласие на публикацию отзывов требуют завершения.</p></header><main><nav aria-label="Документы">${navigation}</nav><div><p class="note">Перед запуском продаж привести оформление заказа в соответствие с итоговой офертой: сроки оплаты и доставки, сохранение условий и реальные чеки. Для политики подтвердить договоры обработки, сроки хранения и внешние передачи. Проект согласия на отзывы пока не использовать как действующую форму.</p>${content}</div></main></body></html>`;
await writeFile('output/legal/index.html',html);console.log(JSON.stringify({pages:pages.length,preview:'output/legal/index.html',published:false}));
