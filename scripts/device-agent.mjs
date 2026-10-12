#!/usr/bin/env node
// WROSECODE Companion v2: Windows/macOS/Linux, outbound-only HTTPS, per-user device token.
// Does not expose the OS shell or bind an inbound listener. Sensitive operations
// require a HUMAN TO APPROVE THEM ON THE LOCAL MACHINE (no unattended bypass).
import {readFile,writeFile,mkdir,chmod,unlink} from 'node:fs/promises';
import {homedir,hostname,platform,release} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileOperation,requestLocalApproval,runTerminal} from './native-operations.mjs';

function flag(key){const idx=process.argv.indexOf('--'+key);return idx<0?'':process.argv[idx+1]||''}
const backend=(flag('backend')||process.env.WROSE_BACKEND_URL||'').replace(/\/$/,'');
const code=flag('code');
const cli=process.env.WROSECODE_BIN||'wrosecode';
const deviceName=flag('name')||hostname();
const statePath=process.env.WROSE_DEVICE_STATE_FILE||path.join(homedir(),'.wrosecode','web-device.json');
const workspaceRoot=path.resolve(process.env.WROSE_WORKSPACE_ROOT||path.join(homedir(),'wrosecode-web-workspace'));
if(!/^https:\/\/[a-z\d.-]+(?::443)?$/i.test(backend)&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(backend)){
 console.error('Usage: node scripts/device-agent.mjs --backend https://YOUR-BACKEND --code AAAAAA-BBBBBB');process.exit(1)
}
if(code&&!/^[A-Z2-9]{6}-[A-Z2-9]{6}$/.test(code)){console.error('Invalid pairing code');process.exit(1)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let identity=null;try{identity=JSON.parse(await readFile(statePath,'utf8'))}catch{}
if(identity?.backend!==backend)identity=null;
async function call(endpoint,{method='GET',body,asBinary=false,auth=identity?.deviceToken,timeout=30_000}={}){
 const response=await fetch(backend+endpoint,{method,headers:{...(auth?{authorization:`Bearer ${auth}`}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${(await response.text()).slice(0,120)}`);
 return asBinary?Buffer.from(await response.arrayBuffer()):response.json();
}
if(code){
 const result=await call('/api/agent/enroll',{method:'POST',body:{code,name:deviceName},auth:''});
 identity={backend,deviceId:result.deviceId,deviceToken:result.deviceToken};
 await mkdir(path.dirname(statePath),{recursive:true,mode:0o700});
 await writeFile(statePath,JSON.stringify(identity),{mode:0o600});await chmod(statePath,0o600);
 console.log('Device paired. Secret saved only on the device. Revoke from the website if compromised.');
}
if(!identity){console.error('Pair first using --code.');process.exit(1)}
await mkdir(workspaceRoot,{recursive:true,mode:0o700});
const cliHelp=spawnSync(cli,['--help'],{encoding:'utf8',timeout:6000});
const available=!cliHelp.error;
const help=((cliHelp.stdout||'')+'\n'+(cliHelp.stderr||'')).slice(0,20000);
const supports={headless:/--headless\b/.test(help),events:/--events\b/.test(help),provider:/--provider\b/.test(help),model:/--model\b/.test(help)};
let version='unavailable';if(available){const v=spawnSync(cli,['--version'],{encoding:'utf8',timeout:4000});version=String(v.stdout||v.stderr||'installed').trim().split('\n')[0].slice(0,110)}
await call('/api/agent/status',{method:'POST',body:{platform:`${platform()} ${release()}`.slice(0,110),cliVersion:version,capabilities:{chat:available,terminal:true,files:true,stdin:true,providerFlags:supports.provider,modelFlags:supports.model}}});
console.log(`WROSECODE Device Bridge v2: ${deviceName} (${platform()})`);
console.log(`Backend: ${backend} · Workspace: ${workspaceRoot} · CLI: ${available?version:'NOT INSTALLED'}`);
console.log('Sensitive terminal/file operations require LOCAL approval. No auto-approve mode. Ctrl+C to disconnect.');
let stopped=false;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
async function message(jobId,text){for(let offset=0;offset<String(text).length;offset+=4800){await call(`/api/agent/jobs/${jobId}/log`,{method:'POST',body:{text:String(text).slice(offset,offset+4800)}})}}
async function permission(jobId,summary,decision){await call(`/api/agent/jobs/${jobId}/permission`,{method:'POST',body:{summary:summary.slice(0,280),decision}}).catch(e=>console.error('Approval event:',e.message))}
async function approved(job,summary){await permission(job.id,summary,'pending');const yes=await requestLocalApproval(summary);await permission(job.id,summary,yes?'approved':'denied');return yes}
async function cliJob(job,isCancelled){
 if(!available){await message(job.id,'Installed WROSECODE CLI not found. Set WROSECODE_BIN to the local executable.');return 127}
 const folder=path.join(workspaceRoot,'sessions',job.sessionId||'default');await mkdir(folder,{recursive:true,mode:0o700});
 let artifact='';if(job.kind==='ctf'){
  const data=await call(`/api/agent/jobs/${job.id}/artifact`,{asBinary:true,timeout:90_000});
  if(data.length>16*1024*1024)throw Error('Artifact exceeds size limit');
  const challengeDir=path.join(workspaceRoot,'ctf',job.id);await mkdir(challengeDir,{recursive:true,mode:0o700});
  artifact=path.join(challengeDir,'challenge.bin');await writeFile(artifact,data,{mode:0o600});
 }
 // For CLI builds without native resume, replay only bounded conversation history.
 const history=Array.isArray(job.history)?job.history.filter(v=>['user','assistant'].includes(v.role)&&typeof v.content==='string').slice(-6):[];
 const prior=history.length?`\nRecent conversation (reference only):\n${history.map(h=>`${h.role}: ${h.content.slice(0,1600)}`).join('\n').slice(0,6500)}\n` :'';
 const prompt=job.kind==='ctf'?`/ctf Analyze the authorized local challenge artifact at ${artifact}. Goal: ${(job.prompt||'Investigate and report evidence').slice(0,3500)}. Mark flags UNVERIFIED unless platform verified.`:`${prior}\nUser request:\n${job.prompt}`;
 const args=[];
 if(supports.headless)args.push('--headless');
 if(supports.headless&&supports.events)args.push('--events','-');
 if(job.provider&&supports.provider)args.push('--provider',job.provider);
 if(job.model&&supports.model)args.push('--model',job.model);
 args.push(prompt);
 await message(job.id,`[CLI] Starting ${job.kind} using local WROSECODE. Session workspace: ${folder}`);
 let code=1;
 try{
  code=await new Promise(resolve=>{
   const child=spawn(cli,args,{cwd:folder,env:{...process.env,NO_COLOR:'1'},stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
   let finished=false,tail='',chain=Promise.resolve(),received=0;
   const sendLine=line=>{if(line.trim())chain=chain.then(()=>message(job.id,line)).catch(e=>console.warn('Output delivery:',e.message))};
   const consume=buf=>{
    received+=buf.length;if(received>2_000_000){child.kill('SIGTERM');sendLine('[bridge] Output limit exceeded');return}
    tail+=buf.toString('utf8');let i;
    while((i=tail.indexOf('\n'))!==-1){sendLine(tail.slice(0,i));tail=tail.slice(i+1)}
    if(tail.length>4800){sendLine(tail.slice(0,4800));tail=tail.slice(4800)}
   };
   child.stdout.on('data',consume);child.stderr.on('data',consume);
   const inputPoll=setInterval(async()=>{
    try{if(isCancelled()){child.kill('SIGTERM');return}
     const r=await call(`/api/agent/jobs/${job.id}/inputs`,{timeout:8000});
     for(const item of r.inputs||[])if(!child.stdin.destroyed)child.stdin.write(item.text+'\n');
    }catch{}
   },1000);inputPoll.unref();
   const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),4000).unref()},600_000);timer.unref();
   child.on('error',e=>sendLine('CLI error: '+e.message));
   child.on('close',async(exit,signal)=>{if(finished)return;finished=true;clearTimeout(timer);clearInterval(inputPoll);if(tail.trim())sendLine(tail);await chain;resolve(exit??(signal?130:1))});
  });
 }finally{if(artifact)await unlink(artifact).catch(()=>{})}
 return code;
}
async function perform(job){
 let done=false;const isCancelled=()=>stopped||done;
 const statusPoll=setInterval(async()=>{try{const s=await call(`/api/agent/jobs/${job.id}/status`,{timeout:7000});if(s.status==='cancelled')done=true}catch{}},1400);statusPoll.unref();
 let exitCode=1;
 try{
  if(job.kind==='chat'||job.kind==='ctf'){
   exitCode=await cliJob(job,isCancelled);
  }else if(job.kind==='terminal'||job.kind==='file'){
   const operation=job.request||{};
   if(job.kind==='terminal'&&operation.op!=='terminal')throw Error('Invalid terminal request');
   if(job.kind==='file'&&!['read','write','list'].includes(operation.op))throw Error('Invalid file request');
   const summary=job.kind==='terminal'?`Terminal command in ${workspaceRoot}: ${operation.command}`:`${operation.op.toUpperCase()} ${operation.path} in ${workspaceRoot}`;
   if(!await approved(job,summary)){await message(job.id,'Denied: operator did not approve on the local device.');exitCode=126}
   else if(done){exitCode=130}
   else if(job.kind==='terminal')exitCode=await runTerminal(workspaceRoot,operation.command,text=>message(job.id,text),isCancelled);
   else{await fileOperation(workspaceRoot,operation,text=>message(job.id,text));exitCode=0}
  }else throw Error('Unsupported job type');
 }catch(e){await message(job.id,'Device error: '+String(e.message).slice(0,250)).catch(()=>{})}
 finally{clearInterval(statusPoll)}
 try{await call(`/api/agent/jobs/${job.id}/complete`,{method:'POST',body:{exitCode}})}catch(e){console.warn('Completion:',e.message)}
}
let retry=3000;
while(!stopped){
 try{
  const result=await call('/api/agent/poll',{timeout:15_000});retry=3000;
  if(result.job)await perform(result.job);else await sleep(3000);
 }catch(e){
  const msg=String(e.message);
  if(msg.includes('HTTP 401')){console.error('Device token revoked. Re-pair from the website.');break}
  console.warn('Connection interrupted (retrying):',msg.slice(0,160));await sleep(retry);retry=Math.min(30_000,retry*2);
 }
}
console.log('Companion stopped.');
