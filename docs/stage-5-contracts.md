# Этап 5 — реализация и контракты

Разрешён владельцем 22.09.2026. Только новый проект и локальные адаптеры. Этапы 6/7, публикация и реальные платежи/сообщения не запускаются. Применённые миграции 001–006 неизменяемы. Общая новая схема — migrations/007_store_expansion.sql, владелец схемы — главный агент.

## Области работы

- Главный: SQL, торговые команды/доставка/история/уведомления/генератор, manager API, базовые DTO, интеграция, запуск и приёмка.
- Контент: content repository, семь CMS-страниц, блог/теги/категории/VK/Rutube, страницы автомобилей, ссылки оболочки, configure-content/seed-content, content tests. Не менять schema или страницу товара.
- Социальные функции: избранное, отзывы/фото/модерация, social API, store.ts, favorites.astro, компонент отзывов и включение в product page; tests social. Не менять commerce.ts или manager pages.
- Интерфейс владельца: manager pages, manager portion commerce.ts, owner-tools.ts/CSS, история/трек для покупателя, инструкция владельца, браузерный тест этапа 5. API/SQL пишет главный.

## Схема

Точные поля — в 007. Content: ar_pages, ar_blog_categories, ar_blog_tags, ar_articles, ar_article_tags, ar_content_slugs. Контент — простой текст/абзацы, без небезопасного raw HTML. Статья видна только при публикации её категории и самой статьи. Видео — только нормализованные embed URL VK/VK Video и Rutube; без серверной загрузки видео и fetch пользовательского URL. Старые slug можно разрешать через ar_content_slugs с 301 на актуальный.

Social: ar_favorites(customer_id,product_id unique); ar_reviews(customer_id,product_id unique, order_id,author_name,body,status pending/approved/rejected,moderation_note,moderated_by,moderated_at); ar_review_media(review_id,image_data bytea,mime image/webp,width/height<=1600,sort0..4 unique). Покупатель подтверждён email; отзыв только на top-level productId в снимке собственного оплаченного заказа с delivery_status=delivered и delivered_at!=null. До этого отказ. Ни звёзд, ни оценок. Фото: до 5×10 MiB, тело <=51 MiB, JPEG/PNG/WebP, проверка реального формата и MIME, максимум24MP, запрет анимации, Sharp timeout10s и ограничение одновременной обработки, WebP<=2MiB с удалением метаданных. Непроверенные оригиналы не сохранять; image_data выдавать только при approved/published или авторизованному администратору в preview. Не включать картинки в JSON API.

Операции: ar_orders получает tracking_number,delivery_source(checkout/manager/carrier),delivery_override,carrier_status,carrier_updated_at,carrier_tracking_number (миграция008),delivery_updated_at,delivered_at. ar_order_notes — приватные заметки, не отдавать покупателю. ar_delivery_events — неизменяемая история источника/времени/применения. ar_owner_notifications — локальный outbox для каналов max/email, создаётся триггером событий заказа; worker доставляет только локально. ar_description_drafts — исходный fingerprint, два текста preview/applied. При Apply сервер меняет ТОЛЬКО description и meta_description, не seo_title.

## Общие API

JSON mutation: текущие Origin/CSRF, actor с сервера, idempotencyKey UUID. Денежные поля — строки Rubles. Любой тестовый адаптер требует local-test + loopback origin. GET личных данных — private,no-store. Установлен sharp 0.35.4; работа по документации Context7 /lovell/sharp.

### Social (реализует социальный агент)

