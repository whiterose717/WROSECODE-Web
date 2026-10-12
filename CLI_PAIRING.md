> **Updated:** Read [NATIVE_BRIDGE_V2.md](NATIVE_BRIDGE_V2.md) for remote tools, local approvals, cross-platform usage, conversation history and important limitations.

# Private WROSECODE CLI pairing

Every signed-in account pairs **its own machine**. No website user receives arbitrary shell access to the Node host or another user's Kali device.

1. Deploy/start the Node service and serve the console from its secure HTTPS origin.
2. Register or sign in with your own account.
3. Open Console → `Connect CLI` → `GENERATE ONE-TIME PAIRING CODE`.
4. Install WROSECODE CLI on **your own machine**, along with Node.js 22.13+ and this repository/ZIP's `scripts/device-agent.mjs`.
5. From the ZIP's project folder, in a non-root terminal:

```bash
command -v wrosecode
wrosecode --help
node scripts/device-agent.mjs --backend https://console.example.com --code YOUR-12-CHAR-CODE
```

The companion securely stores `~/.wrosecode/web-device.json` with mode 0600; never publish or copy this file. Each agent makes outbound HTTPS requests, polls only its assigned jobs, and invokes the local `wrosecode` program using argument arrays, not a remote arbitrary-shell endpoint. It writes artifacts into its local per-job workspace. The system does not require `wrosecode server --hostname` (some installed WROSECODE launchers treat `server` as a prompt).

6. Console → Connect CLI → Refresh should show ONLINE when the companion polls. In Chat, choose `Local paired CLI`, select optional CLI provider/model, then submit. In CTF, confirm your authorization, upload a challenge file (16 MiB max), and start the live investigation. The agent output is streamed back. Regex-like flags are **candidates, not verified solves**.
7. Use `REVOKE` from Connect CLI to disable a lost device. Press Ctrl+C to stop the local companion. A stopped agent goes OFFLINE after about 90 seconds. Keep the CLI host online for live execution.

If an installed `wrosecode` binary does not support server/bridge subcommands, this companion intentionally uses its existing CLI invocation interface. CLI features depend on the installed binary; no universal command compatibility or flag-solvability guarantee is possible without testing it.

Use `BRIDGE_MODE=disabled`, `ALLOW_MEMBER_JOBS=0`, `I_ACCEPT_SHARED_CLI_RISK=no` as the default secure setup. This does **not** disable personally paired devices. A member need not be approved to use their **own** authenticated device or personal AI API profile, but cannot execute the server owner's shared CLI.

## Troubleshooting

- `BACKEND OFFLINE`: Node isn't reachable at the hostname. Cloudflare Pages hosts only static files. Open the full console at the Node HTTPS hostname, or configure `backend.js` navigation there.
- `CLI OFFLINE`: Start the companion, check outbound HTTPS, then refresh Devices.
- `WROSECODE CLI not found`: set `WROSECODE_BIN` to the installed executable path in the companion's environment.
- `401 device token`: revoked/invalid credential; generate a fresh pairing code.
- `No model`: enter a valid model ID for direct API profiles or configure the device's own CLI provider.
- OAuth 503: provider ID/secret not configured or rotated.
