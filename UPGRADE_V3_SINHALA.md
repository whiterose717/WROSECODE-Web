# WROSECODE Web Console — V3 upgrade (Sinhala + English)

## Changes
- **Email/password only UI**: Sign in / Sign up toggle, confirm password for sign-up. Google and GitHub sign-in buttons and account-link buttons removed. Google and GitHub OAuth API routes are **disabled by default** (`ENABLE_SOCIAL_LOGIN=0`) and can be explicitly re-enabled only for legacy compatibility. Set `SIGNUP_MODE=open` to allow registrations. New accounts can use **their own paired CLI**; shared-host execution stays disabled by default.
- **Full-viewport Agent Chat**: 100dvh, collapsible advanced selectors and optional stdin, scrollable transcript, responsive mobile composer, batched rendering of streamed logs. Same WROSECODE theme with DeepSeek-like proportions; not a DeepSeek dependency or exact clone.
- **CTF**: realtime flagged candidate cards, de-duplication, copy, candidate summary; flag patterns are **unverified until your challenge provider accepts the submission**. Upload limit stays 16 MiB.
- **Security**: Device pairing remains per-user and outbound-only; the local operator must approve remote terminal/file operations. No anonymous shared-host root access.
- **Routes**: /login, /console on local Node server and Cloudflare Pages `_redirects`.

## Installation on Kali (preserve existing users and secrets)
**Back up** your current folder's `.env` and `data/` database securely before any deployment. The downloaded ZIP purposely has NO `.env`, NO `data`, and NO `.git` to avoid distributing account databases, tokens, secrets, or VCS history. Do **not** replace your live database. Extract the ZIP to a NEW folder; review changes and merge code files into your existing repository (e.g., using `diff -ru` or `rsync --dry-run`). Keep your current `.env` and `data/` unchanged.

```bash
cd /home/kali/Desktop/myweb/WROSECODE-Web-Console
npm run check
npm test
npm run build
sudo systemctl restart wrosecode-web
curl -sS http://127.0.0.1:8787/api/health
```

Restart requires your existing service setup. Do not run a second server on port 8787. Login URLs: `http://127.0.0.1:8787/login` and for private Tailscale users, `https://kali.tailb1f78d.ts.net/login` (only when Serve and Tailscale are active).

## Access from any device
1. **Same Wi-Fi**: best to use Tailscale on every device and private HTTPS Serve; exposing port 8787 directly on the LAN is not necessary. The Node server can remain `HOST=127.0.0.1`.
2. **Different Wi-Fi / mobile data**: connect both devices to your private Tailscale tailnet; use its `https://<hostname>.<tailnet>.ts.net` Serve URL. Only devices authorized into the same tailnet can access. Tailscale is not a public multi-tenant login solution.
3. **Any internet user without Tailscale**: deploy a stable PUBLIC HTTPS Node backend with safe auth, abuse controls and a scoped CLI relay, then configure Cloudflare Pages build `WROSECODE_BACKEND_URL=https://your-real-public-backend`. This ZIP does not automatically deploy that infrastructure; Cloudflare Pages static hosting alone cannot serve the Node+SQLite backend.
4. **CLI pairing**: Console → Connect CLI → generate single-use code → on your OWN Kali/Windows/macOS machine, install WROSECODE CLI and Node.js >=22.13 then run:

```bash
node scripts/device-agent.mjs --backend https://YOUR-BACKEND --code YOUR-PAIR-CODE
```

Run companion as a normal user; keep it running, and keep your CLI host awake. This provides authenticated chat/CTF and locally approved workspace tools, **not** a full interactive desktop/PT​Y or automatic control of an unpaired CLI. Do not run a root-owned CLI server on a public interface; keep `BRIDGE_MODE=disabled`, `ALLOW_MEMBER_JOBS=0`, `I_ACCEPT_SHARED_CLI_RISK=no` unless a separately security-reviewed sandbox exists.

## Important
- Existing OAuth secrets exposed in chat should be rotated. Do not share `.env`, CLI tokens, or `data/` as ZIP files.
- Google/GitHub OAuth backend routes are disabled unless `ENABLE_SOCIAL_LOGIN=1`; keep it `0`, and rotate/unset any exposed OAuth credentials. Do not commit your secrets.
- Automated tests use local/mocked flows; they do not verify actual public-domain login, devices, or remote CLI feature parity. Real internet usage must be tested separately.
- If you serve both Pages frontend and a different backend domain, prefer redirecting `login.html` and `console.html` to the backend origin to avoid third-party cookie restrictions (existing `backend.js`).
