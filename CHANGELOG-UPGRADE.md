# Upgrade notes — uploaded ZIP enhancement

The uploaded source archive was an **older standalone WROSECODE Web Console** snapshot, not the later GitHub commit claimed in previous reports. This package is built from the uploaded files, not from live GitHub or a live Kali installation.

## Changes

- Removed `#capabilities` and `#workflow` homepage sections and their navigation links; preserved original colors, logo, layout, and CSS styling, with small additions for new controls.
- Added public signup mode and retained existing Google/GitHub OAuth authorization-code routes. OAuth still requires **new, private** credentials, stable HTTPS, and an owned backend hostname.
- Added per-user device pairing and revocation, outbound-only companion, job polling, stream logs, account-bound artifacts and job isolation. Shared server CLI remains disabled to protect multi-tenancy.
- Added Live Lab button for authorized artifact upload to the paired CLI, with truthful connectivity and flag verification labels.
- Added account-specific AI API provider profiles, AES-256-GCM encryption at rest, models discovery, direct OpenAI-compatible chat streaming, and conversation history. This is **not** a complete DeepSeek autonomous tool-use harness. The personal CLI remains the tool-execution engine.
- Added safe static build allowlist and Cloudflare Pages `_headers` configuration; backend/data/auth secrets are not copied into `dist/`.
- Added deployment, OAuth and per-user CLI setup guides plus local integration regression tests.

## Important non-claims

- Does **not** reuse ChatGPT web account authentication as an API credential. Only valid OpenAI API keys or user-owned CLI-supported authentication are applicable.
- Does **not** give public visitors direct raw shell/SSH access to any device.
- Actual Rust server endpoints, live Google/GitHub OAuth, actual provider responses and internet/iPhone deployment cannot be tested in this isolated file environment.
- Security features in a prototype are not a replacement for external security review, deployment WAF/abuse protection, rate limits, and reliable service monitoring.
- New user self-signup currently verifies passwords but **does not send a confirmation email**; configure an email verification service before declaring broad public production readiness.
