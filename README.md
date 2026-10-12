# WROSECODE Enhanced Web Console — Native Bridge Companion v2

**Source + Cloudflare Pages frontend + self-hosted Node backend + cross-platform companion.** Enhanced remote chat, device status, user-selected device routing, bounded conversation history, streaming, optional stdin and individually locally approved terminal/workspace-file operations. The companion is an external Node process; full native Rust TUI mirroring needs changes to the original Rust CLI repository and remains outside this source ZIP.

**Start with** [NATIVE_BRIDGE_V2.md](NATIVE_BRIDGE_V2.md), [DEPLOYMENT.md](DEPLOYMENT.md), [CLI_PAIRING.md](CLI_PAIRING.md), [OAUTH_SETUP.md](OAUTH_SETUP.md), [TEST_RESULTS_NATIVE.md](TEST_RESULTS_NATIVE.md).

**Security:** Google/GitHub secrets previously posted in chat must be **replaced** at the providers and kept only in your local `.env`. Do not publish any token or device credential. Use an unprivileged CLI account. The local CLI's AI tools are not an OS sandbox. Protect the backend with HTTPS and authenticated access.

---

# WROSECODE Enhanced Web Console (ZIP upgrade)

This package is based on the *uploaded standalone source ZIP*. It includes self-service sign-up, per-user private CLI agent pairing, BYOK OpenAI-compatible provider profiles, and a Pages-safe frontend build. See [CHANGELOG-UPGRADE.md](CHANGELOG-UPGRADE.md) for scope and honest test limits.

**Start here:** [DEPLOYMENT.md](DEPLOYMENT.md) · [CLI_PAIRING.md](CLI_PAIRING.md) · [OAUTH_SETUP.md](OAUTH_SETUP.md) · [TEST_RESULTS_UPGRADE.md](TEST_RESULTS_UPGRADE.md)

**URGENT:** Any OAuth client secrets pasted into chat must be revoked and rotated. Never insert secrets into `backend.js` or a shared ZIP.

---

# WROSECODE Web Console — Kali-hosted, authenticated agent bridge

This project extends the original WROSECODE static CTF lab and CLI download/docs website with a separate **Node.js 22.13+ backend**, browser chat/CTF workspace, email-password accounts, optional Google/GitHub OAuth, provider selection, live SSE, and Kali Linux / Tailscale access. Your uploaded purple-blue WROSECODE logo is included as transparent PNG.

**Not a modified Rust repo:** this implementation launches your installed WROSECODE binary as a child process. The real Kali environment and Rust repository were **not** accessible for integration testing. The bundled mock binary exercises the command protocol; real compatibility must be validated on your machine. It is **not** safe to offer untrusted visitors general shell execution without genuine VM/container isolation and per-user provider credential separation.

## Project files

- `index.html` / `docs.html`: the original WROSECODE landing, browser-local CTF lab, CLI install/download center and documentation (preserved, with new links and logo)
- `login.html`, `login.js`: accounts and optional social login
- `console.html`, `console.css`, `console.js`: multi-panel chat/CTF/profiles/jobs/access-control interface
- `web-setup.html`: complete Kali LAN, Tailscale, OAuth setup guide
- `server/server.mjs`: authenticated API, SQLite sessions, OAuth, uploads, task queue, CLI bridge, SSE
- `scripts/create-admin.mjs`: initial private owner account
- `tests/api.test.mjs`: live mock-CLI HTTP integration test
- `tests/browser_static.py`: desktop/mobile browser rendering and navigation tests (uses Playwright + Chromium)
- `.env.example`: configuration starter

## Quick start on Kali Linux

Requires Node.js >=22.13 and your installed `wrosecode` CLI. Do not run this as root.

```bash
cd WROSECODE-Web-Console
node --version
wrosecode --version
wrosecode providers list
cp .env.example .env
# Edit .env to change BRIDGE_MODE=cli and set WROSECODE_BIN to an absolute CLI path.
read -rp 'Admin email: ' ADMIN_EMAIL
read -rsp 'Admin password (12+ chars): ' ADMIN_PASSWORD; echo
export ADMIN_EMAIL ADMIN_PASSWORD
node --env-file=.env scripts/create-admin.mjs
unset ADMIN_EMAIL ADMIN_PASSWORD
node --env-file=.env server/server.mjs
```

Open `http://127.0.0.1:8787/login.html`. **No `npm install` required**: backend uses Node 22 built-ins including `node:sqlite` (experimental in some Node 22 versions). `BRIDGE_MODE=disabled` is the safe default. For local fake integration, set `BRIDGE_MODE=mock` (simulated messages, no real AI). Real agent: `BRIDGE_MODE=cli` and `WROSECODE_BIN=/path/to/wrosecode`.

Default: bind `127.0.0.1`, port `8787`, server URL `http://127.0.0.1:8787`, private account registration, one owner running commands. The web bridge creates per-user workspace directories but **this is not an OS sandbox**.

### Same LAN (trusted/test environment only)

Find your actual local IP (`hostname -I`). In `.env`:

```dotenv
HOST=0.0.0.0
PORT=8787
PUBLIC_BASE_URL=http://192.168.1.50:8787
BRIDGE_MODE=cli
```

Replace `192.168.1.50` with the actual Kali host LAN IP. Restart the Node server. Open `http://KALI_LAN_IP:8787` from another device on that LAN (and restrict inbound firewall rules). **Plain HTTP carries passwords unencrypted.** Do not use this configuration on untrusted Wi-Fi or as an internet-facing deployment. Prefer a TLS reverse proxy or Tailscale HTTPS.

