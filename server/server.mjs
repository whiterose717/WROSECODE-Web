import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, createWriteStream } from 'node:fs';
import { stat, readFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = {
  host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || '8787'),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  baseUrl: (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '8787'}`).replace(/\/$/,''),
  bridge: process.env.BRIDGE_MODE || 'disabled',
  binary: process.env.WROSECODE_BIN || 'wrosecode',
  signup: process.env.SIGNUP_MODE || 'closed',
  allowMembers: process.env.ALLOW_MEMBER_JOBS === '1' && process.env.I_ACCEPT_SHARED_CLI_RISK === 'yes',
  maxJobs: Math.min(Math.max(Number(process.env.MAX_CONCURRENT_JOBS || 2),1),6),
  maxUpload: 16 * 1024 * 1024,
  maxSeconds: Math.min(Math.max(Number(process.env.MAX_JOB_SECONDS || 300),30),1800),
  oauthGoogleId: process.env.GOOGLE_CLIENT_ID || '', oauthGoogleSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  oauthGithubId: process.env.GITHUB_CLIENT_ID || '', oauthGithubSecret: process.env.GITHUB_CLIENT_SECRET || '',
};
if (!['disabled','mock','cli'].includes(CONFIG.bridge)) throw Error('BRIDGE_MODE must be disabled, mock or cli');
if (!Number.isInteger(CONFIG.port) || CONFIG.port < 1 || CONFIG.port > 65535) throw Error('Invalid PORT');
mkdirSync(CONFIG.dataDir,{recursive:true,mode:0o700});
const db = new DatabaseSync(path.join(CONFIG.dataDir,'wrosecode-web.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass_hash TEXT,role TEXT NOT NULL DEFAULT 'member', approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,provider_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(provider,provider_id));
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_flows(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,link_user_id TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,prompt TEXT,provider TEXT,model TEXT,created_at INTEGER NOT NULL,finished_at INTEGER,artifact_id TEXT,exit_code INTEGER);
CREATE TABLE IF NOT EXISTS job_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job_id,seq));
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,filename TEXT NOT NULL,filepath TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL);`);
if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='link_user_id'))db.exec('ALTER TABLE oauth_flows ADD COLUMN link_user_id TEXT');
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
db.prepare('UPDATE jobs SET status = ? WHERE status IN (?,?,?)').run('interrupted','queued','running','cancelling');
const liveJobs = new Map();
let activeCount=0;const waitQueue=[];
const now=()=>Date.now();
const id=()=>crypto.randomUUID();
const rand=()=>crypto.randomBytes(32).toString('base64url');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const emailOK=s=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const constantEq=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const hashPass=p=>{const salt=crypto.randomBytes(16);return 'scrypt$'+salt.toString('hex')+'$'+crypto.scryptSync(p,salt,64).toString('hex')};
const verifyPass=(pass,stored)=>{try {const [tag,salt,hash]=stored.split('$');if(tag!=='scrypt')return false;return constantEq(crypto.scryptSync(pass,Buffer.from(salt,'hex'),64).toString('hex'),hash)}catch{return false}};
const cookieMap=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(p=>p.trim()).filter(x=>x.includes('=')).map(x=>{let i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
const https=CONFIG.baseUrl.startsWith('https://');
function setCookie(res,name,val,maxAge=604800, httpOnly=true){res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie')||[]),`${name}=${encodeURIComponent(val)}; Path=/; SameSite=Lax; ${httpOnly?'HttpOnly; ':''}${https?'Secure; ':''}Max-Age=${maxAge}`])}
function userFor(req){const token=cookieMap(req).wrose_session;if(!token)return null;const user=db.prepare('SELECT users.id,users.email,users.role,users.approved FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id_hash=? AND sessions.expires_at>?').get(sha(token),now());return user||null}
function publicUser(user){return user?{id:user.id,email:user.email,role:user.role,approved:!!user.approved,canRun:CONFIG.bridge!=='disabled'&&(user.role==='owner'||(user.approved&&CONFIG.allowMembers))}:null}
function send(res,status,obj){if(res.writableEnded)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
function error(res,status,message){send(res,status,{error:message})}
async function readBody(req,max=20_000){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>max)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk)}return Buffer.concat(chunks)}
async function jsonBody(req){const buf=await readBody(req);try{return JSON.parse(buf.toString('utf8'))}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}}
const canRun=u=>u&&(u.role==='owner'||(u.approved&&CONFIG.allowMembers))&&CONFIG.bridge!=='disabled';
const ipCount=new Map();
function rateLimited(req){const key=req.socket.remoteAddress||'unknown';const t=now();const recent=(ipCount.get(key)||[]).filter(x=>t-x<60_000);if(recent.length>=40)return true;recent.push(t);ipCount.set(key,recent);return false}
function safeOrigin(req){const o=req.headers.origin;if(!o)return true;return o===CONFIG.baseUrl}
const secrets=/(bearer\s+)\S+|((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|authorization|cookie|password|signature|auth_user_id)\s*[:=]\s*)[^\s&"']+|(https?:\/\/[^\s?#]+\?)[^\s#]+|\b(?:sk-[\w-]{12,}|ghp_[\w-]{12,}|github_pat_[\w-]{12,})\b/gi;
function scrub(s){return String(s).replace(secrets,(m,p1,p2,p3)=>p1?p1+'[REDACTED]':p2?p2+'[REDACTED]':p3?p3+'[REDACTED QUERY]':'[REDACTED]') .replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').slice(0,6000)}
function addEvent(job,type,data){const running=liveJobs.get(job.id);if(type==='log'&&running&&running.logCount++>700)return;const seq=running?(++running.seq):(db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM job_events WHERE job_id=?').get(job.id).n);const sanitized={...data};if(typeof sanitized.text==='string')sanitized.text=scrub(sanitized.text);db.prepare('INSERT INTO job_events(job_id,seq,type,payload) VALUES(?,?,?,?)').run(job.id,seq,type,JSON.stringify(sanitized));if(running){for(const s of running.listeners)try{s.write(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(sanitized)}\n\n`)}catch{}}}
const allowedTypes=new Set(['status','log','done','candidate']);
function announce(job,status,extra={}){db.prepare('UPDATE jobs SET status=?,finished_at=CASE WHEN ? IN (?,?,?) THEN ? ELSE finished_at END WHERE id=?').run(status,status,'completed','failed','cancelled',now(),job.id);addEvent(job,'status',{status,...extra})}
function normalizeCliEvent(line){try{const j=JSON.parse(line);if(j&&typeof j==='object'){let type=j.type||j.event||'log';if(type==='text' ||type==='step' ||type==='result')return {type:'log',text:String(j.text||j.message||j.output||JSON.stringify(j)).slice(0,4000)};return {type:'log',text:JSON.stringify(j)}}}catch{}return{type:'log',text:line}}
function scanCandidates(job,value){const run=liveJobs.get(job.id);if(!run)return;for(const m of String(value).matchAll(/\b(?:HTB|flag|CTF|picoCTF)\{[^}\r\n]{3,180}\}/gi)){const flag=m[0];if(run.candidates.has(flag)||run.candidates.size>=20)continue;run.candidates.add(flag);addEvent(job,'candidate',{value:flag,verification:'unverified',source:'CLI output pattern',notice:'Requires reproducible or challenge-authority validation.'})}}
function consumeStream(job,stream){let pending='';stream.on('data',chunk=>{pending+=chunk.toString('utf8');if(pending.length>16_384){addEvent(job,'log',{text:pending.slice(0,8192)});pending=''}let pos;while((pos=pending.indexOf('\n'))!==-1){const line=pending.slice(0,pos);pending=pending.slice(pos+1);if(line.trim()){const o=normalizeCliEvent(line);addEvent(job,'log',{text:o.text});scanCandidates(job,o.text)}}});stream.on('end',()=>{if(pending.trim()){addEvent(job,'log',{text:pending.slice(0,4000)});scanCandidates(job,pending)}})}
function cliEnvironment(){return Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(?:ADMIN_|GOOGLE_CLIENT_|GITHUB_CLIENT_|OAUTH_|I_ACCEPT_SHARED_CLI_RISK$|SIGNUP_MODE$)/i.test(key)).concat([['NO_COLOR','1']]))}
async function executeJob(job){activeCount++;const runtime=liveJobs.get(job.id)||{seq:db.prepare('SELECT COALESCE(MAX(seq),0) as n FROM job_events WHERE job_id=?').get(job.id).n,listeners:new Set(),process:null,stop:false,logCount:0,candidates:new Set()};liveJobs.set(job.id,runtime);announce(job,'running');
let code=-1;try{if(CONFIG.bridge==='mock'){
  const words=job.kind==='ctf'?['Verifying authorized challenge scope','Inspecting artifact metadata','Generating evidence-driven hypotheses','Flag candidates require independent verification']:['Reading task request','Selecting next action','Evaluating results'];
  for(const msg of words){if(runtime.stop)break;await new Promise(r=>setTimeout(r,220));addEvent(job,'log',{text:`[MOCK] ${msg}`})}
  code=runtime.stop?130:0;
}else{
  let args,wd=path.join(CONFIG.dataDir,'workspaces',job.user_id);await mkdir(wd,{recursive:true,mode:0o700});
  if(job.kind==='ctf'){
    const a=db.prepare('SELECT * FROM artifacts WHERE id=? AND user_id=?').get(job.artifact_id,job.user_id);
    if(!a||!a.filepath.startsWith(path.join(CONFIG.dataDir,'workspaces')+path.sep))throw Error('Artifact not found');
    args=['ctf',a.filepath,'--budget',`steps=40,seconds=${CONFIG.maxSeconds}`];
  }else{args=['--headless','--events','-','--permission','auto-safe','--max-wall-time',String(CONFIG.maxSeconds)];if(job.provider)args.push('--provider',job.provider);if(job.model)args.push('--model',job.model);args.push(job.prompt)}
  await new Promise((resolve,reject)=>{const child=spawn(CONFIG.binary,args,{cwd:wd,env:cliEnvironment(),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});runtime.process=child;
    consumeStream(job,child.stdout);consumeStream(job,child.stderr);
    const timeout=setTimeout(()=>{runtime.stop=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1500).unref()},CONFIG.maxSeconds*1000);
    child.once('error',e=>{clearTimeout(timeout);reject(e)});child.once('close',c=>{clearTimeout(timeout);code=c??1;resolve()})});
}
 }catch(e){addEvent(job,'log',{text:`Execution error: ${e.message}`});code=1}
  const status=runtime.stop?'cancelled':code===0?'completed':'failed';db.prepare('UPDATE jobs SET exit_code=? WHERE id=?').run(code,job.id);announce(job,status,{exitCode:code});addEvent(job,'done',{status,exitCode:code,verified:false,notice:'A successful run is not independent CTF flag verification.'});for(const s of runtime.listeners){try{s.end()}catch{}}liveJobs.delete(job.id);activeCount--;schedule();
}
function schedule(){while(activeCount<CONFIG.maxJobs&&waitQueue.length){const job=waitQueue.shift();executeJob(job).catch(()=>{})}}
function sessionFor(res,user){const token=rand();db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),user.id,now()+7*86400000);setCookie(res,'wrose_session',token);return publicUser(user)}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function staticFile(req,res,urlPath){let name=urlPath==='/'?'index.html':decodeURIComponent(urlPath).slice(1);if(name.includes('..')||name.includes('\\')||!/^([\w.\/-]+)$/.test(name))return error(res,404,'Not found');if(name.startsWith('server/')||name.startsWith('data/')||name.startsWith('tests/')||name.startsWith('scripts/')||name.startsWith('.')||name.startsWith('node_modules/'))return error(res,404,'Not found');const full=path.resolve(ROOT,name);if(!full.startsWith(ROOT+path.sep))return error(res,404,'Not found');try{const file=await readFile(full);res.writeHead(200,{'content-type':mime[path.extname(full)]||'application/octet-stream','cache-control':'public, max-age=600','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:file)}catch{error(res,404,'Not found')}}
const oauthSpecs={google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',identity:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid email profile'},github:{auth:'https://github.com/login/oauth/authorize',token:'https://github.com/login/oauth/access_token',identity:'https://api.github.com/user',scope:'read:user user:email'}};
async function tokenFetch(url,opt){const controller=new AbortController();const t=setTimeout(()=>controller.abort(),12000);try{const res=await fetch(url,{...opt,signal:controller.signal,headers:{'user-agent':'WROSECODE-web-console/1.0',...opt.headers}});if(!res.ok)throw Error('OAuth provider request failed');return res.json()}finally{clearTimeout(t)}}
async function oauthCallback(provider,u,req,res){const state=u.searchParams.get('state')||'', flow=cookieMap(req).wrose_oauth||'';if(!constantEq(state,flow))return error(res,400,'OAuth state mismatch');const record=db.prepare('SELECT * FROM oauth_flows WHERE state_hash=? AND provider=? AND expires_at>?').get(sha(state),provider,now());db.prepare('DELETE FROM oauth_flows WHERE state_hash=?').run(sha(state));setCookie(res,'wrose_oauth','',0);if(!record||!u.searchParams.get('code'))return error(res,400,'OAuth flow expired');const cfg=oauthSpecs[provider];const clientId=provider==='google'?CONFIG.oauthGoogleId:CONFIG.oauthGithubId;const secret=provider==='google'?CONFIG.oauthGoogleSecret:CONFIG.oauthGithubSecret;
const token=await tokenFetch(cfg.token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({client_id:clientId,client_secret:secret,code:u.searchParams.get('code'),redirect_uri:CONFIG.baseUrl+`/api/oauth/${provider}/callback`,grant_type:'authorization_code',code_verifier:record.verifier})});if(!token.access_token)throw Error('OAuth token missing');
const headers={authorization:`Bearer ${token.access_token}`,accept:'application/json'};const identity=await tokenFetch(cfg.identity,{headers});let email=identity.email;let verified=provider==='google'&&identity.email_verified===true;
if(provider==='github'){const emails=await tokenFetch('https://api.github.com/user/emails',{headers});const primary=emails.find(e=>e.primary&&e.verified);email=primary?.email;verified=!!primary}
if(!emailOK(email)||!verified)throw Error('A verified email is required');email=email.toLowerCase();const rawProviderId=identity.id||identity.sub;if(!rawProviderId)throw Error('Provider identity missing');const providerId=String(rawProviderId);let user=db.prepare('SELECT * FROM users WHERE id=(SELECT user_id FROM identities WHERE provider=? AND provider_id=?)').get(provider,providerId);
if(record.link_user_id){const existing=db.prepare('SELECT * FROM users WHERE id=?').get(record.link_user_id);if(!existing||existing.email!==email||user&&user.id!==existing.id)throw Error('OAuth identity cannot be linked to this account');user=existing;db.prepare('INSERT OR IGNORE INTO identities(provider,provider_id,user_id) VALUES(?,?,?)').run(provider,providerId,user.id)}
else if(!user){if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return res.writeHead(302,{location:'/login.html?error=link_required'}).end();if(CONFIG.signup!=='open')return res.writeHead(302,{location:'/login.html?error=signup_closed'}).end();const uid=id();db.prepare('INSERT INTO users(id,email,pass_hash,role,approved,created_at) VALUES(?,?,?,?,?,?)').run(uid,email,null,'member',0,now());user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);db.prepare('INSERT INTO identities(provider,provider_id,user_id) VALUES(?,?,?)').run(provider,providerId,user.id)}
sessionFor(res,user);res.writeHead(302,{location:'/console.html'}).end()}

export function createServer(){return http.createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');res.setHeader('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com https://github.com");
  try{
    const url=new URL(req.url,'http://localhost');const p=url.pathname;const method=req.method;
    if(p==='/api/health'&&method==='GET')return send(res,200,{ok:true,bridge:CONFIG.bridge,readyForLiveAgent:CONFIG.bridge==='cli',time:new Date().toISOString()});
    if(method==='POST'&&!safeOrigin(req))return error(res,403,'Invalid origin');
    if(p==='/api/config'&&method==='GET')return send(res,200,{bridge:CONFIG.bridge,signup:CONFIG.signup,google:!!(CONFIG.oauthGoogleId&&CONFIG.oauthGoogleSecret),github:!!(CONFIG.oauthGithubId&&CONFIG.oauthGithubSecret),baseUrl:CONFIG.baseUrl});
    if(p==='/api/auth/register'&&method==='POST'){
      if(rateLimited(req))return error(res,429,'Try again later');if(CONFIG.signup!=='open')return error(res,403,'Registration disabled. Ask the owner to invite you.');const {email,password}=await jsonBody(req);if(!emailOK(email)||typeof password!=='string'||password.length<12||password.length>200)return error(res,400,'Use a valid email and password of 12–200 characters');if(db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))return error(res,409,'Account already exists');const uid=id();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(uid,email.toLowerCase(),hashPass(password),'member',0,now());return send(res,201,{message:'Account created. The owner must approve execution access.'});
    }
    if(p==='/api/auth/login'&&method==='POST'){
      if(rateLimited(req))return error(res,429,'Try again later');const {email,password}=await jsonBody(req);const user=typeof email==='string'?db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()):null;if(typeof password!=='string'||!user?.pass_hash||!verifyPass(password,user.pass_hash))return error(res,401,'Invalid email or password');return send(res,200,{user:sessionFor(res,user)});
    }
    if(p.startsWith('/api/oauth/')&&method==='GET'){
      const parts=p.split('/');const provider=parts[3],callback=parts[4];const cfg=oauthSpecs[provider];if(!cfg)return error(res,404,'Unknown provider');const clientId=provider==='google'?CONFIG.oauthGoogleId:CONFIG.oauthGithubId;const secret=provider==='google'?CONFIG.oauthGoogleSecret:CONFIG.oauthGithubSecret;if(!clientId||!secret)return error(res,503,'OAuth provider not configured');
      if(callback==='callback')return await oauthCallback(provider,url,req,res);
      if(callback)return error(res,404,'Not found');const state=rand(),verifier=rand();db.prepare('INSERT INTO oauth_flows(state_hash,provider,verifier,expires_at,link_user_id) VALUES(?,?,?,?,?)').run(sha(state),provider,verifier,now()+10*60000,userFor(req)?.id||null);setCookie(res,'wrose_oauth',state,600);const params={client_id:clientId,redirect_uri:CONFIG.baseUrl+`/api/oauth/${provider}/callback`,scope:cfg.scope,state};if(provider==='google'){params.response_type='code';params.code_challenge_method='S256';params.code_challenge=crypto.createHash('sha256').update(verifier).digest('base64url');params.access_type='online'}const target=cfg.auth+'?'+new URLSearchParams(params).toString();return res.writeHead(302,{location:target}).end();
    }
    const user=userFor(req);
    if(p==='/api/me'&&method==='GET')return send(res,200,{user:publicUser(user)});
    if(p==='/api/auth/logout'&&method==='POST'){const tok=cookieMap(req).wrose_session;if(tok)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha(tok));setCookie(res,'wrose_session','',0);return send(res,200,{ok:true})}
    if(p.startsWith('/api/')){
      if(!user)return error(res,401,'Log in to continue');
      if(p==='/api/providers'&&method==='GET'){
        if(!canRun(user))return error(res,403,'Execution access not approved');
        if(CONFIG.bridge==='mock')return send(res,200,{raw:'MOCK MODE — no real provider connection',providers:[],mock:true});
        let raw='';try{const p=spawn(CONFIG.binary,['providers','list'],{shell:false,stdio:['ignore','pipe','pipe'],env:cliEnvironment()});await new Promise(resolve=>{const timeout=setTimeout(()=>p.kill('SIGKILL'),5000);p.stdout.on('data',d=>{if(raw.length<12_000)raw+=d.toString('utf8')});p.on('error',()=>{clearTimeout(timeout);resolve()});p.on('close',()=>{clearTimeout(timeout);resolve()})})}catch{}const providerLines=scrub(raw).split('\n').filter(line=>line.length<=180&&!/(?:api[_-]?key|password|secret|token|cookie|authorization|bearer|\[REDACTED|https?:\/\/)/i.test(line)).slice(0,40).join('\n');return send(res,200,{raw:providerLines,note:'Filtered provider names/status only; credential-like lines are removed.'});
      }
      if(p==='/api/jobs'&&method==='GET'){const jobs=db.prepare('SELECT id,kind,status,created_at,finished_at,exit_code FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(user.id);return send(res,200,{jobs})}
      if(p==='/api/jobs'&&method==='POST'){
        if(!canRun(user))return error(res,403,'Execution disabled for this account. Only owner can run CLI by default.');
        if(db.prepare("SELECT COUNT(*) as n FROM jobs WHERE user_id=? AND status IN ('queued','running','cancelling')").get(user.id).n>=2)return error(res,429,'Finish or cancel your other jobs first');
        const b=await jsonBody(req);if(!['chat','ctf'].includes(b.kind))return error(res,400,'Invalid task type');if(b.kind==='chat'&&(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>8000))return error(res,400,'Task must be 1–8000 characters');let artifact=null;if(b.kind==='ctf'){artifact=typeof b.artifactId==='string'?db.prepare('SELECT id FROM artifacts WHERE id=? AND user_id=?').get(b.artifactId,user.id):null;if(!artifact)return error(res,400,'Upload an authorized challenge artifact first')}
        const ident=/^[\w.\/:\-]{1,100}$/;if(b.provider&&!ident.test(b.provider))return error(res,400,'Invalid provider');if(b.model&&!ident.test(b.model))return error(res,400,'Invalid model');const job={id:id(),user_id:user.id,kind:b.kind,status:'queued',prompt:b.kind==='chat'?b.prompt.trim():'',provider:b.provider||'',model:b.model||'',created_at:now(),artifact_id:artifact?.id||null};db.prepare('INSERT INTO jobs(id,user_id,kind,status,prompt,provider,model,created_at,artifact_id) VALUES(?,?,?,?,?,?,?,?,?)').run(job.id,job.user_id,job.kind,job.status,job.prompt,job.provider,job.model,job.created_at,job.artifact_id);liveJobs.set(job.id,{seq:0,listeners:new Set(),process:null,stop:false,logCount:0,candidates:new Set()});addEvent(job,'status',{status:'queued'});waitQueue.push(job);schedule();return send(res,201,{id:job.id,status:'queued'});
      }
      const ev=p.match(/^\/api\/jobs\/([a-f0-9-]+)\/events$/);if(ev&&method==='GET'){
        const job=db.prepare('SELECT id,kind,status FROM jobs WHERE id=? AND user_id=?').get(ev[1],user.id);if(!job)return error(res,404,'Job not found');res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.write(': connected\n\n');const past=db.prepare('SELECT seq,type,payload FROM job_events WHERE job_id=? AND seq>? ORDER BY seq').all(job.id,Number(req.headers['last-event-id']||url.searchParams.get('after')||0)||0);for(const e of past)res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${e.payload}\n\n`);const run=liveJobs.get(job.id);if(run){run.listeners.add(res);res.on('close',()=>run.listeners.delete(res))}else res.end();return;
      }
      const cancel=p.match(/^\/api\/jobs\/([a-f0-9-]+)\/cancel$/);if(cancel&&method==='POST'){
        const job=db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(cancel[1],user.id);if(!job)return error(res,404,'Job not found');const run=liveJobs.get(job.id);if(job.status==='queued'){const i=waitQueue.findIndex(x=>x.id===job.id);if(i!==-1)waitQueue.splice(i,1);announce(job,'cancelled');addEvent(job,'done',{status:'cancelled',exitCode:null,verified:false});if(run){for(const s of run.listeners)try{s.end()}catch{};liveJobs.delete(job.id)}}else if(run&&job.status==='running'){run.stop=true;run.process?.kill('SIGTERM');announce(job,'cancelling')}return send(res,200,{ok:true})
      }
      if(p==='/api/artifacts'&&method==='POST'){
        if(!canRun(user))return error(res,403,'Upload restricted');const filename=url.searchParams.get('filename')||'artifact.bin';if(filename.length>100||!/^[\w.()\- ]+$/.test(filename)||filename==='.'||filename==='..')return error(res,400,'Invalid filename');const artifactId=id(),workspace=path.join(CONFIG.dataDir,'workspaces',user.id,'artifacts');await mkdir(workspace,{recursive:true,mode:0o700});const filepath=path.join(workspace,artifactId+'-'+filename);let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>CONFIG.maxUpload)return error(res,413,'Artifact exceeds 16 MiB');chunks.push(chunk)}if(!size)return error(res,400,'Empty file');const b=Buffer.concat(chunks);await import('node:fs/promises').then(fs=>fs.writeFile(filepath,b,{flag:'wx',mode:0o600}));const digest=sha(b);db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(artifactId,user.id,filename,filepath,size,digest,now());return send(res,201,{id:artifactId,name:filename,size,sha256:digest})
      }
      if(p==='/api/admin/users'&&method==='GET'&&user.role==='owner')return send(res,200,{users:db.prepare('SELECT id,email,role,approved,created_at FROM users ORDER BY created_at DESC LIMIT 200').all()});
      if(p==='/api/admin/approve'&&method==='POST'&&user.role==='owner'){const b=await jsonBody(req);if(typeof b.id!=='string'||typeof b.approved!=='boolean')return error(res,400,'Invalid approval');db.prepare("UPDATE users SET approved=? WHERE id=? AND role='member'").run(b.approved?1:0,b.id);return send(res,200,{ok:true,memberJobsAvailable:CONFIG.allowMembers})}
      return error(res,404,'API route not found')
    }
    if(method==='GET'||method==='HEAD')return await staticFile(req,res,p);
    return error(res,404,'Not found');
  }catch(e){console.error('Request error:',e.message);return error(res,e.status||500,e.status?e.message:'Server error')}
})}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const server=createServer();server.listen(CONFIG.port,CONFIG.host,()=>{console.log(`WROSECODE Web Console: ${CONFIG.baseUrl} (bind ${CONFIG.host}:${CONFIG.port})`);console.log(`Bridge: ${CONFIG.bridge}; member execution: ${CONFIG.allowMembers?'ENABLED / unsafe without isolation':'disabled'}`)})}
