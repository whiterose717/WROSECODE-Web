import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, createWriteStream } from 'node:fs';
import { stat, readFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createDeviceBridge } from './device-bridge.mjs';
import { createAiProviders } from './ai-providers.mjs';
import { createRustBridge } from './rust-bridge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = {
  host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || '8787'),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  baseUrl: (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '8787'}`).replace(/\/$/,''),
  bridge: process.env.BRIDGE_MODE || 'disabled',
  binary: process.env.WROSECODE_BIN || 'wrosecode',
  signup: process.env.SIGNUP_MODE || 'open',
  frontend: (process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || '8787'}`).replace(/\/$/,''),
  allowMembers: process.env.ALLOW_MEMBER_JOBS === '1' && process.env.I_ACCEPT_SHARED_CLI_RISK === 'yes',
  maxJobs: Math.min(Math.max(Number(process.env.MAX_CONCURRENT_JOBS || 2),1),6),
  maxUpload: 16 * 1024 * 1024,
  maxSeconds: Math.min(Math.max(Number(process.env.MAX_JOB_SECONDS || 300),30),1800),
  oauthGoogleId: process.env.GOOGLE_CLIENT_ID || '', oauthGoogleSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  oauthGithubId: process.env.GITHUB_CLIENT_ID || '', oauthGithubSecret: process.env.GITHUB_CLIENT_SECRET || '',
};
if (!['disabled','mock','cli'].includes(CONFIG.bridge)) throw Error('BRIDGE_MODE must be disabled, mock or cli');
if (!Number.isInteger(CONFIG.port) || CONFIG.port < 1 || CONFIG.port > 65535) throw Error('Invalid PORT');
const IS_ENTRYPOINT = process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if (IS_ENTRYPOINT) {
  const probeHost = CONFIG.host === '0.0.0.0' ? '127.0.0.1' : CONFIG.host === '::' ? '::1' : CONFIG.host;
  const occupied = await new Promise(resolve => {
    const probe = net.connect({host:probeHost,port:CONFIG.port});
    probe.setTimeout(700);
    probe.once('connect',()=>{probe.destroy();resolve(true)});
    probe.once('timeout',()=>{probe.destroy();resolve(false)});
    probe.once('error',()=>resolve(false));
  });
  if (occupied) {
    console.error(`WROSECODE Web Console cannot start: ${CONFIG.host}:${CONFIG.port} is already in use. Check the existing service before starting another instance.`);
    process.exit(1);
  }
}
for(const [name,value] of [['PUBLIC_BASE_URL',CONFIG.baseUrl],['FRONTEND_URL',CONFIG.frontend]]){
  let u;try{u=new URL(value)}catch{throw Error(`${name} must be an absolute HTTP(S) URL`)}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error(`${name} must be an absolute HTTP(S) origin without credentials, query or fragment`);
  const loopback=['127.0.0.1','localhost','::1'].includes(u.hostname);
  if(!loopback&&u.protocol!=='https:')throw Error(`${name} must use HTTPS outside loopback`);
}
mkdirSync(CONFIG.dataDir,{recursive:true,mode:0o700});
const db = new DatabaseSync(path.join(CONFIG.dataDir,'wrosecode-web.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass_hash TEXT,role TEXT NOT NULL DEFAULT 'member', approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,provider_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(provider,provider_id));
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_flows(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,link_user_id TEXT,nonce TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,prompt TEXT,provider TEXT,model TEXT,created_at INTEGER NOT NULL,finished_at INTEGER,artifact_id TEXT,exit_code INTEGER);
CREATE TABLE IF NOT EXISTS job_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job_id,seq));
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,filename TEXT NOT NULL,filepath TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at INTEGER NOT NULL);`);
if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='link_user_id'))db.exec('ALTER TABLE oauth_flows ADD COLUMN link_user_id TEXT');
if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='nonce'))db.exec('ALTER TABLE oauth_flows ADD COLUMN nonce TEXT');
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
const crossSite=new URL(CONFIG.frontend).origin!==new URL(CONFIG.baseUrl).origin;
if(crossSite && !https)console.warn('WARNING: Cross-origin auth requires an HTTPS backend. Prefer same-origin access for Safari.');
function setCookie(res,name,val,maxAge=604800, httpOnly=true){res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie')||[]),`${name}=${encodeURIComponent(val)}; Path=/; SameSite=${crossSite&&https?'None':'Lax'}; ${httpOnly?'HttpOnly; ':''}${https?'Secure; ':''}Max-Age=${maxAge}`])}
function userFor(req){const token=cookieMap(req).wrose_session;if(!token)return null;const user=db.prepare('SELECT users.id,users.email,users.role,users.approved FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id_hash=? AND sessions.expires_at>?').get(sha(token),now());return user||null}
function publicUser(user){return user?{id:user.id,email:user.email,role:user.role,approved:!!user.approved,canRun:!!deviceBridge?.activeDevice(user)||CONFIG.bridge!=='disabled'&&(user.role==='owner'||(user.approved&&CONFIG.allowMembers))}:null}
function send(res,status,obj){if(res.writableEnded)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
function error(res,status,message){send(res,status,{error:message})}
async function readBody(req,max=20_000){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>max)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk)}return Buffer.concat(chunks)}
async function jsonBody(req,max=20_000){const buf=await readBody(req,max);try{return JSON.parse(buf.toString('utf8'))}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}}
const canRun=u=>!!u&&(!!deviceBridge?.activeDevice(u)||(u.role==='owner'&&CONFIG.bridge!=='disabled')||(u.approved&&CONFIG.allowMembers&&CONFIG.bridge!=='disabled'));
const canSharedRun=u=>!!u&&CONFIG.bridge!=='disabled'&&(u.role==='owner'||(u.approved&&CONFIG.allowMembers));
const ipCount=new Map();
const authCount=new Map();
function clientAddress(req){const remote=req.socket.remoteAddress||'unknown';if(remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1'){const forwarded=String(req.headers['cf-connecting-ip']||'').trim();if(net.isIP(forwarded))return forwarded}return remote}
function rateLimited(req,max=40){const key=clientAddress(req);const t=now();const recent=(ipCount.get(key)||[]).filter(x=>t-x<60_000);if(recent.length>=max)return true;recent.push(t);ipCount.set(key,recent);return false}
function authRateLimited(req,email=''){const t=now();
  const ipk='auth:'+clientAddress(req);const iparr=(authCount.get(ipk)||[]).filter(x=>t-x<60_000);
  if(iparr.length>=10) return true;iparr.push(t);authCount.set(ipk,iparr);
  if(email){const ek='email:'+String(email).toLowerCase();const earr=(authCount.get(ek)||[]).filter(x=>t-x<60_000);if(earr.length>=10) return true;earr.push(t);authCount.set(ek,earr)}
  return false}
function safeOrigin(req){const o=req.headers.origin;if(!o)return true;return o===CONFIG.baseUrl||o===CONFIG.frontend}
const secrets=/(bearer\s+)\S+|((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|authorization|cookie|password|signature|auth_user_id)\s*[:=]\s*)[^\s&"']+|(https?:\/\/[^\s?#]+\?)[^\s#]+|\b(?:sk-[\w-]{12,}|ghp_[\w-]{12,}|github_pat_[\w-]{12,})\b/gi;
function scrub(s){return String(s).replace(secrets,(m,p1,p2,p3)=>p1?p1+'[REDACTED]':p2?p2+'[REDACTED]':p3?p3+'[REDACTED QUERY]':'[REDACTED]') .replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').slice(0,6000)}
function addEvent(job,type,data){const running=liveJobs.get(job.id);if(type==='log'&&running&&running.logCount++>700)return;const seq=running?(++running.seq):(db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM job_events WHERE job_id=?').get(job.id).n);const sanitized=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='string'?scrub(v):v]));db.prepare('INSERT INTO job_events(job_id,seq,type,payload) VALUES(?,?,?,?)').run(job.id,seq,type,JSON.stringify(sanitized));if(running){for(const s of running.listeners)try{s.write(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(sanitized)}\n\n`)}catch{}}}
const allowedTypes=new Set(['status','log','done','candidate','permission']);
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
async function staticFile(req,res,urlPath){let name=urlPath==='/'?'index.html':decodeURIComponent(urlPath).slice(1);if(name.includes('..')||name.includes('\\')||!/^([\w.\/-]+)$/.test(name))return error(res,404,'Not found');if(name.startsWith('server/')||name.startsWith('data/')||name.startsWith('tests/')||name.startsWith('scripts/')||name.startsWith('.')||name.startsWith('node_modules/')||name.startsWith('dist/')||name.endsWith('.sqlite')||name.endsWith('.md')||name.endsWith('.json'))return error(res,404,'Not found');const full=path.resolve(ROOT,name);if(!full.startsWith(ROOT+path.sep))return error(res,404,'Not found');try{const file=await readFile(full);res.writeHead(200,{'content-type':mime[path.extname(full)]||'application/octet-stream','cache-control':'public, max-age=600','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:file)}catch{error(res,404,'Not found')}}
const oauthSpecs={google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',identity:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid email profile'},github:{auth:'https://github.com/login/oauth/authorize',token:'https://github.com/login/oauth/access_token',identity:'https://api.github.com/user',scope:'read:user user:email'}};
async function tokenFetch(url,opt){const controller=new AbortController();const t=setTimeout(()=>controller.abort(),12000);try{const res=await fetch(url,{...opt,signal:controller.signal,headers:{'user-agent':'WROSECODE-web-console/1.0',...opt.headers}});if(!res.ok)throw Error('OAuth provider request failed');return res.json()}finally{clearTimeout(t)}}
let googleKeys=null,googleKeysAt=0;
async function verifyGoogleIdToken(jwt,clientId,nonce){
  const parts=String(jwt||'').split('.');if(parts.length!==3)throw Error('Google ID token is invalid');
  let head,claims;try{head=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'))}catch{throw Error('Google ID token is invalid')}
  if(head.alg!=='RS256'||typeof head.kid!=='string')throw Error('Google ID token algorithm is not accepted');
  if(!googleKeys||Date.now()-googleKeysAt>60*60_000){const doc=await tokenFetch('https://www.googleapis.com/oauth2/v3/certs');googleKeys=doc.keys||[];googleKeysAt=Date.now()}
  let jwk=googleKeys.find(k=>k.kid===head.kid&&k.kty==='RSA'&&k.use==='sig');
  if(!jwk){const doc=await tokenFetch('https://www.googleapis.com/oauth2/v3/certs');googleKeys=doc.keys||[];googleKeysAt=Date.now();jwk=googleKeys.find(k=>k.kid===head.kid&&k.kty==='RSA'&&k.use==='sig')}
  if(!jwk)throw Error('Google signing key unavailable');
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});
  if(!crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))throw Error('Google ID token signature is invalid');
  const t=Math.floor(Date.now()/1000);
  if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||!Number.isFinite(claims.exp)||claims.exp<=t||!Number.isFinite(claims.iat)||claims.iat>t+60||claims.nonce!==nonce||claims.email_verified!==true)throw Error('Google identity claims are invalid');
  return claims;
}
async function oauthCallback(provider,u,req,res){const state=u.searchParams.get('state')||'', flow=cookieMap(req).wrose_oauth||'';if(!constantEq(state,flow))return error(res,400,'OAuth state mismatch');const record=db.prepare('SELECT * FROM oauth_flows WHERE state_hash=? AND provider=? AND expires_at>?').get(sha(state),provider,now());db.prepare('DELETE FROM oauth_flows WHERE state_hash=?').run(sha(state));setCookie(res,'wrose_oauth','',0);if(!record)return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=oauth_expired'}).end();if(u.searchParams.has('error'))return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=oauth_denied'}).end();if(!u.searchParams.get('code'))return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=oauth_failed'}).end();const cfg=oauthSpecs[provider];const clientId=provider==='google'?CONFIG.oauthGoogleId:CONFIG.oauthGithubId;const secret=provider==='google'?CONFIG.oauthGoogleSecret:CONFIG.oauthGithubSecret;
const token=await tokenFetch(cfg.token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({client_id:clientId,client_secret:secret,code:u.searchParams.get('code'),redirect_uri:CONFIG.baseUrl+`/api/oauth/${provider}/callback`,grant_type:'authorization_code',code_verifier:record.verifier})});if(!token.access_token)throw Error('OAuth token missing');
const headers={authorization:`Bearer ${token.access_token}`,accept:'application/json'};let identity,email,verified=false;
if(provider==='google'){identity=await verifyGoogleIdToken(token.id_token,clientId,record.nonce);email=identity.email;verified=identity.email_verified===true}
else{identity=await tokenFetch(cfg.identity,{headers});const emails=await tokenFetch('https://api.github.com/user/emails',{headers});const primary=emails.find(e=>e.primary&&e.verified);email=primary?.email;verified=!!primary}
if(!emailOK(email)||!verified)throw Error('A verified email is required');email=email.toLowerCase();const rawProviderId=identity.id||identity.sub;if(!rawProviderId)throw Error('Provider identity missing');const providerId=String(rawProviderId);let user=db.prepare('SELECT * FROM users WHERE id=(SELECT user_id FROM identities WHERE provider=? AND provider_id=?)').get(provider,providerId);
if(record.link_user_id){const existing=db.prepare('SELECT * FROM users WHERE id=?').get(record.link_user_id);if(!existing||existing.email!==email||user&&user.id!==existing.id)throw Error('OAuth identity cannot be linked to this account');user=existing;db.prepare('INSERT OR IGNORE INTO identities(provider,provider_id,user_id) VALUES(?,?,?)').run(provider,providerId,user.id)}
else if(!user){if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=link_required'}).end();if(CONFIG.signup!=='open')return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=signup_closed'}).end();const uid=id();db.prepare('INSERT INTO users(id,email,pass_hash,role,approved,created_at) VALUES(?,?,?,?,?,?)').run(uid,email,null,'member',0,now());user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);db.prepare('INSERT INTO identities(provider,provider_id,user_id) VALUES(?,?,?)').run(provider,providerId,user.id)}
sessionFor(res,user);res.writeHead(302,{location:CONFIG.baseUrl+'/console.html'}).end()}

