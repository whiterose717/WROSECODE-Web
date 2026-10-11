# WROSECODE Web Console — Deployment

## Architecture (production)

```
iPhone / Desktop browser (HTTPS)
  → https://wrosecode-web.pages.dev  (Cloudflare Pages, static only)
  → https://<your-backend>           (Node server/server.mjs, authenticated API)
  → http://127.0.0.1:4076            (Rust WROSECODE server, loopback only)
```

- Cloudflare Pages serves `dist/` built by `npm run build`. It does **not** run Node.
- The Node backend serves the same frontend **and** `/api/*` when run on Kali.
  From Pages, the frontend calls the backend origin configured in `backend.js`
  (`window.WROSECODE_BACKEND` or `localStorage.wrose_backend`) with
  `credentials: include` (CORS + `SameSite=None; Secure` cookies).
- The Rust server is **loopback-only**. Never expose port 4076 publicly.
  Remote access is via Cloudflare Tunnel or Tailscale Serve in front of the
  Node backend (port 8787), not the Rust port.

## Kali startup (exact)

```bash
cd /home/kali/Desktop/myweb/WROSECODE-Web-Console
node --version            # >=22.13
wrosecode --version
wrosecode providers list
cp .env.example .env      # edit .env (see below)

# Rust agent API (terminal 1)
wrosecode server --hostname 127.0.0.1 --port 4076

# Node backend (terminal 2)
node --env-file=.env server/server.mjs
# → http://127.0.0.1:8787/login.html
```

Minimal `.env` for local use:

```dotenv
HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=http://127.0.0.1:8787
BRIDGE_MODE=cli
WROSE_URL=http://127.0.0.1:4076
SIGNUP_MODE=closed
```

## Remote access — option A: Tailscale Serve (private, recommended)

```bash
sudo tailscale up
# .env:
HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=https://your-kali.your-tailnet.ts.net
FRONTEND_URL=https://wrosecode-web.pages.dev
BRIDGE_MODE=cli
node --env-file=.env server/server.mjs
# second terminal:
tailscale serve --bg 8787
tailscale serve status
```

Copy the exact HTTPS hostname into `PUBLIC_BASE_URL` and restart Node.
Do **not** use `tailscale funnel` (public) for the execution bridge.

## Remote access — option B: Cloudflare Tunnel (public HTTPS backend)

```bash
cloudflared tunnel login
cloudflared tunnel create wrose-bridge
# route wrose-bridge.example.com → http://127.0.0.1:8787 in Cloudflare dashboard
cloudflared tunnel run wrose-bridge
```

`.env`:

```dotenv
HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=https://wrose-bridge.example.com
FRONTEND_URL=https://wrosecode-web.pages.dev
BRIDGE_MODE=cli
```

`PUBLIC_BASE_URL` must be `https://` so cookies are `Secure` and OAuth
redirects match the registered URIs.

## Cloudflare Pages settings

- Project: `wrosecode-web` → `https://wrosecode-web.pages.dev`
- Root: `WROSECODE-Web-Console/` (the plain-HTML console, not the Astro site)
- Build command: `npm run build`
- Output directory: `dist`
- No environment secrets in Pages. OAuth secrets stay in Node `.env` only.
- `dist/` is gitignored; Pages builds from source on every push to `main`.

To point Pages at the backend, edit `backend.js` before pushing:

```js
window.WROSECODE_BACKEND = "https://wrose-bridge.example.com";
```

or leave same-origin (Kali-served UI) and set a per-browser override in
DevTools: `localStorage.wrose_backend="https://..."`.

## Health checks

```bash
curl -s http://127.0.0.1:8787/api/health | head -c 1000; echo
curl -s http://127.0.0.1:8787/api/config | head -c 1000; echo
curl -s http://127.0.0.1:4076/health; echo
TOKEN=$(cat ~/.wrosecode/server.token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4076/v1/status | head -c 500; echo
```

`wrosecode-web.pages.dev` serves static files only: `/api/*` there is
expected to 404. The frontend must use the backend origin.