### Different networks: private Tailscale Serve

Install Tailscale on your Kali host and client devices and add them to the same permitted tailnet. Set `.env`:

```dotenv
HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=https://your-kali.your-tailnet.ts.net
BRIDGE_MODE=cli
```

Then start the app and on Kali run:

```bash
sudo tailscale up
node --env-file=.env server/server.mjs
# in a second terminal
tailscale serve --bg 8787
tailscale serve status
```

Use the **actual** HTTPS hostname reported by Tailscale Serve in `PUBLIC_BASE_URL`. Restart the web server after changing it. `tailscale serve` remains private to authorized tailnet participants; do **not** use `tailscale funnel` for the execution bridge. Check [Tailscale Serve docs](https://tailscale.com/docs/reference/tailscale-cli/serve) if your local client syntax differs. Tailscale must support HTTPS certificates for Serve.

### Google/GitHub login

Register OAuth clients in the respective developer consoles and put these in `.env`:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Required callback URLs:

```
https://your-kali.your-tailnet.ts.net/api/oauth/google/callback
https://your-kali.your-tailnet.ts.net/api/oauth/github/callback
```

Google's domain verification/consent requirements may reject a `*.ts.net` redirect; a domain you control with HTTPS may be necessary. Social login supports verified-email identification, OAuth state and Google's PKCE. OAuth credential issuance and real callback success were **not tested against live provider accounts**. When adding Google/GitHub to an existing email account, sign in with email/password first and use **Link Google login** / **Link GitHub login** in the AI providers tab. This avoids automatically merging unverified password sign-ups with OAuth accounts. Password registration does not verify ownership of the claimed email address: enable it only with owner review or add a real email-verification service for public signups. Do not expose `.env` to the internet.

### Users, approvals, execution safety

`SIGNUP_MODE=closed` is default. Set to `open` to allow new email/password accounts and verified Google/GitHub signups. New users appear as pending; an owner can approve them under **Access control**. The bridge intentionally lets only the **owner** execute CLI tasks by default, even after approval.

`ALLOW_MEMBER_JOBS=1` plus `I_ACCEPT_SHARED_CLI_RISK=yes` disables that guard, but **never enable it for untrusted/public users**. This project does not enforce separate Linux users, containers, per-user CLI provider billing, filesystem isolation or network egress policy. Shared host credentials and privileged CLI tools could otherwise be abused. Build a sandboxed worker service before enabling publicly available arbitrary AI tasks.

### CLI bridge arguments

- Chat: `wrosecode --headless --events - --permission auto-safe --max-wall-time 300 [--provider ID] [--model ID] "request"`
- CTF: `wrosecode ctf /absolute/path/to/uploaded/artifact --budget steps=40,seconds=300`
- Providers: `wrosecode providers list` (redacted and bounded output)

Execution: `spawn` with `shell:false`; owner-only by default; stdout/stderr redaction and capped logs, timeout with termination, job cancellation, modest bounded task queue. No arbitrary shell string is accepted as an HTTP endpoint. Those command flags were derived from the user-provided CLI documentation and must be checked against the installed build.

CTF uploads: 16 MiB max, owner permission, explicit authorization checkbox on the UI, random server path, no archive extraction by the web server. The CLI may still inspect/execute challenge content: **run in an isolated sandbox for untrusted artifacts**. Regex-like flags emitted by the CLI are labeled **UNVERIFIED** and are never marked solved by this bridge without independent challenge-authority confirmation. A 0 exit code means completed execution, not a verified flag.

### Cloudflare Pages

Static landing/docs pages can be deployed to Cloudflare Pages; the Node server and native CLI cannot execute in a simple static Pages deployment. For the full working console host these files with the Node server on Kali or an isolated Linux server behind HTTPS, and ensure the browser uses the same-origin `/api` endpoints. Do not upload the `.env`, SQLite data or server state to Pages.

## Testing and evidence

```bash
npm test
python tests/browser_static.py  # requires Playwright + Chromium installed
```

At creation: `npm test` passed a mocked executable integration suite covering login, rejected unauthorized users, permission gating, artifact upload, path rejection, CLI event streaming, provider secret redaction, false-positive flags, and cross-origin mutation rejection. Desktop (1440px) and mobile (390px) browser static layout/nav tests passed. Tests of local Chromium **navigation to the live HTTP server** were blocked by the execution environment's browser administrator policy; this is not a claim of a successful live browser/E2E UI test. Actual Rust WROSECODE CLI, real Google/GitHub OAuth, Tailscale, Kali OS, hardened sandbox and public multi-user security were not tested and must be validated on the target host.

## Current limitations

- A shared CLI installation means shared provider credentials; not a multi-tenant cloud SaaS.
- Job events survive restarts in SQLite; running processes are marked interrupted on restart. Relaunching a task is manual; no process reconnection across restart.
- The chat bridge uses headless one-shot prompts, not a full persistent interactive Rust TUI session; the CLI's own session architecture may be expanded later.
- No verified flag submission or automated challenge-authority validation (unverified candidate reporting only).
- OAuth setup and TLS require external accounts/domain configuration.
- No true per-user container/VM sandbox, egress filtering, billing isolation, distributed scaling or professional security audit.
- Full Rust CLI source-based integration and solve-rate benchmarks were not possible without the actual repo and Kali binary.
