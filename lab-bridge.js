(()=>{'use strict';
 const btn=document.getElementById('runLiveLab'),note=document.getElementById('liveLabState');if(!btn)return;
 const base=window.WROSECODE_API_BASE||location.origin;
 async function api(p,opts){const r=await fetch(base+p,{credentials:'include',...opts});const b=await r.json().catch(()=>({}));if(!r.ok)throw Error(b.error||`HTTP ${r.status}`);return b}
 async function status(){try{
  const [health,user]=await Promise.all([api('/api/health'),api('/api/me')]);
  if(!user.user){note.textContent='Sign in to your backend first';btn.textContent='SIGN IN TO RUN CTF ↗';btn.disabled=false;btn.dataset.action='login';return}
  if(!user.user.canRun){note.textContent='Pair your CLI in Connect CLI';btn.textContent='PAIR YOUR CLI ↗';btn.disabled=false;btn.dataset.action='pair';return}
  note.textContent='Authenticated agent available (real execution requires an authorized challenge)';btn.disabled=false;btn.textContent='RUN ON MY KALI CLI ↗';btn.dataset.action='run';
 }catch{note.textContent='Backend unreachable. Configure secure HTTPS/Tailscale bridge.';btn.textContent='SET UP CLI ↗';btn.disabled=false;btn.dataset.action='setup'}}
 btn.addEventListener('click',async()=>{
  if(btn.dataset.action==='login')return location.assign(base+'/login.html');
  if(btn.dataset.action==='pair')return location.assign(base+'/console.html#devices');
  if(btn.dataset.action==='setup')return location.assign('web-setup.html');
  if(!document.getElementById('scopeCheckbox').checked){note.textContent='Confirm authorization first';return}
  const files=[...document.getElementById('filesInput').files];if(!files.length){note.textContent='Choose a challenge artifact first (max 16 MiB)';return}
  if(files[0].size>16*1024*1024){note.textContent='File exceeds 16 MiB backend limit';return}
  btn.disabled=true;note.textContent='Uploading authorized artifact to your paired agent…';
  try{
   const file=files[0];const artifact=await api('/api/artifacts?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});
   const job=await api('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'ctf',artifactId:artifact.id,prompt:document.getElementById('challengeDesc').value.trim().slice(0,4000)})});
   note.textContent=`Investigation queued: ${job.id.slice(0,8)} — open Console → History / CTF for results. Flags must be verified independently.`;
   btn.textContent='OPEN LIVE CONSOLE ↗';btn.dataset.action='view';
  }catch(e){note.textContent=e.message}finally{btn.disabled=false}
 });
 const handler=btn.addEventListener.bind(btn);
 btn.addEventListener('click',()=>{if(btn.dataset.action==='view')location.assign(base+'/console.html#ctf')});
 status();
})();
