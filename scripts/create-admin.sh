#!/usr/bin/env bash
set -euo pipefail

wrose_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
read -r -p 'Owner email: ' ADMIN_EMAIL
read -r -s -p 'Owner password (12–200 characters): ' ADMIN_PASSWORD
printf '\n'
read -r -s -p 'Confirm owner password: ' ADMIN_PASSWORD_CONFIRM
printf '\n'
if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
  unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
  printf '%s\n' 'Passwords did not match; no account changed.' >&2
  exit 1
fi
unset ADMIN_PASSWORD_CONFIRM
export ADMIN_EMAIL ADMIN_PASSWORD
exec /usr/local/lib/wrosecode/node --env-file="$wrose_root/.env" "$wrose_root/scripts/create-admin.mjs"
