# Навигатор документации

Обновлено 24.09.2026. Цель — начать конкретную доработку без чтения всей переписки и истории этапов.

## Первые пять минут

1. Прочитать [next-session.md](next-session.md) и [status.md](status.md). Это краткая передача дел и единственный текущий снимок выпуска.
2. Проверить `git status --short`, текущую ветку и `/health` на нужной среде. SHA в Git HEAD может быть новее запущенного приложения из-за коммитов документации.
3. Для продуктового решения свериться с [brief.md](brief.md) и [decisions.md](decisions.md), для этапа — с нужной частью [plan.md](plan.md). Новое прямое поручение владельца важнее старой записи.
4. По [карте кода](code-map.md) открыть только нужные модули и профильный контракт. По [testing.md](testing.md) выбрать проверки затронутого поведения.
5. Если задача меняет сервер — использовать [server-staging.md](server-staging.md). Для обычной правки документации сервер не пересобирать.

Не читать весь `artifacts/`, все stage-review и `private/` заранее. Частные файлы открывать только по назначению; не выводить секреты в чат/логи.

## Кто отвечает за какую информацию

| Вопрос | Основной источник | Дополнение |
|---|---|---|
| Что сейчас опубликовано и работает | [status.md](status.md) | Проверенный deployment/public-check, на которые он ссылается |
| Где остановились | [next-session.md](next-session.md) | Короткое резюме, не полная история |
| Что согласовано | [brief.md](brief.md), [decisions.md](decisions.md) | Бриф сохранён как исходник; поздние решения записываются отдельно |
| Как устроено приложение | [architecture.md](architecture.md) | [code-map.md](code-map.md), исходники, миграции |
| Как запускать и проверять | [development.md](development.md), [testing.md](testing.md) | Скрипты и package.json |
| Как выпускать и восстанавливать | [server-staging.md](server-staging.md) | [operations.md](operations.md) — локальные backup/restore-инструменты |
| Что ещё нужно сделать | [backlog.md](backlog.md) | [launch.md](launch.md) — условия реальных продаж |
| Где материалы вне Git | [private-materials.md](private-materials.md) | Само содержимое в private/ и на сервере |

## Профильные документы — читать по задаче

- Каталог/владелец: [cms.md](cms.md), [manager-guide.md](manager-guide.md), [wb-catalog-import.md](wb-catalog-import.md).
- Торговые контракты: [stage-4-contracts.md](stage-4-contracts.md), [stage-5-contracts.md](stage-5-contracts.md). Это базовые контракты этапов; актуальные изменения checkout и провайдеров перечислены в architecture.md и следующих документах.
- ЮKassa: [yookassa.md](yookassa.md), [yookassa-checkout-contract.md](yookassa-checkout-contract.md).
- СДЭК/карта: [cdek.md](cdek.md), [cdek-checkout-contract.md](cdek-checkout-contract.md).
- Юридическая подготовка: [legal-and-cookies-review.md](legal-and-cookies-review.md), [offer-draft.md](offer-draft.md). Это датированный аудит и проект, не утверждённая оферта; перед реальным запуском нормы проверить заново.
- SEO: [seo.md](seo.md); оформление: [MASTER.md](../design-system/MASTER.md).
- Лицензия: [license.md](license.md); статический тур: [muzey.md](muzey.md).
- Версии: package.json / package-lock.json / Dockerfile / Compose — фактические pins; [versions.json](versions.json) — датированный снимок, не рекомендация автоматически обновляться.

## История и доказательства

`stage-*-review.md`, `stage-*-plan.md`, `artifacts/stage-*`, `new-store-kit/`, `prototypes/` и [server-history.md](server-history.md) сохраняют ход работ на указанную дату. Фраза «не подключено» в старом отчёте не отменяет действующее состояние. Не выполнять старые команды переноса/seed как способ продолжить разработку.

В отчётах различать тесты на чистой QA-базе, локальной CMS, опубликованном сайте и реальных API. `passed` в старом JSON не доказывает работу нового изменения.

## Как завершать каждую доработку

- Проверить затронутое поведение; записать результат и ограничение проверки, без секретов/данных покупателей.
- Существенное решение владельца внести в decisions.md, незавершённую работу — в backlog.md.
- После выпуска обновить только текущий снимок status.md: app SHA, image ID, миграции и доказательство. Коммит документации не объявлять новой сборкой приложения.
- Переписать next-session.md в четыре коротких ответа: где остановились, что работает, что не трогать, следующий шаг. Не наращивать туда хронику.
- Изменились команды/границы модуля — обновить соответствующий регламент и карту кода. Завершить понятным коммитом; проверить ссылки документации.
