const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const dialog = $('#dialog');
const body = $('#dialog-body');
let count = 0;
let toastTimer;
function toast(message) {
  const el = $('.toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
function open(title, message) {
  body.replaceChildren();
  const h = document.createElement('h2'); h.id = 'dialog-title'; h.textContent = title;
  body.append(h);
  dialog.setAttribute('aria-labelledby', h.id);
  if (message) { const p = document.createElement('p'); p.textContent = message; body.append(p); }
  dialog.showModal();
}
$('.close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
$$('[data-info]').forEach(b => b.addEventListener('click', () => open('Визуальный прототип', b.dataset.info)));
$$('[data-menu]').forEach(b => b.addEventListener('click', () => {
  open('Каталог');
  const p = document.createElement('p'); p.textContent = 'Показываем структуру меню. В этом прототипе категории ведут к одной демонстрационной карточке.'; body.append(p);
  const nav = document.createElement('nav'); nav.className = 'menu-links';
  ['Блоки отопителя','Автомобильные консоли','Android-магнитолы','Воздуховоды AMG','Готовые комплекты','Ручки КПП','Переходные панели','Рамки под магнитолы','Чехлы на ручки КПП'].forEach(t => { const a = document.createElement('a'); a.href = 'a-product.html'; a.textContent = t; nav.append(a); });
  body.append(nav);
}));
function search() {
  open('Поиск по каталогу','На этом этапе доступна одна демонстрационная карточка товара.');
  const a = document.createElement('a'); a.href = 'a-product.html'; a.className = 'primary'; a.textContent = 'Блок управления отопителем →'; body.append(a);
}
$('.search')?.addEventListener('submit', e => { e.preventDefault(); search(); });
$$('[data-search]').forEach(b => b.addEventListener('click', search));
function cart() { open('Корзина · прототип', count ? `Добавлено в демонстрацию: ${count} шт. Реальный заказ не создаётся. Цена и наличие показаны только для выбора дизайна.` : 'Пока ничего не добавлено. Откройте карточку товара, чтобы посмотреть состояние кнопки покупки.'); }
$$('[data-cart]').forEach(b => b.addEventListener('click', cart));
$('#selection')?.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  open('Автомобиль выбран', `${f.get('model')}, ${f.get('year')}. Данные совместимости ещё не переданы. В рабочем магазине здесь появятся только проверенные подходящие детали.`);
  const a = document.createElement('a'); a.href = 'a-product.html'; a.className = 'primary'; a.textContent = 'Посмотреть пример карточки →'; body.append(a);
});
$$('[data-color]').forEach(b => b.addEventListener('click', () => {
  $$('[data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('[data-color-name]').textContent = b.dataset.color;
  $('[data-product-image]').style.filter = b.dataset.hue === 'gray' ? 'grayscale(1)' : `hue-rotate(${b.dataset.hue}deg)`;
}));
$$('[data-quantity]').forEach(b => b.addEventListener('click', () => {
  const q = $('#quantity'); q.value = String(Math.max(1, Math.min(99, Number(q.value || q.textContent) + Number(b.dataset.quantity))));
}));
$$('[data-add]').forEach(button => button.addEventListener('click', () => {
  count += Number($('#quantity').value || $('#quantity').textContent);
  $$('[data-cart-count]').forEach(el => { el.textContent = count; });
  toast('Добавлено в демо-корзину. Заказ не оформляется.');
}));
$('[data-favorite]')?.addEventListener('click', e => {
  const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on));
  $('span', b).textContent = on ? 'В избранном' : 'В избранное'; b.style.color = on ? '#cb181a' : '';
  toast(on ? 'Добавлено в избранное · демонстрация' : 'Удалено из избранного · демонстрация');
});
$$('[data-view]').forEach(b => b.addEventListener('click', () => {
  $$('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('.gallery-index').textContent = `0${b.dataset.view} / 03`;
  const img = $('[data-product-image]'); img.style.transform = b.dataset.view === '3' ? 'scale(1.22)' : b.dataset.view === '2' ? 'scale(.9)' : '';
  if (b.dataset.view !== '1') toast('Для этого вида тоже показана заглушка. Реальные фото добавим позже.');
}));
function selectTab(b) {
  $$('[data-tab]').forEach(x => { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
  $$('.tab-panel').forEach(p => { p.hidden = p.id !== `panel-${b.dataset.tab}`; });
}
$$('[data-tab]').forEach((b,i,all) => {
  b.addEventListener('click', () => selectTab(b));
  b.addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault(); const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    selectTab(all[n]); all[n].focus();
  });
});
$('[data-fitment]')?.addEventListener('click', () => {
  open('Проверка совместимости','Выберите автомобиль. Реальную применимость заполним после получения таблицы товаров.');
  const form = document.createElement('form');
  const fields = [['Модель',['Лада Гранта','Лада Калина','Лада Приора 1','Лада Приора 2','Лада Веста','ВАЗ-2110','ВАЗ-2114','Renault Duster']],['Год выпуска',Array.from({length:27},(_,i)=>String(2026-i))],['Кондиционер',['Есть','Нет','Не знаю']]];
  fields.forEach(([label,values],i) => {
    const l = document.createElement('label'); l.className = 'field'; l.textContent = label;
    const s = document.createElement('select'); s.name = `field${i}`; s.required = true;
    const first = document.createElement('option'); first.value = ''; first.textContent = 'Выберите'; s.append(first);
    values.forEach(v=>{ const o=document.createElement('option');o.textContent=v;s.append(o); }); l.append(s);form.append(l);
  });
  const b = document.createElement('button'); b.className='primary';b.textContent='Проверить';form.append(b);
  form.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(form);dialog.close();$('[data-fitment-label]').textContent=`${f.get('field0')} · совместимость уточняется`;toast('Совместимость не подтверждена: нужны данные товара.');});body.append(form);
});
