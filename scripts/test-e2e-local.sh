#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/server/.env"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not installed."
  exit 1
fi

resolve_db_url() {
  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    printf '%s\n' "${SUPABASE_DB_URL}"
    return
  fi
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s\n' "${DATABASE_URL}"
    return
  fi
  if [[ -f "${ENV_FILE}" ]]; then
    local line
    line="$(grep -E '^(SUPABASE_DB_URL|DATABASE_URL)=' "${ENV_FILE}" | head -n 1 || true)"
    if [[ -n "${line}" ]]; then
      line="${line#*=}"
      line="${line%\"}"
      line="${line#\"}"
      printf '%s\n' "${line}"
      return
    fi
  fi
  return 1
}

BASE_DB_URL="$(resolve_db_url || true)"
if [[ -z "${BASE_DB_URL}" ]]; then
  echo "No database URL found. Set SUPABASE_DB_URL or DATABASE_URL, or configure server/.env."
  exit 1
fi

read -r ADMIN_DB_URL TEST_DB_URL TEST_DB_NAME <<EOF
$(node - "${BASE_DB_URL}" <<'NODE'
const raw = process.argv[2];
const base = new URL(raw);
base.search = '';
const dbName = `songless_e2e_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const admin = new URL(base.toString());
admin.pathname = '/postgres';
const test = new URL(base.toString());
test.pathname = `/${dbName}`;
process.stdout.write(`${admin.toString()} ${test.toString()} ${dbName}`);
NODE
)
EOF

cleanup() {
  psql "${ADMIN_DB_URL}" -v ON_ERROR_STOP=1 \
    -c "drop database if exists \"${TEST_DB_NAME}\" with (force);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating test database ${TEST_DB_NAME}..."
psql "${ADMIN_DB_URL}" -v ON_ERROR_STOP=1 -c "create database \"${TEST_DB_NAME}\";"

echo "Bootstrapping Supabase-compatible auth helpers/roles..."
psql "${TEST_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;
SQL

echo "Applying migrations..."
shopt -s nullglob
all_migration_files=("${ROOT_DIR}"/supabase/migrations/*.sql)
native_port_files=("${ROOT_DIR}"/supabase/migrations/*_supabase_native_port.sql)
migration_files=()

if [[ "${#native_port_files[@]}" -gt 0 ]]; then
  latest_native_port="$(printf '%s\n' "${native_port_files[@]}" | sort | tail -n 1)"
  while IFS= read -r file; do
    if [[ "$(basename "${file}")" < "$(basename "${latest_native_port}")" ]]; then
      continue
    fi
    migration_files+=("${file}")
  done < <(printf '%s\n' "${all_migration_files[@]}" | sort)
else
  while IFS= read -r file; do
    migration_files+=("${file}")
  done < <(printf '%s\n' "${all_migration_files[@]}" | sort)
fi
if [[ "${#migration_files[@]}" -eq 0 ]]; then
  echo "No migration files found under supabase/migrations."
  exit 1
fi

echo "Migration set:"
printf ' - %s\n' "${migration_files[@]}"

for file in "${migration_files[@]}"; do
  psql "${TEST_DB_URL}" -v ON_ERROR_STOP=1 -f "${file}"
done

echo "Running full E2E test suite..."
(
  cd "${ROOT_DIR}"
  DATABASE_URL="${TEST_DB_URL}" node --test tests/server.test.js tests/deezer-audio.test.js
)

echo "E2E run complete. Test database will be cleaned up."
