# Какие проверки запускать

Актуально на24.09.2026. Это выбор по риску изменения, не требование запускать всё. Команды из корня проекта с pinned Node/npm; запуск среды — [development.md](development.md).

## Базовые проверки

- `npm run check` — Astro/TypeScript.
- `npm test` — быстрые тесты. Интеграционные suites без своих флагов будут **skipped**, это не их успешный прогон.
- `npm run build` — свежий `dist` для браузерных harness.
- `git diff --check` — ошибки пробелов/патча.

Только документация: проверка ссылок и фактов, без изменения БД/сборки/публикации. Для простой обратимой правки не создавать тест, повторяющий её реализацию.

## Матрица по областям

| Изменение | Основная проверка | Дополнение при затрагивании поведения |
|---|---|---|
| Деньги/фильтры/SEO | `node --test tests/money.test.ts tests/catalog.test.ts tests/seo.test.ts` | SSR/фильтры в браузере |
| Корзина, склад, заказы | `AR_COMMERCE_TESTS=1 node --test tests/commerce.test.ts` | `AR_STAGE6_TESTS=1 node --test tests/stage-6-commerce.test.ts` для комплектов/предзаказов |
| Вход/доступ | `AR_AUTH_TESTS=1 node --test tests/auth.test.ts` | Покупка/чужая сессия/выход |
| ЮKassa | `node --test tests/yookassa.test.ts`; `AR_YOOKASSA_TESTS=1 node --test tests/yookassa-integration.test.ts` | Реальный sandbox — отдельно по процедуре yookassa.md |
| СДЭК | `node --test tests/cdek.test.ts`; `AR_CDEK_TESTS=1 node --test tests/cdek-checkout.test.ts` | `AR_CDEK_BROWSER=1 node tests/cdek-browser.mjs` использует настоящий API и private/cdek.env |
| Автокорзина/русские поля/подтверждения | `AR_CHECKOUT_UX_TESTS=1 node tests/checkout-ux-browser.mjs` | Справочники/SDK подменены. С24.09 проверяется автозагрузка без записи согласий; `AR_CHECKOUT_UX_OUTPUT` позволяет сохранить отчёт отдельно |
| Галерея/кнопка избранного/badge | `node tests/product-gallery-browser.mjs` | 1440/375px, быстрый выбор/ошибка, гость/аккаунт/две вкладки |
| Серверное избранное/отзывы | `AR_SOCIAL_TESTS=1 node --test tests/social.test.ts` | `node tests/social-browser.mjs` — полный социальный путь |
| Кабинет владельца | `AR_STAGE5_TESTS=1 node --test tests/management.test.ts` | `node tests/owner-browser.mjs` |
| Контент | `AR_CONTENT_TESTS=1 node --test tests/content-integration.test.ts` | `node tests/content-storefront-browser.mjs` — чтение текущей локальной витрины |
| Полная покупка | `node tests/purchase-browser.mjs` | `AR_PURCHASE_VIEWPORT=375 AR_PURCHASE_OUTPUT=artifacts/<проверка>/mobile node tests/purchase-browser.mjs` |
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
