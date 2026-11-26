#!/usr/bin/env bash
# Checks that the local stack applied every migration, then runs every SQL test against it. Start the
# stack first with `supabase start`. Each test runs in a transaction and rolls back, so a run leaves the
# database as it found it. Exits nonzero when a migration is missing or any test fails.
set -uo pipefail

cd "$(dirname "$0")/../.."
db="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

migrations=(supabase/migrations/*.sql)
applied=$(psql "$db" -XAtc 'select count(*) from supabase_migrations.schema_migrations') || exit 1

if [ "$applied" != "${#migrations[@]}" ]; then
  echo "The stack applied $applied of ${#migrations[@]} migrations in supabase/migrations."
  exit 1
fi

echo "Applied all ${#migrations[@]} migrations."

tests=(supabase/tests/*.sql)
failed=()

for file in "${tests[@]}"; do
  if psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$file"; then
    echo "pass $file"
  else
    echo "FAIL $file"
    failed+=("$file")
  fi
done

echo "${#tests[@]} SQL test files, ${#failed[@]} failed."
[ "${#failed[@]}" = 0 ]
