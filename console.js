(() => {'use strict';
const $ = s => document.querySelector(s); const $$ = s => Array.from(document.querySelectorAll(s));
const api = (p) => (window.WROSECODE_API ? window.WROSECODE_API(p) : p);
let current = { chat: null, ctf: null }; let me = null, bridge = 'disabled'; const streams = {};
let cliState = { reachable: false, authorized: false, busy: false, paired: false };
function elt(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
async function apiJson(url, opts = {}) {
  const r = await fetch(api(url), { credentials: 'include', ...opts });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json() : { error: await r.text() };
  if (!r.ok) throw Error((j && j.error) || `Request failed (${r.status})`);
  return j;
}
const post = (url, data) => apiJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
function pickView(view) {
  $$('.side-link').forEach(b => b.classList.toggle('selected', b.dataset.view === view));
  $$('.view-pane').forEach(b => b.classList.toggle('is-active', b.id === `view-${view}`));
  $('#breadcrumb').textContent = { chat: 'AGENT CHAT', ctf: 'CTF OPERATIONS', cli: 'CONNECT CLI', history: 'JOB HISTORY', providers: 'AI PROVIDERS', admin: 'ACCESS CONTROL' }[view];
  $('#sidebar').classList.remove('open');
  if (view === 'history') refreshJobs();
  if (view === 'providers') refreshProviders();
  if (view === 'admin') refreshUsers();
  if (view === 'cli') refreshCli();
}
function line(target, kind, text) { const item = elt('div', `message-line ${kind}`); const tag = elt('span', 'message-tag', kind === 'user' ? 'YOU' : kind === 'system' ? 'SYSTEM' : kind === 'error' ? 'ERROR' : 'WROSECODE'); item.append(tag, elt('div', 'message-text', text)); target.append(item); target.scrollTop = target.scrollHeight }
// Legacy job SSE (spawn bridge)
function stream(jobId, kind) {
  if (streams[kind]) try { streams[kind].close() } catch {}
  const source = new EventSource(api(`/api/jobs/${jobId}/events`)); streams[kind] = source;
  const feed = kind === 'ctf' ? $('#ctfFeed') : $('#transcript');
  function render(data, type) {
    if (type === 'log') line(feed, 'agent', data.text || '');
    if (type === 'candidate') { const c = elt('div', 'candidate'); c.append(elt('span', 'candidate-tag', 'UNVERIFIED'), elt('code', '', data.value || '')); $('#candidates').prepend(c); $('#candidateCount').textContent = String(Number($('#candidateCount').textContent) + 1) }
    if (type === 'status') { if (kind === 'ctf') { $('#ctfStatus').textContent = data.status.toUpperCase(); $('#ctfAnalysis').textContent = data.status.toUpperCase() } else $('#chatSubstatus').textContent = data.status.toUpperCase() }
    if (type === 'done') { if (kind === 'ctf') { $('#ctfStatus').textContent = data.status.toUpperCase(); $('#cancelCtf').hidden = true; $('#startCtf').disabled = false } else { $('#chatSubstatus').textContent = data.status.toUpperCase(); $('#cancelChat').hidden = true; $('#sendChat').disabled = false } line(feed, 'system', `Execution ${data.status} · exit ${data.exitCode} · verification: not independently confirmed`); source.close(); current[kind] = null; refreshJobs() }
  }
  for (const event of ['log', 'candidate', 'status', 'done']) source.addEventListener(event, e => { try { render(JSON.parse(e.data), event) } catch {} });
  source.onerror = () => { source.close(); if (current[kind]) line(feed, 'error', 'Live connection interrupted. Check job history for recorded output.'); if (kind === 'ctf') { $('#cancelCtf').hidden = true; $('#startCtf').disabled = false } else { $('#cancelChat').hidden = true; $('#sendChat').disabled = false } current[kind] = null };
}
// Real Rust streaming chat via /api/cli/chat/stream (SSE POST)
async function runRustChat(value) {
  const feed = $('#transcript');
  $('#sendChat').disabled = true; $('#chatSubstatus').textContent = 'CONNECTING';
  try {
    const r = await fetch(api('/api/cli/chat/stream'), {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: value, provider: $('#provider').value.trim() || undefined, model: $('#model').value.trim() || undefined })
    });
    if (r.status === 401) throw Error('Unauthorized — open Connect CLI and pair this device.');
    if (r.status === 503) throw Error('Agent busy — a chat/CTF turn holds the agent. Retry shortly.');
    if (r.status === 403) throw Error('Execution access not approved.');
    if (!r.ok || !r.body) throw Error(`Chat failed (${r.status})`);
    $('#chatSubstatus').textContent = 'STREAMING';
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let acc = elt('div', 'message-line agent');
    acc.append(elt('span', 'message-tag', 'WROSECODE'), elt('div', 'message-text', ''));
    feed.append(acc); feed.scrollTop = feed.scrollHeight;
    const txt = () => acc.querySelector('.message-text');
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const mEv = frame.match(/^event:\s*(\S+)/m); const mData = frame.match(/^data:\s*([\s\S]*)/m);
        if (!mEv) continue;
        const ev = mEv[1]; let data = {}; try { data = JSON.parse((mData ? mData[1] : '{}').split('\n').filter(l => l.startsWith('data:') ? false : true).join('\n')) } catch {}
        if (ev === 'chat.delta' && data.delta) { txt().textContent += data.delta; feed.scrollTop = feed.scrollHeight }
        else if (ev === 'chat.started') { $('#chatSubstatus').textContent = 'RUNNING' }
        else if (ev === 'thinking.status' && data.status) { $('#chatSubstatus').textContent = String(data.status).slice(0, 60).toUpperCase() }
        else if (ev === 'chat.completed') { if (data.answer && !txt().textContent) txt().textContent = data.answer; $('#chatSubstatus').textContent = 'COMPLETED' }
        else if (ev === 'chat.failed') { line(feed, 'error', data.error || 'Chat failed'); $('#chatSubstatus').textContent = 'FAILED' }
      }
    }
    if (!txt().textContent) txt().textContent = '(empty response)';
    $('#chatSubstatus').textContent = 'COMPLETED';
  } catch (err) { line(feed, 'error', err.message); $('#chatSubstatus').textContent = 'ERROR' }
  finally { $('#sendChat').disabled = false }
}
async function runChat(e) {
  e.preventDefault();
  const value = $('#prompt').value.trim(); if (!value) return;
  $('#transcript').querySelector('.empty-transcript')?.remove();
  line($('#transcript'), 'user', value); $('#prompt').value = '';
  // Prefer real Rust bridge when paired; fall back to legacy job queue otherwise.
  if (cliState.reachable && cliState.authorized && cliState.paired) return runRustChat(value);
  if (current.chat) return;
  $('#sendChat').disabled = true; $('#chatSubstatus').textContent = 'QUEUING';
  try { const response = await post('/api/jobs', { kind: 'chat', prompt: value, provider: $('#provider').value.trim(), model: $('#model').value.trim() }); current.chat = response.id; $('#cancelChat').hidden = false; stream(response.id, 'chat') }
  catch (err) { line($('#transcript'), 'error', err.message); $('#sendChat').disabled = false }
}
async function runCtf() {
  if (current.ctf) return;
  const file = $('#artifactInput').files[0];
  if (!file) { alert('Select a challenge file first.'); return }
  if (!$('#authorizedScope').checked) { alert('Confirm authorization to analyze this challenge.'); return }
  if (file.size > 16 * 1024 * 1024) { alert('Maximum artifact size is 16 MiB.'); return }
  $('#startCtf').disabled = true; $('#ctfFeed').replaceChildren();
  $('#candidates').replaceChildren(elt('div', 'candidate-note', 'Flags remain UNVERIFIED until independently confirmed by the challenge platform.'));
  $('#candidateCount').textContent = '0'; $('#ctfStatus').textContent = 'UPLOADING';
  try {
    const u = await apiJson('/api/artifacts?filename=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    line($('#ctfFeed'), 'system', `Artifact saved: ${u.name} / ${u.size} bytes / sha256 ${u.sha256.slice(0, 16)}…`);
    const j = await post('/api/jobs', { kind: 'ctf', artifactId: u.id });
    current.ctf = j.id; $('#cancelCtf').hidden = false; stream(j.id, 'ctf');
  } catch (e) { line($('#ctfFeed'), 'error', e.message); $('#startCtf').disabled = false }
}
async function cancel(kind) {
  const job = current[kind]; if (!job) return;
  try { await post(`/api/jobs/${job}/cancel`, {}); if (kind === 'ctf') $('#ctfStatus').textContent = 'CANCELLING'; else $('#chatSubstatus').textContent = 'CANCELLING' }
  catch (e) { line(kind === 'ctf' ? $('#ctfFeed') : $('#transcript'), 'error', e.message) }
}
async function refreshJobs() {
  try {
    const data = await apiJson('/api/jobs'); const list = $('#historyList'), recent = $('#recentJobs');
    list.replaceChildren(); recent.replaceChildren();
    if (!data.jobs.length) { list.append(elt('p', 'quiet-placeholder', 'No jobs yet.')); recent.append(elt('p', 'quiet-placeholder', 'No executions yet.')); return }
    for (const j of data.jobs) { const row = elt('div', 'history-item'); row.append(elt('span', 'history-kind', j.kind === 'ctf' ? '⚑ CTF' : '⌘ CHAT'), elt('span', 'history-id', j.id.slice(0, 8)), elt('span', 'history-status ' + j.status, j.status.toUpperCase()), elt('small', '', new Date(j.created_at).toLocaleString())); list.append(row) }
    for (const j of data.jobs.slice(0, 5)) { const r = elt('div', 'recent-item'); r.append(elt('span', '', j.kind === 'ctf' ? '⚑' : '⌘'), elt('div', '', j.kind === 'ctf' ? 'CTF ANALYSIS' : 'AGENT TASK'), elt('small', '', j.status.toUpperCase())); recent.append(r) }
  } catch (e) { $('#historyList').textContent = e.message }
}
async function refreshProviders() {
  try {
    // Prefer real Rust providers; fall back to legacy spawn bridge.
    try {
      const r = await apiJson('/api/cli/providers');
      const names = (r.providers || []).map(p => `${p.id} — ${p.status || ''}${p.model ? ' / ' + p.model : ''}`).join('\n');
      $('#providerOutput').textContent = names || 'No providers returned.';
      const dl = $('#providersList'); dl.replaceChildren();
      for (const p of (r.providers || [])) { const o = document.createElement('option'); o.value = p.id; dl.append(o) }
      return;
    } catch (e) { if (!/Unauthorized|approved|Log in/.test(e.message)) throw e; }
    const r = await apiJson('/api/providers');
    $('#providerOutput').textContent = r.raw || 'No provider output was returned. Check wrosecode providers list on Kali.';
  } catch (e) { $('#providerOutput').textContent = e.message }
}
async function refreshCli() {
  const box = $('#cliStatus'); if (!box) return;
  box.textContent = 'Checking Rust server...';
  try {
    const s = await apiJson('/api/cli/status');
    cliState = { reachable: !!s.reachable, authorized: !!s.authorized, busy: !!s.busy, paired: !!s.paired };
    const lines = [
      `REACHABLE: ${s.reachable ? 'YES' : 'NO'}`,
      `AUTHORIZED: ${s.authorized ? 'YES' : 'NO'}`,
      `PAIRED: ${s.paired ? 'YES (' + (s.device_id || '') + ')' : 'NO'}`,
      s.busy ? 'STATUS: BUSY — agent turn in progress' : `STATUS: ${s.provider ? s.provider + ' / ' + (s.model || '') : (s.error || 'unknown')}`,
      `PAIRED DEVICES: ${s.paired_devices ?? '?'}`,
      `PENDING CODES: ${s.pending_codes ?? '?'}`,
    ];
    box.textContent = lines.join('\n');
    updateEngine(s);
  } catch (e) { box.textContent = 'CLI status failed: ' + e.message }
}
async function pairCli() {
  const code = $('#pairCode').value.trim(); const name = $('#pairName').value.trim() || 'Browser device';
  $('#pairMsg').textContent = 'Pairing...';
  try {
    const r = await post('/api/cli/pair', { code, device_name: name });
    $('#pairMsg').textContent = 'Paired: ' + r.device_id;
    $('#pairCode').value = '';
    await refreshCli();
  } catch (e) { $('#pairMsg').textContent = e.message }
}
async function revokeCli() {
  $('#pairMsg').textContent = 'Revoking...';
  try { await post('/api/cli/revoke', {}); $('#pairMsg').textContent = 'Device revoked.'; await refreshCli() }
  catch (e) { $('#pairMsg').textContent = e.message }
}
async function refreshUsers() {
  try {
    const d = await apiJson('/api/admin/users'); const list = $('#usersList'); list.replaceChildren();
    for (const u of d.users) {
      const row = elt('div', 'history-item');
      row.append(elt('strong', 'history-email', u.email), elt('span', 'history-status', u.role.toUpperCase()), elt('span', '', u.approved ? 'APPROVED' : 'PENDING'));
      if (u.role !== 'owner') { const b = elt('button', 'tiny-button', u.approved ? 'REVOKE' : 'APPROVE'); b.addEventListener('click', async () => { try { await post('/api/admin/approve', { id: u.id, approved: !u.approved }); refreshUsers() } catch (e) { alert(e.message) } }); row.append(b) }
      list.append(row);
    }
  } catch (e) { $('#usersList').textContent = e.message }
}
function updateEngine(s) {
  // s may be /api/cli/status or legacy config
  if (s && typeof s.reachable === 'boolean') {
    $('#engineMode').textContent = !s.reachable ? 'RUST CLI OFFLINE' : s.busy ? 'AGENT BUSY' : s.paired ? 'RUST CLI CONNECTED' : 'RUST REACHABLE / UNPAIRED';
    $('#engineNote').textContent = !s.reachable ? 'Start: wrosecode server --hostname 127.0.0.1 --port 4076' : s.busy ? 'A turn holds the agent — retry shortly' : s.paired ? 'Paired Rust agent runtime' : 'Open Connect CLI and pair';
    $('#connectionPill').lastChild.textContent = ' ' + (!s.reachable ? 'CLI OFFLINE' : s.busy ? 'AGENT BUSY' : s.paired ? 'KALI CONNECTED' : 'UNPAIRED');
    $('#engineLight').style.color = s.reachable && s.paired && !s.busy ? '#67d4ff' : '#e0a83c';
    return;
  }
}
function setup() {
  $$('.side-link').forEach(b => b.addEventListener('click', () => pickView(b.dataset.view)));
  $('#mobileSidebar').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#logoutBtn').addEventListener('click', async () => { await post('/api/auth/logout', {}); location.replace('login.html') });
  $('#chatForm').addEventListener('submit', runChat);
  $('#cancelChat').addEventListener('click', () => cancel('chat'));
  $('#cancelCtf').addEventListener('click', () => cancel('ctf'));
  $('#startCtf').addEventListener('click', runCtf);
  $('#refreshHistory').addEventListener('click', refreshJobs);
  $('#refreshProviders').addEventListener('click', refreshProviders);
  $('#refreshUsers').addEventListener('click', refreshUsers);
  if ($('#refreshCli')) $('#refreshCli').addEventListener('click', refreshCli);
  if ($('#pairCli')) $('#pairCli').addEventListener('click', pairCli);
  if ($('#revokeCli')) $('#revokeCli').addEventListener('click', revokeCli);
  $('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit() } });
  $('#clearChat').addEventListener('click', () => $('#transcript').replaceChildren());
  $$('[data-example]').forEach(b => b.addEventListener('click', () => { $('#prompt').value = b.dataset.example; $('#prompt').focus() }));
  $('#artifactInput').addEventListener('change', () => { $('#artifactInfo').textContent = $('#artifactInput').files[0] ? `${$('#artifactInput').files[0].name} (${($('#artifactInput').files[0].size / 1024).toFixed(1)} KiB)` : 'No file selected' });
  const drop = $('#fileDrop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-active') });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-active'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag-active'); const file = e.dataTransfer.files[0]; if (file) { const dt = new DataTransfer(); dt.items.add(file); $('#artifactInput').files = dt.files; $('#artifactInfo').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KiB)` } });
}
(async () => {
  setup();
  try {
    const [who, cfg] = await Promise.all([apiJson('/api/me'), apiJson('/api/config')]);
    if (!who.user) { location.replace('login.html'); return }
    me = who.user; bridge = cfg.bridge;
    for (const provider of ['google', 'github']) {
      if (!cfg[provider]) { const link = $(`#link${provider[0].toUpperCase() + provider.slice(1)}`); if (link) { link.classList.add('disabled'); link.removeAttribute('href'); link.title = 'Configure OAuth credentials on Kali first' } }
      else { const link = $(`#link${provider[0].toUpperCase() + provider.slice(1)}`); if (link) link.href = api(`/api/oauth/${provider}`) }
    }
    $('#userInitial').textContent = me.email[0].toUpperCase();
    $('#footerUser').textContent = me.email;
    $('#adminNav').hidden = me.role !== 'owner';
    try {
      const s = await apiJson('/api/cli/status');
      cliState = { reachable: !!s.reachable, authorized: !!s.authorized, busy: !!s.busy, paired: !!s.paired };
      updateEngine(s);
    } catch {
      $('#engineMode').textContent = bridge === 'cli' ? 'RUST CLI CONNECTED' : bridge === 'mock' ? 'SIMULATION MODE' : 'NOT CONNECTED';
      $('#engineNote').textContent = bridge === 'cli' ? 'Local Kali agent runtime' : bridge === 'mock' ? 'Test responses only — not real AI' : 'Set BRIDGE_MODE=cli on Kali';
      $('#connectionPill').lastChild.textContent = ' ' + (bridge === 'cli' ? 'KALI CONNECTED' : bridge === 'mock' ? 'MOCK SESSION' : 'BRIDGE OFFLINE');
      $('#engineLight').style.color = bridge === 'cli' ? '#67d4ff' : '#67cfff';
    }
    if (!me.canRun) { $('#sendChat').disabled = true; $('#startCtf').disabled = true; line($('#transcript'), 'system', me.role === 'owner' ? 'Execution disabled. Configure BRIDGE_MODE=cli to connect your local Rust binary.' : 'Execution requires owner approval and explicit multi-user execution configuration.') }
    else if (!cliState.paired && cliState.reachable) { line($('#transcript'), 'system', 'Rust server reachable but unpaired. Open Connect CLI and enter your pairing code.') }
    refreshJobs();
  } catch (e) { location.replace('login.html') }
})();
})();
