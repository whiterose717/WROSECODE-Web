# WROSECODE Web Console — validation report

Tested in the artifact-building environment on 2026-10-11 (runtime: Node.js 22.16.0, Python/Playwright with Chromium).

## Passed

- `npm test`: **1 integration suite / 1 passed** (mock CLI executable, real local Node HTTP API). Coverage includes owner bootstrap and login, incorrect password rejection, unauthorized API rejection, privileged execution gating, path traversal rejection, artifact byte cap path, successful binary artifact upload, CLI subprocess startup, live event replay, provider output masking, task history, CTF pattern as **UNVERIFIED**, backend completion (not flag verification), queued-job cancellation and cross-origin POST rejection.
- `python tests/browser_static.py`: **2 viewports passed** (1440x900 desktop / 390x844 mobile), no uncaught JS errors, no horizontal overflow. Login/Chat/CTF/Providers navigation exercised with fake browser API data, original local CTF lab inspected a synthetic fixture, original docs and web deployment docs rendered.
- `node --check` on all main backend/client JavaScript files: passed.
- Static unauthorized file paths under `/server`, `/data`, and hidden `.env` blocked by the HTTP server.
- Logo converted from user-provided image to transparent PNG (850x850, 73.8 KB).

## Not validated; cannot be claimed as fully tested

- Actual native WROSECODE Rust binary execution and original repository internals: no access to user's Kali host or CLI repository in this environment.
- End-to-end live Chromium navigation to the local HTTP API: browser administrator policy blocked requests to `127.0.0.1`, even though direct Node HTTP integration passed. Optional `tests/browser_live_unverified.py` is provided for Kali/local validation.
- Google and GitHub OAuth with real app credentials, live OAuth callbacks, Google verification/domain approval and production email delivery.
- Tailscale Serve availability across two actual devices/networks, firewall setup, real HTTPS certificate provisioning.
- Safe arbitrary-task execution for untrusted web users: **not supported without per-user OS/container/VM isolation**.
- Public cloud deployment, third-party penetration testing, production traffic and CTF solve-rate benchmarks.
- Independently verified flags. This bridge reports patterns as **UNVERIFIED**, not solved.

## Known limitations

- The bridge invokes documented headless native CLI commands, not a full persistent terminal TUI session. CLI arguments should be checked on Kali with `wrosecode --help` and `wrosecode ctf --help`.
- Owners have CLI execution access; members require explicit unsafe override and should not use it without isolation.
- OAuth client IDs/secrets must be provided by the owner. Password registration is not email verified; disable public sign-up unless an owner is reviewing it or an email verification system is added.
- SQLite records job history/events and marks in-progress tasks interrupted after restart; automatic restart/resume of native processes is not implemented.
- Browser display and job streaming are suitable for a private trusted-host installation, not a formally audited public multi-tenant SaaS.

## Recommended acceptance tests on Kali

1. `wrosecode --help` and `wrosecode ctf --help` to verify flag syntax.
2. Run `npm test` and `python tests/browser_live_unverified.py` (on a host with Playwright and Chromium).
3. Configure `BRIDGE_MODE=cli`, create owner account, start a simple read-only chat job, and check recorded events.
4. Upload a harmless local CTF fixture; ensure output is unverified until challenge-authority confirmation.
5. Exercise two real LAN devices over TLS or two authorized Tailscale tailnet devices, then test cancellation and OAuth configuration.
6. Audit shell permissions, secrets, container boundaries and rate limits before accepting any untrusted users.
