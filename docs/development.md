# Локальная разработка

Основной адрес этапа 5: http://127.0.0.1:14323/. Каталог читается из новой CMS, корзина и заказы сохраняются в PostgreSQL. Оплата, доставка и письма работают только в локальном тестовом режиме.

## Docker

Нужны Docker Compose, Node 24.21.0, npm 11.19.1 и Python 3. Из корня нового репозитория:

```sh
node scripts/setup-local.mjs --seed-demo
```

Скрипт создаёт отсутствующие локальные настройки, применяет миграции, настраивает CMS, собирает web и запускает worker. На заполненной базе `--seed-demo` не заменяет изменённые записи. Подробности и границы прав — [cms.md](cms.md).

```sh
docker compose -p autoreelz2026-new ps
docker compose -p autoreelz2026-new up -d --build --wait web worker
```

Все команды относятся только к новому Compose-проекту. `.env`, ключ SSH и тома не хранятся в Git.

## Astro без контейнера

Сначала запустите новую БД/CMS через setup. На этом компьютере Node установлен только в папке проекта:

```sh
export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"
node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js ci
APP_ORIGIN=http://127.0.0.1:14322 node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js run dev
```

На другом компьютере используйте Node из `.node-version`, npm 11.19.1 и обычные `npm ci` / `npm run dev`. Перед запуском проверьте свободный порт 14322. Старые процессы других проектов не останавливать. APP_ORIGIN должен совпадать с адресом браузера, иначе защита Origin отклонит команды.

В dev-режиме файлы CMS проксируются через Docker-витрину 14323, если CMS_UPLOADS_PATH не задан. Worker из Docker обслуживает ту же новую БД. Для отдельной тестовой базы нужны свои процесс worker, APP_ORIGIN и секрет.

## Проверки

```sh
npm run check
npm test
npm run build
AR_AUTH_TESTS=1 node --test tests/auth.test.ts
AR_COMMERCE_TESTS=1 node --test tests/commerce.test.ts
node tests/purchase-browser.mjs
node tests/cms-money-browser.mjs
AR_STAGE5_TESTS=1 node --test tests/management.test.ts
AR_SOCIAL_TESTS=1 node --test tests/social.test.ts
AR_CONTENT_TESTS=1 node --test tests/content-integration.test.ts
node tests/owner-browser.mjs
node tests/social-browser.mjs
node tests/content-storefront-browser.mjs
node tests/content-browser.mjs
node tests/cms-owner-links.mjs
```

`npm test` выполняет быстрые тесты каталога, денег, контента и обработки фото; интеграционные наборы требуют явных флагов. Они создают временные базы `ar_qa_*` в новом кластере и удаляют их после проверки. Браузерный тест требует текущую сборку dist, свободный порт 14325, установленный Chrome и Playwright. Путь к Playwright задаётся PLAYWRIGHT_MODULE; по умолчанию используется библиотека среды Codex. Тест поднимает отдельные web/worker и БД, обращения к основной CMS нужны только для проверки авторизации сотрудников. Отчёты — [stage-4-review.md](stage-4-review.md).

## Основные файлы

- `src/server/catalog.ts` — свежий опубликованный каталог и наследование данных CMS; `src/lib/catalog.ts` — фильтрация одного SKU.
- `src/server/cart.ts`, `orders.ts`, `payments.ts` — серверные команды и транзакции; `adapters/` — тестовые оплата и доставка.
- `src/server/auth.ts`, `security.ts` — email-коды, сессии, права, CSRF и идемпотентность.
- `scripts/commerce-worker.ts` — истечение резервов и приватная тестовая почта каждые 5 секунд.
- `src/pages/cart.astro`, `checkout.astro`, `orders/`, `account.astro`, `manager/` — покупка и управление.
- `migrations/` — неизменяемые после применения SQL-файлы; `cms/schema.snapshot.json` — метаданные CMS без учётных записей.

`src/lib/demo.ts` сохранён для изолированных тестов и истории этапа 2; рабочая витрина его не импортирует. Гостевое избранное хранится в браузере; после входа объединяется с серверным списком аккаунта. Архив прототипов — порт 14321.

## GitHub

Отдельный remote: git@github.com:gbasyr-sketch/autoreelz.git. На текущем компьютере repo-local core.sshCommand использует отдельный deploy key в игнорируемой папке private и проверенный GitHub known_hosts. Глобальная SSH-конфигурация не менялась. На новом компьютере потребуется собственный разрешённый ключ; приватный ключ не переносить через репозиторий.

Изменение денежной модели описано в [ruble-prices-review.md](ruble-prices-review.md). Миграцию 006 выполнять с остановленными web/worker/CMS и резервной копией новой БД. После неё запускать только версию приложения с рублёвыми полями; старый checkout нужно пересчитать.

## Дополнения этапа 5

Контракты — [stage-5-contracts.md](stage-5-contracts.md), приёмка — [stage-5-review.md](stage-5-review.md). Owner browser использует отдельный QA-порт14326, social browser14327; контентный read-only тест — текущую Docker-витрину14323. CMS content test создаёт помеченные временные записи и удаляет их после проверки. Тяжёлую Docker-сборку и браузерные приёмки лучше выполнять последовательно, чтобы тайм-аут CMS не маскировал результат.

Фото отзывов после проверки перекодируются в WebP и хранятся приватно в bytea новой БД. Docker web ограничен1GiB RAM/2CPU; Sharp — один поток обработки и ограниченный кеш, одновременно не более двух upload-запросов. Эти пределы не являются нагрузочной аттестацией production.
