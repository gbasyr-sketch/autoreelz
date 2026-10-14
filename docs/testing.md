# Какие проверки запускать

Cookies/документы14.10: `tests/privacy.test.ts`, `tests/privacy-database.mjs`, `tests/legal-pages.test.ts`; `node scripts/build-legal-preview.ts` собирает обзор и пакет черновиков. `tests/privacy-preview.mjs` поднимает отдельную синтетическую БД, app14363 и proxy14364; заменяет только URL SDK на местную имитацию, проверяет настоящие API403/409/no-store. UI проверять в браузере: отказ/reload, неизвестный исход/retry, принятие, отзыв в нескольких вкладках, медленная загрузка, кабинет/query/404. При SIGINT fixture завершает процессы и удаляет свою QA-базу. Снимки только private. Обезличенные результаты — artifacts/legal-analytics. Проверка фикстуры не подтверждает работу настоящего ещё не созданного счётчика Метрики.

Актуально на24.09.2026. Это выбор по риску изменения, не требование запускать всё. Команды из корня проекта с pinned Node/npm; запуск среды — [development.md](development.md).

## Базовые проверки

Объединённый checkout15.10: [контракт](combined-checkout.md). Backend: `AR_QA_NATIVE=1 AR_COMMERCE_TESTS=1 AR_STAGE6_TESTS=1 AR_CDEK_TESTS=1 AR_YOOKASSA_TESTS=1 node --test --test-concurrency=1 tests/commerce.test.ts tests/stage-6-commerce.test.ts tests/cdek-checkout.test.ts tests/yookassa-integration.test.ts`. Полный синтетический browser/API: `node tests/combined-checkout-browser.mjs` после build, порт14365; `AR_COMBINED_OUTPUT` по умолчанию `private/combined-checkout/full-browser`. Поддерживает `AR_CHROMIUM_EXECUTABLE`/`PLAYWRIGHT_MODULE`. Старый UX-набор также поддерживает `AR_QA_NATIVE=1`, установленный Chromium и вывод в private через `AR_CHECKOUT_UX_OUTPUT`. Запускать DB-наборы последовательно, не копировать реальные товары/заказы. У нового browser-набора все операции API настоящие локальные, shipping/payment=simulation, внешние запросы блокируются; это не новая проверка реальных тарифов/оплаты.

Транспорт Яндекса14.10: `python3 tests/yandex-webdav.py` — границы собственной папки, HTTPS-адреса и запрет переноса credentials, сохранение PUT/тела, ограниченные цепочки переходов, read-back/SHA256 и неопределённый исход, частичное чтение, размеры/формат body, отсутствие секретов в argv. После изменения маршрута/заголовков нужны сверка прежнего repo ID, настоящая передача и внешний restore. Не переинициализировать репозитории; обновлять runner только вне работающего задания. Range направляется в узел хранения, а не в медленный управляющий endpoint.

Серверные копии14.10: `python3 tests/store-backup.py`, `node --experimental-strip-types --test tests/backup-status.test.ts`, `tests/dashboard-browser.mjs` (1440/768/375). Проверяют повреждённые/отсутствующие файлы, symlink, оба формата ИИ, закрепление репозитория, запрет retention до восстановления/при очереди, сохранение локального снимка при сбое облака, повтор без лишнего снимка и отсутствие секретов в статусе. Реальный runner проверять сначала `capture`/`verify-local`, затем внешнюю передачу/`verify`, только после успеха — service и timers. Изолированный drill не подключает сеть, внешние оплаты/ИИ и лицензированную CMS. [Контракт](server-backups.md). Фото и полные логи UI/восстановления хранить в private; в artifacts только обезличенные результаты.

Шлюз OpenAI09.10: `python3 tests/ai-gateway.py` (без внешних вызовов), `tests/ai-text.test.ts` и check/build. Транспортная проверка из настоящего web использует health/неверный секрет/неверное тело без платной генерации, проверяет закреплённый сертификат. Реальная проба только через журнал бюджета, с сохранённым idempotencyKey; старые live-скрипты не запускать повторно. Доказательства — artifacts/ai-gateway; [регламент и откат](ai-gateway.md).