- GET /api/social/favorites -> {authenticated:boolean,productIds:string[]}; POST {action:merge|add|remove,productIds?:string[],productId?:string,idempotencyKey}. Только подтверждённый customer для записи; лимит500. Merge — объединение без дублей/потерь. После успешного merge очищать гостевой список; не смешивать локальный кеш разных вошедших пользователей. Обновлять с других устройств при открытии/возврате фокуса.
- GET /api/social/reviews?productId=UUID -> {reviews:ReviewView[],canReview:boolean,eligibleOrders:{id,number}[]}. ReviewView: {id,productId,productName,authorName,body,status,moderationNote?:string,createdAt,media:{id,url,width,height}[]}.
- POST /api/social/reviews multipart: productId,orderId,authorName,body,idempotencyKey и files (0–5). Сохранять как pending.
- GET /api/social/moderation -> {reviews:ReviewView[]} только staff; POST {reviewId,status:approved|rejected,note,idempotencyKey} -> ReviewView. Приватные media URL /review-media/{id}?preview=1 проверяют staff.

### Manager (реализует главный)

Все пути /api/manager/, права действующего staff. DTO src/lib/management-types.ts.

- GET orders -> {orders:ManagerOrderView[]}; обычный OrderView расширен trackingNumber,deliverySource,deliveryOverride,deliveredAt. ManagerOrderView добавляет notes и deliveryEvents, которые не выдаются клиентским commerce endpoints.
- POST note {orderId,note,idempotencyKey} -> ManagerOrderView.
- POST stock-adjust {skuId,onHand,reason,idempotencyKey} -> {ok:true}; onHand целое>=reserved, журнал разницы.
- POST order-cancel {orderId,reason,idempotencyKey} -> ManagerOrderView; отмена неоплаченных, paid требует отдельного процесса возврата.
- POST fulfillment {orderId,status:packing|shipped|delivered,trackingNumber?,reason,idempotencyKey} -> ManagerOrderView; только paid, нормальная последовательность. Действие сотрудника включает ручное управление статусом.
- POST delivery-override {orderId,status:quoted|packing|shipped|delivered|null,reason,trackingNumber?,idempotencyKey} -> ManagerOrderView. status=null снимает override и применяет последний допустимый статус перевозчика. События при override записываются, не затирают ручное решение.
- POST carrier-test {orderId,status:packing|shipped|delivered,occurredAt:ISO,providerEventId,idempotencyKey} -> ManagerOrderView. Локальный имитатор подписывает событие, общий обработчик проверяет подпись/дубликаты/порядок. Публичный endpoint /api/delivery/event принимает подписанное событие от тестового адаптера; неподписанные события отвергаются.
- GET notifications -> {notifications:OwnerNotification[]}. POST notification-retry {notificationId,idempotencyKey} -> {ok:true}; не создаёт новую запись.
- GET products -> {products:GenerationProduct[]}; DTO включает текущие description,metaDescription,seoTitle.
- POST generate {productId,simulateFailure?:boolean,idempotencyKey} -> DescriptionDraft; локальный имитатор, без OpenAI-запросов/оплаты.
- POST apply-description {draftId,description,metaDescription,idempotencyKey} -> {ok:true,product:GenerationProduct}. Факты и прежний текст проверяются fingerprint; конфликт409 не затирает CMS. Draft принадлежит actor. Два поля editable в preview; title отображать только для чтения.

## CMS

Страницы/статьи/категории/теги редактируются owner/editor. Отзывы, заметки, события, уведомления и генерации — только просмотр owner, команды через manager. Native presentation-links в карточке товара «Сгенерировать описание» ведёт /manager/content?product={{id}}. Частные бинарные review media не регистрировать в публичном Files. Настройка новых отношений — только метаданные, сохранять SQL FK; ориентироваться на configure-cms.mjs. Главный подключает новые configure/seed скрипты к setup.

## Приёмка

Отдельная PostgreSQL QA, без активации копии Directus/OIG. Проверить слияние/чужие favorites, покупку/получение для review, модерацию и закрытые фото, invalid/oversized/multi-frame images; статусы перевозчика duplicate/out-of-order/override; изменения CMS→SSR и публикацию родителей; Apply two fields/concurrency/title/errors; stock adjustment vs reserve; owner notifications dedup/local-only. Браузер desktop/mobile и реальные формы CMS. Все QA-данные очистить; файлы/дампы/ключи не коммитить.