const deviceBridge=createDeviceBridge({db,send,error,jsonBody,addEvent,announce,liveJobs});
const aiProviders=createAiProviders({db,send,error,jsonBody,addEvent,announce,liveJobs});
const rustBridge=createRustBridge({db,send,error,jsonBody,scrub});
export function createServer(){return http.createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');res.setHeader('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com https://github.com");
  try{
    const origin=req.headers.origin;
    if(origin && (origin===CONFIG.frontend||origin===CONFIG.baseUrl)){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-credentials','true');res.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS');res.setHeader('access-control-allow-headers','Content-Type,Authorization');}
    if(req.method==='OPTIONS'){if(!origin||!safeOrigin(req))return error(res,403,'Origin denied');res.writeHead(204);return res.end()}
    const url=new URL(req.url,'http://localhost');const p=url.pathname;const method=req.method;
    if(p==='/api/health'&&method==='GET'){
      let rust={reachable:false};
      try{
        const s=await rustBridge.statusFor({id:'__health__',email:'',role:'owner'});
        rust={reachable:s.reachable,authorized:s.authorized,busy:s.busy,paired_devices:s.paired_devices??null,pending_codes:s.pending_codes??null};
      }catch{}
      const sharedHostCliConfigured=CONFIG.bridge==='cli';
      return send(res,200,{ok:true,bridge:CONFIG.bridge,readyForLiveAgent:sharedHostCliConfigured&&!!rust.reachable&&!!rust.authorized,readyForSharedHostCli:sharedHostCliConfigured&&!!rust.reachable&&!!rust.authorized,sharedHostCliConfigured,perUserDeviceBridgeAvailable:true,rust,wroseUrl:rustBridge.wroseUrl(),tokenConfigured:rustBridge.tokenConfigured(),time:new Date().toISOString()});
    }
    if(['POST','PUT','PATCH','DELETE'].includes(method)&&(!safeOrigin(req)||(cookieMap(req).wrose_session&&!origin)))return error(res,403,'Invalid or missing origin');
    if(p==='/api/config'&&method==='GET')return send(res,200,{bridge:CONFIG.bridge,signup:CONFIG.signup,google:!!(CONFIG.oauthGoogleId&&CONFIG.oauthGoogleSecret),github:!!(CONFIG.oauthGithubId&&CONFIG.oauthGithubSecret),baseUrl:CONFIG.baseUrl,frontendUrl:CONFIG.frontend,crossSite,deviceBridge:true,rust:true,wroseUrl:rustBridge.wroseUrl(),rustTokenConfigured:rustBridge.tokenConfigured()});
    if(p==='/api/auth/register'&&method==='POST'){
      const pre=await jsonBody(req).catch(()=>null);
      if(pre&&authRateLimited(req,pre.email))return error(res,429,'Too many attempts. Try again later');
      if(CONFIG.signup!=='open')return error(res,403,'Registration disabled. Ask the owner to invite you.');const {email,password}=pre||{};if(!emailOK(email)||typeof password!=='string'||password.length<12||password.length>200)return error(res,400,'Use a valid email and password of 12–200 characters');if(db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))return error(res,409,'Account already exists');const uid=id();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(uid,email.toLowerCase(),hashPass(password),'member',0,now());return send(res,201,{message:'Account created. The owner must approve execution access.'});
    }
    if(p==='/api/auth/login'&&method==='POST'){
      const pre=await jsonBody(req).catch(()=>null);
      if(authRateLimited(req,pre?.email))return error(res,429,'Too many attempts. Try again later');const {email,password}=pre||{};const user=typeof email==='string'?db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()):null;if(typeof password!=='string'||!user?.pass_hash||!verifyPass(password,user.pass_hash))return error(res,401,'Invalid email or password');return send(res,200,{user:sessionFor(res,user)});
    }
    if(p.startsWith('/api/oauth/')&&method==='GET'){
      const parts=p.split('/');const provider=parts[3],callback=parts[4];const cfg=oauthSpecs[provider];if(!cfg)return error(res,404,'Unknown provider');const clientId=provider==='google'?CONFIG.oauthGoogleId:CONFIG.oauthGithubId;const secret=provider==='google'?CONFIG.oauthGoogleSecret:CONFIG.oauthGithubSecret;if(!clientId||!secret)return error(res,503,'OAuth provider not configured');
      if(callback==='callback'){try{return await oauthCallback(provider,url,req,res)}catch(e){console.error('OAuth callback failed:',scrub(e.message));return res.writeHead(302,{location:CONFIG.baseUrl+'/login.html?error=oauth_failed'}).end()}}
      if(callback)return error(res,404,'Not found');const state=rand(),verifier=rand(),nonce=rand();db.prepare('INSERT INTO oauth_flows(state_hash,provider,verifier,expires_at,link_user_id,nonce) VALUES(?,?,?,?,?,?)').run(sha(state),provider,verifier,now()+10*60000,userFor(req)?.id||null,nonce);setCookie(res,'wrose_oauth',state,600);const params={client_id:clientId,redirect_uri:CONFIG.baseUrl+`/api/oauth/${provider}/callback`,scope:cfg.scope,state,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};if(provider==='google'){params.response_type='code';params.nonce=nonce;params.access_type='online'}const target=cfg.auth+'?'+new URLSearchParams(params).toString();return res.writeHead(302,{location:target}).end();
    }
    const user=userFor(req);
    if(p==='/api/agent/enroll'&&method==='POST'&&rateLimited(req))return error(res,429,'Pairing rate limited');
    if(p.startsWith('/api/agent/'))return await deviceBridge.handle(req,res,url,user);
    if(p.startsWith('/api/devices'))return await deviceBridge.handle(req,res,url,user);
    if(p.startsWith('/api/ai/'))return await aiProviders.handle(req,res,url,user);
    if(p.startsWith('/api/cli/')){
      if(!user)return error(res,401,'Log in to continue');
      return await rustBridge.handle(req,res,url,user,{canRun,rateLimited,CONFIG});
    }
    if(p==='/api/me'&&method==='GET')return send(res,200,{user:publicUser(user)});
    if(p==='/api/auth/logout'&&method==='POST'){const tok=cookieMap(req).wrose_session;if(tok)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha(tok));setCookie(res,'wrose_session','',0);return send(res,200,{ok:true})}
    if(p.startsWith('/api/')){
      if(!user)return error(res,401,'Log in to continue');
      if(p==='/api/providers'&&method==='GET'){
        if(!canRun(user))return error(res,403,'Execution access not approved');
        if(CONFIG.bridge==='mock')return send(res,200,{raw:'MOCK MODE — no real provider connection',providers:[],mock:true});
        if(!canSharedRun(user))return send(res,200,{raw:'Provider discovery for your paired CLI is device-local and is not available through this companion protocol yet. Use a model ID supported by your CLI, or save a private API provider profile.',providers:[],deviceLocal:true});
        let raw='';try{const p=spawn(CONFIG.binary,['providers','list'],{shell:false,stdio:['ignore','pipe','pipe'],env:cliEnvironment()});await new Promise(resolve=>{const timeout=setTimeout(()=>p.kill('SIGKILL'),5000);p.stdout.on('data',d=>{if(raw.length<12_000)raw+=d.toString('utf8')});p.on('error',()=>{clearTimeout(timeout);resolve()});p.on('close',()=>{clearTimeout(timeout);resolve()})})}catch{}const providerLines=scrub(raw).split('\n').filter(line=>line.length<=180&&!/(?:api[_-]?key|password|secret|token|cookie|authorization|bearer|\[REDACTED|https?:\/\/)/i.test(line)).slice(0,40).join('\n');return send(res,200,{raw:providerLines,note:'Filtered provider names/status only; credential-like lines are removed.'});
      }
      if(p==='/api/jobs'&&method==='GET'){const jobs=db.prepare('SELECT id,kind,status,created_at,finished_at,exit_code FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(user.id);return send(res,200,{jobs})}
      if(p==='/api/jobs'&&method==='POST'){
        if(db.prepare("SELECT COUNT(*) as n FROM jobs WHERE user_id=? AND status IN ('queued','running','cancelling')").get(user.id).n>=2)return error(res,429,'Finish or cancel your other jobs first');
        const b=await jsonBody(req,140_000);
        if(!['chat','ctf','terminal','file'].includes(b.kind))return error(res,400,'Invalid task type');
        const directProfile=(typeof b.providerId==='string'&&b.kind==='chat'&&aiProviders.ownsProfile(user,b.providerId))?b.providerId:null;
        if(!canRun(user)&&!directProfile)return error(res,403,'Pair your own device or configure an AI provider to run tasks.');
        if(b.kind==='chat'&&(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>8000))return error(res,400,'Task must be 1–8000 characters');
        const special=['terminal','file'].includes(b.kind);
        const request=special?deviceBridge.prepareRequest(b.request):null;
        if(special&&(!request||(b.kind==='terminal')!==(request.op==='terminal')))return error(res,400,'Invalid scoped device operation');
        if(directProfile&&special)return error(res,403,'Device required');
        let artifact=null;
        if(b.kind==='ctf'){artifact=typeof b.artifactId==='string'?db.prepare('SELECT id FROM artifacts WHERE id=? AND user_id=?').get(b.artifactId,user.id):null;if(!artifact)return error(res,400,'Upload an authorized challenge artifact first')}
        const ident=/^[\w.\/:\-]{1,100}$/;
        if(b.provider&&!ident.test(b.provider))return error(res,400,'Invalid provider');if(b.model&&!ident.test(b.model))return error(res,400,'Invalid model');
        let target=null;
        if(!directProfile){
          target=deviceBridge.activeDevice(user,typeof b.deviceId==='string'?b.deviceId:undefined);
          if(b.deviceId&&!target)return error(res,404,'Selected device not online or not owned by your account');
          if(special&&!target)return error(res,503,'An online paired device is required for local operations');
        }
        const session=b.kind==='chat'&&!directProfile&&b.sessionId&&target?deviceBridge.sessionFor(user,b.sessionId,target.id):null;
        if(b.kind==='chat'&&!directProfile&&b.sessionId&&!session)return error(res,404,'Device session does not belong to this account and device');
        const job={id:id(),user_id:user.id,kind:b.kind,status:'queued',prompt:b.kind==='chat'?b.prompt.trim():(typeof b.prompt==='string'?b.prompt.trim().slice(0,4000):''),provider:directProfile?'api:'+directProfile:(b.provider||''),model:b.model||'',created_at:now(),artifact_id:artifact?.id||null,device_request:request?JSON.stringify(request):null,device_session_id:session?.id||null};
        db.prepare('INSERT INTO jobs(id,user_id,kind,status,prompt,provider,model,created_at,artifact_id,device_request,device_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id,job.user_id,job.kind,job.status,job.prompt,job.provider,job.model,job.created_at,job.artifact_id,job.device_request,job.device_session_id);
        liveJobs.set(job.id,{seq:0,listeners:new Set(),process:null,stop:false,logCount:0,candidates:new Set()});addEvent(job,'status',{status:'queued'});
        if(directProfile){aiProviders.runChat(job,user,directProfile,typeof b.sessionId==='string'?b.sessionId:'').catch(e=>console.error('AI task failed:',scrub(e.message)))}
        else if(target?deviceBridge.routeJob(job,user,target.id):!special&&canSharedRun(user)){
          if(!target){waitQueue.push(job);schedule()}
        }else if(!special&&canSharedRun(user)){waitQueue.push(job);schedule()}
        else{db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(job.id);liveJobs.delete(job.id);return error(res,503,'No paired device is online')}
        return send(res,201,{id:job.id,status:'queued'});
      }
      const input=p.match(/^\/api\/jobs\/([a-f0-9-]+)\/input$/);
      if(input&&method==='POST'){
        const job=db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(input[1],user.id);
        if(!job)return error(res,404,'Job not found');
        const b=await jsonBody(req);
        if(!deviceBridge.queueInput(job,user,b.text))return error(res,409,'Job is not running, device stdin unavailable, or input queue full');
        return send(res,202,{ok:true});
      }
      const ev=p.match(/^\/api\/jobs\/([a-f0-9-]+)\/events$/);if(ev&&method==='GET'){
        const job=db.prepare('SELECT id,kind,status FROM jobs WHERE id=? AND user_id=?').get(ev[1],user.id);if(!job)return error(res,404,'Job not found');res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.write(': connected\n\n');const past=db.prepare('SELECT seq,type,payload FROM job_events WHERE job_id=? AND seq>? ORDER BY seq').all(job.id,Number(req.headers['last-event-id']||url.searchParams.get('after')||0)||0);for(const e of past)res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${e.payload}\n\n`);const run=liveJobs.get(job.id);if(run){run.listeners.add(res);res.on('close',()=>run.listeners.delete(res))}else res.end();return;
      }
      const cancel=p.match(/^\/api\/jobs\/([a-f0-9-]+)\/cancel$/);if(cancel&&method==='POST'){
        const job=db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(cancel[1],user.id);if(!job)return error(res,404,'Job not found');const run=liveJobs.get(job.id);if(deviceBridge.ownsJob(job)){deviceBridge.cancelJob(job);return send(res,200,{ok:true})}if(aiProviders.cancel(job))return send(res,200,{ok:true});if(job.status==='queued'){const i=waitQueue.findIndex(x=>x.id===job.id);if(i!==-1)waitQueue.splice(i,1);announce(job,'cancelled');addEvent(job,'done',{status:'cancelled',exitCode:null,verified:false});if(run){for(const s of run.listeners)try{s.end()}catch{};liveJobs.delete(job.id)}}else if(run&&job.status==='running'){run.stop=true;run.process?.kill('SIGTERM');announce(job,'cancelling')}return send(res,200,{ok:true})
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
  }catch(e){console.error('Request error:',scrub(e.message));return error(res,e.status||500,e.status?e.message:'Server error')}
})}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const server=createServer();server.requestTimeout=30_000;server.headersTimeout=15_000;server.keepAliveTimeout=5_000;
server.on('error',err=>{if(err.code==='EADDRINUSE')console.error(`WROSECODE Web Console cannot start: ${CONFIG.host}:${CONFIG.port} is already in use. Check the existing service before starting another instance.`);else console.error('WROSECODE Web Console server error:',err.message);try{db.close()}catch{}process.exitCode=1});
server.listen(CONFIG.port,CONFIG.host,()=>{console.log(`WROSECODE Web Console: ${CONFIG.baseUrl} (bind ${CONFIG.host}:${CONFIG.port})`);console.log(`Bridge: ${CONFIG.bridge}; member execution: ${CONFIG.allowMembers?'ENABLED / unsafe without isolation':'disabled'}`)});
let stopping=false;
async function shutdown(signal){if(stopping)return;stopping=true;console.log(`WROSECODE Web Console stopping (${signal})`);for(const run of liveJobs.values()){run.stop=true;try{run.abort?.abort()}catch{};try{run.process?.kill('SIGTERM')}catch{};for(const res of run.listeners)try{res.end()}catch{}}const force=setTimeout(()=>process.exit(1),12_000);force.unref();server.close(()=>{clearTimeout(force);try{db.close()}catch{};console.log('WROSECODE Web Console stopped cleanly')});server.closeAllConnections?.()}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
}
