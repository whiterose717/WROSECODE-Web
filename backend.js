/* WROSECODE backend endpoint configuration.
 * Same-origin by default (Node serves frontend + /api).
 * For Cloudflare Pages + remote backend (Tunnel/Tailscale), set
 * window.WROSECODE_BACKEND to the backend origin, e.g.:
 *   window.WROSECODE_BACKEND = "https://your-kali-tailnet.ts.net";
 * Or store an override in localStorage: wrose_backend
 */
(function () {
  'use strict';
  var stored = '';
  try { stored = localStorage.getItem('wrose_backend') || ''; } catch (e) {}
  var configured = (window.WROSECODE_BACKEND || '').replace(/\/$/, '');
  var override = String(stored || '').replace(/\/$/, '');
  window.WROSECODE_BACKEND = override || configured || '';
  window.WROSECODE_API = function (path) {
    if (window.WROSECODE_BACKEND) return window.WROSECODE_BACKEND + path;
    return path;
  };
})();
