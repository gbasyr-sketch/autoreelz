# Версии и совместимость

Проверено 21.09.2026 по официальной документации, npm registry и файлам релиза. Проверены опубликованные ограничения и разрешение зависимостей; runtime-проверка ещё не созданного приложения не проводилась.

| Компонент | Зафиксированная версия | Основание |
|---|---|---|
| Node витрины | 24.21.0, .node-version | LTS из официального release index; удовлетворяет Astro >=22.12.0 |
| npm | 11.19.1, packageManager | Доступен в окружении; lockfileVersion 3 |
| Astro | 7.3.3 | engines Node >=22.12.0, npm >=9.6.5 |
| @astrojs/node | 11.1.6 | peer astro ^7.2.1 включает 7.3.3; SSR standalone |
| TypeScript | 7.0.2 | engines Node >=16.20.0; компиляция проверяется позже |
| Directus | 12.3.1 | Отдельный официальный образ; engines >=22, Dockerfile релиза использует Node 22 |
| PostgreSQL | 17.11 | Поддерживаемая ветка 17 до ноября 2029; в документации Directus есть конфигурация PostgreSQL/PostGIS 17 |

Системный Node 26.9.0 не заменяли. Выполнено `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Дерево разрешено; получено ожидаемое EBADENGINE для корня, требующего Node 24. Пакеты в node_modules не устанавливались, lifecycle scripts не выполнялись. На этапе реализации использовать изолированный Node 24.21.0, выполнить npm ci, сборку и SSR smoke-test.

Directus/PostgreSQL закреплены отдельно в versions.json, не в npm-lock витрины. Перед compose проверить официальные теги для нужной архитектуры и записать immutable digest. Образы не скачивались и не запускались. Миграции и CMS→PostgreSQL проверить на этапе 3; совместимость работающей среды пока не доказана.

## Лицензия Directus

Файл license релиза 12.3.1 содержит MSCL-1.0-GPL, а не прежнюю BSL. Разрешённые цели исключают конкурирующее предоставление самого ПО; нельзя обходить защиту функций лицензионным ключом. При распространении требуется сохранять условия и уведомления. Для конкретной версии предусмотрен переход на GPL-3.0 через четыре года. До запуска проверить соответствие использования магазином условиям именно закреплённой версии и необходимость ключа для выбранных функций. Старые пороги выручки BSL автоматически не применять.

Источники: [лицензия релиза](https://github.com/directus/directus/blob/v12.3.1/license), [официальные условия](https://directus.com/license). Это список для проверки перед запуском, не заключение о конкретном коммерческом сценарии.

## Источники

- [Astro installation](https://docs.astro.build/en/install-and-setup/), [Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/).
- npm: [Astro](https://registry.npmjs.org/astro/7.3.3), [adapter](https://registry.npmjs.org/@astrojs/node/11.1.6), [Directus](https://registry.npmjs.org/directus/12.3.1), [TypeScript](https://registry.npmjs.org/typescript/7.0.2).
- [Node release index](https://nodejs.org/dist/index.json), [цикл поддержки](https://nodejs.org/en/about/previous-releases).
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/).
- Directus: [requirements](https://github.com/directus/docs/blob/main/content/self-hosting/2.requirements.md), [deployment](https://github.com/directus/docs/blob/main/content/self-hosting/3.deploying.md), [Dockerfile 12.3.1](https://github.com/directus/directus/blob/v12.3.1/Dockerfile).

Обновлять версии отдельным проверяемым коммитом. Аудит уязвимостей/лицензий дерева, digest образов и воспроизводимость установки проверить до выпуска; сейчас не выполнялись.
