> **New:** [NATIVE_BRIDGE_V2.md](NATIVE_BRIDGE_V2.md) describes the upgraded cross-platform companion, remote tools and the intentionally limited terminal access.

# WROSECODE — Secure Web Console deployment

This ZIP is a **self-hosted Node web console plus a Cloudflare Pages-compatible static frontend**. Cloudflare Pages cannot run `server/server.mjs` or store private login sessions. Production auth, agent jobs and encrypted API provider profiles require a **reachable Node backend**.

## 1. Local setup (Node >= 22.13)

```bash
cd WROSECODE-Web-Console
cp .env.example .env
chmod 600 .env
openssl rand -hex 32           # copy result to PROVIDER_ENCRYPTION_KEY in .env; do not share
# Edit .env: SIGNUP_MODE=open, BRIDGE_MODE=disabled, and your OAuth credentials only after rotation
node --env-file=.env server/server.mjs
```

Open `http://127.0.0.1:8787/login.html`. Register a new account, or create an owner with the existing `scripts/create-admin.mjs` using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. `data/wrosecode-web.sqlite` holds the user/session/agent metadata and **encrypted** provider API keys. Back up the DB and encryption key securely; loss of the key makes stored API keys unrecoverable.

By default, unapproved members can pair **their own CLI companion** and use their own AI API profiles. `ALLOW_MEMBER_JOBS=0` and `I_ACCEPT_SHARED_CLI_RISK=no` prevent members from running the **server owner's shared local CLI**. Do NOT set these to unsafe values to work around pairing errors.

## 2. Production HTTPS + iPhone access

Recommended for Safari and maximum cookie reliability:

1. Configure a stable **custom domain** in Cloudflare (example `console.example.com`), with Cloudflare Tunnel forwarding HTTPS to Node `127.0.0.1:8787`. The tunnel connector runs on the Node host. Keep Node bound to loopback and firewall it. The website files are also served by the Node backend on that hostname, so authentication is **same-origin**.
2. In `.env`, set `PUBLIC_BASE_URL=https://console.example.com`, `FRONTEND_URL=https://console.example.com`.
3. Restart the Node service. Visit `https://console.example.com/login.html` in Safari; test real login/logout.
4. Keep `https://wrosecode-web.pages.dev` as the marketing/public static frontend. To make its navigation open the live secure console, insert `window.WROSECODE_BACKEND = 'https://console.example.com';` at the TOP of `backend.js`, then rebuild and redeploy. **Never put tokens, client secrets or API keys in `backend.js`.**

Avoid cross-site cookies for production iPhone login: browsers including Safari block third-party cookies even when SameSite=None. For this reason, prefer the full Node-served console on the backend hostname over cross-origin `/api` from `pages.dev`.

Private access alternative: Tailscale Serve over an authenticated tailnet with HTTPS, if only your own devices need access. Public service for many unrelated users needs HTTPS, abuse protection, backups, audit logging, resource quotas, and independent penetration testing before launch.

**Do not expose port 4076 or a generic SSH/raw-shell proxy.** The private companion uses outbound HTTPS and a narrowly scoped device token. Root execution is strongly discouraged.

## 3. Pages frontend build

```bash
npm run build
npm test
```

Cloudflare Pages settings: Git repository root `WROSECODE-Web-Console/` if nested in a larger repo, otherwise `/`; framework `None`; build command `npm run build`; output directory `dist`. Deployment is not proven until Cloudflare reports success, and its domain remains frontend-only. The ZIP includes a prebuilt `dist` that contains only public allowlisted assets.

## 4. OAuth

See `OAUTH_SETUP.md`. Redirect URIs must point to `PUBLIC_BASE_URL` (the Node hostname), not Pages. Google/GitHub credentials supplied in a chat or accidentally published must be revoked and regenerated **before** use. Do not upload `.env` to GitHub or into this ZIP.

## 5. Per-user CLI pairing

See `CLI_PAIRING.md`. Users register, open `Connect CLI`, generate a one-time 10-minute code, and run `scripts/device-agent.mjs` on their own CLI machine with HTTPS backend and code. The companion authenticates via a revocable device token and runs the *installed* `wrosecode` binary in a per-job workspace. No `wrosecode server --hostname` subcommand is required for this mode. Verify the installed binary actually supports the required agent workflow before promising tool execution.

## 6. BYOK providers

Set `PROVIDER_ENCRYPTION_KEY` to a stable random 32-byte hex key. In AI Providers, each user can save an encrypted API key for OpenAI API, DeepSeek API, OpenRouter, Groq or, if the owner explicitly sets `ALLOW_CUSTOM_PROVIDERS=1`, custom public HTTPS OpenAI-compatible endpoints. Models are discovered via the provider's `/models` endpoint; set a model ID before sending a direct-API chat message. API providers cost money under the user's own provider terms.

**ChatGPT website subscriptions and ChatGPT OAuth are not interchangeable with OpenAI API credentials.** Do not solicit browser session tokens or cookie exports. Official user-delegated ChatGPT sign-in to arbitrary apps is not implemented here.

## 7. Operational checks

```bash
node --version
npm test
npm run build
curl -i http://127.0.0.1:8787/api/health
curl -i http://127.0.0.1:8787/api/config
# From iPhone network, verify PUBLIC_BASE_URL and log in over HTTPS
```

A working **pairing protocol** was exercised with simulated device HTTP requests in tests. Real OAuth, actual provider completions, deployment, and a real WROSECODE binary on your Kali machine were **not** available in the packaging environment and MUST be tested after installing your own credentials and CLI.
