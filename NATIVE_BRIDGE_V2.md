# WROSECODE Device Bridge v2 — owner-approved remote agent, not an unrestricted TUI

This edition adds account-scoped remote CLI device selection, outbound companion auto-reconnect, rich capability/OS status, conversation history, live streamed output, cancellable jobs, optional stdin input, and terminal/file requests that require **explicit local approval** on the machine that owns the CLI.

## What it actually does

Browser/iPhone -> authenticated Node HTTPS backend -> 1 assigned user/device job -> outbound-only companion -> installed `wrosecode` executable -> streamed text events. Each signed-in user only sees their own jobs, device tokens, conversations, and saved provider API profiles. Any user can register with `SIGNUP_MODE=open` and pair **their own** companion; the host's shared CLI remains off (`BRIDGE_MODE=disabled`, `ALLOW_MEMBER_JOBS=0`, `I_ACCEPT_SHARED_CLI_RISK=no`).

### Platform support

The companion is Node.js 22.13+ and uses `spawn(..., {shell:false})`; its cross-platform code targets Linux/Kali, Windows, and macOS. Actual compatibility depends on the installed WROSECODE CLI executable on that machine. We did not have the user's real Rust CLI binary/source, so its exact arguments, native TUI, native permission events, multi-agent tools and model catalog are **not verified**. The CLI launches on demand as a subprocess, rather than mounting a persistent pseudo-terminal. Browser 'send stdin' only works with CLI builds that accept non-TTY input. This is NOT a Rust-internal native bridge or full OpenCode-like TUI mirror.

### Local commands (Linux/macOS)

Start your private HTTPS-reachable Node backend (and tunnel) on the host with `.env` configured:

```bash
node --version
cd WROSECODE-Web-Console
cp .env.example .env  # only if you haven't already configured it
chmod 600 .env
node --env-file=.env server/server.mjs
```

Sign in to the same-origin HTTPS console. Select `Connect CLI` and create a single-use 10-minute pairing code. Then, on **the computer with the installed CLI**, run:

```bash
node --version
command -v wrosecode
wrosecode --help
# From an extracted copy of THIS ZIP:
export WROSECODE_BIN="$(command -v wrosecode)"
export WROSE_WORKSPACE_ROOT="$HOME/wrosecode-web-workspace"
node scripts/device-agent.mjs --backend https://YOUR-STABLE-BACKEND-HOST --code XXXXXX-XXXXXX
```

Subsequent launches need no code:

```bash
node scripts/device-agent.mjs --backend https://YOUR-STABLE-BACKEND-HOST
```

The token is stored at `~/.wrosecode/web-device.json` (0600 where supported). **Never share this file**, and revoke lost devices immediately from the web console. The agent never binds an incoming TCP port.

### Windows PowerShell

```powershell
node --version
where.exe wrosecode
$env:WROSECODE_BIN = 'C:\path\to\wrosecode.exe'
$env:WROSE_WORKSPACE_ROOT = "$HOME\wrosecode-web-workspace"
node .\scripts\device-agent.mjs --backend https://YOUR-STABLE-BACKEND-HOST --code XXXXXX-XXXXXX
```

Keep companion running while using the web interface. An unstable network triggers bounded exponential reconnect retries. The backend must remain online and the user must be able to reach it over HTTPS. `pages.dev` hosts static assets only. For production iPhone Safari sign-in, prefer loading the full Node-served console over the backend hostname to avoid cross-origin cookie blocking.

## Capabilities and access policy

- **Agent chat:** Sends an independent prompt to the installed CLI, with per-session bounded prior conversation messages as context. Selected provider/model flags are passed **only if** the installed CLI advertises the corresponding options. AI tool actions depend on the CLI's own settings/approvals.
- **Sessions:** Conversation metadata/history is stored per account and device in SQLite. The CLI is spawned per turn. This gives contextual continuity, **not** native resumed agent state or permanent local TUI state.
- **Remote stdin:** While a CLI process is running, the browser may send a line to its standard input, subject to job/account ownership. Interactive TUIs requiring a PTY will not work via this stream.
- **CTF:** Authorized artifact is copied to a 0600 file in the device workspace, referenced by the local CLI prompt, and removed after the run. Flags detected in output are candidates, not verified solves.
- **Terminal:** UI submits one executable and argv (no shell expansion or pipes); the trusted local machine user must type `yes` in the companion terminal within 30 seconds. Non-interactive auto-start services **deny** terminal operations. Output is bounded and logged to the account's private job SSE stream. This is **not** a sandbox: an approved terminal command can affect host files. Do not approve untrusted commands.
- **Workspace files:** List/read/write operations are limited to `WROSE_WORKSPACE_ROOT`. Relative paths only; traversal and out-of-root symlinks are rejected. Read limit 128 KiB; write limit 100 KiB. Every operation requires **local approval**. Noninteractive companions deny. This is NOT an OS-enforced sandbox against the CLI's own tool execution.
- **Pair/revoke:** 12-character random single-use code, hashed device token, per-account device routing, and revoke cancellation. The token is never returned to another browser account.
- **Providers:** Private OpenAI-compatible API profiles remain encrypted in SQLite by `PROVIDER_ENCRYPTION_KEY`. Supported presets are OpenAI API, DeepSeek, Groq, OpenRouter, optional custom HTTPS endpoint. ChatGPT website login is not OpenAI API authentication and is not implemented as provider OAuth.

## Recommended production security

1. Stable HTTPS backend with Cloudflare Tunnel and preferably same-origin Node-served console; leave Node bound to loopback and never expose Rust port 4076.
2. Enable separate backend auth/Google/GitHub OAuth with verified redirects; rotate previously exposed secrets.
3. Run Node and companion under unprivileged local OS accounts. For internet-facing public users, deploy quotas and abuse controls, audit logging, and a separate isolated sandbox for executing untrusted challenges.
4. Prefer containers/VMs for untrusted AI commands and CTF tasks, since an AI CLI can potentially execute tools with its OS account permissions. Local approval on terminal/file UI does not constrain the installed CLI's internal tool calls.
5. Keep `.env`, SQLite, provider master keys and `web-device.json` out of uploaded ZIPs, Cloudflare Pages and GitHub commits.

## Verify locally

```bash
npm test
npm run build
curl -i http://127.0.0.1:8787/api/health
# Verify production HTTP and OAuth separately when credentials/domain are configured.
```

Tests run a **real spawned Node companion** against a simulated WROSECODE binary and assert device isolation, chat output/session persistence, local-approval denial, traversal/symlink protection, and revoke. They do not verify a real Rust CLI, full PTY interaction, live Cloudflare or iPhone access.