Карта OSM07.10: `node tests/pickup-map-browser.mjs` проверяет опубликованный checkout на1440/768/375, по умолчанию `AR_MAP_URL=https://autoreelz.ru`; `AR_MAP_OUTPUT` задаёт папку отчёта, `AR_CHROMIUM_EXECUTABLE` — путь браузера. Все API, кроме загрузки HTML/ассетов, и все тайлы подменены: реальные заказы/корзины/тарифы не создаются. Проверены автозагрузка, отсутствие Яндекса/согласия, кластеры, клавиатура/popup, список/поля/ранняя цена, курьер, пустой город, сбой подложки и ПВЗ без координат. `AR_MAP_CANDIDATE=1` только для репетиции переключения: заменяет провайдер в полученном HTML; не является проверкой серверной конфигурации. Отчёты — artifacts/osm-map. Автоматические pan/zoom не направлять к публичному tile.openstreetmap.org.

Контент03.10: `tests/content-editor.test.ts`, `tests/content-editor-database.mjs` (только `ar_qa_content_editor_*` со схемой001–019), `tests/content-editor-browser.mjs` с `AR_CONTENT_URL`/`AR_CONTENT_OUTPUT`. Браузерные записи подменены; настоящий API проверяется на отдельной QA-БД, а опубликованные материалы читаются без сохранения. После изменения медиа-защиты запускать регрессию библиотеки и редактора товаров. Доказательства — artifacts/content-editor.

Объединение цветов03.10: `tests/product-color-merges-database.mjs` — только `ar_qa_color_merges_*` со схемой001–017 и синтетическими записями. `AR_COLOR_URL=<preview> node tests/product-color-merges-browser.mjs` использует рассмотренный каталог из `AR_COLOR_PLAN` либо `artifacts/color-merge/rehearsal.json`. Проверяет точные цвета/цены/галереи, старые ссылки, избранное/историю. [Контракт](product-color-merges.md). Не выполнять разовый SQL переноса на рабочей базе повторно ради теста.

- `npm run check` — Astro/TypeScript.
- `npm test` — быстрые тесты. Интеграционные suites без своих флагов будут **skipped**, это не их успешный прогон.
- `npm run build` — свежий `dist` для браузерных harness.
- `git diff --check` — ошибки пробелов/патча.

Только документация: проверка ссылок и фактов, без изменения БД/сборки/публикации. Для простой обратимой правки не создавать тест, повторяющий её реализацию.

## Единая форма товара (30.09.2026)

Коллаж комплекта: `tests/bundle-collage.test.ts`, `tests/bundle-collage-browser.mjs`. `AR_COLLAGE_PUBLIC=1` проверяет опубликованный клиент; API подменён. Проверяются геометрия/края изображений,20 позиций, повтор загрузки, заполненная галерея и очистка после выхода. Результаты — artifacts/bundle-collage.

Комплекты03.10: `tests/bundle-editor.test.ts`; `tests/bundle-editor-database.mjs` на отдельной `ar_qa_product_editor_*` со схемой001–018; `tests/bundle-editor-browser.mjs` на375/768/1440. `AR_BUNDLE_PUBLIC=1` проверяет опубликованный клиент, по умолчанию подменяются HTML/JS/CSS на локальную сборку. API синтетические в обоих случаях. Регрессии обычного редактора и lifecycle обязательны при изменении общего сохранения. [Контракт](bundle-editor.md).

Библиотека фото03.10: `tests/product-image-library-database.mjs` запускается только на отдельной `ar_qa_product_editor_library_*` со схемой001–016 и синтетическими записями. Проверяет переиспользование, корзину/восстановление, защиту всех ссылок и гонку с сохранением. `AR_LIBRARY_URL=<preview> node tests/product-image-library-browser.mjs` проверяет четыре размера экрана с mockAPI. [Контракт](product-image-library.md). Не использовать рабочий каталог для мутационных QA-наборов.

Инфографика: `node --test tests/product-infographic.test.ts`; `.tools/background-removal/venv/bin/python tests/background-worker.py`; `AR_INFO_URL=<preview> node tests/product-infographic-browser.mjs` (mockAPI). DB-набор редактора требует миграцию014 на отдельной базе и проверяет приватный рецепт после публикации/замены галереи. Реальная связка CMS/API/worker проверяется с временными файлами и их удалением. Доказательства — `artifacts/infographics/`.

