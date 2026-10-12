// WROSECODE Device Bridge v2. Authenticated per-account outbound companion protocol.
// No raw TCP ports and no device tokens are exposed to the web application.
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const now=()=>Date.now();
const ONLINE_MS=90_000;
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const safePath=p=>typeof p==='string'&&p.length<=240&&p.length>0&&!p.includes('\\')&&!p.startsWith('/')&&!p.split('/').includes('..')&&!p.includes('\0')&&!/^[A-Za-z]:/.test(p);

export function createDeviceBridge({db,send,error,jsonBody,addEvent,announce,liveJobs}){
 db.exec(`CREATE TABLE IF NOT EXISTS device_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,last_seen INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_jobs(job_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,claimed_at INTEGER,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_inputs(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,user_id TEXT NOT NULL,device_id TEXT NOT NULL,text TEXT NOT NULL,claimed_at INTEGER);
 `);
 const addColumn=(table,column,type)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)};
 addColumn('devices','platform','TEXT');addColumn('devices','cli_version','TEXT');addColumn('devices','capabilities','TEXT');
 addColumn('jobs','device_request','TEXT');addColumn('jobs','device_session_id','TEXT');
 const online=d=>!!d&&!d.revoked&&d.last_seen>now()-ONLINE_MS;
 const list=user=>db.prepare('SELECT id,name,platform,cli_version,capabilities,last_seen,revoked,created_at FROM devices WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(user.id).map(d=>({...d,online:online(d),capabilities:JSON.parse(d.capabilities||'{}')}));
 const selected=(user,deviceId)=> deviceId ? db.prepare('SELECT id,name,last_seen,revoked FROM devices WHERE id=? AND user_id=? AND revoked=0 AND last_seen>?').get(deviceId,user.id,now()-ONLINE_MS) : db.prepare('SELECT id,name,last_seen,revoked FROM devices WHERE user_id=? AND revoked=0 AND last_seen>? ORDER BY last_seen DESC LIMIT 1').get(user.id,now()-ONLINE_MS);
 const agent=req=>{
  const authorization=req.headers.authorization||'';
  if(!authorization.startsWith('Bearer ')||authorization.length>350)return null;
  return db.prepare('SELECT id,user_id,name,last_seen FROM devices WHERE token_hash=? AND revoked=0').get(sha(authorization.slice(7)));
 };
 const jobFor=(device,jobId)=>db.prepare('SELECT j.* FROM jobs j JOIN device_jobs d ON j.id=d.job_id WHERE j.id=? AND j.user_id=? AND d.device_id=?').get(jobId,device.user_id,device.id);
 function event(job,type,payload){const runtime=liveJobs.get(job.id);if(type==='log'&&runtime&&runtime.logCount++>1000)return;addEvent(job,type,payload)}
 function finish(job,status,exitCode){const runtime=liveJobs.get(job.id);db.prepare('UPDATE jobs SET exit_code=? WHERE id=?').run(exitCode,job.id);announce(job,status,{exitCode});event(job,'done',{status,exitCode,verified:false});
  if(runtime){for(const res of runtime.listeners)try{res.end()}catch{};liveJobs.delete(job.id)}
  db.prepare('DELETE FROM device_inputs WHERE job_id=?').run(job.id);
 }
 function prepareRequest(data){
  if(!data||typeof data!=='object')return null;
  if(data.op==='terminal'){
   if(typeof data.command!=='string'||data.command.trim().length<1||data.command.length>800||/[\x00-\x08\x0e-\x1f]/.test(data.command))return null;
   return {op:'terminal',command:data.command.trim()};
  }
  if(['list','read','write'].includes(data.op)&&safePath(data.path)){
   if(data.op==='write'&&(typeof data.content!=='string'||Buffer.byteLength(data.content,'utf8')>100_000))return null;
   return {op:data.op,path:data.path,...(data.op==='write'?{content:data.content}:{})};
  }
  return null;
 }
 function sessions(user){return db.prepare('SELECT id,title,device_id,created_at,updated_at FROM device_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 50').all(user.id)}
 const handle=async(req,res,url,user)=>{
  const p=url.pathname,m=req.method;
  if(p.startsWith('/api/agent/')){
   if(p==='/api/agent/enroll'&&m==='POST'){
    const b=await jsonBody(req);const code=b.code,name=b.name;
    if(typeof code!=='string'||!/^[A-Z2-9]{6}-[A-Z2-9]{6}$/.test(code)||typeof name!=='string'||!name.trim()||name.length>60)return error(res,400,'Invalid pairing code or device name');
    const info=db.prepare('SELECT user_id FROM device_codes WHERE code_hash=? AND expires_at>?').get(sha(code),now());
    if(!info)return error(res,403,'Invalid or expired pairing code');
    if(db.prepare('DELETE FROM device_codes WHERE code_hash=? AND expires_at>?').run(sha(code),now()).changes!==1)return error(res,403,'Pairing code already used');
    const deviceId=crypto.randomUUID(),deviceToken=token();db.prepare('INSERT INTO devices(id,user_id,name,token_hash,last_seen,created_at) VALUES(?,?,?,?,?,?)').run(deviceId,info.user_id,name.trim(),sha(deviceToken),now(),now());
    return send(res,201,{deviceId,deviceToken,pollIntervalSeconds:3});
   }
   const dev=agent(req);if(!dev)return error(res,401,'Invalid or revoked device token');
   db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(now(),dev.id);
   if(p==='/api/agent/status'&&m==='POST'){
    const b=await jsonBody(req);const str=s=>typeof s==='string'?s.slice(0,120):'';
    const capabilities={chat:!!b?.capabilities?.chat,terminal:!!b?.capabilities?.terminal,files:!!b?.capabilities?.files,stdin:!!b?.capabilities?.stdin,modelFlags:!!b?.capabilities?.modelFlags,providerFlags:!!b?.capabilities?.providerFlags};
    db.prepare('UPDATE devices SET platform=?,cli_version=?,capabilities=?,last_seen=? WHERE id=?').run(str(b.platform),str(b.cliVersion),JSON.stringify(capabilities),now(),dev.id);
    return send(res,200,{ok:true});
   }
   if(p==='/api/agent/poll'&&m==='GET'){
    const running=db.prepare("SELECT j.id FROM jobs j JOIN device_jobs d ON d.job_id=j.id WHERE d.device_id=? AND j.status='running' LIMIT 1").get(dev.id);
    if(running)return send(res,200,{job:null,busy:true});
    const next=db.prepare("SELECT j.* FROM jobs j JOIN device_jobs d ON d.job_id=j.id WHERE d.device_id=? AND j.status='queued' ORDER BY j.created_at LIMIT 1").get(dev.id);
    if(!next)return send(res,200,{job:null});
    if(db.prepare("UPDATE jobs SET status='running' WHERE id=? AND status='queued'").run(next.id).changes!==1)return send(res,200,{job:null});
    db.prepare('UPDATE device_jobs SET claimed_at=?,updated_at=? WHERE job_id=?').run(now(),now(),next.id);
    event(next,'status',{status:'running'});
    const session=next.device_session_id?db.prepare('SELECT id FROM device_sessions WHERE id=? AND user_id=? AND device_id=?').get(next.device_session_id,dev.user_id,dev.id):null;
    const history=session?db.prepare('SELECT role,content FROM device_messages WHERE session_id=? AND user_id=? ORDER BY id DESC LIMIT 8').all(session.id,dev.user_id).reverse():[];
    return send(res,200,{job:{id:next.id,kind:next.kind,prompt:next.prompt,provider:next.provider,model:next.model,hasArtifact:!!next.artifact_id,sessionId:session?.id||null,history,request:next.device_request?JSON.parse(next.device_request):null}});
   }
   const a=p.match(/^\/api\/agent\/jobs\/([a-f0-9-]+)\/(log|complete|artifact|status|inputs|permission)$/);
   if(a){const job=jobFor(dev,a[1]);if(!job)return error(res,404,'Unknown device job');
    const op=a[2];
    if(op==='status'&&m==='GET')return send(res,200,{status:job.status});
    if(op==='inputs'&&m==='GET'){
     const rows=db.prepare('SELECT id,text FROM device_inputs WHERE job_id=? AND device_id=? AND claimed_at IS NULL ORDER BY id LIMIT 20').all(job.id,dev.id);
     for(const row of rows)db.prepare('UPDATE device_inputs SET claimed_at=? WHERE id=?').run(now(),row.id);
     return send(res,200,{inputs:rows});
    }
    if(op==='artifact'&&m==='GET'){
     if(job.kind!=='ctf'||!job.artifact_id)return error(res,404,'Artifact missing');
     const row=db.prepare('SELECT * FROM artifacts WHERE id=? AND user_id=?').get(job.artifact_id,dev.user_id);if(!row)return error(res,404,'Artifact missing');
     const file=await readFile(row.filepath);res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="artifact.bin"','cache-control':'no-store'});return res.end(file);
    }
    if(op==='log'&&m==='POST'){
     if(job.status!=='running')return error(res,409,'Job is no longer running');
     const b=await jsonBody(req);if(typeof b.text!=='string'||b.text.length>6000)return error(res,400,'Invalid log');
     event(job,'log',{text:b.text});
     if(job.kind==='ctf')for(const match of b.text.matchAll(/\b(?:HTB|flag|CTF|picoCTF)\{[^}\r\n]{3,180}\}/gi))event(job,'candidate',{value:match[0],verified:false,source:'agent-output'});
     db.prepare('UPDATE device_jobs SET updated_at=? WHERE job_id=?').run(now(),job.id);
     return send(res,200,{ok:true});
    }
    if(op==='permission'&&m==='POST'){
     if(job.status!=='running')return error(res,409,'Job is no longer running');
     const b=await jsonBody(req);if(typeof b.summary!=='string'||b.summary.length>300||!['pending','approved','denied'].includes(b.decision))return error(res,400,'Invalid permission event');
     event(job,'permission',{summary:b.summary,decision:b.decision,source:'device-local-operator'});return send(res,200,{ok:true});
    }
    if(op==='complete'&&m==='POST'){
     if(job.status!=='running')return error(res,409,'Job is no longer running');
     const b=await jsonBody(req);const exitCode=Number.isSafeInteger(b.exitCode)?b.exitCode:1;
     if(job.kind==='chat'&&job.device_session_id){
      const session=db.prepare('SELECT id FROM device_sessions WHERE id=? AND user_id=? AND device_id=?').get(job.device_session_id,dev.user_id,dev.id);
      if(session){
       db.prepare('INSERT INTO device_messages(session_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)').run(session.id,dev.user_id,'user',job.prompt,now());
       const messages=db.prepare("SELECT payload FROM job_events WHERE job_id=? AND type='log' ORDER BY seq").all(job.id).map(row=>{try{return JSON.parse(row.payload).text||''}catch{return ''}}).join('\n').slice(0,30_000);
       if(messages)db.prepare('INSERT INTO device_messages(session_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)').run(session.id,dev.user_id,'assistant',messages,now());
       db.prepare('UPDATE device_sessions SET updated_at=? WHERE id=?').run(now(),session.id);
      }
     }
     finish(job,exitCode===0?'completed':'failed',exitCode);return send(res,200,{ok:true});
    }
   }
   return error(res,404,'Device endpoint not found');
  }
  if(!p.startsWith('/api/devices'))return false;
  if(!user)return error(res,401,'Log in first');
  if(p==='/api/devices'&&m==='GET')return send(res,200,{devices:list(user)});
  if(p==='/api/devices/pair'&&m==='POST'){
   const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.randomBytes(12);const code=Array.from(bytes,b=>chars[b%chars.length]).join('');const display=code.slice(0,6)+'-'+code.slice(6);
   db.prepare('DELETE FROM device_codes WHERE user_id=? OR expires_at<?').run(user.id,now());db.prepare('INSERT INTO device_codes VALUES(?,?,?)').run(sha(display),user.id,now()+600_000);
   return send(res,201,{code:display,expiresInSeconds:600});
  }
  if(p==='/api/devices/sessions'&&m==='GET')return send(res,200,{sessions:sessions(user)});
  if(p==='/api/devices/sessions'&&m==='POST'){
   const b=await jsonBody(req);if(typeof b.deviceId!=='string'||!selected(user,b.deviceId))return error(res,400,'Select your own online device');
   const title=typeof b.title==='string'?b.title.trim().slice(0,80):'CLI Conversation';const session={id:crypto.randomUUID(),user_id:user.id,device_id:b.deviceId,title:title||'CLI Conversation',created_at:now()};
   db.prepare('INSERT INTO device_sessions VALUES(?,?,?,?,?,?)').run(session.id,user.id,session.device_id,session.title,session.created_at,session.created_at);
   return send(res,201,{session});
  }
  const session=p.match(/^\/api\/devices\/sessions\/([0-9a-f-]+)$/);
  if(session&&m==='GET'){
   const s=db.prepare('SELECT id,title,device_id FROM device_sessions WHERE id=? AND user_id=?').get(session[1],user.id);if(!s)return error(res,404,'Session not found');
   return send(res,200,{session:s,messages:db.prepare('SELECT role,content,created_at FROM device_messages WHERE session_id=? AND user_id=? ORDER BY id DESC LIMIT 40').all(s.id,user.id).reverse()});
  }
  const revoke=p.match(/^\/api\/devices\/([a-f0-9-]+)\/revoke$/);
  if(revoke&&m==='POST'){
   const dev=db.prepare('SELECT id FROM devices WHERE id=? AND user_id=? AND revoked=0').get(revoke[1],user.id);if(!dev)return error(res,404,'Device not found');
   db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(dev.id);
   const jobs=db.prepare("SELECT j.* FROM jobs j JOIN device_jobs d ON d.job_id=j.id WHERE d.device_id=? AND j.status IN ('queued','running')").all(dev.id);
   for(const job of jobs)finish(job,'cancelled',130);
   return send(res,200,{ok:true});
  }
  return error(res,404,'Device endpoint not found');
 };
 const routeJob=(job,user,deviceId)=>{
  const dev=selected(user,deviceId);if(!dev)return false;
  db.prepare('INSERT INTO device_jobs(job_id,device_id,updated_at) VALUES(?,?,?)').run(job.id,dev.id,now());return true;
 };
 const ownsJob=job=>!!db.prepare('SELECT 1 FROM device_jobs WHERE job_id=?').get(job.id);
 const cancelJob=job=>{if(!ownsJob(job))return false;finish(job,'cancelled',130);return true};
 const queueInput=(job,user,text)=>{
  if(job.status!=='running'||job.kind!=='chat'||typeof text!=='string'||!text.trim()||text.length>1500)return false;
  const device=db.prepare('SELECT device_id FROM device_jobs WHERE job_id=?').get(job.id);if(!device)return false;
  if(db.prepare('SELECT COUNT(*) as n FROM device_inputs WHERE job_id=? AND claimed_at IS NULL').get(job.id).n>=10)return false;
  db.prepare('INSERT INTO device_inputs(job_id,user_id,device_id,text) VALUES(?,?,?,?)').run(job.id,user.id,device.device_id,text);
  return true;
 };
 const sessionFor=(user,sessionId,deviceId)=>sessionId?db.prepare('SELECT id FROM device_sessions WHERE id=? AND user_id=? AND device_id=?').get(sessionId,user.id,deviceId):null;
 return {handle,routeJob,activeDevice:selected,devicesFor:list,ownsJob,cancelJob,prepareRequest,queueInput,sessionFor};
}
