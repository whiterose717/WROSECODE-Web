import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function port(){return new Promise(res=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p))})})}
async function wait(base){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('Server not ready')}
test('open sign-up, account-scoped devices, pair/revoke, real SSE protocol, and per-user isolation',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wrose-device-')),p=await port(),base=`http://127.0.0.1:${p}`;
 const env={...process.env,HOST:'127.0.0.1',PORT:String(p),DATA_DIR:dir,PUBLIC_BASE_URL:base,FRONTEND_URL:base,BRIDGE_MODE:'disabled',SIGNUP_MODE:'open',ALLOW_MEMBER_JOBS:'0',I_ACCEPT_SHARED_CLI_RISK:'no'};
 const child=spawn(process.execPath,['server/server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true})});await wait(base);
 async function req(route,{cookie='',token='',method='GET',body}={}){
  const res=await fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),origin:base},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));return {res,data,cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
 }
 let alice=await req('/api/auth/register',{method:'POST',body:{email:'alice@example.net',password:'this-is-a-long-password-for-alice'}});assert.equal(alice.res.status,201,stderr);
 let bob=await req('/api/auth/register',{method:'POST',body:{email:'bob@example.net',password:'this-is-a-long-password-for-bob'}});assert.equal(bob.res.status,201);
 alice=await req('/api/auth/login',{method:'POST',body:{email:'alice@example.net',password:'this-is-a-long-password-for-alice'}});bob=await req('/api/auth/login',{method:'POST',body:{email:'bob@example.net',password:'this-is-a-long-password-for-bob'}});
 assert.equal(alice.res.status,200);assert.equal(bob.res.status,200);
 const ac=alice.cookie,bc=bob.cookie;
 const sharedStatus=await req('/api/cli/status',{cookie:ac});assert.equal(sharedStatus.res.status,200);assert.equal(sharedStatus.data.authorized,false);assert.equal(sharedStatus.data.paired,false);
 let pair=await req('/api/devices/pair',{method:'POST',cookie:ac,body:{}});assert.equal(pair.res.status,201);assert.match(pair.data.code,/^[A-Z2-9]{6}-[A-Z2-9]{6}$/);
 let attempt=await req('/api/agent/enroll',{method:'POST',body:{code:'AAAAAA-BBBBBB',name:'malicious'}});assert.equal(attempt.res.status,403);
 const enrolled=await req('/api/agent/enroll',{method:'POST',body:{code:pair.data.code,name:'Alice Kali'}});assert.equal(enrolled.res.status,201);
 const token=enrolled.data.deviceToken;
 attempt=await req('/api/agent/enroll',{method:'POST',body:{code:pair.data.code,name:'reuse'}});assert.equal(attempt.res.status,403);
 let dev=await req('/api/devices',{cookie:ac});assert.equal(dev.data.devices.length,1);assert.equal(dev.data.devices[0].online,true);
 const providerList=await req('/api/providers',{cookie:ac});assert.equal(providerList.res.status,200);assert.equal(providerList.data.deviceLocal,true);assert.match(providerList.data.raw,/device-local/i);
 dev=await req('/api/devices',{cookie:bc});assert.equal(dev.data.devices.length,0);
 const aJob=await req('/api/jobs',{method:'POST',cookie:ac,body:{kind:'chat',prompt:'Analyze my own repository'}});assert.equal(aJob.res.status,201,stderr);
 const bJob=await req('/api/jobs',{method:'POST',cookie:bc,body:{kind:'chat',prompt:'Unpaired job'}});assert.equal(bJob.res.status,403);
 let claimed=await req('/api/agent/poll',{token});assert.equal(claimed.data.job.id,aJob.data.id);
 const logged=await req(`/api/agent/jobs/${aJob.data.id}/log`,{token,method:'POST',body:{text:'WROSECODE agent says hello'}});assert.equal(logged.res.status,200);
 const done=await req(`/api/agent/jobs/${aJob.data.id}/complete`,{token,method:'POST',body:{exitCode:0}});assert.equal(done.res.status,200);
 const events=await fetch(base+`/api/jobs/${aJob.data.id}/events`,{headers:{cookie:ac}});assert.equal(events.status,200);const stream=await events.text();assert.match(stream,/WROSECODE agent says hello/);assert.match(stream,/event: done/);
 const cross=await fetch(base+`/api/jobs/${aJob.data.id}/events`,{headers:{cookie:bc}});assert.equal(cross.status,404);
 const revoked=await req(`/api/devices/${enrolled.data.deviceId}/revoke`,{cookie:ac,method:'POST',body:{}});assert.equal(revoked.res.status,200);
 assert.equal((await req('/api/agent/poll',{token})).res.status,401);
 assert.equal((await req('/api/me',{cookie:ac})).data.user.canRun,false);
});

test('custom provider SSRF defenses require a public HTTPS hostname, and missing encryption key fails securely',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wrose-ai-')),p=await port(),base=`http://127.0.0.1:${p}`;
 const child=spawn(process.execPath,['server/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(p),DATA_DIR:dir,PUBLIC_BASE_URL:base,FRONTEND_URL:base,BRIDGE_MODE:'disabled',SIGNUP_MODE:'open',PROVIDER_ENCRYPTION_KEY:'',ALLOW_CUSTOM_PROVIDERS:'1'},stdio:'ignore'});
 t.after(()=>{child.kill();rmSync(dir,{recursive:true,force:true})});await wait(base);
 const request=async(endpoint,body,cookie='')=>fetch(base+endpoint,{method:'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 await request('/api/auth/register',{email:'profile@example.net',password:'a-very-long-safe-password'});
 const login=await request('/api/auth/login',{email:'profile@example.net',password:'a-very-long-safe-password'});const cookie=login.headers.get('set-cookie').split(';')[0];
 let r=await request('/api/ai/providers',{name:'unsafe',preset:'custom',baseUrl:'http://127.0.0.1:8787',apiKey:'dummykey1234'},cookie);assert.equal(r.status,400);
 r=await request('/api/ai/providers',{name:'DeepSeek',preset:'deepseek',apiKey:'dummykey1234'},cookie);assert.equal(r.status,503);
 const listed=await fetch(base+'/api/ai/providers',{headers:{cookie}});assert.equal((await listed.json()).encryptionReady,false);
});
