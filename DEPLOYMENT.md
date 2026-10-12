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

Open `http://127.0.0.1:8787/login.html`. Initialize the owner before opening registration with `sudo -u kali ./scripts/create-admin.sh`; it prompts for the password without echoing it. `data/wrosecode-web.sqlite` holds the user/session/agent metadata and **encrypted** provider API keys. Back up the DB and encryption key securely; loss of the key makes stored API keys unrecoverable.

## Run as a system service on Kali

`deploy/wrosecode-web.service` runs Node as the unprivileged `kali` account, reads the existing private `.env`, writes only under `data/`, restarts after failures, and shuts down gracefully. Preserve the existing `.env` values; make sure `data/` and `.env` are owned by `kali` with modes `700` and `600` before enabling it:

```bash
sudo chown kali:kali .env
sudo chmod 600 .env
sudo chown -R kali:kali data
sudo chmod 700 data
sudo install -m 644 deploy/wrosecode-web.service /etc/systemd/system/wrosecode-web.service
sudo install -D -m 644 deploy/cloudflared-wrosecode.conf /etc/systemd/system/cloudflared.service.d/wrosecode.conf
sudo systemctl daemon-reload
sudo systemctl enable --now wrosecode-web
sudo systemctl status wrosecode-web --no-pager
```

The Cloudflare drop-in orders the connector after Node on boot. Enable Cloudflare only after rotating the exposed token and configuring a real published route. Restarting Node preserves SQLite accounts and sessions. Port 8787 stays bound to loopback; the Rust API stays on 4076 and must not be published.

By default, unapproved members can pair **their own CLI companion** and use their own AI API profiles. `ALLOW_MEMBER_JOBS=0` and `I_ACCEPT_SHARED_CLI_RISK=no` prevent members from running the **server owner's shared local CLI**. Do NOT set these to unsafe values to work around pairing errors.

## 2. Production HTTPS + iPhone access

Recommended for Safari and maximum cookie reliability:

1. A Cloudflare Tunnel public hostname requires a hostname in a DNS zone you control. A Pages `*.pages.dev` name is not a customer DNS zone. The currently installed connector has no ingress rules and returns 503, so it does not publish this backend.
2. The host currently has a Tailscale `*.ts.net` name, but Tailscale is stopped. Funnel can publish a stable HTTPS name after tailnet policy and owner authorization. Funnel is in beta and its docs advise against exposing services that contain sensitive data; this app stores account and provider-key metadata. Treat Funnel as a controlled evaluation path, not the production recommendation for public multi-user access.
3. For a production public service, use an authorized public HTTPS backend hostname (a Cloudflare Tunnel hostname under a domain you control, or a separately hosted backend). In `.env`, set `PUBLIC_BASE_URL=https://ACTUAL_BACKEND_HOST` and `FRONTEND_URL=https://wrosecode-web.pages.dev`. The Node server serves the login and console on the backend host so its session cookie is first-party.
4. Configure Cloudflare Pages build environment variable `WROSECODE_BACKEND_URL=https://ACTUAL_BACKEND_HOST`. `npm run build` embeds this public URL into only `dist/backend.js`; it never embeds secrets. Pages navigation sends login and console pages to the backend hostname. Login on the backend hostname directly for Safari and verify real login/logout.

Avoid cross-site cookies for production iPhone login: browsers including Safari block third-party cookies even when SameSite=None. For this reason, prefer the full Node-served console on the backend hostname over cross-origin `/api` from `pages.dev`.

Private access alternative: Tailscale Serve over an authenticated tailnet with HTTPS, if only your own devices need access. Public service for many unrelated users needs HTTPS, abuse protection, backups, audit logging, resource quotas, and independent penetration testing before launch.

**Do not expose port 4076 or a generic SSH/raw-shell proxy.** The private companion uses outbound HTTPS and a narrowly scoped device token. Root execution is strongly discouraged.

## 3. Pages frontend build

```bash
npm run build
npm test
```

Cloudflare Pages settings: Git repository root `WROSECODE-Web-Console/` if nested in a larger repo, otherwise `/`; framework `None`; build command `npm run build`; output directory `dist`; set the non-secret build variable `WROSECODE_BACKEND_URL` to the actual HTTPS backend origin. Deployment is not proven until Cloudflare reports success. The build output contains only public allowlisted assets.

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
