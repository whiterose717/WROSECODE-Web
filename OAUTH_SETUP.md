# Google and GitHub OAuth setup

**Security first:** OAuth client secrets previously posted in chat should be treated as exposed. Revoke/rotate both secrets in Google Cloud Console and GitHub Developer Settings, then set the new values in the LOCAL `.env` only. Do not reuse posted secrets.

Use a stable Node HTTPS hostname such as `https://console.example.com`, not `wrosecode-web.pages.dev`, for both OAuth callbacks. Set `PUBLIC_BASE_URL=https://console.example.com` and `FRONTEND_URL=https://console.example.com` before registering URLs.

## Google

Open <https://console.cloud.google.com/auth/overview>, create/select a project, configure the Google Auth Platform consent screen, set audience `External` and the necessary test users in testing mode. Create an OAuth client of type **Web application**. Add the backend origin `https://console.example.com` as appropriate, and the exact redirect URI:

`https://console.example.com/api/oauth/google/callback`

Save the resulting `GOOGLE_CLIENT_ID` and regenerated `GOOGLE_CLIENT_SECRET` to `.env`. Request only `openid email profile`. OAuth callback identity comes from Google's userinfo endpoint; a verified email is required. Signups are allowed when `SIGNUP_MODE=open`. Existing password users aren't silently merged by email; link from an already authenticated session.

## GitHub

Open <https://github.com/settings/developers> → OAuth Apps → New OAuth App. Set homepage to your WROSECODE website, callback to:

`https://console.example.com/api/oauth/github/callback`

Create the app, copy `GITHUB_CLIENT_ID`, generate a NEW client secret and store the new `GITHUB_CLIENT_SECRET` in `.env`. Scopes: `read:user user:email`. The backend requires a verified primary GitHub email. Email missing or unverified will block login until resolved in GitHub settings.

## Verify

Restart Node. `GET /api/config` will show `google:true` / `github:true` only when both ID and secret are configured. Test consent, callback, session, and logout in a real browser on the backend hostname. OAuth cannot be fully tested without valid owned applications and user consent.

**Do not use** `http://127.0.0.1` as a production callback hostname. Local dev callback URIs (if separately registered) are:

- `http://127.0.0.1:8787/api/oauth/google/callback`
- `http://127.0.0.1:8787/api/oauth/github/callback`
