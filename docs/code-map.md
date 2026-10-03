# Карта кода по задачам

Проверено 24.09.2026. Открывать нужную строку таблицы вместо чтения всего репозитория. Пути относятся к корню проекта; ссылки ведут к основному файлу, соседние модули названы рядом.

| Что менять | Где начать | Что проверить |
|---|---|---|
| Шапка, меню, общие стили | [StoreLayout.astro](../src/layouts/StoreLayout.astro), `src/styles/global.css` | Desktop/mobile, навигация, счётчики, отсутствие горизонтального скролла |
| Каталог/фильтры/поиск/страницы | [catalog.ts](../src/lib/catalog.ts), `src/pages/catalog.astro`, `src/lib/pagination.ts`, `src/scripts/catalog.ts` | Все условия совпадают на одном SKU; страницы по12; сброс page при фильтрации |
| Чтение каталога из CMS | [server/catalog.ts](../src/server/catalog.ts), `src/lib/catalog-types.ts` | Статусы родителей/SKU, наследование фото/атрибутов/совместимости |
| Товар, миниатюры, увеличение | [product/[slug].astro](../src/pages/product/[slug].astro), `src/scripts/product.ts`, `src/scripts/photo-swipe.ts`, `src/styles/product.css` | Миниатюры/счётчик/modal, клавиатура и свайпы; вертикальная прокрутка/pinch zoom, отмена жеста, ошибка/гонка загрузки |
| Закреплённые разделы товара | `src/scripts/product-sections.ts`, `product/[slug].astro`, `src/styles/product.css` | Панель до конца отзывов; якоря, aria-current, короткие разделы, клавиатура/Back,375/768/1280px; не помещать обратно внутрь левой колонки |
| Похожие товары и история | `src/lib/product-discovery.ts`, `src/scripts/product-discovery.ts`, `ProductCarousel.astro`, `api/catalog/recent.astro` | Точный SKU, актуальная цена, TTL/очистка, безопасные публичные карточки, применимость и ручной порядок |
| Удаление и восстановление | `src/server/product-lifecycle.ts`, `src/scripts/product-lifecycle.ts`, `api/manager/product-lifecycle.ts`, миграция015 | Архив без потери заказов/остатков, защита комплектов и устаревшего подтверждения, идемпотентность, восстановление только в черновик |
| Избранное | [FavoriteButton.astro](../src/components/FavoriteButton.astro), `src/scripts/social-favorites.ts`, `src/server/social.ts` | Гость/аккаунт/вкладки/merge; личный badge, без популярности «N человек» |
| Фото каталога | [media/[id].ts](../src/pages/media/[id].ts), таблицы `directus_files`, `ar_product_media`, `ar_sku_media` | Файл опубликованного товара, путь/тип/размер; uploads доступны web только для чтения |
| Корзина и UI checkout | [commerce.ts](../src/scripts/commerce.ts), `src/pages/cart.astro`, `src/pages/checkout.astro`, `src/scripts/russian-validation.ts` | Очередь автосохранения, версия, быстрые правки, переход после сохранения, русские сообщения |
| Кнопка «Перейти в корзину» | [store.ts](../src/scripts/store.ts), `src/scripts/commerce.ts`, `src/pages/product/[slug].astro` | Успех/ошибка, точный SKU, обе кнопки, reload/back, смена количества, отсутствие повторного POST |
| Деньги/снимок/разделение | [pricing.ts](../src/server/pricing.ts), `src/lib/money.ts`, `src/server/cart.ts` | Точные строки RUB, единый спрос компонентов, неизвестная доставка, смена цены/наличия |
| Заказ/склад/сроки | [orders.ts](../src/server/orders.ts) | Транзакции, одинаковый порядок блокировок, повтор/конкуренция, однократное списание/возврат |
| ЮKassa | [yookassa-payments.ts](../src/server/yookassa-payments.ts), `adapters/yookassa-sandbox.ts`, `payment-policy.ts`, `src/pages/api/payments/yookassa.ts` | Таймаут/неизвестный исход, повтор с тем же ключом, callback+GET, поздняя оплата |
| СДЭК/упаковка | [cdek-shipping.ts](../src/server/cdek-shipping.ts), `adapters/cdek.ts`, `adapters/shipping.ts`, `shipping-policy.ts` | Вес г/размер мм→см, упаковка состава, quote5мин, нет сети под складскими блокировками |
| Карта и ранняя стоимость | [shipping-form.ts](../src/scripts/shipping-form.ts), `yandex-pickup-map.ts`, `commerce.ts` | Автозагрузка SDK после выбора города, карта/список, устаревший ответ, цена без контактов |
| Подтверждения | [confirmations.ts](../src/server/confirmations.ts), `src/lib/checkout-confirmations.ts`, миграция011 | Пустое/ложное/устаревшее подтверждение, неизменяемый текст/время. Менять version при изменении смысла текста |
| Сессия/вход/права | [security.ts](../src/server/security.ts), `auth.ts`, `http.ts`, `src/middleware.ts` | Cookie/CSRF/Origin, OTP, другой клиент, штатная авторизация CMS |
| Worker/сообщения | [worker.ts](../src/server/worker.ts), `scripts/commerce-worker.ts`, `notifications.ts` | Истечение резервов, сверка PSP, heartbeat; delivered имитатора не означает настоящее письмо |
| Рабочие разделы кабинета | [manager-workspace.ts](../src/server/manager-workspace.ts), `src/lib/manager-workspace.ts`, `src/scripts/manager-*.ts`, `src/pages/manager/`, `manager-workspace.css` | Пагинация/поиск, отдельный заказ, складские dialog/идемпотентность/история, ссылки и общий вход; [контракт](manager-workspace.md) |
| Единая форма товара | [product-editor.ts](../src/server/product-editor.ts), `product-editor-images.ts`, `src/lib/product-editor.ts`, `src/scripts/product-editor.ts`, `src/pages/manager/products/edit.astro`, миграция012 | Черновик отдельно, права/CSRF, фото, атомарная публикация/приход, повторы, конфликтCMS, варианты/совместимость; [контракт](product-editor-proposal.md) |
| Владелец/CRM | [management.ts](../src/server/management.ts), `src/pages/manager/`, `src/scripts/owner-tools.ts` | Роли, stock-команды, причины, заметки, override доставки |
| Дашборд владельца | [dashboard.ts](../src/server/dashboard.ts), `src/lib/dashboard.ts`, `src/scripts/dashboard.ts`, `src/layouts/ManagerLayout.astro`, `src/styles/dashboard.css` | Подтверждённые тестовые оплаты, даты МСК, повторы, роли, устаревшие ответы и автообновление; [контракт](dashboard.md) |
| Страницы/блог | [content.ts](../src/server/content.ts), `src/lib/content.ts`, `src/pages/info/`, `src/pages/blog/` | Публикация, slug/редирект, экранирование, только разрешённые видео |
| Отзывы | [social.ts](../src/server/social.ts), `social-photos.ts`, `src/components/Reviews.astro` | Только полученный заказ, модерация, приватность исходников/неодобренных фото |
| Генератор текстов | [description-generation.ts](../src/server/description-generation.ts), `adapters/description.ts` | Preview/Apply, изменённые исходные данные, ручной title. Сейчас имитатор |
| Настоящая генерация в форме товара | [product-ai.ts](../src/server/product-ai.ts), `adapters/ai-text.ts`, `src/scripts/product-ai.ts`, `src/lib/ai-text.ts`, миграция013 | Общий бюджет, резерв до внешнего вызова, повторы/неопределённость, вход/CSRF, whitelist фактов, применение только в форму; [контракт](ai-text-generation.md) |
| SEO/фид | [seo.ts](../src/lib/seo.ts), `src/server/seo.ts`, `src/lib/feed.ts` | SSR SKU, canonical, sitemap/YML, отсутствие ложных свойств; staging остаётся noindex |
| Схема/CMS | [migrations](../migrations), `cms/model.mjs`, `scripts/configure-*.mjs` | Только новая миграция, SQL и CMS-права, метаданные, совместимость старых заказов |
| Выпуск/маршрутизация | [server-staging.md](server-staging.md), `Dockerfile`, `infra/release/` | Нужный overlay, SHA web/worker, /cms, /muzey/, webhook, публичная витрина |

## Точки входа HTTP

Генератор инфографики: `src/scripts/product-infographic.ts`, `src/lib/product-infographic.ts`, `src/lib/infographic-text.ts`, `src/server/product-background.ts`, `services/background-removal/`, миграция014. Проверять приватность исходников, очередь1+2, кисти/отмену, свободное размещение фото, размеры/переполнение текста, PNG и сохранение рецепта после публикации, retry. [Контракт](product-infographics.md).

Серверные маршруты в `src/pages/api/`: commerce, auth, social, manager, shipping, delivery/event, payments/yookassa. Публичного CRUD торговых таблиц нет.

`src/pages/demo-cart.astro`, `src/lib/demo.ts`, `prototypes/` — наследие прототипа/fixtures, не источник рабочего каталога. Не исправлять их вместо активных cart/catalog/server-модулей.

Точный смысл DTO — в `src/lib/commerce-types.ts`, `catalog-types.ts`, `management-types.ts`, `social-types.ts`; реальная схема — последовательность миграций. `cms/schema.snapshot.json` не содержит рабочих данных и не заменяет миграции/backup.

- Главная, демонстрационные товарные отзывы и статьи: [homepage-content.md](homepage-content.md).
