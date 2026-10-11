(() => {'use strict';
  let register = false; const $ = s => document.querySelector(s); const cfg = {};
  const api = (p) => (window.WROSECODE_API ? window.WROSECODE_API(p) : p);
  const loginError = new URLSearchParams(location.search).get('error');
  function error(s) { $('#authError').textContent = s || '' }
  function backendLabel(s) { $('#backendStatus').textContent = s }
  async function request(url, opts) {
    const r = await fetch(api(url), { credentials: 'include', ...opts });
    const ct = r.headers.get('content-type') || '';
    const b = ct.includes('json') ? await r.json() : { error: await r.text() };
    if (!r.ok) throw Error((b && b.error) || `Request failed (${r.status})`);
    return b;
  }
  function mode() {
    register = !register;
    $('#authTitle').textContent = register ? 'Request an account.' : 'Welcome back.';
    $('#authSub').textContent = register ? 'Create credentials. The server owner approves execution access.' : 'Sign in to open your private web console.';
    $('#authSubmit').innerHTML = register ? 'CREATE ACCOUNT <span>→</span>' : 'SIGN IN <span>→</span>';
    $('#switchPrompt').textContent = register ? 'Already registered?' : 'Need an account?';
    $('#switchAuth').textContent = register ? 'Sign in' : 'Request access';
    $('#password').autocomplete = register ? 'new-password' : 'current-password'; error('');
  }
  $('#switchAuth').addEventListener('click', () => {
    if (cfg.signup !== 'open') { error('Public sign-up is disabled. Ask the Kali host owner to invite you.'); return }
    mode();
  });
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#email').value.trim(), password = $('#password').value;
    $('#authSubmit').disabled = true; error('');
    try {
      const r = await request(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
      });
      if (register) { mode(); error('Account created. Ask the owner for approval before running tasks.') }
      else location.assign('console.html');
    } catch (e) { error(e.message) } finally { $('#authSubmit').disabled = false }
  });
  (async () => {
    try {
      const [c, m] = await Promise.all([request('/api/config'), request('/api/me')]);
      Object.assign(cfg, c);
      if (m.user) { location.replace('console.html'); return }
      if (loginError === 'link_required') error('Account already exists. Sign in with your password first, then link this provider under AI providers.');
      if (loginError === 'signup_closed') error('Sign-up is disabled. Contact the owner.');
      const dot = $('#backendDot');
      // Real backend states: CONNECTED (Rust reachable), DEGRADED (backend up, Rust offline), OFFLINE
      try {
        const h = await request('/api/health');
        if (h.rust && h.rust.reachable) {
          dot.classList.add(h.rust.busy ? 'demo' : 'live');
          backendLabel(h.rust.busy ? 'BACKEND CONNECTED / AGENT BUSY' : 'BACKEND CONNECTED / RUST CLI ONLINE');
        } else {
          dot.classList.add('demo');
          backendLabel('BACKEND CONNECTED / RUST CLI OFFLINE — start: wrosecode server --hostname 127.0.0.1 --port 4076');
        }
      } catch {
        dot.classList.add(c.bridge === 'cli' ? 'live' : 'demo');
        backendLabel(c.bridge === 'cli' ? 'KALI AGENT BRIDGE / AVAILABLE' : c.bridge === 'mock' ? 'SIMULATION MODE / CONNECTED' : 'BACKEND CONNECTED / EXECUTION DISABLED');
      }
      for (const provider of ['google', 'github']) {
        const a = $(`#${provider}Login`);
        a.href = api(`/api/oauth/${provider}`);
        if (!c[provider]) { a.classList.add('disabled'); a.removeAttribute('href'); a.title = `Configure ${provider} OAuth credentials in .env` }
      }
      if (c.signup !== 'open') $('#switchAuth').textContent = 'Request access (owner approval)';
      if (window.WROSECODE_BACKEND) backendLabel($('#backendStatus').textContent + ` — via ${window.WROSECODE_BACKEND}`);
    } catch {
      backendLabel('BACKEND OFFLINE — start the Node server or set backend.js WROSECODE_BACKEND');
      $('#backendDot').classList.add('offline');
    }
  })();
})();
