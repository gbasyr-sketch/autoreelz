# Версии и совместимость

Проверено 21.09.2026 по официальной документации, npm registry и файлам релиза. На этапе 2 прошли установка, проверка типов, сборка и SSR Astro. На этапе 3 проверены Docker-сборка, запуск Directus/PostgreSQL на пустых томах, SQL-ограничения и формы CMS под двумя ролями.

| Компонент | Зафиксированная версия | Основание |
|---|---|---|
| Node витрины | 24.21.0, .node-version | LTS из официального release index; удовлетворяет Astro >=22.12.0 |
| npm | 11.19.1, packageManager | Доступен в окружении; lockfileVersion 3 |
| Astro | 7.3.3 | engines Node >=22.12.0, npm >=9.6.5 |
| @astrojs/node | 11.1.6 | peer astro ^7.2.1 включает 7.3.3; SSR standalone |
| TypeScript | 6.0.3 | Совместим с peerDependencies @astrojs/check; check/build прошли |
| @astrojs/check | 0.9.10 | Проверка .astro/TypeScript: peer TypeScript ^5.0.0 или ^6.0.0 |
| Directus | 12.3.1 | Отдельный официальный образ; engines >=22, Dockerfile релиза использует Node 22 |
| PostgreSQL | 17.11 | Поддерживаемая ветка 17 до ноября 2029; в документации Directus есть конфигурация PostgreSQL/PostGIS 17 |

Системный Node 26.9.0 не заменяли. На этапе 0 lockfile был подготовлен без установки пакетов. На этапе 2 официальный архив Node 24.21.0 для darwin-arm64 скачан в игнорируемую .tools и проверен по SHASUMS256.txt. Через этот Node и npm 11.19.1 выполнена установка. Подготовительный TypeScript 7.0.2 оказался вне поддерживаемого диапазона @astrojs/check 0.9.10, поэтому закреплён 6.0.3; lockfile обновлён. `npm run check`, `npm test`, `npm run build` прошли, standalone SSR запущен на localhost:14322. npm сообщил о неразрешённых install scripts esbuild/fsevents; дополнительное разрешение им не давалось, сборка с установленными пакетами прошла.

Directus/PostgreSQL/Node закреплены digest в compose.yaml / Dockerfile и versions.json, не в npm-lock витрины. Образы arm64 скачаны, запуск и совместимость подтверждены этапом 3. Сборка витрины внутри Linux-контейнера также прошла. Сырые секреты не передаются в Docker build context.

## Лицензия Directus

Файл license релиза 12.3.1 содержит MSCL-1.0-GPL, а не прежнюю BSL. Разрешённые цели исключают конкурирующее предоставление самого ПО; нельзя обходить защиту функций лицензионным ключом. При распространении требуется сохранять условия и уведомления. Для конкретной версии предусмотрен переход на GPL-3.0 через четыре года. До запуска проверить соответствие использования магазином условиям именно закреплённой версии и необходимость ключа для выбранных функций. Старые пороги выручки BSL автоматически не применять.

Источники: [лицензия релиза](https://github.com/directus/directus/blob/v12.3.1/license), [официальные условия](https://directus.com/license). Это список для проверки перед запуском, не заключение о конкретном коммерческом сценарии.

При первом входе Directus 12 показал необязательный ввод ключа и запрос владельца проекта с принятием MSCL/DPA. Для локальных проверок использованы штатные Skip/Remind Later. Никакие условия от имени пользователя не приняты, сведения о выручке и право на OIG не заявлялись. Этот шаг, тарифные ограничения и фактическую лицензию повторно проверить перед реальным запуском.

## Источники

- [Astro installation](https://docs.astro.build/en/install-and-setup/), [Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/).
- npm: [Astro](https://registry.npmjs.org/astro/7.3.3), [adapter](https://registry.npmjs.org/@astrojs/node/11.1.6), [Directus](https://registry.npmjs.org/directus/12.3.1), [TypeScript](https://registry.npmjs.org/typescript/6.0.3), [Astro check](https://registry.npmjs.org/@astrojs/check/0.9.10).
- [Node release index](https://nodejs.org/dist/index.json), [цикл поддержки](https://nodejs.org/en/about/previous-releases).
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/).
- Directus: [requirements](https://github.com/directus/docs/blob/main/content/self-hosting/2.requirements.md), [deployment](https://github.com/directus/docs/blob/main/content/self-hosting/3.deploying.md), [Dockerfile 12.3.1](https://github.com/directus/directus/blob/v12.3.1/Dockerfile).

Обновлять версии отдельным проверяемым коммитом. Digest образов и воспроизводимость локального запуска проверены. Аудит уязвимостей/лицензий полного дерева и подготовка публичного выпуска остаются задачами до реальных продаж.
