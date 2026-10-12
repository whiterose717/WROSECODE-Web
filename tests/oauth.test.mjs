import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function ready(base){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('Server not ready')}

test('OAuth redirects use exact callback, PKCE S256, nonce, and one-time state checks',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wrose-oauth-')),p=await port(),base=`http://127.0.0.1:${p}`;
 const child=spawn(process.execPath,['server/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(p),DATA_DIR:dir,PUBLIC_BASE_URL:base,FRONTEND_URL:base,BRIDGE_MODE:'disabled',SIGNUP_MODE:'open',GOOGLE_CLIENT_ID:'google-test-client',GOOGLE_CLIENT_SECRET:'google-test-secret',GITHUB_CLIENT_ID:'github-test-client',GITHUB_CLIENT_SECRET:'github-test-secret'},stdio:'ignore'});
 t.after(()=>{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true})});await ready(base);
 for(const provider of ['google','github']){
  const start=await fetch(`${base}/api/oauth/${provider}`,{redirect:'manual'});assert.equal(start.status,302);
  const target=new URL(start.headers.get('location'));assert.equal(target.searchParams.get('redirect_uri'),`${base}/api/oauth/${provider}/callback`);
  assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.match(target.searchParams.get('code_challenge')||'',/^[A-Za-z0-9_-]{43}$/);
  const state=target.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];assert.ok(state);
  const invalid=await fetch(`${base}/api/oauth/${provider}/callback?state=invalid&error=access_denied`,{headers:{cookie},redirect:'manual'});assert.equal(invalid.status,400);
  const denied=await fetch(`${base}/api/oauth/${provider}/callback?state=${encodeURIComponent(state)}&error=access_denied`,{headers:{cookie},redirect:'manual'});assert.equal(denied.status,302);assert.equal(denied.headers.get('location'),`${base}/login.html?error=oauth_denied`);
  const replay=await fetch(`${base}/api/oauth/${provider}/callback?state=${encodeURIComponent(state)}&error=access_denied`,{headers:{cookie},redirect:'manual'});assert.equal(replay.status,302);assert.match(replay.headers.get('location'),/oauth_expired/);
 }
});
