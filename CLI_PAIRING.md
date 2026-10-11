# CLI pairing — connect the browser to your Kali Rust server

The Rust server binds `127.0.0.1:4076` and requires a bearer token from
`~/.wrosecode/server.token` (or per-device tokens from pairing). The token
never leaves your Kali host: the browser only holds the Node session cookie,
and Node proxies to Rust server-side.

## One-time setup (Kali)

```bash
# 1. Start the real agent API (loopback only — do NOT use 0.0.0.0 publicly)
wrosecode server --hostname 127.0.0.1 --port 4076

# 2. In another terminal, generate a pairing code (10-minute, one-time use)
wrosecode bridge pair
# → Device  dev_xxx
# → Code    123-456

# 3. Start the Node backend (same machine)
cd /home/kali/Desktop/myweb/WROSECODE-Web-Console
node --env-file=.env server/server.mjs
```

If `HOME` differs between root and your user, set the token path explicitly:

```dotenv
WROSE_TOKEN_FILE=/root/.wrosecode/server.token
# or: WROSE_TOKEN_FILE=/home/kali/.wrosecode/server.token
```

## Pair in the browser

1. Sign in (Google, GitHub, or approved email/password).
2. Open **Connect CLI** in the console sidebar.
3. Status shows `REACHABLE / UNPAIRED` if Rust is up.
4. Enter the `123-456` code + device name → **PAIR DEVICE**.
5. Status becomes `RUST CLI CONNECTED` with provider/model.
6. Agent chat now streams from the real Rust model.
7. **REVOKE** deletes the device token locally and on Rust
   (`POST /v1/devices/revoke`).

Pairing binds `account_id = your login email`. Rust enforces session
isolation: a device token cannot read another account's sessions.

## If Kali stops

- Status shows `CLI OFFLINE`; chat shows the error (no fake success).
- Restart `wrosecode server ...` — the browser restores service without
  exposing another user's device (pairing is per-login-email).

## Relay / different networks

The Rust server dials **out** only when configured:

```bash
wrosecode bridge status     # NOT CONFIGURED = local-only (normal)
wrosecode bridge login --relay wss://<your-worker>/relay/device
```

Without a relay, cross-network browsers must reach the **Node backend**
(Tunnel/Tailscale), which proxies to Rust over loopback. Never enter
`192.168.x.x:4076` into the public HTTPS site — mixed-content browsers block
`http://` private IPs from `https://` pages, and the token would be exposed.

## API (authenticated, owner/approved only)

```
GET  /api/cli/status      → reachable/authorized/paired/busy/provider/model
POST /api/cli/pair        → {code, device_name?} → {device_id} (no token out)
POST /api/cli/revoke      → unpair current user
GET  /api/cli/providers   → redacted provider list (keys masked)
GET  /api/cli/models?provider=vyce
POST /api/cli/chat        → {prompt,...} → {answer, session_id}
POST /api/cli/chat/stream → SSE: chat.started/delta/completed/failed
GET  /api/cli/sessions    → own-account sessions only
GET  /api/cli/ctf/status
```

HTTP 503 `agent busy` means a chat/CTF turn holds the Rust agent — the UI
shows BUSY and retries; it never hangs.