Генерация: `node --test tests/ai-text.test.ts`; `tests/ai-text-database.mjs` допускает только отдельную `ar_qa_ai_text_*` с миграцией013, использует подменённые адаптеры, не тратит средства. `AR_AI_URL=<preview> node tests/product-ai-browser.mjs` — подменённыеAPI, ручное применение/конфликт/повтор и mobile. Реальные платные пробы запускать отдельно, с учётом в рабочем журнале расходов и в согласованном месячном лимите. Не применять результаты к рабочим товарам без команды владельца.

`node --test tests/product-editor.test.ts` — единицы, суммы, пустые черновики, ограничения и публикация. `tests/product-editor-database.mjs` — только отдельная PostgreSQL `ar_qa_product_editor_*` с полной схемой и миграцией012: повтор/конкурентная публикация, приход, конфликты CMS, сохранение чужой упаковки, дубли/фотографии/связи. Не запускать на рабочем каталоге; QA-базу удалить после проверки. `AR_EDITOR_URL=<preview> node tests/product-editor-browser.mjs` — интерфейс375/768/1440, подменённыеAPI, черновик/retry/фото/предпросмотр/повторный вход. Настоящие upload/auth/CSRF/API проверены отдельно в изолированной торговой БД; временный файл собственной проверки в CMS удалён, сессия отозвана. Доказательства — `artifacts/product-editor/`.

## ИИ-инфографика (локально, 09.10.2026)

- `node --test tests/ai-images.test.ts`: модель/формат, whitelist данных, подсчёт тарифа, границы лимита и ответы провайдера.
- `node tests/ai-image-database.mjs`: только отдельная `ar_qa_ai_images_*`; источники/результаты, подпись сметы, идемпотентность, бюджетные резервы, очередь, неизвестный исход без повторного вызова, восстановление по квитанции, ошибки и отдельность текстового журнала.
- `python3 tests/ai-image-gateway.py`: локальная проверка преобразования запроса и allowlist; OpenAI не вызывается.
- `node tests/ai-image-api.mjs` — только вместе с локальным `tests/helpers/ai-image-preview.mjs` и уникальными `AR_IMAGE_PREVIEW_DATABASE`, `AR_IMAGE_PREVIEW_DIR`, `AR_AI_IMAGE_ARTIFACT_DIR`. Preview использует CMS-имитатор, отдельную базу и `AI_IMAGE_PROVIDER=simulation`; API проверяет вход/CSRF, gallery/import/upload, PNG/privacy, повтор, применение и явное сохранение черновика. Останавливать preview с `AR_IMAGE_PREVIEW_DROP_DATABASE=1 AR_IMAGE_PREVIEW_REMOVE_FILES=1`.
- `node tests/ai-image-studio-browser.mjs` — Playwright/Chrome, desktop1440 и mobile375; реальный локальный UI с simulation, фоновой очередью и фиктивной CMS. Для локальной проверки использован браузер Codex. При выпуске настоящий UI1440/375 проверен установленным Yandex/Chromium с отдельными профилями; отчёт — artifacts/ai-image-studio/server-deploy/browser. В публичной UI-проверке нет генерации/сохранения товара; реальный gateway-вызов проверяется отдельно по сохранённому ключу запроса.
- Не запускать `tests/ai-image-pilot.mjs` и не менять provider на `openai` без согласованного бюджета изображений. Текстовая генерация имеет отдельный бюджет/журнал; использовать текущий текстовый учёт для image QA нельзя.

## Матрица по областям

