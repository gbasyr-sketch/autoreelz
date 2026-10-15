# Сервер: диагностика, выпуск и откат

**B25: реальный IP через прокси.** В HTTPS vhost только autoreelz.ru Nginx доверяет X-Real-IP от186.2.160.0/24 — подсети DDoS-Guard из [актуальной инструкции ISPmanager](https://www.ispmanager.ru/docs/ispmanager/nastrojka-ddos-guard), совпавшей с TCP peer собственного health-probe. Прямые подключения не могут переопределить IP. Nginx заменяет X-Forwarded-For и X-Real-IP на нормализованный $remote_addr; Caddy передаёт этот единственный адрес в XFF. Граница доверия Caddy — опубликованный **только на127.0.0.1:14324** порт из ispmanager.yaml; открывать его наружу с этим конфигом нельзя. Не включать доверие всем private_ranges/всему ASN и не возвращать append пользовательского XFF. При изменении услуги/подсети провайдера перепроверить документацию и фактический ingress; внешний непроверенный список автоматически не импортировать.

Проверка B25: `AR_RUN_PROXY_QA=1 AR_PROXY_QA_IMAGE=<проверенный образ> bash tests/proxy-ip-chain.sh` на deployment host. Создаёт отдельную rootless сеть, Caddy и HTTP echo на фактическом Astro-адаптере, отдельный Nginx14390 и edge14389 loopback; БД/env магазина не подключает. Проверяет двух клиентов, поддельные заголовки, IPv6/неверный IP и webhook, затем удаляет только собственные ресурсы.

**Актуально после открытия индексации15.10:** по прямому поручению владельца SEO_INDEXING_ENABLED=true, overlay ispmanager читает его из env. Общий noindex на edge снят, CMS и /muzey/ сохраняют запрет, остальные маршруты используют политику приложения. Appff922ef; резервные файлы и читаемый DB-only dump — shared/seo-indexing-20261015 (0600). Старые требования сохранять общий noindex ниже — история. Для закрытия поиска изменить только SEO_INDEXING_ENABLED=false и пересоздать web на текущем образе; полный env/БД не восстанавливать. Edge пока использует прежний bind mount из954721a, синхронизированный с актуальным Caddyfile.ispmanager.

Актуальное уточнение15.10 после appa92995b: СДЭК разрешён владельцем и включён в live/allow_live=true для web/worker; первая накладная зарегистрирована. При следующих выпусках сохранять эти значения и историю. Старые требования disabled ниже относятся к периоду до активации. Пауза отправлений — только disabled/allow_live=false, без восстановления старого env/БД и без повторного POST. [Результат](../artifacts/cdek-live/activation-and-first-shipment.json).

15.10 опубликован «Умный платёж», app7efc520/036. Применённые001–036 неизменяемы; после появления method=smart нужен совместимый web/worker, старый обработчик только card/sbp не годится для отката. Backup/schema/сверка данных — [результат](../artifacts/yookassa-smart/deployment.json), режим и проверки — [контракт](yookassa-smart-payment.md). Noindex, live ЮKassa/чеки, disabled-СДЭК и SMTP cutoff сохраняются.

Действующий регламент на24.09.2026. Текущие app SHA/image ID — **[status.md](status.md)**, доказательство последнего выпуска — указанный там deployment/public-check. [История размещения](server-history.md) сохранена отдельно; её команды первого переноса повторять нельзя.

## Ресурсы и границы

- Резервирование нового магазина: [server-backups.md](server-backups.md). Runner/бинарники — `/opt/autoreelz2026-backup`, секреты — `/var/lib/autoreelz2026-backup/private`, локальный зашифрованный репозиторий — `/var/lib/autoreelz2026-backup/work/repository`. В web примонтирован только `/var/lib/autoreelz2026-backup/status` read-only; секреты и архивы не доступны приложению. Фактическое состояние расписания — status.md.
- SSH: `root@91.200.150.79:22`, отдельные `private/ssh_server_ed25519` и `private/server_known_hosts`.
- Новый Linux-пользователь: `autoreelz2026`, UID1018; дом `/srv/autoreelz2026`.
- Только наш rootless Docker: проект `autoreelz2026-release`, socket `/run/user/1018/docker.sock`. Системный Docker, ISPmanager и другие сайты не менять.
- Релизы: `/srv/autoreelz2026/releases/<полный-SHA>`; архивы: `incoming/`; рабочий env: `shared/bootstrap/server.env`.
- Подтверждения поисковых сервисов: Google `google031b679d17a8feda.html` и Яндекс `yandex_77486fc3808f1fc9.html` хранятся в `/srv/autoreelz2026/public/verification`, отдаются точными маршрутами edge и сохраняются при выпуске/откате. Актуальный путь bind-mounted Caddyfile брать из inspect edge: он может относиться к более старому релизу, чем app SHA.15.10 добавлен только маршрут Яндекса; [публикация/backup](../artifacts/webmaster/publication.json).
- Каталог/заказы: БД `autoreelz2026_new`. Серверная БД авторитетна и не заменяется локальной.
- Фото CMS: том `autoreelz2026-release_uploads`, физически `/srv/autoreelz2026/.local/share/docker/volumes/autoreelz2026-release_uploads/_data`; новые фото обычно добавлять через CMS.
- Тур: `/srv/autoreelz2026/public/muzey/`, доступен через `/muzey/`. Не включать его большие файлы в Git/образ web.
- Внешний HTTPS проходит через DDoS-Guard; origin Nginx-конфиг `/etc/nginx/conf.d/autoreelz2026.conf` направляет на127.0.0.1:14324. Наш Caddy маршрутизирует web4321 и CMS8055 внутри Docker.
- TLS origin — предоставленный Timeweb Pro, `/etc/ssl/autoreelz2026/`, срок до10.03.2027 по проверке23.09.2026. Автопродление в кабинете не равно автоматической доставке следующего CRT/KEY на этот сервер: последняя пока не настроена.

Используются **оба** файла: `infra/release/compose.yaml` и `infra/release/ispmanager.yaml`. Базовый compose отдельно не описывает текущий запуск. После разрешённой15.10 активации overlay из204defb выбирает STORE_MODE web/worker из env (default staging); на сервере production/live/чеки yookassa/opt-in=true, noindex web остаётся явно false. Старый overlay из appbf6adb6 с жёстким staging нельзя возвращать при следующем выпуске: серверная конфигурация обновлена отдельно без пересборки образа. Image-worker остался staging. [Результат](../artifacts/yookassa-live-activation-2026-10-15.json), [аварийная пауза](yookassa-production.md#рабочая-оплата-включена-на-всём-сайте15102026). `staging.yaml`/`Caddyfile.staging` — старый вариант с общим паролем, не текущий сервер. Переменные TEST_GATE_* ещё требуются синтаксисом overlay, но действующий Caddyfile.ispmanager общего Basic Auth не включает. Не удалять их из env без отдельной правки конфигурации.

## Безопасное начало — только чтение

После активации production15.10 накладные сохранять `CDEK_SHIPMENTS_MODE=disabled`, `CDEK_SHIPMENTS_ALLOW_LIVE=false` до отдельного допуска. Режим test в production запрещён и прерывает workerTick перед heartbeat; он не является безопасной работающей конфигурацией worker. `SHIPPING_PROVIDER=cdek`/калькулятор/тестовые ключи/историю при отключении накладных не менять. После каждого перезапуска подтвердить last_run_at строго позже State.StartedAt нового worker, а не только healthy или возраст старой отметки. [Разбор и результат](../artifacts/yookassa-live-ui-2026-10-15.json).

На рабочем компьютере из корня репозитория:

```sh
ssh -i "$PWD/private/ssh_server_ed25519" \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$PWD/private/server_known_hosts" root@91.200.150.79
```

Далее **в SSH-сессии сервера** определить helper (он действует только в этом shell):

```sh
ardocker() {
  runuser -u autoreelz2026 -- env \
    XDG_RUNTIME_DIR=/run/user/1018 \
    DOCKER_HOST=unix:///run/user/1018/docker.sock \
    PATH=/srv/autoreelz2026/bin:/usr/local/bin:/usr/bin:/bin docker "$@"
}
ardocker ps --filter label=com.docker.compose.project=autoreelz2026-release \
  --format '{{.Names}} {{.Image}} {{.Status}}'
ardocker inspect autoreelz2026-release-web-1 \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Проверить с рабочего компьютера `curl --fail --silent --show-error https://autoreelz.ru/health`. Результат содержит ok/revision, не секреты. Не выводить полный docker inspect, compose config или содержимое server.env: в них есть ключи.

Проверка схемы (в SSH, после helper):

```sh
ardocker exec autoreelz2026-release-db-1 psql -X -At \
  -U ar_migrator -d autoreelz2026_new \
  -c 'SELECT name,sha256 FROM ar_migrations ORDER BY name;'
```

Перед выбором текущего compose-каталога взять полный SHA из OCI-label, проверить40hex, перейти в соответствующий `releases/<SHA>`. Не выбирать релиз по дате каталога: код мог быть загружен без запуска.

## Выпуск приложения

Это процедура для разрешённой доработки staging, а не команда переключения на реальные деньги.

1. Проверить изменение по [testing.md](testing.md), сохранить доказательства. Просмотреть diff, закоммитить код; SHA — полный40hex. Независимые пользовательские изменения не сбрасывать: проверять и выпускать архив конкретного коммита, указав исключённые правки. При незакоммиченных изменениях runtime использовать отдельный checkout проверенного SHA. `git rev-parse HEAD` не обязан совпадать с текущим сервером.
2. Сохранить текущие app SHA/image ID, миграции и предыдущий env вне Git. Если меняется схема/контент — сначала backup. Для CSS/JS-only выпуска новая копия БД не заменяет общую программу резервирования, но схема/данные не должны меняться.
3. На рабочем компьютере подготовить архив **проверенного коммита**, не рабочей папки:

```sh
ar_release_sha=$(git rev-parse HEAD)
test -z "$(git status --porcelain -- src migrations infra scripts Dockerfile package.json package-lock.json)"
git archive --format=tar --output="private/release-$ar_release_sha.tar" "$ar_release_sha"
chmod 600 "private/release-$ar_release_sha.tar"
scp -i "$PWD/private/ssh_server_ed25519" \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$PWD/private/server_known_hosts" \
  "private/release-$ar_release_sha.tar" root@91.200.150.79:/srv/autoreelz2026/incoming/
```

4. В SSH задать **тот же проверенный SHA**, проверить формат, распаковать в новый каталог. Не перезаписывать работающий релиз:

```sh
ar_release_sha='ЗАМЕНИТЬ_НА_ПРОВЕРЕННЫЙ_ПОЛНЫЙ_SHA'
[[ "$ar_release_sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
ar_release_dir="/srv/autoreelz2026/releases/$ar_release_sha"
test ! -e "$ar_release_dir" || { echo 'Release directory exists: inspect before retry'; exit 1; }
mkdir "$ar_release_dir"
tar -xf "/srv/autoreelz2026/incoming/release-$ar_release_sha.tar" -C "$ar_release_dir"
chown -R autoreelz2026:autoreelz2026 "$ar_release_dir"
cd "$ar_release_dir"
ardocker build --build-arg "VCS_REF=$ar_release_sha" \
  -t "autoreelz2026-new-web:$ar_release_sha" .
ardocker image inspect "autoreelz2026-new-web:$ar_release_sha" \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

5. Если есть новая миграция: проверить совместимость старого/нового приложения, архив, checksum и отсутствие записи в `ar_migrations`; выполнить только новый SQL под `BEGIN`, `ON_ERROR_STOP` и advisory-lock320260900, записать имя/sha256 в той же транзакции. План остановки writers зависит от изменения; destructive-миграции автоматически не выполнять. `scripts/migrate.mjs` работает локально, не является серверным runner. Применённые SQL не исправлять задним числом.
6. Сделать датированную приватную копию `shared/bootstrap/server.env` с0600. Атомарно заменить **только RELEASE_IMAGE** на `autoreelz2026-new-web:<SHA>`; сохранить остальные поля и владельца1018:1018. Для новых переменных — точечное слияние, не копия локального .env. Секреты не печатать.
7. Из каталога нового релиза обновить только наши сервисы:

```sh
ardocker compose --env-file /srv/autoreelz2026/shared/bootstrap/server.env \
  -f infra/release/compose.yaml -f infra/release/ispmanager.yaml \
  -p autoreelz2026-release up -d --no-deps web worker image-worker
```

Web, commerce-worker и image-worker должны использовать один проверенный образ. БД/CMS не пересоздавать для обычной правки витрины. Edge обновлять только при изменении его конфигурации. Caddy admin API отключён: `caddy reload` через2019 не работает; для изменённого конфига сначала validate, затем перезапуск/пересоздание только собственного edge.

8. Проверить health/SHA, состояние web/worker и затронутое поведение. Контроль маршрутов: `/`200 без пароля; `/cms/users/me` и `/api/manager/orders`401 анонимно; `/muzey/`200; `/cookies`404; noindex сохранён. Webhook ЮKassa должен оставаться доступным по точному пути, но не посылать поддельный succeeded ради smoke.
9. Записать deployment с SHA/image ID/миграцией/проверками, обновить status/next-session, сделать отдельный коммит результата и push. Документационный commit не пересобирать ради равенства HEAD и app SHA.

## Копии и восстановление

Переключение карты07.10 не было новой сборкой: сохранён текущий app SHA, в приватном `server.env` атомарно заменён только `PICKUP_MAP_PROVIDER=yandex` на `osm`; из каталога активного релиза с обоими Compose-файлами выполнен `up -d --no-deps web`. Предыдущий env сохранён с0600, путь указан в artifacts/osm-map/deployment.json. Для согласованного отката заменить только этот ключ и пересоздать web; не восстанавливать весь старый env поверх последующих настроек/ключей. После переключения проверить HTML checkout/отсутствие Яндекс-ключа, браузерные запросы и health.

Предоперационный **DB-only** архив (SSH, после helper):

```sh
umask 077
ar_backup="/srv/autoreelz2026/backups/before-change-$(date -u +%Y%m%dT%H%M%SZ).dump"
ardocker exec autoreelz2026-release-db-1 pg_dump \
  -U ar_migrator -d autoreelz2026_new -Fc > "$ar_backup"
chown autoreelz2026:autoreelz2026 "$ar_backup"
ardocker exec -i autoreelz2026-release-db-1 pg_restore --list < "$ar_backup" > /dev/null
```

Это читаемый дамп БД, **не проверенное полное восстановление** и не согласованная копия изменяемых uploads. Полное восстановление требует БД/ролей/миграций, uploads, секретов/конфигурации, TLS и отдельно /muzey/. Для согласованной пары DB+uploads нужно окно без записи CMS/приложения либо отдельно спроектированный snapshot-процесс. Зашифрованные offsite-копии, расписание и серверный restore-drill ещё в [backlog B06](backlog.md).

Локальные backup-local/restore-drill описаны в [operations.md](operations.md) и не восстанавливают сервер. Восстановление сначала проверять в изолированной среде; живую БД поверх новых заказов не затирать. Не запускать CMS-клон с новой OIG-активацией автоматически.

## Откат

Вернуть предыдущий совместимый RELEASE_IMAGE и выполнить тот же compose up для web/worker/edge, затем проверить health и функции. Проверить также, что версия используемого Caddyfile соответствует плану отката. Новые данные и добавочные миграции сохраняются; откат приложения не является откатом каталога.

Старый app6ab6bea с симулятором нельзя использовать для отката незавершённых ЮKassa-платежей. Старый a908f83 уберёт аудит подтверждений/согласие до SDK; откат до нужной миграции может вообще не стартовать. Совместимость проверять по конкретному diff, не по слову «предыдущий».

Если нужна потеря/замена данных из backup — отдельный план и решение владельца со сверкой заказов/PSP. Удаление томов, `down -v`, повтор initial-transfer и общий seed не способы ремонта.

## Сервис удаления фона

Дополнительный профиль Compose `infographics`: сервис `background` в отдельной внутренней сети `images`, к которой подключён только web. Порт наружу не публикуется. Лимиты3CPU/3584MiB безswap; read-only/no-new-privileges/cap_drop, модель читается из `/srv/autoreelz2026/shared/background/u2net.onnx`. SHA256 весов закреплён в `services/background-removal/worker.py`.

При выпуске собрать отдельный образ с `-f services/background-removal/Dockerfile --build-arg VCS_REF=<SHA>`, закрепить `BACKGROUND_IMAGE`, `BACKGROUND_MODEL_PATH`, `BACKGROUND_REMOVAL_URL=http://background:8090` в текущем env без печати ключей. Применить новую миграцию014 перед web. Запуск: прежние два compose-файла плюс `--profile infographics up -d --no-deps background web worker edge`. Для последующих выпусков web переменные/сеть уже присутствуют в базовом compose; background пересобирать при изменении её кода/зависимостей. Перед выпуском остановить временный QA-worker, чтобы не держать две сессии модели.

Откат web не удаляет рецепты и модель. При недоступном обработчике UI сохраняет исходник и показывает ошибку; публикация товара и обычная галерея от него не зависят. [Контракт](product-infographics.md).

## ИИ-инфографика на сервере — 09.10.2026

Выпуск `52012268f5ccaacc6cf6493f3b97523daa80ed73` добавил миграцию021, сервис `image-worker` и том `autoreelz2026-release_ai_image_assets`. Перед миграцией создан и проверен чтением DB-only backup; путь и предыдущий env — [отчёт](../artifacts/ai-image-studio/server-deploy/deployment.json) и [activation.json](../artifacts/ai-image-studio/server-deploy/activation.json). Старые миграции не переписывать, рабочий каталог локальным snapshot не заменять.

Web сохраняет нормализованные источники в общий приватный том, worker сохраняет PNG/WebP и квитанции завершения. В backup теперь включать **БД + uploads + ai_image_assets (assets и receipts)**. Том расположен под `/srv/autoreelz2026/.local/share/docker/volumes/`; выдача файлов только через manager/API, публичный alias на этот каталог не создавать. Снимки файлов и БД должны быть согласованными; единичный предмиграционный pg_dump не заменяет полный restore-drill.

Image-worker:1CPU/768MiB/32pids, rootfs read-only, публичных портов нет. HTTP-healthcheck базового web-образа отключена; штатно контейнер имеет состояние `running` без `healthy`. При остановке предоставлены210с для завершения одного запроса. Не использовать принудительный kill при работающем paid-job. Наблюдать состояние процесса и задания `queued/running/uncertain`, а не HTTP4321.

На NL активен `autoreelz-ai-image-gateway.service`, код `/opt/autoreelz-ai-gateway/images/server.py`, env `/etc/autoreelz-ai-gateway/images.env`0600. Текстовый gateway не заменять. Endpoint TLS14447 только для IP91.200.150.79/loopback и отдельного секрета; fixed Images Edits/Sunburst/high/1536×1024, одна обработка,256MiB/25%CPU. Сертификат и дата обновления общие с [текстовым шлюзом](ai-gateway.md). Amnezia/маршруты/firewall не изменялись. Прямой SSH с рабочего компьютера09.10 не отвечал; использован временный SSH ProxyCommand через сервер магазина, с локальными ключами и проверкой known_hosts на обеих связях.

Конфигурация магазина: `AI_IMAGE_PROVIDER=openai`, `AI_IMAGE_API_KEY_CONFIGURED=true` у web, `AI_IMAGE_OPENAI_API_KEY`/`AI_IMAGE_GATEWAY_TOKEN` только у image-worker. Значение ключа задано явно из существующего OpenAI-секрета, автоматического fallback к текстовому env нет. `AI_IMAGE_BUDGET_KEY=autoreelz-image-pilot-v1`, выделенный лимит$4.756348 после локальной части пилота; остаток — в manager и [контракте](ai-image-studio.md). Не менять ключ бюджета ради нового лимита и не удалять журнал. Локальный paid-runner закрыт маркером allocation, его данные сохраняются. Текстовые настройки$10/месяц не менять.

Откат: сначала выключить новые image-запросы в web, затем корректно остановить image-worker с его grace period. Вернуть предыдущий совместимый RELEASE_IMAGE только для web/commerce-worker и запустить их из соответствующего релиза; старый образ не содержит image-worker. При необходимости выключить только image systemd-service после завершения оплаченных запросов. Миграцию021, том, источники, результаты и резервы оставить. Не восстанавливать целиком старый env поверх последующих настроек; брать из приватной копии только нужные поля. Не повторять `uncertain` задания новым платным запросом без сверки расходов.


## Видео товара — 11.10.2026

Выпуск `fde8358eec09bfec9bcfa7c65fb955970ebf3af7`, миграция022: nullable `ar_products.video_url`. Перед применением сохранён читаемый DB-only dump; строки товаров сверены как JSONB без новой NULL-колонки внутри транзакции. [Миграция/backup](../artifacts/product-video/migration.json), [выпуск/env backup](../artifacts/product-video/deployment.json). Новых сервисов/ключей/портов/видеофайлов нет. Старые миграции не менять.

Новый редактор исключает NULL video_url из fingerprint для совместимости старых черновиков. При откате к прежнему приложению колонку и видео сохранять; не сбрасывать черновики автоматически при несовпадении fingerprint старого кода. Проверить редактирование/публикацию в изолированной среде либо перенести этот совместимый расчёт в образ отката. Каталог с видео старый код продолжит читать, но сам плеер в нём отсутствует.


## Справочник автомобилей — 13.10.2026

Выпуск `03db389b717bcfb584e3bcc2a72bb6eda525ba59`, миграция023: INSERT/UPDATE для ar_app на автомобилях/модификациях и отдельная таблица аудита с SELECT/INSERT. DELETE не выдан. Существующие строки/связи/черновики не меняются; перед применением создан читаемый DB-only backup. [Миграция](../artifacts/vehicle-editor/migration.json), [выпуск/env backup](../artifacts/vehicle-editor/deployment.json), [проверка прав и сервисов](../artifacts/vehicle-editor/after-release.json).

При откате к предыдущему `cba00b67d283b4cd3f7c8cabe655079da5d50470` сохранять миграцию023, новые записи справочника и аудит; интерфейс их редактирования будет доступен через CMS. Откат приложения не требует возврата данных из dump. Изменяются только web/worker/image-worker; перед пересозданием image-worker дождаться окончания активных заданий и соблюдать его stop_grace_period. Итоговый исходный архив сверяется с SHA; после обрыва SSH сначала проверить выполненное состояние, не повторять миграцию/активацию вслепую.

## Генератор описаний —14.10.2026

Выпуск `def9ce9aaac290bf536f8067a2effe455ef23612`: новый промпт/правки/история и выбор Luna/Sol. Миграций нет, сохраняются001–023 и прежний журнал. В env изменены RELEASE_IMAGE, добавлены AI_TEXT_ALLOW_SOL=true и AI_TEXT_OPENAI_MODEL=gpt-6-luna. Если владелец выберет Sol по умолчанию, изменить только AI_TEXT_OPENAI_MODEL=gpt-6.1-sol и пересоздать web с той же проверенной сборкой. Image-worker ради текстовой настройки перезапускать не нужно. Общий месячный бюджет остаётся10. [Выпуск/env backup](../artifacts/text-editor/deployment.json), [проверка](../artifacts/text-editor/after-release.json).

NL-шлюз обновлён с точечной копией предыдущего server.py; image gateway и Amnezia не изменены. Расширение совместимо с прежней Luna. При откате приложения сохранить записи Sol, историю и расходы; не сбрасывать месячный бюджет и не удалять отклонённые оплаченные результаты. Сравнение выполнено временными rootless-контейнерами без публичных портов; они удалены, runner.env удалён, планы/ответы остались в закрытом shared/text-eval-20261014 для аудита. Повторный запуск приватного paid-скрипта без новой задачи не нужен.

## Подготовка чеков ЮKassa —15.10.2026

Выпущен749f74f, применена добавочная028 после читаемого DB-only backup. Обновлены только web/worker/image-worker одним образом; остальные контейнеры/env сохранены. `PAYMENT_PROVIDER=yookassa-sandbox`, `YOOKASSA_RECEIPTS_MODE=disabled`. GET/me подтвердил test=true/fiscalization=false,20 HTTP-проверок прошли, данные совпали с предоперационными контрольными суммами. [Итог и пути backup/env](../artifacts/yookassa-receipts/deployment/final.json), [контракт](yookassa-receipts.md).

При отключённых чеках и отсутствии новых receipt_snapshot предыдущий d2d727b совместим с добавочной028; схему/данные не откатывать. После будущего включения чеков старый worker не ведёт их регистрацию: перед откатом отдельно сверять незавершённые операции. Не включать фискализацию/production только сменой переменной или ключа.

## Объединённая корзина и один заказ —15.10.2026

Выпущен2462d01e44548dfd76f5d28c66740ee2b52947b2, миграции001–028 без изменения. Перед выпуском создан читаемый DB-only backup; в env заменён только RELEASE_IMAGE. Обновлены web/worker/image-worker, БД/CMS/edge/background сохранили контейнеры. Новые оферта/доставка опубликованы через штатный content-editor API; остальные документы, каталог, остатки, заказы и ИИ-журналы сохранены. [Итог и пути backup/env](../artifacts/combined-checkout/deployment/final.json), [контракт](combined-checkout.md).

Предыдущий749f74f совместим со схемой и существующими заказами, включая единый preorder с несколькими строками. При откате приложения согласованно вернуть прежние оферту/доставку из `private/combined-checkout-deploy/pages-plan.json` через manager с актуальными версиями/hash и новым ключом команды, после проверки отсутствия более поздних правок. Не восстанавливать весь DB-dump или server.env поверх новых данных/настроек. Старые снимки заказов неизменны. Публичный UI1440/375 проверен без создания заказов/платежей; тестовые корзина и расчёты не являются торговыми заказами.

## SMTP Timeweb —15.10.2026

Выпуск48f6e92, добавочная029 после читаемого DB-only backup. MAIL_PROVIDER=timeweb-smtp; MAIL_ALLOWED_RECIPIENTS и MAIL_OWNER_RECIPIENT — sales@autoreelz.ru. SMTP_PASSWORD хранится в прежнем server.env0600 и передаётся только worker; web/image-worker его не получают. Подтверждены verify из worker, одно разрешённое письмо через очередь/во входящих и21 HTTP-проверка. Прежние env-поля и БД/CMS/edge/background сохранены. [Итог/backup/env-backup](../artifacts/smtp/deployment/final.json), [контракт](mail.md).

Не откатывать commerce-worker к коду до029 с незавершёнными SMTP pending/retry: старый worker не различает провайдеры и может пометить их локально доставленными. Сначала остановить новые постановки/сверить очередь либо откатить только web с сохранением нового worker. Миграцию/историю не удалять, старый outbox не переводить в SMTP. Расширение allowlist/контрольные письма — по отдельному поручению владельца.

## Отправка новых писем всем адресатам15.10.2026

Выпущен6423b28 без миграций. MAIL_RECIPIENT_POLICY=all-new, MAIL_NEW_MESSAGES_FROM=2026-10-14T23:37:31.373Z. Это постоянная граница включения, не скользящий срок; при следующих выпусках её не обновлять. Старые pending/retry до неё блокируются, simulation/blocked/failed/uncertain не переотправляются. При включении ожидающих писем не было, история13 simulation/1 SMTP сохранилась.21 HTTP-проверка и серверная проверка внешнего адреса/запрета старого снимка без отправки успешны. Платёж остаётся sandbox; прочие настройки и защищённые данные сохранены. [Итог](../artifacts/smtp/all-new/final.json).

Для отката только адресатной политики вернуть MAIL_RECIPIENT_POLICY=allowlist, сохранив MAIL_NEW_MESSAGES_FROM и прежний MAIL_ALLOWED_RECIPIENTS=sales@autoreelz.ru. Не снимать временную границу ради старых писем. Контрольные/исторические письма в этом выпуске не отправлялись.

## HTML-письма15.10.2026

Опубликован app6a84aca с030 (после backup), HTML/text/CID-логотип — неизменяемый снимок SMTP. Старая почта не дополнена/не переслана, cutoff и остальные env сохранены. Пять отдельно разрешённых примеров доставлены в sales; общий /orders перенаправляет в /account без повторной отправки. [Контракт и доказательства](mail-html.md).

Для отката сохранить030/историю/снимки. Старый worker не обрабатывает HTML/CID: при pending/retry сначала остановить новые постановки и сверить очередь, либо оставить новый worker при откате web. Только web/worker/image-worker обновлены, БД/CMS/edge/background сохранены.

## Частичные возвраты031 опубликованы15.10.2026

Выпущен644f2c4, применена только031 после читаемого DB-only backup; ранее032 сохранена.24 HTTP-проверки, новая форма/JS/CSS и read-only чтение5 платежей из нового приложения прошли без торговых операций. Защищённые данные/остальные env/cutoff совпали, БД/CMS/edge/background не пересоздавались, web/worker/image-worker используют один образ. [Итог/backup/env-backup](../artifacts/partial-refunds/deployment/final.json), [контракт](partial-refunds.md). Sandbox/disabled-чеки/noindex/test-СДЭК сохраняются.

После частичных записей worker до031 несовместим: нельзя проверять частичную сумму как полный платёж или возвращать полный receipt. Схему/историю/снимки сохранять, уникальность одного возврата на payment_id не восстанавливать, rollback только на совместимую сборку. Применённые001–032 не менять.

## Подтверждение поставщика до прихода15.10.2026

По отдельному поручению выпущен42f3a86d8d7f7cba00638d1eb16a37bdb6f8fa78 и применена032_supplier_preorders.sql после читаемого DB-only backup. На сервере теперь001–030 и032;031 частичных возвратов в этот выпуск не включена и должна применяться отдельно, без повторения032. Образ получен из архива проверенного коммита, сторонние локальные/последующие изменения в него не вошли. [Выпуск/backup/env-backup](../artifacts/supplier-preorders/deployment/final.json), [контракт](supplier-preorders.md).

Обновлены только web/worker/image-worker. В env изменён только RELEASE_IMAGE; SMTP/cutoff/ключи/бюджеты, sandbox/чеки disabled/noindex и Google/Яндекс verification сохранены.22 HTTP-проверки и публичный UI1440/375 с synthetic API прошли; настоящий runtime подтвердил ограничения/новые поля/индекс истечения/права приложения. Реальных команд подтверждения/выделения/оплаты не выполняли, писем не создавали; защищённые таблицы совпали (новые NULL audit-поля исторических заказов при сравнении исключены).

После появления supplier_pending/supplier_paid предыдущий6a84aca не является совместимым откатом: его worker/платёжный код не знают эти состояния. Использовать исправленную совместимую сборку, сохранять032/заказы/журналы. Не возвращать весь server.env или DB-dump поверх новых данных. Для следующих выпусков брать текущий SHA из health/OCI-label; не выбирать релиз только по HEAD/времени каталога.

## SEO и адаптивные фото —15.10.2026

Выпущен4301d0c69c06979c234e0cb09781fa7dfaec0cdd, схема001–032 без изменения. После читаемого DB-only backup применён scripts/data/seo-product-titles.sql к двум пустым целевым полям; обновление updated_at штатное. Остальные поля товаров/торговля/журналы сохранены; в существующей накладной фоновой worker обновил только next_check_at/updated_at, это отдельно сверено с backup через временную таблицу без восстановления рабочей БД. [Итог/backup/env-backup](../artifacts/seo-improvements/deployment/final.json).

Только web/worker/image-worker получили новый образ. Остальные контейнеры/настройки, SMTP/cutoff/ключи/ИИ-бюджеты, verification, sandbox/чеки disabled/test-СДЭК/noindex сохранены.26HTTP-проверок, публичный UI375/1440, галерея/оригинал и мобильный Lighthouse прошли; [замеры](../artifacts/seo-improvements/deployment/mobile-lab.json) одиночные. Адаптивные копии хранятся только в ограниченном кэше памяти web, новых томов/исходников нет.

Откат приложения — прежний совместимый644f2c4052bcd5eb8e87d074d831d8a36af87fa8, замена только RELEASE_IMAGE и compose up из каталога релиза для web/worker/image-worker. Два исправленных title, данные/схему/env сохранять. Старый маршрут media при параметре w отдаст исходник, поэтому откат не требует удаления копий/URL. Не возвращать целиком старый env или dump поверх последующих изменений. Приватные снимки двух строк до правки — shared/seo-improvements-20261015/targets-before-activation.json; отмена правки данных — только по отдельному поручению с проверкой более поздних изменений.

## Приёмка возвратов033 опубликована15.10.2026

По отдельному поручению выпущен6ff750c, применена только033 после читаемого DB-only backup.30HTTP,302 /orders→/account, JS/встроенный CSS и read-only workspace6заказов/права приложения подтверждены без реальных приёмок и складских операций. Журнал пуст, прежние данные/env/cutoff и БД/CMS/edge/background сохранены. Все001–033 checksums совпали; web/worker/image-worker используют один образ. [Итог/backup/env-backup](../artifacts/return-intake/deployment/final.json), [контракт](return-intake.md). Режимы остаются sandbox/disabled-чеки/staging/noindex/test-СДЭК.

Журнал append-only и приход атомарны; после отката кода нельзя сбрасывать on_hand/историю или повторять приход вручную. Старый интерфейс не показывает033, новая обработка должна учитывать журнал. Сохранять совместимость с031/032 и все применённые001–033, не откатывать БД целиком.

## Зависимости безопасности опубликованы15.10.2026

По отдельному поручению включёнba4029c0366f9cb17a0dd744da71295dd7883e48, проверенный образsha256:4d62589a42455d2e73e689cdc4a4a411bf7abe600bc13b4241196bf0fb9bb2b3. В момент этого переключения прежний app6ff750c/001–033 сохранён как совместимый откат; миграций/SQL данных не было. Перед переключением — читаемый DB-only backup и копия env0600. Заменён только RELEASE_IMAGE, перезапущены только web/worker/image-worker. Runtime-env кроме APP_REVISION,69 защищённых таблиц и БД/CMS/edge/background сохранены. [Итог/backup/env-backup](../artifacts/dependency-security/deployment/final.json), [контракт](dependency-security.md).

42HTTP, публичный Chromium1440/375, SHA256 JS редактора/приёмки, read-only6заказов/права033 и WebP прошли. Web/worker healthy; yookassa-sandbox/чеки disabled/staging/noindex/test-СДЭК/SMTP all-new/cutoff и пароль только worker прежние. Новый платёж/заказ/письмо/приёмка не создавались.

Затем параллельно опубликован67c1d92 с034, который включаетba4029c. На итоговой версии повторены42HTTP и read-only проверки пакетов/режимов/SHA256 JS — [результат](../artifacts/dependency-security/deployment/successor.json). После034 нельзя механически возвращать старую схему/образ: совместимость отката проверять заново, историю/данные/env сохранять.

## ЮKassa production-код с выключенными реальными операциями15.10.2026

По прямому поручению владельца выпущенbf6adb6d0112cb34f52a724e48456036de7eecbb/035 после читаемого DB-only backup. Применена только035;001–034 checksums неизменны. Из env заменён только RELEASE_IMAGE; новые live-поля Docker получают безопасные defaults, live opt-in=false. Sandbox/чеки disabled/staging/noindex/test-СДЭК/SMTP cutoff/ключи/бюджеты сохранены. Web/worker/image-worker используют один образ; БД/CMS/edge/background не пересозданы. [Итог/backup/env-backup](../artifacts/yookassa-production/deployment/final.json), [контракт](yookassa-production.md).

32 HTTP+302 и публичный UI1440/375 с настоящей временной сессией прошли, сессия отозвана. Runtime проверил6 существующих заказов/права035/пустую очередь, денежные/фискальные live-команды и paused worker заблокированы до сети. Для повторного выпуска брать текущий SHA из health;035 не повторять. После появления035 job/full_payment-return откат только на совместимый обработчик с сохранением истории. Реальные платежи/чеки включаются отдельно.

## Установка рабочих ключей ЮKassa без активации15.10.2026

По отдельному поручению владельца добавлены только YOOKASSA_LIVE_SHOP_ID/YOOKASSA_LIVE_SECRET_KEY из локального private/yookassa-live.env в server.env0600; перед изменением создана приватная копия. Compose5.5.1 проверен, обе конфигурации текущего выпуска использованы без изменения. Выполнен up -d --no-deps только для web/worker на прежнем образеbf6adb6. Ключи присутствуют только у этих сервисов; временный файл переноса удалён. Sandbox/disabled-чеки/live opt-in=false/staging/noindex/test-СДЭК/SMTP cutoff и остальные env/runtime-поля сохранены. Образ,001–035,70 защищённых таблиц и остальные контейнеры сохранены.

Серверный GET/me200 подтвердил установленный рабочий магазин/способы оплаты/фискализацию. Блокировки реальных команд до сети и14HTTP/noindex прошли; реальных операций0. [Отчёт и путь резервной копии](../artifacts/yookassa-live-key-install-2026-10-15.json). Откат установки — вернуть только два live-поля из копии, проверив актуальные режимы и остальные поля, затем пересоздать web/worker на действующем образе и проверить здоровье. Полный старый env поверх последующих изменений не восстанавливать. Настоящая доставка уведомлений/чеков пока не подтверждена.
