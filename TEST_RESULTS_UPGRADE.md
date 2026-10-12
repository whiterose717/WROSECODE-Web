# Upgrade validation — local only

- PASS: `npm test` — original fake-CLI tests and added multi-tenant bridge/authorization/SSRF guard tests.
- PASS: `npm run build` — public allowlist produces `dist/` without `server`, `data`, `.env` or credentials.
- PASS: `node --check` for modified JS server/frontend/agent modules.
- PASS: static DOM checks — homepage `#capabilities` and `#workflow` removed, new device/provider/live-lab controls present, original logo/assets remain.
- BLOCKED: graphical Chromium browser automation (sandbox navigation was blocked by environment administrator). Re-run Playwright on your Kali machine.
- NOT TESTED: real Google/GitHub OAuth redirect and login (owned live credentials unavailable).
- NOT TESTED: real external OpenAI/DeepSeek/OpenRouter/Groq completions or ChatGPT OAuth (no outbound network/credentials).
- NOT TESTED: user's physical WROSECODE CLI and Rust server compatibility, remote agent streaming over a real internet tunnel or iPhone Safari.
- NOT DEPLOYED: user's Cloudflare account / GitHub repo. ZIP is a local deliverable, not an update pushed to GitHub.

`npm test` exercises simulated remote device protocol and existing fake CLI fixture, not an actual CTF solve. No flag is marked verified by a regex match.
