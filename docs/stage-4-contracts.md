# Этап 4 — контракты реализации

> Исторический базовый контракт этапа4. Актуальный checkout дополнен подтверждением условий и провайдерами: [architecture.md](architecture.md), [yookassa-checkout-contract.md](yookassa-checkout-contract.md), [cdek-checkout-contract.md](cdek-checkout-contract.md).

Разрешён владельцем. Только локальные адаптеры, без реальных платежей/писем/публикации. Стиль A и светлая CMS сохраняются.

## Владение кодом

Главный агент: миграции, pg-доступ, сессии, корзина/заказы, складские транзакции, оплата/доставка/OTP, worker, manager API и интеграция. Отдельный агент каталога: live catalog DTO/repository, исходные страницы/карточки и media route. Агент интерфейса покупки: новые cart/checkout/orders/account/manager страницы, клиентский store.ts и commerce CSS. Общую SQL-схему меняет главный агент.

## Серверная основа

src/server/db.ts экспортирует query(sql, params), getPool(), transaction(fn, repeatable=true), передаёт один PoolClient в транзакцию и повторяет serialization/deadlock ошибки. Только ar_app и новая БД либо ar_qa_*.

src/server/catalog.ts (агент каталога) экспортирует async getCatalog(): CatalogSnapshot. Снимок свежий на запрос, без общего кеша. Только опубликованные товары/родители/SKU. CMS изменяет PostgreSQL; storefront читает те же данные своей ролью. Изображения выдаёт /media/:id после проверки связи с опубликованным каталогом, из read-only тома uploads. Никаких токенов CMS в браузере. При локальной разработке media допускает проксирование в Docker-витрину.

## HTTP-контракты для клиента

Типы DTO: src/lib/commerce-types.ts. Денежные поля имеют суффикс Rubles и строковый формат "7200.00"; SQL-колонки *_rubles — numeric(16,2). Расчёты выполняются Decimal в рублях. JSON-ошибка всегда {error:{code,message}}. Изменяющий запрос — POST JSON, same-origin, заголовок X-CSRF-Token, уникальный idempotencyKey (crypto.randomUUID). Session endpoint выдаёт csrfToken; cookie HttpOnly, SameSite=Lax. Личные данные никогда не кешируются.

| Endpoint | Запрос / ответ |
|---|---|
| GET /api/commerce/session | ShopSession; csrfToken, email после OTP |
| GET /api/commerce/cart | CartView |
| POST /api/commerce/cart | {productId,skuId,quantity,mode:'add'/'set'/'remove',cartVersion,idempotencyKey} → CartView |
| POST /api/commerce/quote | CheckoutInput → CheckoutQuote; это ещё не заказ |
| POST /api/commerce/checkout | {quoteId,cartVersion,idempotencyKey} → CheckoutResult; изменение цены/состава/разделения после quote требует нового просмотра |
| GET /api/commerce/orders | {orders:OrderView[]} — собственные гостевые и подтверждённого email |
| GET /api/commerce/order?id=UUID | OrderView, проверка сессии/email обязательна |
| POST /api/commerce/pay | {orderId,shippingVersion,method:'card'/'sbp',idempotencyKey} → OrderView; тестовая оплата, только после известной доставки и разрешённого состояния |
| POST /api/commerce/cancel | {orderId,idempotencyKey} → OrderView |
| POST /api/auth/request | {email} → {challengeId,expiresAt}; письмо в защищённый тестовый почтовый ящик |
| POST /api/auth/verify | {challengeId,code} → {ok:true}; ротация сессии, затем /account |
| POST /api/auth/logout | {} → {ok:true} |
| POST /api/manager/login | {email,password} → {ok:true}; авторизация через новый Directus, секрет не хранится в браузерном JS |
| GET /api/manager/orders | {orders:OrderView[]}; только CMS-администратор |
| GET /api/manager/mail | {messages:[{id,to,subject,body,createdAt}]} — только локально и менеджеру |
| POST /api/manager/shipping | {orderId,costRubles,note,idempotencyKey} → OrderView |
| POST /api/manager/confirm | {orderId,terms,idempotencyKey} → OrderView; списать обеспеченный предзаказ, срок 30 минут |
| POST /api/manager/stock | {skuId,quantity,reason,idempotencyKey} → {ok:true}; приход для обеспечения предзаказа |

Backend requireStaff проверяет текущего пользователя и /permissions/me нового Directus по его session cookie. Только полный доступ update ar_stock разрешает команды; identity берётся с сервера. Редактор контента ими не управляет. В CMS заказы доступны владельцу только для чтения; безопасные команды — в разделе /manager с тем же входом.

## Поведение покупки

Строки не дробятся: в порядке добавления строки, полностью обеспеченные свободным остатком всех физических SKU, идут в обычный заказ; остальные целиком в предзаказ. Доставка рассчитывается отдельно. Без данных упаковки/правила коробки или при сбое адаптера стоимость null, требуется ручной расчёт и оплата закрыта.

Обычный заказ резервирует физические SKU на 30 минут одной транзакцией. Предзаказ до подтверждения ничего не держит; подтверждение при наличии всех составляющих списывает их сразу и открывает оплату на 30 минут. Оплата не списывает их повторно. Истечение/отмена освобождают резерв либо возвращают предварительное списание один раз. Платёж после срока/возврата — manual_review без автоматической отгрузки.

Снимки названий/артикулов/цен/состава неизменяемы после checkout. Stock locks в порядке UUID; order lock предшествует его складским операциям. Повторы checkout/payment/manager/worker безопасны. Фоновый worker реально обрабатывает сроки, а не зависит от открытия страницы.

OTP: 10 минут, 5 попыток, пауза повторной отправки 60 секунд и общие лимиты. Номер заказа или введённый email не дают доступ к чужой истории. Тестовый inbox защищён менеджерским входом; код не возвращается покупателю в API.
