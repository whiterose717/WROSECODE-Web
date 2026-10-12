/* Rust WROSECODE server bridge (local HTTP API at 127.0.0.1:4076).
 * Kept alongside the outbound device companion: this talks to a locally
 * running `wrosecode server` over loopback with the bearer token from
 * ~/.wrosecode/server.token. The token never leaves the Node host.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

function resolveHome() { return process.env.HOME || '/root' }
function tokenPaths() {
  const custom = process.env.WROSE_TOKEN_FILE;
  if (custom) return [custom];
  const h = resolveHome();
  const list = [path.join(h, '.wrosecode', 'server.token')];
  for (const p of ['/root/.wrosecode/server.token', '/home/kali/.wrosecode/server.token']) {
    if (!list.includes(p)) list.push(p);
  }
  return list;
}

export function createRustBridge({ db, send, error, jsonBody, scrub }) {
  try {
    db.exec('CREATE TABLE IF NOT EXISTS cli_pairings(user_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,device_token TEXT NOT NULL,created_at INTEGER NOT NULL)');
  } catch {}
  let cached = '', cachedAt = 0;
  const wroseUrl = () => (process.env.WROSE_URL || 'http://127.0.0.1:4076').replace(/\/$/, '');
  function loadMaster() {
    if (cached && Date.now() - cachedAt < 30000) return cached;
    for (const p of tokenPaths()) {
      try {
        const t = readFileSync(p, 'utf8').trim();
        if (t && t.length >= 10) { cached = t; cachedAt = Date.now(); return t }
      } catch {}
    }
    return '';
  }
  function tokenFor(user) {
    if (!user) return '';
    try {
      const row = db.prepare('SELECT device_token FROM cli_pairings WHERE user_id=?').get(user.id);
      if (row?.device_token) return row.device_token;
    } catch {}
    return loadMaster();
  }
  async function rustFetch(rpath, { method = 'GET', body, token, timeoutMs = 20000 } = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(wroseUrl() + rpath, {
        method, signal: controller.signal,
        headers: { 'content-type': 'application/json', 'user-agent': 'WROSECODE-web-console/1.0', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null } catch { json = { _raw: text.slice(0, 4000) } }
      return { status: r.status, json };
    } catch (e) {
      return { status: 0, json: { error: e.name === 'AbortError' ? 'Rust server timeout' : 'Rust server unreachable' } };
    } finally { clearTimeout(t) }
  }
  const scrubRust = (s) => String(scrub(String(s || ''))).slice(0, 8000);
  function redactProviders(list) {
    return (Array.isArray(list) ? list : []).map((p) => {
      const label = String(p.label || '');
      const looks = /(sk-|ghp_|github_pat_|api[_-]?key|secret|token)/i.test(label) || (label.length > 40 && /^[A-Za-z0-9\-_]{20,}$/.test(label));
      return { id: p.id, kind: p.kind, base_url: p.base_url, model: p.model, status: p.status, label: looks ? p.id : label };
    });
  }
  function redactGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map((g) => {
      const label = String(g.label || '');
      const looks = /(sk-|ghp_|github_pat_|api[_-]?key|secret|token)/i.test(label) || (label.length > 40 && /^[A-Za-z0-9\-_]{20,}$/.test(label));
      return { ...g, label: looks ? String(g.provider || 'provider') : label };
    });
  }
  async function statusFor(user) {
    const pairing = (() => { try { return db.prepare('SELECT device_id FROM cli_pairings WHERE user_id=?').get(user.id) || null } catch { return null } })();
    const tok = tokenFor(user);
    if (!tok) return { reachable: false, authorized: false, paired: !!pairing, device_id: pairing?.device_id || null, error: 'Rust token not configured on server' };
    const h = await rustFetch('/health', { timeoutMs: 4000 });
    if (h.status !== 200) return { reachable: false, authorized: false, paired: !!pairing, device_id: pairing?.device_id || null, error: 'Rust server offline' };
    const s = await rustFetch('/v1/status', { token: tok, timeoutMs: 8000 });
    if (s.status === 401) return { reachable: true, authorized: false, paired: !!pairing, device_id: pairing?.device_id || null, error: 'Unauthorized — re-pair this device' };
    if (s.status === 503) return { reachable: true, authorized: true, busy: true, paired: !!pairing, device_id: pairing?.device_id || null, status: 'busy', error: 'Agent busy; retry shortly' };
    if (s.status !== 200) return { reachable: true, authorized: true, paired: !!pairing, device_id: pairing?.device_id || null, error: String(s.json?.error || 'Rust status failed').slice(0, 200) };
    return {
      reachable: true, authorized: true, busy: false, paired: !!pairing, device_id: pairing?.device_id || null,
      provider: s.json?.provider || s.json?.server?.provider || null,
      model: s.json?.model || s.json?.server?.model || null,
      paired_devices: s.json?.server?.paired_devices ?? null,
      pending_codes: s.json?.server?.pending_codes ?? null,
      cloud_bridge: s.json?.server?.cloud_bridge || null,
    };
  }
  async function handle(req, res, url, user, helpers) {
    const { canRun, rateLimited, CONFIG } = helpers;
    const p = url.pathname, method = req.method;
    if (p === '/api/cli/status' && method === 'GET') return send(res, 200, await statusFor(user));
    if (p === '/api/cli/pair' && method === 'POST') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      if (rateLimited(req, 10)) return error(res, 429, 'Too many pairing attempts');
      const b = await jsonBody(req);
      const code = String(b.code || '').trim();
      if (!/^\d{3}-\d{3}$/.test(code)) return error(res, 400, 'Enter the 6-digit code as 123-456');
      const master = loadMaster();
      if (!master) return error(res, 503, 'Rust token not configured on server');
      const r = await rustFetch('/v1/pair/confirm', { method: 'POST', token: master, body: { code, account_id: user.email, device_name: String(b.device_name || 'Browser device').slice(0, 80) }, timeoutMs: 10000 });
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, String(r.json?.error || 'Pairing failed').slice(0, 200));
      try {
        db.prepare('INSERT INTO cli_pairings(user_id,device_id,device_token,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET device_id=excluded.device_id,device_token=excluded.device_token,created_at=excluded.created_at')
          .run(user.id, String(r.json.device_id), String(r.json.device_token), Date.now());
      } catch { return error(res, 500, 'Could not store pairing') }
      return send(res, 200, { ok: true, device_id: String(r.json.device_id) });
    }
    if (p === '/api/cli/revoke' && method === 'POST') {
      let pairing = null;
      try { pairing = db.prepare('SELECT device_id FROM cli_pairings WHERE user_id=?').get(user.id) } catch {}
      if (!pairing) return error(res, 404, 'No paired device');
      const master = loadMaster();
      if (master) await rustFetch('/v1/devices/revoke', { method: 'POST', token: master, body: { device_id: pairing.device_id }, timeoutMs: 8000 });
      try { db.prepare('DELETE FROM cli_pairings WHERE user_id=?').run(user.id) } catch {}
      return send(res, 200, { ok: true });
    }
    if (p === '/api/cli/providers' && method === 'GET') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      const r = await rustFetch('/v1/providers', { token: tokenFor(user), timeoutMs: 10000 });
      if (r.status === 401) return error(res, 401, 'Unauthorized — re-pair this device');
      if (r.status === 503) return error(res, 503, 'Agent busy; retry shortly');
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, String(r.json?.error || 'Provider lookup failed').slice(0, 200));
      return send(res, 200, { providers: redactProviders(r.json?.providers) });
    }
    if (p === '/api/cli/models' && method === 'GET') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      const provider = String(url.searchParams.get('provider') || '').slice(0, 80);
      const r = await rustFetch('/v1/models' + (provider ? `?provider=${encodeURIComponent(provider)}&limit=100` : ''), { token: tokenFor(user), timeoutMs: 15000 });
      if (r.status === 401) return error(res, 401, 'Unauthorized — re-pair this device');
      if (r.status === 503) return error(res, 503, 'Agent busy; retry shortly');
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, String(r.json?.error || 'Model lookup failed').slice(0, 200));
      return send(res, 200, { groups: redactGroups(r.json?.groups), models: r.json?.models || [] });
    }
    if (p === '/api/cli/chat' && method === 'POST') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      if (rateLimited(req, 20)) return error(res, 429, 'Too many chat requests');
      const b = await jsonBody(req);
      if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 32000) return error(res, 400, 'Prompt must be 1–32000 characters');
      const ident = /^[\w.\/:@\-]{1,100}$/;
      if (b.provider && !ident.test(b.provider)) return error(res, 400, 'Invalid provider');
      if (b.model && !ident.test(b.model)) return error(res, 400, 'Invalid model');
      const r = await rustFetch('/v1/chat', {
        method: 'POST', token: tokenFor(user),
        body: { prompt: b.prompt.trim(), provider: b.provider || undefined, model: b.model || undefined, session_id: b.session_id || undefined, mode: b.mode || undefined },
        timeoutMs: Math.min(CONFIG.maxSeconds, 300) * 1000,
      });
      if (r.status === 401) return error(res, 401, 'Unauthorized — re-pair this device');
      if (r.status === 503) return error(res, 503, 'Agent busy; retry shortly');
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, scrubRust(r.json?.error || 'Chat failed'));
      return send(res, 200, { answer: scrubRust(r.json?.answer || ''), session_id: String(r.json?.session_id || ''), metrics: r.json?.metrics || null });
    }
    if (p === '/api/cli/chat/stream' && method === 'POST') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      const b = await jsonBody(req);
      if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 32000) return error(res, 400, 'Prompt must be 1–32000 characters');
      const tok = tokenFor(user);
      const controller = new AbortController();
      const killer = setTimeout(() => controller.abort(), Math.min(CONFIG.maxSeconds, 300) * 1000);
      let upstream;
      try {
        upstream = await fetch(wroseUrl() + '/v1/chat/stream', {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
          body: JSON.stringify({ prompt: b.prompt.trim(), provider: b.provider || undefined, model: b.model || undefined, session_id: b.session_id || undefined, mode: b.mode || undefined }),
        });
      } catch { clearTimeout(killer); return error(res, 502, 'Rust server unreachable') }
      clearTimeout(killer);
      if (upstream.status === 401) return error(res, 401, 'Unauthorized — re-pair this device');
      if (upstream.status === 503) return error(res, 503, 'Agent busy; retry shortly');
      if (!upstream.ok || !upstream.body) return error(res, 502, 'Chat stream failed');
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': connected\n\n');
      try { for await (const chunk of upstream.body) res.write(scrubRust(Buffer.from(chunk).toString('utf8'))) } catch {}
      try { res.end() } catch {}
      return;
    }
    if (p === '/api/cli/sessions' && method === 'GET') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      const r = await rustFetch('/v1/sessions', { token: tokenFor(user), timeoutMs: 10000 });
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, String(r.json?.error || 'Session lookup failed').slice(0, 200));
      return send(res, 200, { sessions: (r.json?.sessions || []).filter((s) => !s.account_id || s.account_id === user.email) });
    }
    if (p === '/api/cli/ctf/status' && method === 'GET') {
      if (!canRun(user) && user.role !== 'owner') return error(res, 403, 'Execution access not approved');
      const r = await rustFetch('/v1/ctf/status', { token: tokenFor(user), timeoutMs: 10000 });
      if (r.status !== 200) return error(res, r.status === 0 ? 502 : r.status, String(r.json?.error || 'CTF status failed').slice(0, 200));
      return send(res, 200, r.json);
    }
    return error(res, 404, 'Rust bridge route not found');
  }
  return { handle, statusFor, tokenConfigured: () => !!loadMaster(), wroseUrl };
}
