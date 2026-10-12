# Google and GitHub OAuth setup

**Security first:** OAuth client secrets previously posted in chat should be treated as exposed. Revoke/rotate both secrets in Google Cloud Console and GitHub Developer Settings, then set the new values in the LOCAL `.env` only. Do not reuse posted secrets.

Use the actual stable Node HTTPS hostname, not `wrosecode-web.pages.dev`, for OAuth callbacks. The Pages hostname is only the static frontend. Set `PUBLIC_BASE_URL=https://ACTUAL_BACKEND_HOST` and `FRONTEND_URL=https://wrosecode-web.pages.dev`; the login flow then opens on the backend origin so Safari keeps its session cookie first-party.

## Google

Open <https://console.cloud.google.com/auth/overview>, create/select a project, configure the Google Auth Platform consent screen, set audience `External` and add the testing account as a test user if the app is in Testing mode. Create an OAuth client of type **Web application**. Add the backend origin as an authorized JavaScript origin if requested, and the exact redirect URI:

`https://ACTUAL_BACKEND_HOST/api/oauth/google/callback`

Save the resulting `GOOGLE_CLIENT_ID` and regenerated `GOOGLE_CLIENT_SECRET` to the private `.env`. The backend uses authorization code + PKCE, state and OIDC nonce checks, and verifies Google's signed ID token, issuer, audience, expiry, and verified email. Signups are allowed when `SIGNUP_MODE=open`. Existing password users aren't silently merged by email; sign in first and link while authenticated.

## GitHub

Open <https://github.com/settings/developers> → OAuth Apps → New OAuth App. Set homepage to your WROSECODE website, callback to:

`https://ACTUAL_BACKEND_HOST/api/oauth/github/callback`

Create the app, copy `GITHUB_CLIENT_ID`, generate a NEW client secret and store the new `GITHUB_CLIENT_SECRET` in the private `.env`. Scopes: `read:user user:email`. The backend uses state + PKCE, a verified GitHub account ID and verified primary email. It will not merge a password account by matching email; link only from that signed-in account.

## Verify

Restart Node. `GET /api/config` will show `google:true` / `github:true` only when both ID and secret are configured. Test consent, callback, session, and logout in a real browser on the backend hostname. OAuth cannot be fully tested without valid owned applications and user consent.

**Do not use** `http://127.0.0.1` as a production callback hostname. Local dev callback URIs (if separately registered) are:

- `http://127.0.0.1:8787/api/oauth/google/callback`
- `http://127.0.0.1:8787/api/oauth/github/callback`
