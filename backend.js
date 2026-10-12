// Production preference: serve the console from the SAME origin as the Node backend
// (via Cloudflare Tunnel or private Tailscale Serve). This avoids Safari third-party
// cookie blocking on the static *.pages.dev hostname.
(()=>{'use strict';
 const configured=(window.WROSECODE_BACKEND||'').trim().replace(/\/$/,'');
 let chosen=configured;
 try{if(!chosen)chosen=localStorage.getItem('wrose_backend')||''}catch{}
 try{const u=new URL(chosen);if(!['https:'].includes(u.protocol)&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))chosen='';else chosen=u.origin}catch{chosen=''}
 window.WROSECODE_API_BASE=chosen||location.origin;
 window.wroseApiPath=p=>window.WROSECODE_API_BASE+p;
 // Back-compat for pages expecting the older helper name.
 window.WROSECODE_BACKEND=chosen;
 window.WROSECODE_API=p=>window.WROSECODE_API_BASE+p;
 // Keep authentication and console pages first-party so Safari can persist
 // the backend's session cookie when the marketing site is hosted on Pages.
 if(chosen&&chosen!==location.origin&&/\/(?:login|console)\.html$/.test(location.pathname)){
   location.replace(chosen+location.pathname+location.search+location.hash);return;
 }
 // Static Pages has no auth endpoint; open full authenticated console at backend.
 if(chosen&&chosen!==location.origin){
   document.querySelectorAll('a[href="login.html"],a[href="console.html"]').forEach(a=>{
     a.href=chosen+'/'+a.getAttribute('href');
   });
 }
})();
