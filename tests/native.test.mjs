import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgv,scopedPath,requestLocalApproval} from '../scripts/native-operations.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function until(fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await delay(120)}throw Error('Timed out waiting for device / completion')}

test('arg parsing and local filesystem guards deny traversal and symlink escape',async t=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'wrose-fs-'));const fs=await import('node:fs/promises');t.after(()=>rmSync(tmp,{recursive:true,force:true}));
 const workspace=path.join(tmp,'workspace');await fs.mkdir(workspace);await fs.symlink(tmp,path.join(workspace,'outside'));
 assert.deepEqual(parseArgv('git status --short'),['git','status','--short']);
 assert.deepEqual(parseArgv('git log --format="hello world"'),['git','log','--format=hello world']);
 assert.throws(()=>parseArgv('foo "bad'),/quote/);
 await assert.rejects(scopedPath(workspace,'../outside'),/relative|outside/);
 await assert.rejects(scopedPath(workspace,'outside/secret'),/outside/);
 await assert.rejects(scopedPath(workspace,'outside/new.txt',{allowMissing:true}),/outside/);
 assert.equal(await requestLocalApproval('fake',{}),false);
});

test('end-to-end companion streaming, sessions, local approvals, account isolation and revoke',async t=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'wrose-native-'));const p=await port(),base=`http://127.0.0.1:${p}`;
 const env={...process.env,HOST:'127.0.0.1',PORT:String(p),DATA_DIR:path.join(tmp,'data'),PUBLIC_BASE_URL:base,FRONTEND_URL:base,BRIDGE_MODE:'disabled',SIGNUP_MODE:'open',ALLOW_MEMBER_JOBS:'0',I_ACCEPT_SHARED_CLI_RISK:'no'};
 const server=spawn(process.execPath,['server/server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let agent;
 let stderr='';server.stderr.on('data',d=>stderr+=d.toString());
 t.after(()=>{agent?.kill('SIGKILL');server.kill('SIGKILL');rmSync(tmp,{recursive:true,force:true})});
 await until(async()=>{try{return (await fetch(base+'/api/health')).ok}catch{return false}},7000);
 async function req(route,{method='GET',body,cookie='',token=''}={}){
  const r=await fetch(base+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{}),origin:base},body:body?JSON.stringify(body):undefined});
  return {status:r.status,json:await r.json().catch(()=>({})),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 }
 const register=async(email)=>{
  assert.equal((await req('/api/auth/register',{method:'POST',body:{email,password:'example-long-enough-password'}})).status,201,stderr);
  const x=await req('/api/auth/login',{method:'POST',body:{email,password:'example-long-enough-password'}});assert.equal(x.status,200);return x.cookie;
 };
 const alice=await register('alice2@example.net'),bob=await register('bob2@example.net');
 const pair=await req('/api/devices/pair',{method:'POST',cookie:alice,body:{}});assert.equal(pair.status,201);
 agent=spawn(process.execPath,['scripts/device-agent.mjs','--backend',base,'--code',pair.json.code,'--name','Alice Linux'],{
  cwd:root,env:{...env,WROSE_DEVICE_STATE_FILE:path.join(tmp,'token.json'),WROSE_WORKSPACE_ROOT:path.join(tmp,'myproject'),WROSECODE_BIN:path.join(root,'tests/fake-cli.mjs')},stdio:['ignore','pipe','pipe']});
 let errors='';agent.stderr.on('data',d=>errors+=d.toString());
 const device=await until(async()=>{const d=await req('/api/devices',{cookie:alice});return d.json.devices?.[0]?.capabilities?.chat?d.json.devices[0]:null},8000);
 assert.equal(device.online,true,errors);assert.match(device.platform,/linux|darwin|win32/);
 const create=await req('/api/devices/sessions',{method:'POST',cookie:alice,body:{deviceId:device.id,title:'Project conversation'}});assert.equal(create.status,201);
 const sessionId=create.json.session.id;
 assert.equal((await req(`/api/devices/sessions/${sessionId}`,{cookie:bob})).status,404);
 const chat=await req('/api/jobs',{method:'POST',cookie:alice,body:{kind:'chat',prompt:'print hello',sessionId,deviceId:device.id,model:'test-model'}});assert.equal(chat.status,201,stderr);
 const row=await until(async()=>{const d=await req('/api/jobs',{cookie:alice});return d.json.jobs?.find(j=>j.id===chat.json.id&&j.status==='completed')},16000);
 assert.equal(row.status,'completed');
 const messages=await req(`/api/devices/sessions/${sessionId}`,{cookie:alice});assert.equal(messages.status,200);assert.equal(messages.json.messages[0].role,'user');assert.ok(messages.json.messages.some(x=>x.role==='assistant'));
 assert.equal((await req('/api/jobs',{method:'POST',cookie:bob,body:{kind:'chat',prompt:'snoop',deviceId:device.id}})).status,403);
 assert.equal((await req('/api/jobs',{method:'POST',cookie:alice,body:{kind:'file',request:{op:'read',path:'../secrets'}}})).status,400);
 const denied=await req('/api/jobs',{method:'POST',cookie:alice,body:{kind:'terminal',deviceId:device.id,request:{op:'terminal',command:'node --version'}}});assert.equal(denied.status,201);
 const final=await until(async()=>{const d=await req('/api/jobs',{cookie:alice});return d.json.jobs?.find(j=>j.id===denied.json.id&&j.status==='failed')},16000);
 assert.equal(final.status,'failed');
 const ev=await fetch(base+`/api/jobs/${denied.json.id}/events`,{headers:{cookie:alice}});const text=await ev.text();assert.match(text,/event: permission/);assert.match(text,/denied/i);
 assert.equal((await req(`/api/jobs/${denied.json.id}/events`,{cookie:bob})).status,404);
 assert.equal((await req(`/api/devices/${device.id}/revoke`,{method:'POST',cookie:alice,body:{}})).status,200);
 await until(()=>agent.exitCode!==null,7000);
});
