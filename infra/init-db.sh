#!/bin/sh
set -eu
# Runs idempotently in this project's db-init service after PostgreSQL is healthy.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=cms_password="$CMS_DB_PASSWORD" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=read_password="$READ_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE ar_cms LOGIN PASSWORD %L', :'cms_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ar_cms') \gexec
SELECT format('CREATE ROLE ar_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ar_app') \gexec
SELECT format('CREATE ROLE ar_catalog_reader LOGIN PASSWORD %L', :'read_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ar_catalog_reader') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO ar_cms;
GRANT USAGE ON SCHEMA public TO ar_app, ar_catalog_reader;
SQL
