import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=mkdtempSync(path.join(tmpdir(),'wrose-web-test-'));let child,base,authCookie='';
async function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
function exec(cmd,args,env){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cmd,...args],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>out+=x);p.once('close',c=>c?reject(Error(out)):resolve(out))})}
async function api(p,{method='GET',body,raw=false,auth=true}={}){const headers={};if(auth)headers.cookie=authCookie;if(body&&!raw)headers['content-type']='application/json';if(body&&raw)headers['content-type']='application/octet-stream';headers.origin=base;const r=await fetch(base+p,{method,headers,body:body&&(raw?body:JSON.stringify(body))});const j=await r.json();return{r,j}}
async function ready(){for(let i=0;i<80;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,60))}throw Error('Server failed to start')}
async function until(id){for(let i=0;i<100;i++){const r=await fetch(base+`/api/jobs/${id}/events`,{headers:{cookie:authCookie}});const text=await r.text();if(text.includes('event: done'))return text;await new Promise(r=>setTimeout(r,40))}throw Error('Job did not finish')}
test('live fake CLI bridge, auth, upload, SSE, redaction, candidate classification, and scope',async t=>{
const p=await port();base=`http://127.0.0.1:${p}`;const env={...process.env,PORT:String(p),PUBLIC_BASE_URL:base,HOST:'127.0.0.1',DATA_DIR:temp,WROSE_TOKEN_FILE:path.join(temp,'missing-token'),BRIDGE_MODE:'cli',WROSECODE_BIN:path.join(ROOT,'tests/fake-cli.mjs'),SIGNUP_MODE:'open',MAX_CONCURRENT_JOBS:'1',ADMIN_EMAIL:'owner@example.com',ADMIN_PASSWORD:'a_very_long_testing_password'};
await exec(path.join(ROOT,'scripts/create-admin.mjs'),[],env);child=spawn(process.execPath,['server/server.mjs'],{cwd:ROOT,env,stdio:'ignore'});t.after(()=>{child.kill();rmSync(temp,{recursive:true,force:true})});await ready();
let result=await api('/api/health',{auth:false});assert.equal(result.j.readyForLiveAgent,false);assert.equal(result.j.readyForSharedHostCli,false);assert.equal(result.j.sharedHostCliConfigured,true);assert.equal(result.j.perUserDeviceBridgeAvailable,true);
let hidden=await fetch(base+'/server/server.mjs');assert.equal(hidden.status,404);
hidden=await fetch(base+'/.env.example');assert.equal(hidden.status,404);
hidden=await fetch(base+'/data/wrosecode-web.sqlite');assert.equal(hidden.status,404);
result=await api('/api/jobs',{method:'GET',auth:false});assert.equal(result.r.status,401);
result=await api('/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:'not-the-password'}});assert.equal(result.r.status,401);
let raw=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'a_very_long_testing_password'})});assert.equal(raw.status,200);authCookie=raw.headers.get('set-cookie').split(';')[0];
result=await api('/api/me');assert.equal(result.j.user.role,'owner');assert.equal(result.j.user.canRun,true);
result=await api('/api/providers');assert.ok(result.j.raw.includes('anthropic'));assert.ok(!result.j.raw.includes('DO_NOT_EXPOSE'));assert.ok(!result.j.raw.includes('MORE_SECRET'));
result=await api('/api/jobs',{method:'POST',body:{kind:'chat',prompt:'Summarize files',provider:'anthropic',model:'claude'}});assert.equal(result.r.status,201);let text=await until(result.j.id);assert.match(text,/event: done/);assert.match(text,/Args:/);assert.match(text,/completed/);
// Bounded worker queue and cancellation of a pending job.
const slow=await api('/api/jobs',{method:'POST',body:{kind:'chat',prompt:'slow'}});
const queued=await api('/api/jobs',{method:'POST',body:{kind:'chat',prompt:'queued task'}});
assert.equal(slow.r.status,201);assert.equal(queued.r.status,201);
result=await api(`/api/jobs/${queued.j.id}/cancel`,{method:'POST',body:{}});assert.equal(result.r.status,200);
let cancelled=await until(queued.j.id);assert.match(cancelled,/cancelled/);
await until(slow.j.id);
result=await api('/api/artifacts?filename=../../passwd',{method:'POST',body:Buffer.from('test'),raw:true});assert.equal(result.r.status,400);
result=await api('/api/artifacts?filename=challenge.txt',{method:'POST',body:Buffer.from('a local challenge fixture'),raw:true});assert.equal(result.r.status,201);assert.equal(result.j.size,25);const artifactId=result.j.id;
result=await api('/api/jobs',{method:'POST',body:{kind:'ctf',artifactId}});assert.equal(result.r.status,201);text=await until(result.j.id);assert.match(text,/candidate/);assert.match(text,/unverified/);assert.match(text,/event: done/);assert.match(text,/verified\":false/);
const other=await api('/api/auth/register',{method:'POST',body:{email:'member@example.com',password:'another_long_password'}});assert.equal(other.r.status,201);const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:'member@example.com',password:'another_long_password'})});const otherCookie=login.headers.get('set-cookie').split(';')[0];let deny=await fetch(base+'/api/jobs',{method:'POST',headers:{cookie:otherCookie,origin:base,'content-type':'application/json'},body:JSON.stringify({kind:'chat',prompt:'ls'})});assert.equal(deny.status,403);
result=await api('/api/admin/users');assert.equal(result.r.status,200);assert.ok(result.j.users.find(u=>u.email==='member@example.com'));
const cross=await fetch(base+'/api/jobs',{method:'POST',headers:{cookie:authCookie,origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({kind:'chat',prompt:'hi'})});assert.equal(cross.status,403);
});
