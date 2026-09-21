(() => {
  'use strict';
  const dialog = document.querySelector('#prototype-dialog');
  const title = document.querySelector('#dialog-title');
  const content = document.querySelector('#dialog-content');
  const toast = document.querySelector('.toast');
  const variants = {
    red: { name: 'Красная', price: 4900, color: '#cb181a', stock: true },
    blue: { name: 'Синяя', price: 5100, color: '#3b62a8', stock: true },
    white: { name: 'Белая', price: 4900, color: '#77796e', stock: false },
  };
  let chosen = 'red';
  let quantity = 1;
  let cart = [];
  let toastTimer;
  let vehicle = '';
  const formatPrice = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const showToast = message => {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4500);
  };
  const openDialog = (heading, html) => {
    title.textContent = heading;
    content.innerHTML = html;
    if (!dialog.open) dialog.showModal();
  };
  const updateCartCount = () => {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.querySelectorAll('.cart-count').forEach(node => node.textContent = String(count));
    document.querySelectorAll('[data-cart]').forEach(node => node.setAttribute('aria-label', `Открыть демонстрационную корзину, товаров: ${count}`));
  };
  const info = {
    journal: ['Журнал AUTO REELZ', '<p>Здесь появятся материалы об установке, обзоры и новости магазина.</p><p class="dialog-note">В этом прототипе подготовлены главная и карточка товара.</p>'],
    account: ['Личный кабинет', '<p>В будущем магазине вход будет по одноразовому коду на email. Здесь появятся заказы и избранное.</p><p class="dialog-note">Прототип не отправляет письма и не создаёт аккаунты.</p>'],
    delivery: ['Доставка по России', '<p>Стоимость доставки будет рассчитана при оформлении заказа. Если расчёт недоступен, менеджер уточнит стоимость до оплаты.</p><p class="dialog-note">Расчёт доставки в визуальном прототипе не подключён.</p>'],
    preorder: ['Предзаказ без ранней оплаты', '<p>Если товара не хватает, вся строка корзины переходит в предзаказ. Сначала менеджер подтверждает срок и условия, затем становится доступна оплата.</p><p class="dialog-note">Обычный заказ и предзаказ оформляются отдельно, с отдельной доставкой для каждого.</p>'],
    vehicles: ['Выберите автомобиль', '<p>Лада Гранта, Калина, Приора 1, Приора 2, Веста, ВАЗ-2110, ВАЗ-2114 и Renault Duster.</p><p class="dialog-note">Перечень предварительный. Точная применимость деталей будет подтверждена при наполнении.</p><button class="button red-button" data-compatibility>Начать подбор <span aria-hidden="true">↗</span></button>'],
  };
  const openCompatibility = initialVehicle => {
    const selected = initialVehicle || vehicle;
    const options = ['Лада Гранта', 'Лада Калина', 'Лада Приора 1', 'Лада Приора 2', 'Лада Веста', 'ВАЗ-2110', 'ВАЗ-2114', 'Renault Duster'];
    openDialog('Проверить совместимость', `<p>Укажите автомобиль. Сейчас показан интерфейс подбора; товарная таблица ещё не заполнена.</p><form id="compatibility-form"><label for="car-model">Автомобиль<select id="car-model" name="model" required><option value="">Выберите модель</option>${options.map(model => `<option${model === selected ? ' selected' : ''}>${model}</option>`).join('')}</select></label><label for="car-year">Год выпуска<input id="car-year" name="year" type="number" inputmode="numeric" min="1970" max="2026" placeholder="Например, 2015" required></label><label for="car-ac">Кондиционер<select id="car-ac" name="ac" required><option value="">Выберите вариант</option><option value="yes">Есть</option><option value="no">Нет</option></select></label><button class="button red-button" type="submit">Проверить <span aria-hidden="true">→</span></button><div id="compatibility-result" role="status" aria-live="polite"></div></form>`);
    content.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      vehicle = content.querySelector('#car-model').value;
      const result = content.querySelector('#compatibility-result');
      result.className = 'dialog-result';
      result.innerHTML = '<p><strong>Совместимость уточняется.</strong></p><p class="dialog-note">Данных для подтверждения пока нет. Выбор автомобиля сохранён только на этой странице.</p><a class="button red-button" href="b-product.html">Посмотреть демонстрационный товар <span aria-hidden="true">↗</span></a>';
      const status = document.querySelector('#compatibility-status');
      if (status) status.textContent = `${vehicle} · совместимость уточняется.`;
    });
  };
  const openCart = () => {
    if (!cart.length) {
      openDialog('Демо-корзина пуста', '<p>В карточке товара можно выбрать подсветку и добавить пример товара. Реальная покупка в прототипе недоступна.</p><a class="button red-button" href="b-product.html">К демонстрационному товару <span aria-hidden="true">↗</span></a>');
      return;
    }
    const rows = cart.map((item, index) => `<div class="cart-item"><strong>Блок управления отопителем</strong><p>Подсветка: ${variants[item.color].name.toLowerCase()} · ${item.quantity} шт.</p><p>${variants[item.color].stock ? 'В наличии · пример' : 'Предзаказ · пример, без оплаты'}</p><div class="cart-total"><span>${formatPrice(variants[item.color].price * item.quantity)}</span><button class="cart-remove" data-remove="${index}">Убрать</button></div></div>`).join('');
    openDialog('Демонстрационная корзина', `${rows}<p class="dialog-note">Демонстрационные цены и наличие. Совместимость уточняется. Заказ не создаётся, данные никуда не отправляются. Корзина сбросится при переходе на другую страницу.</p>`);
  };
  document.addEventListener('click', event => {
    const target = event.target.closest('button,a');
    if (!target) return;
    if (target.hasAttribute('data-close')) dialog.close();
    if (target.hasAttribute('data-info')) {
      const entry = info[target.dataset.info];
      if (entry) openDialog(...entry);
    }
    if (target.hasAttribute('data-category')) openDialog(target.dataset.category, '<p>Раздел каталога появится на следующем этапе. Сейчас можно оценить композицию магазина и демонстрационную карточку товара.</p><a class="button red-button" href="b-product.html">Посмотреть карточку <span aria-hidden="true">↗</span></a>');
    if (target.hasAttribute('data-vehicle')) openCompatibility(target.dataset.vehicle);
    if (target.hasAttribute('data-compatibility')) openCompatibility();
    if (target.hasAttribute('data-cart')) openCart();
    if (target.hasAttribute('data-menu')) openDialog('AUTO REELZ', '<a class="dialog-link" href="b.html#catalog">01 / Каталог</a><a class="dialog-link" href="b.html#vehicle">02 / Ваш автомобиль</a><button class="dialog-link" style="background:none;border:0;border-bottom:1px solid var(--line);width:100%;padding:0" data-info="journal">03 / Журнал</button><button class="button red-button" data-search>Поиск по каталогу <span aria-hidden="true">↗</span></button>');
    if (target.hasAttribute('data-search')) {
      openDialog('Поиск по каталогу', '<p>В прототипе доступна одна демонстрационная карточка.</p><form id="search-form"><label for="search-query">Название детали<input id="search-query" name="query" type="search" placeholder="Например, блок отопителя" required></label><button class="button red-button" type="submit">Найти <span aria-hidden="true">→</span></button><div id="search-result" role="status" aria-live="polite"></div></form>');
      content.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const query = content.querySelector('input').value.trim().toLowerCase();
        const result = content.querySelector('#search-result');
        result.className = 'dialog-result';
        result.innerHTML = /блок|отоп|управлен/.test(query) ? '<a class="dialog-link" href="b-product.html">Блок управления отопителем <span aria-hidden="true">↗</span></a><p class="dialog-note">Демонстрационный товар</p>' : '<p>Совпадений в демонстрационном каталоге нет.</p><a class="dialog-link" href="b-product.html">Открыть пример карточки <span aria-hidden="true">↗</span></a>';
      });
    }
    if (target.hasAttribute('data-color')) {
      chosen = target.dataset.color;
      const variant = variants[chosen];
      document.querySelectorAll('[data-color]').forEach(button => {
        const active = button.dataset.color === chosen;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.querySelector('#selected-color').textContent = variant.name;
      document.querySelector('#description-color').textContent = variant.name;
      document.querySelector('#product-price').textContent = formatPrice(variant.price);
      const status = document.querySelector('#stock-status');
      status.innerHTML = `<i aria-hidden="true"></i> ${variant.stock ? 'В наличии · пример' : 'Предзаказ · пример'}`;
      status.classList.toggle('is-preorder', !variant.stock);
      document.querySelector('[data-add]').innerHTML = `${variant.stock ? 'В демо-корзину' : 'Демо-предзаказ'} <span aria-hidden="true">↗</span>`;
      document.documentElement.style.setProperty('--product-light', variant.color);
      showToast(`Подсветка: ${variant.name.toLowerCase()}. ${variant.stock ? 'В наличии' : 'Предзаказ'}, демонстрационные данные.`);
    }
    if (target.hasAttribute('data-quantity')) {
      quantity = Math.max(1, Math.min(99, quantity + (target.dataset.quantity === 'plus' ? 1 : -1)));
      document.querySelector('#quantity').textContent = String(quantity);
      document.querySelector('[data-quantity="minus"]').disabled = quantity === 1;
      document.querySelector('[data-quantity="plus"]').disabled = quantity === 99;
    }
    if (target.hasAttribute('data-add')) {
      const existing = cart.find(item => item.color === chosen);
      if (existing) existing.quantity += quantity; else cart.push({ color: chosen, quantity });
      updateCartCount();
      showToast(`${quantity} шт. · ${variants[chosen].name.toLowerCase()} подсветка — добавлено в демо-корзину.`);
    }
    if (target.hasAttribute('data-remove')) {
      cart.splice(Number(target.dataset.remove), 1);
      updateCartCount();
      openCart();
    }
    if (target.hasAttribute('data-favorite')) {
      const active = target.getAttribute('aria-pressed') !== 'true';
      target.setAttribute('aria-pressed', String(active));
      target.setAttribute('aria-label', active ? 'Убрать из избранного' : 'Добавить в избранное');
      showToast(active ? 'Добавлено в избранное на этой странице прототипа.' : 'Удалено из избранного.');
    }
    if (target.hasAttribute('data-enlarge')) {
      const drawing = document.querySelector('.product-drawing').cloneNode(true);
      drawing.querySelector('[data-enlarge]').remove();
      // Inline pattern IDs are made unique for the enlarged illustration.
      drawing.querySelector('pattern').id = 'enlarged-grid';
      drawing.querySelector('rect[fill]').setAttribute('fill', 'url(#enlarged-grid)');
      openDialog('Изображение-заглушка', '<p>Условная схема показывает место фотографии. Она не описывает конструкцию или размеры реального изделия.</p>');
      content.append(drawing);
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link && link.getAttribute('href').includes('#')) dialog.close();
  });
})();
