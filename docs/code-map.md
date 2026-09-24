# Карта кода по задачам

Проверено 24.09.2026. Открывать нужную строку таблицы вместо чтения всего репозитория. Пути относятся к корню проекта; ссылки ведут к основному файлу, соседние модули названы рядом.

| Что менять | Где начать | Что проверить |
|---|---|---|
| Шапка, меню, общие стили | [StoreLayout.astro](../src/layouts/StoreLayout.astro), `src/styles/global.css` | Desktop/mobile, навигация, счётчики, отсутствие горизонтального скролла |
| Каталог/фильтры/поиск/страницы | [catalog.ts](../src/lib/catalog.ts), `src/pages/catalog.astro`, `src/lib/pagination.ts`, `src/scripts/catalog.ts` | Все условия совпадают на одном SKU; страницы по12; сброс page при фильтрации |
| Чтение каталога из CMS | [server/catalog.ts](../src/server/catalog.ts), `src/lib/catalog-types.ts` | Статусы родителей/SKU, наследование фото/атрибутов/совместимости |
| Товар, миниатюры, увеличение | [product/[slug].astro](../src/pages/product/[slug].astro), `src/scripts/product.ts`, `src/styles/product.css` | Новый снимок/счётчик/modal, клавиатура, ошибка/гонка загрузки, вертикальное фото |
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
| Владелец/CRM | [management.ts](../src/server/management.ts), `src/pages/manager/`, `src/scripts/owner-tools.ts` | Роли, stock-команды, причины, заметки, override доставки |
| Страницы/блог | [content.ts](../src/server/content.ts), `src/lib/content.ts`, `src/pages/info/`, `src/pages/blog/` | Публикация, slug/редирект, экранирование, только разрешённые видео |
| Отзывы | [social.ts](../src/server/social.ts), `social-photos.ts`, `src/components/Reviews.astro` | Только полученный заказ, модерация, приватность исходников/неодобренных фото |
| Генератор текстов | [description-generation.ts](../src/server/description-generation.ts), `adapters/description.ts` | Preview/Apply, изменённые исходные данные, ручной title. Сейчас имитатор |
| SEO/фид | [seo.ts](../src/lib/seo.ts), `src/server/seo.ts`, `src/lib/feed.ts` | SSR SKU, canonical, sitemap/YML, отсутствие ложных свойств; staging остаётся noindex |
| Схема/CMS | [migrations](../migrations), `cms/model.mjs`, `scripts/configure-*.mjs` | Только новая миграция, SQL и CMS-права, метаданные, совместимость старых заказов |
| Выпуск/маршрутизация | [server-staging.md](server-staging.md), `Dockerfile`, `infra/release/` | Нужный overlay, SHA web/worker, /cms, /muzey/, webhook, публичная витрина |

## Точки входа HTTP

Серверные маршруты в `src/pages/api/`: commerce, auth, social, manager, shipping, delivery/event, payments/yookassa. Публичного CRUD торговых таблиц нет.

`src/pages/demo-cart.astro`, `src/lib/demo.ts`, `prototypes/` — наследие прототипа/fixtures, не источник рабочего каталога. Не исправлять их вместо активных cart/catalog/server-модулей.

Точный смысл DTO — в `src/lib/commerce-types.ts`, `catalog-types.ts`, `management-types.ts`, `social-types.ts`; реальная схема — последовательность миграций. `cms/schema.snapshot.json` не содержит рабочих данных и не заменяет миграции/backup.