| Изменение | Основная проверка | Дополнение при затрагивании поведения |
|---|---|---|
| Деньги/фильтры/SEO | `node --test tests/money.test.ts tests/catalog.test.ts tests/seo.test.ts` | SSR/фильтры в браузере |
| Корзина, склад, заказы | `AR_COMMERCE_TESTS=1 node --test tests/commerce.test.ts` | `AR_STAGE6_TESTS=1 node --test tests/stage-6-commerce.test.ts` для комплектов/предзаказов |
| Вход/доступ | `AR_AUTH_TESTS=1 node --test tests/auth.test.ts` | Покупка/чужая сессия/выход |
| ЮKassa | `node --test tests/yookassa.test.ts`; `AR_YOOKASSA_TESTS=1 node --test tests/yookassa-integration.test.ts` | Реальный sandbox — отдельно по процедуре yookassa.md |
| Отправления СДЭК | `node --test tests/cdek-shipments.test.ts`; `node tests/cdek-shipments-database.mjs` — отдельная синтетическая native PostgreSQL через ai-image-qa helper | `AR_CDEK_SHIPMENTS_URL=<local> node tests/cdek-shipments-browser.mjs` —1440/375, подмена API, скриншоты private; [контракт](cdek-shipments.md). Настоящую песочницу не повторять без необходимости; доступы/пробы вне Git |
| СДЭК | `node --test tests/cdek.test.ts`; `AR_CDEK_TESTS=1 node --test tests/cdek-checkout.test.ts` | `AR_CDEK_BROWSER=1 node tests/cdek-browser.mjs` использует настоящий API и private/cdek.env |
| Автокорзина/русские поля/подтверждения | `AR_CHECKOUT_UX_TESTS=1 node tests/checkout-ux-browser.mjs` | Справочники/SDK подменены. С24.09 проверяется автозагрузка без записи согласий; `AR_CHECKOUT_UX_OUTPUT` позволяет сохранить отчёт отдельно |
| Галерея/кнопка избранного/badge | `node tests/product-gallery-browser.mjs` | 1440/375px, быстрый выбор/ошибка, гость/аккаунт/две вкладки |
| Серверное избранное/отзывы | `AR_SOCIAL_TESTS=1 node --test tests/social.test.ts` | `node tests/social-browser.mjs` — полный социальный путь |
| Кабинет владельца | `AR_STAGE5_TESTS=1 node --test tests/management.test.ts` | `node tests/owner-browser.mjs` |
| Контент | `AR_CONTENT_TESTS=1 node --test tests/content-integration.test.ts` | `node tests/content-storefront-browser.mjs` — чтение текущей локальной витрины |
| Объединённое оформление/покупка | `node tests/combined-checkout-browser.mjs` | Синтетическая база/реальные локальные API, simulation,1440/768/375/landscape; старый `purchase-browser.mjs` использует seed/Docker и прежний split-сценарий, для нового checkout не применять |
| Релизная конфигурация | `node --test tests/release.test.ts tests/test-environment.test.ts`; `node tests/release-config.mjs` | `node tests/release-proxy.mjs` — QA-процесс на14330; старые gate-тесты не описывают нынешний публичный доступ |

## Что тесты могут менять

QA-наборы используют удаляемые базы `ar_qa_*` нового локального PostgreSQL. `tests/helpers/qa-db.mjs` копирует текущую локальную схему; поэтому ожидает применённые миграции. Это не серверный snapshot. Копия может содержать приватные настройки — не сохранять dump в artifacts/Git. Cleanup удаляет только свой QA-клон.

CMS-наборы `cms-browser`, `content-browser`, `stage6-cms-*`, schema/permissions работают с **локальной CMS**, могут создавать/изменять помеченные записи и метаданные. Не запускать их на реальном каталоге и параллельно с редактированием CMS. Старые bootstrap/seed не являются тестом.

`cdek-browser` обращается к реальному калькулятору, но не создаёт накладных. `scripts/check-yookassa.ts` проверяет GET/me, не создаёт оплату. Сценарии sandbox-платежей создают настоящие записи тестового PSP — их нельзя запускать вслепую повторно.

## Порты и зависимости

| Порт | Использование |
|---|---|
| 14325 | purchase-browser |
| 14326 | owner-browser |
| 14327 | social-browser |
| 14329 | seo-browser |
| 14330 | product-gallery, checkout-ux, cdek-browser, release-proxy — **последовательно** |

Нужны Chrome и Playwright. Большинство harness принимают `PLAYWRIGHT_MODULE`; некоторые новые используют прямо `$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`. Перед переносом на другой компьютер проверить импорт конкретного harness. Часть старых тестов также содержит путь `.tools/node-v24.21.0-darwin-arm64/bin/node`.

## Отчёты и публичная проверка

