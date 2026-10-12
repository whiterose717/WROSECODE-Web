# WROSECODE Web Console — V3

**WROSECODE agent + CTF web workspace** for Node.js 22.13+, modern browsers and per-user CLI companion devices on Kali Linux, Windows and macOS. This source archive includes the static frontend and self-hosted Node/SQLite backend. The Rust `wrosecode` executable is **not** bundled here.

### What's new in V3

- Email/password **Sign in / Sign up**, password confirmation, owner bootstrap. Google/GitHub buttons removed. Social OAuth routes **disabled by default**; users sign in with their own website account.
- Full-viewport dark agent chat inspired by the layout in the supplied DeepSeek Harness screenshot. The WROSECODE name, own branding and cyan accents remain.
- Responsive mobile layout, collapsible device/provider/model settings, scrollable sessions and batched SSE transcript updates.
- CTF upload, live output, deduplicated flag-pattern candidate cards and one-click copy. A discovered candidate is **not an independently verified flag**.
- Account-isolated outbound CLI companion protocol for Windows, macOS and Linux. Each account can pair its own CLI and use chat/CTF and locally approved file/terminal operations, subject to the installed CLI's support.
- Directly usable `/login` and `/console` routes on Node and Cloudflare Pages with `_redirects`.

**Read:** [UPGRADE_V3_SINHALA.md](UPGRADE_V3_SINHALA.md) — install/merge/remote-device instructions in Sinhala/English, [CLI_PAIRING.md](CLI_PAIRING.md), [NATIVE_BRIDGE_V2.md](NATIVE_BRIDGE_V2.md), [DEPLOYMENT.md](DEPLOYMENT.md).

## Secure quick start for a NEW local install

```bash
cd WROSECODE-Web-Console
node --version           # Node >=22.13
cp -n .env.example .env  # edit for your real host/ports; do not publish
npm run check
npm test
npm run build
./scripts/create-admin.sh
node --env-file=.env server/server.mjs
```

Use `http://127.0.0.1:8787/login` for local sign-in. On an EXISTING Kali system with a `wrosecode-web.service` already running, **do not start a second instance on port 8787**: preserve your private `.env` and `data/`, merge the upgraded code, restart the service, and test `/api/health`.

Your login database is in `data/`; **never copy production `.env`, `data/`, `~/.wrosecode/` or private Git history into a public ZIP**. This distributed ZIP intentionally excludes those items. The master API key encryption secret must also remain private.

## Remote access: private vs public

| Scenario | Method | Notes |
|---|---|---|
| Same machine | `http://127.0.0.1:8787` | Server bound to loopback |
| Your own devices, same Wi‑Fi or mobile data | **Tailscale Serve** with authenticated tailnet clients | Private, encrypted; Kali must be on |
| Any unaffiliated browser user on internet | Public secure HTTPS Node backend + ingress/relay | **Not deployed by this ZIP**; Pages only hosts the static frontend |

The Node app can remain bound to `127.0.0.1:8787` and Tailscale Serve route to it, for example `sudo tailscale serve --bg http://127.0.0.1:8787`. In `.env`, use the HTTPS Serve origin for **both** `PUBLIC_BASE_URL` and `FRONTEND_URL` while private-testing (e.g. the `https://<device>.<tailnet>.ts.net` URL Tailscale actually assigns). Sign in from a device that is a member of the same tailnet.

Cloudflare Pages `wrosecode-web.pages.dev` **cannot talk to a private Tailscale Serve endpoint from arbitrary public visitors**. For public registration/login, deploy an internet-reachable authenticated backend, set build-time `WROSECODE_BACKEND_URL` in Pages to its real HTTPS origin, rebuild/redeploy and validate cookies and security controls. For Safari, prefer login and console on the **backend origin**. A functioning public relay requires deployment; this ZIP does not make remote access automatically work from any network without it.

## Pair CLI for each user

1. Sign in → **Connect CLI** → Generate pairing code (expires after 10 minutes).
2. Install the actual `wrosecode` CLI and Node.js 22.13+ on your own device.
3. Run from the extracted project directory as your normal OS user (not root):

```bash
node scripts/device-agent.mjs --backend https://YOUR-BACKEND --code YOUR-PAIR-CODE
```

The companion saves its token with private permissions and makes **outbound HTTPS** connections. Keep the agent running to accept tasks. `Connect CLI` shows devices when they report online. Remote tools require approval **on the local CLI device** and operate within a configured workspace, not unbounded shell access. This is **not** an OpenCode TUI or arbitrary remote desktop/PTY mirror.

Leave these defaults intact for a shared website:

```dotenv
SIGNUP_MODE=open
ENABLE_SOCIAL_LOGIN=0
BRIDGE_MODE=disabled
ALLOW_MEMBER_JOBS=0
I_ACCEPT_SHARED_CLI_RISK=no
```

For direct AI provider profiles set `PROVIDER_ENCRYPTION_KEY` as described in `.env.example` and ensure HTTPS, SSRF-safe endpoint settings.

## Verification

```bash
npm run check
npm test
npm run build
curl -fsS http://127.0.0.1:8787/api/health
```

The automated test suite covers browser source contracts, flag parsing, mock authenticated CLI bridge, per-user pairing isolation, event streaming, sessions, security checks, lifecycle and optional legacy OAuth safety. Passing tests **does not guarantee real provider/API reachability, flag correctness, actual Kali binary compatibility, or real public internet routing**. Confirm these with the user's machine and hosting.
