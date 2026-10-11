# OAuth setup — Google + GitHub (production)

Secrets stay in the Node backend `.env` only. Never put them in Pages,
`backend.js`, HTML, or git.

## Redirect URIs (exact)

The backend builds callbacks as:

```
{ PUBLIC_BASE_URL }/api/oauth/{google,github}/callback
```

Register **exactly** these two URIs (replace the host with your backend origin):

Local dev:

```
http://127.0.0.1:8787/api/oauth/google/callback
http://127.0.0.1:8787/api/oauth/github/callback
```

Production (Tunnel example):

```
https://wrose-bridge.example.com/api/oauth/google/callback
https://wrose-bridge.example.com/api/oauth/github/callback
```

Production (Tailscale example):

```
https://your-kali.your-tailnet.ts.net/api/oauth/google/callback
https://your-kali.your-tailnet.ts.net/api/oauth/github/callback
```

Do **not** register the Pages origin (`wrosecode-web.pages.dev/...`) — Pages
cannot complete OAuth. Start login at the backend origin
(`{backend}/api/oauth/google`) or let the Pages frontend redirect there via
`WROSECODE_API()`.

## Google Cloud Console

1. https://console.cloud.google.com → APIs & Services → Credentials.
2. Create OAuth client ID → Web application.
3. Authorized JavaScript origins: your backend origin
   (e.g. `https://wrose-bridge.example.com`).
4. Authorized redirect URIs: the two Google URIs above.
5. Copy Client ID + Client Secret into Kali `.env`:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

6. Configure OAuth consent screen (external). Google may require domain
   verification and rejects some `*.ts.net` redirects — a domain you control
   with HTTPS may be necessary.
7. Flow used: authorization-code + PKCE S256, `state` validated with
   timing-safe compare, `email_verified=true` required, identity from
   `https://openidconnect.googleapis.com/v1/userinfo`.
8. Account linking: if the Google email already exists as a local account,
   login redirects to `login.html?error=link_required`. Sign in with
   password first, then use **Link Google login** in the console.

## GitHub (Settings → Developer settings → OAuth Apps)

1. New OAuth App → Homepage URL: your backend origin.
2. Authorization callback URL: the GitHub URI above (exact).
3. Copy Client ID + Client Secret into `.env`:

```dotenv
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

4. Flow: authorization-code, `state` validated, primary **verified** email
   required via `/user/emails`. Private emails without a verified primary
   are rejected.
5. Same `link_required` / `signup_closed` rules as Google.

## Verify without secrets

```bash
curl -s http://127.0.0.1:8787/api/config
# {"google":false,"github":false,...} → buttons disabled with tooltip

curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  http://127.0.0.1:8787/api/oauth/google
# 503 OAuth provider not configured (expected without secrets)

curl -s http://127.0.0.1:8787/api/oauth/nope
# 404 Unknown provider
```

With secrets configured, `/api/oauth/google` returns `302` to
`accounts.google.com/o/oauth2/v2/auth?...`.