Многие тесты пишут в фиксированные `artifacts/stage-*`, `artifacts/cdek-checkout`, `artifacts/product-gallery`. Сначала сохранить новый результат в отдельный каталог/коммит по смыслу, затем вернуть только перезаписанный исторический файл из прежнего Git, если он не должен обновляться. Не применять общий `git reset --hard` к пользовательской работе.

Для публичного smoke: проверить ожидаемый app SHA, основные страницы, /muzey/, отсутствие общего пароля и сохранение защиты CMS/manager. Выбирать действия без заказов/оплаты/писем, если они не входят в задачу. При снимках админки скрыть данные покупателей и секреты; сырую подложку Яндекса маскировать.

`tests/remote-staging.mjs` — старый harness первоначального развёртывания: требует private access JSON, явных `AR_PUBLIC_ACCESS=1` и `AR_EXPECTED_SHA`; содержит ожидания демотовара/цены/медиа и снимает список заказов. **Не запускать как универсальный безопасный smoke** после изменения каталога или появления клиентов. Приватные одноразовые проверки перечислены в [private-materials.md](private-materials.md); перед повтором читать их действия и текущие selectors.

Успешный `/health` проверяет соединение с БД и revision, но не все интеграции. Локальный pass не заменяет браузерную проверку опубликованной версии. Последние доказательства и их ограничения — [status.md](status.md).

## Главная и товарные демопримеры (29.09.2026)

`tests/home.test.ts` проверяет ограничение примеров staging/local-test, связь с публичными товарами, отсутствие демотоваров при наличии реальных и безопасную обработку текста статей. `tests/homepage-browser.mjs` — только чтение и клиентская навигация, без заказов/платежей. Запуск: `AR_HOME_URL=https://autoreelz.ru AR_HOME_OUTPUT=artifacts/homepage/public node tests/homepage-browser.mjs`; Chrome/Playwright должны быть доступны. Ожидания отражают согласованное наполнение29.09 (6 категорий,4 демоотзыва,8 статей); после появления настоящих отзывов или изменения контента обновить сценарий, не восстанавливать старые данные ради теста.

## Дашборд владельца

- `node --test tests/dashboard.test.ts`: календарные границы МСК, точные суммы/средний чек, допустимые фильтры.
- `tests/dashboard-fixture.sql` и `node tests/dashboard-database.mjs`: отдельная PostgreSQL-база `ar_qa_dashboard_*` с синтетическими таблицами модели чтения. Fixture запрещает другое имя БД; это не миграция и не копия клиентов. Проверяются SQL, принятые оплаты, повторы, разные провайдеры, даты, резервы, наследование медиа/совместимости, комплекты и отсутствие контактов в DTO. Это не полный набор торговых транзакций. После проверки удалить только созданную QA-базу.
- `AR_DASHBOARD_URL=http://127.0.0.1:14331 node tests/dashboard-browser.mjs`: проверяет настоящий собранный интерфейс на доступном серверном preview, подменяя ответы dashboard/login синтетическими. Платежей/заказов не создаёт; проверяет вход/401/403, фильтры, смену периодов, старые ответы, сбой, автопроверку, сохранение предпочтений и375/768/1440px. Скриншоты содержат QA-данные.
- Публичная проверка: неавторизованныйAPI401, владелец200/no-store, неверный период400, точная ссылка на заказ и `/manager/orders`200. Сырые ответы заказов/сессии не сохранять в Git и не снимать клиентские данные на скриншоты.

`tests/staff-logout.test.ts` проверяет режимsession, передачу толькоCMS-cookie, безопасное удаление, повтор безcookie и честную ошибку при недоступностиCMS. Публичную проверку logout выполнять с отдельной сессией, созданной проверкой: безCSRF403 и сохранение доступа, сCSRF200 и последующий401 **даже с сохранённым старым cookie**. Не завершать пользовательскую сессию из его браузера ради теста. Старые browser-наборы для торговых операций обновлены на `/manager/orders`; их полный запуск по-прежнему требует локальной QA-среды.

## Разделение кабинета30.09.2026

