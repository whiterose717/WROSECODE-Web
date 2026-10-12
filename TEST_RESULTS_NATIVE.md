# Native bridge v2 — verification report

## Automated tests (Node.js 22.16 in packaging runtime)

- **PASS** `npm run check` — syntax checks of all modified backend, device agent and browser JS.
- **PASS** `npm test` — 5/5 subtests. Covers original admin/API auth, fake-cli jobs/CTF candidate classification, signup and scoped pairing, encrypted provider errors, private path/symlink defense, remote device status, real spawned Node companion loopback chat output, bounded device conversations, account isolation, revocation, and sensitive terminal denial when no local interactive approval.
- **PASS** `npm run build` — `dist/` includes only allowlisted website public files (CSS/JS/images), no `.env`, database, Node server or device credential.
- **PASS** Playwright mock-backed static UI test at 1300px desktop and 390px mobile — newly added remote-tools panel visible and interactive, provider controls present, no page JS errors or viewport horizontal overflow.
- **BLOCKED** Live browser HTTP navigation: the testing environment policy blocked Chromium loopback requests (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Production network/browser tests remain required.
- **NOT VERIFIED** End-to-end OAuth logins (real Google/GitHub application secrets unavailable), real user's installed Rust WROSECODE CLI (not in ZIP), CLI-native PTY/TUI mirroring, production Cloudflare/Tailscale HTTPS endpoint, cross-network iPhone Safari, real AI provider requests.

## Important functional boundaries

- This ZIP delivers a **Node companion bridge**, not integrated Rust code. No full interactive Ratatui/TUI mirroring is claimed; native Rust CLI adapter, PTY-aware streaming and internal tool approvals require Rust repository integration.
- The test fixture is a simulated WROSECODE binary; a **real companion** running as a Node subprocess was exercised against it. Real providers/CLI workflows must be tested on Windows, Linux and macOS separately.
- Every browser-issued terminal/file request requires **on-device** confirmation. Test verifies noninteractive denial. An approved terminal command is run without a shell, but is not sandboxed from its OS user's full privileges; run the companion as an unprivileged user or sandboxed VM.
- The CLI's own agent may have additional permissions not controlled by the browser remote-tools approval flow.
- HTTPS backend remains a separate always-running Node service. Cloudflare Pages only hosts the static `dist/`.
- No GitHub push or Cloudflare deployment was executed in this packaging environment. This is a download-ready source ZIP.
