# Сервер: диагностика, выпуск и откат

Действующий регламент на24.09.2026. Текущие app SHA/image ID — **[status.md](status.md)**, доказательство последнего выпуска — указанный там deployment/public-check. [История размещения](server-history.md) сохранена отдельно; её команды первого переноса повторять нельзя.

## Ресурсы и границы

- SSH: `root@91.200.150.79:22`, отдельные `private/ssh_server_ed25519` и `private/server_known_hosts`.
- Новый Linux-пользователь: `autoreelz2026`, UID1018; дом `/srv/autoreelz2026`.
- Только наш rootless Docker: проект `autoreelz2026-release`, socket `/run/user/1018/docker.sock`. Системный Docker, ISPmanager и другие сайты не менять.
- Релизы: `/srv/autoreelz2026/releases/<полный-SHA>`; архивы: `incoming/`; рабочий env: `shared/bootstrap/server.env`.
- Каталог/заказы: БД `autoreelz2026_new`. Серверная БД авторитетна и не заменяется локальной.
- Фото CMS: том `autoreelz2026-release_uploads`, физически `/srv/autoreelz2026/.local/share/docker/volumes/autoreelz2026-release_uploads/_data`; новые фото обычно добавлять через CMS.
- Тур: `/srv/autoreelz2026/public/muzey/`, доступен через `/muzey/`. Не включать его большие файлы в Git/образ web.
- Внешний HTTPS проходит через DDoS-Guard; origin Nginx-конфиг `/etc/nginx/conf.d/autoreelz2026.conf` направляет на127.0.0.1:14324. Наш Caddy маршрутизирует web4321 и CMS8055 внутри Docker.
- TLS origin — предоставленный Timeweb Pro, `/etc/ssl/autoreelz2026/`, срок до10.03.2027 по проверке23.09.2026. Автопродление в кабинете не равно автоматической доставке следующего CRT/KEY на этот сервер: последняя пока не настроена.

Используются **оба** файла: `infra/release/compose.yaml` и `infra/release/ispmanager.yaml`. Базовый compose отдельно имеет production/default-параметры и не описывает текущий запуск. `staging.yaml`/`Caddyfile.staging` — старый вариант с общим паролем, не текущий сервер. Переменные TEST_GATE_* ещё требуются синтаксисом overlay, но действующий Caddyfile.ispmanager общего Basic Auth не включает. Не удалять их из env без отдельной правки конфигурации.

## Безопасное начало — только чтение

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

1. Проверить изменение локально по [testing.md](testing.md), сохранить необходимые доказательства. Просмотреть diff, закоммитить код. Дерево должно быть чистым; SHA — полный40hex. `git rev-parse HEAD` не обязан совпадать с текущим сервером.
2. Сохранить текущие app SHA/image ID, миграции и предыдущий env вне Git. Если меняется схема/контент — сначала backup. Для CSS/JS-only выпуска новая копия БД не заменяет общую программу резервирования, но схема/данные не должны меняться.
3. На рабочем компьютере подготовить архив **проверенного коммита**, не рабочей папки:

```sh
ar_release_sha=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
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
  -p autoreelz2026-release up -d --no-deps web worker edge
```

Web и worker должны использовать один проверенный образ. БД/CMS не пересоздавать для обычной правки витрины. Caddy admin API отключён: `caddy reload` через2019 не работает; для изменённого конфига сначала validate, затем перезапуск/пересоздание только собственного edge.

8. Проверить health/SHA, состояние web/worker и затронутое поведение. Контроль маршрутов: `/`200 без пароля; `/cms/users/me` и `/api/manager/orders`401 анонимно; `/muzey/`200; `/cookies`404; noindex сохранён. Webhook ЮKassa должен оставаться доступным по точному пути, но не посылать поддельный succeeded ради smoke.
9. Записать deployment с SHA/image ID/миграцией/проверками, обновить status/next-session, сделать отдельный коммит результата и push. Документационный commit не пересобирать ради равенства HEAD и app SHA.

## Копии и восстановление

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