- `node --test tests/manager-workspace.test.ts` — даты/enum/page, безопасный returnTo, экранирование LIKE и параметрыSQL.
- `tests/manager-workspace-database.mjs` — запускается только в `ar_qa_workspace_*`. В отдельную базу копируется **только схема** текущего нового магазина, затем создаются синтетические товары/заказы. Проверяются пагинация/поиск/история и настоящие серверные команды заметок, доставки, прихода, пересчёта, предзаказа, имитируемой оплаты, отправления и отмены, включая повтор и защиту резерва. Env — отдельный, `PAYMENT_PROVIDER=simulation`, `SHIPPING_PROVIDER=simulation`, origin локальный. База и её env/schema-файл удаляются после проверки. Это не перенос/seed рабочей базы и не внешние отправления.
- `AR_WORKSPACE_URL=http://127.0.0.1:14331 AR_WORKSPACE_OUTPUT=artifacts/manager-workspace/browser node tests/manager-workspace-browser.mjs` — настоящий собранный интерфейс, всеAPI перехватываются синтетическими ответами. Три ширины375/768/1440, таблицы/карточки, возврат к фильтрам, modal/min-reserve, одинаковый ключ при retry, история, служебные/контентные страницы, старые ссылки, выход. НепредусмотренныйAPI не пропускается на сервер.
- `tests/dashboard-browser.mjs` обновлён под краткую сводку; проверяет периоды, гонки, сбой, автообновление и авторизацию. `AR_DASHBOARD_OUTPUT` направлять в новый каталог.
- Публично — только чтение и отдельная временная сессия для входа/выхода: новыеGET401 анонимно,200 владельцу/no-store, даты400, ссылкиCMS. Изменения склада/заказов на рабочем сайте при приёмке не выполнять. Старые owner/purchase browser-наборы адаптированы к новым путям; в текущем запуске они полностью не прогонялись из-за выключенного локальногоDocker.

## Свайпы фотографий (03.10.2026)

`node tests/photo-swipe-browser.mjs` поднимает локальную галерею с настоящими product.ts/photo-swipe.ts и CSS. Через сенсорный ввод Chromium проверяются375/768px: оба направления, обычный тап/увеличенный просмотр, вертикальная прокрутка, multitouch/pinch zoom, отмена, короткий жест, ошибка загрузки и быстрые свайпы. Отдельно проверены desktop-кнопки и единственное фото. БД/платные сервисы не используются. Проверку на физическом iPhone это не заменяет. Артефакты — artifacts/photo-swipe; публичная проверка не меняет товары/корзину.

## Удалённые товары и категории (04.10.2026)

`tests/product-purge-database.mjs`: только `ar_qa_product_editor_*`, миграция020, синтетические записи; одиночное/массовое удаление, устаревший снимок, конкурентные повторы, сохранность учёта, запрет восстановления через редактор/CMS. `tests/product-purge-browser.mjs`: настоящий интерфейс с подменой API375/768/1440, категории/потомки/дополнительные связи/черновики, отмена и повтор, очистка независимо фильтров. Можно задать `AR_BROWSER_PATH` для уже установленного Chromium вместо Google Chrome. Обычную регрессию выполнять без удаления рабочих товаров; очистка04.10 была отдельным прямым поручением владельца. Артефакты — artifacts/product-purge.

## Выбор главного фото (09.10.2026)

`node --test tests/product-main-photo.test.ts tests/product-editor.test.ts`: наследование/собственные галереи, один/все варианты, сохранение фото/подписей, повтор без дублей, полный лимит12 и атомарный отказ. `node tests/product-main-photo-browser.mjs`: настоящий собранный редактор с синтетическим API на1440/768/375, выбор/отмена, черновик/перезагрузка, повтор после503 с тем же ключом, публикация отдельным действием, ошибки лимита. По умолчанию локальный bundle накладывается на опубликованную HTML-страницу; `AR_MAIN_PHOTO_PUBLIC=1` проверяет выпущенный клиент. `AR_MAIN_PHOTO_OUTPUT` задаёт каталог, `AR_CHROMIUM_EXECUTABLE` — установленный Chromium. Рабочие товары не сохраняются; платных вызовов нет. Для CSS галереи дополнительно проверены320/375/600/1440.

## Видео товара (11.10.2026)

