#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf '%s\n' 'Run this with sudo so the token stays in the protected system file.' >&2
  exit 1
fi
read -r -s -p 'Paste the newly rotated Cloudflare Tunnel token: ' token
printf '\n'
if [[ "${#token}" -lt 80 || "$token" == *[[:space:]]* ]]; then
  unset token
  printf '%s\n' 'Token was empty, too short, or contained whitespace; no file changed.' >&2
  exit 1
fi
tmp="$(mktemp /etc/cloudflared/token.XXXXXX)"
chmod 600 "$tmp"
chown root:root "$tmp"
printf '%s' "$token" > "$tmp"
unset token
mv -f -- "$tmp" /etc/cloudflared/token
systemctl enable --now cloudflared
systemctl is-active --quiet cloudflared
printf '%s\n' 'Cloudflare Tunnel restarted with the new token.'