`tests/product-video.test.ts`, `tests/product-video-database.mjs` и `tests/product-video-browser.mjs` — URL/безопасность, миграция/fingerprint/повторы/публикация, настоящий локальный manager API и UI1440/768/375. [Порядок запуска и ограничения](product-video.md#проверки). Дополнительно — прежние DB suites обычного товара/комплекта и editor-browser. RUTUBE с предоставленной ссылкой проверять отдельно без сохранения рабочего товара; внешний плеер зависит от ограничений провайдера. Не смешивать mock-проверку VK с реальным воспроизведением.

## Справочник автомобилей (12–13.10.2026)

`tests/vehicle-editor.test.ts`, `tests/vehicle-editor-database.mjs`, `tests/vehicle-editor-browser.mjs`: нормализация, дубли/конкуренция/старые токены, неизменность ссылок/правил/черновиков, права и журнал; настоящий локальный API и UI1440/768/375. В browser-тесте потерянный ответ моделируется после сохранения на сервере. [Подготовка](vehicle-editor.md#проверки). Использовать `AR_CHROMIUM_EXECUTABLE` для установленного браузера; на Mac доступен native arm64 Chromium headless shell в `~/Library/Caches/ms-playwright`, если Yandex под Rosetta не запускается. Публичные проверки — только чтение и окна, без вымышленных автомобилей/переименований рабочей базы.

## Обновлённый генератор описаний14.10.2026

`tests/ai-text.test.ts`, `tests/ai-text-database.mjs`, `tests/product-ai-browser.mjs`, `tests/ai-gateway.py` покрывают Luna/Sol, отдельные цены/лимиты, принадлежность источника правки, общий бюджет, повторы, историю, восстановление заметок, запрет подмены фактов пожеланием и конфликт цвета. DB-suite — только ar_qa_ai_text_* либо ar_qa_ai_images_text_*; использовать отдельную схему/синтетические данные. В browser-наборе API подменены, поддерживается AR_CHROMIUM_EXECUTABLE. Реальная проверка моделей/правки проведена отдельно через тот же серверный generateProductText и журнал. [Контракт и расходы](ai-text-generation.md). Опубликованный UI проверять отдельной сессией без сохранения товара и без запуска платной генерации. Не повторять39 проб ради smoke.

## Полные возвраты ЮKassa14.10.2026

`tests/yookassa-refunds.test.ts`, `tests/yookassa-refunds-database.mjs`, `tests/yookassa-refunds-browser.mjs`:протокол, отдельная синтетическая PostgreSQL со всеми миграциями, lease/повторы/потеря ответа, правдоподобие webhook, сроки ключа и неизменность склада. Browser-harness поднимает собственные preview14361/CMS-stub14362 и удаляет их вместе с базой; API401/403/CSRF/Origin/no-store настоящие, UI1440/375 — подменённые ответы. Playwright использует уже установленный native Chromium; можно переопределить AR_CHROMIUM_EXECUTABLE. Снимки в private/payment-refunds. Официальная sandbox-проба1.00RUB уже завершена успешным возвратом, не повторять её автоматически. [Результаты и ограничения](payment-refunds.md).

## Сроки и условия заказа15.10.2026

`tests/delivery-deadline.test.ts`, `tests/order-terms-database.mjs`, прежние commerce/CDEK/YooKassa suites; [точные команды и границы проверки](order-terms.md). `AR_QA_NATIVE=1` включает синтетические базы со всеми миграциями через выделенный локальный PostgreSQL, без Docker и без чтения рабочего каталога. Запускать native suites последовательно (`--test-concurrency=1`). UI проверять CUA на отдельной синтетической базе; банковские реквизиты и скриншоты не включать в Git.

## Передача данных чеков ЮKassa15.10.2026

`node --test tests/yookassa-receipts.test.ts` — состав/точные суммы/лимиты/протокол; `node tests/yookassa-receipts-database.mjs` — отдельная синтетическая PostgreSQL001–028 через native QA-helper,8 групп, транспорт подменён, внешних вызовов нет. Регрессия: `AR_QA_NATIVE=1 AR_YOOKASSA_TESTS=1 node --test --test-concurrency=1 tests/yookassa-integration.test.ts` и `node tests/yookassa-refunds-database.mjs`. Использовать закреплённый Node24.21.0 из .tools. [Контракт/границы](yookassa-receipts.md). Никаких новых реальных/sandbox платежей автоматически.
