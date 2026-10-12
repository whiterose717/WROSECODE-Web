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
function start(p,dir){return spawn(process.execPath,['server/server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(p),DATA_DIR:dir,PUBLIC_BASE_URL:`http://127.0.0.1:${p}`,FRONTEND_URL:`http://127.0.0.1:${p}`,BRIDGE_MODE:'disabled',SIGNUP_MODE:'open'},stdio:['ignore','pipe','pipe']})}
function closed(child){return new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve)})}

test('port collision exits clearly before touching data, and graceful restart preserves sessions',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wrose-lifecycle-')),p=await port(),base=`http://127.0.0.1:${p}`;
 const holder=net.createServer();await new Promise(resolve=>holder.listen(p,'127.0.0.1',resolve));
 const duplicate=start(p,path.join(dir,'collision-data'));let output='';duplicate.stderr.on('data',d=>output+=d.toString());
 await closed(duplicate);assert.match(output,/already in use/i);assert.equal((await import('node:fs')).existsSync(path.join(dir,'collision-data')),false);
 await new Promise(resolve=>holder.close(resolve));
 let child=start(p,path.join(dir,'persisted-data'));t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await closed(child)}rmSync(dir,{recursive:true,force:true})});await ready(base);
 const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:'restart@example.net',password:'a-safe-restart-test-password'})});assert.equal(register.status,201);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:'restart@example.net',password:'a-safe-restart-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 child.kill('SIGTERM');await closed(child);child=start(p,path.join(dir,'persisted-data'));await ready(base);
 const me=await fetch(base+'/api/me',{headers:{cookie}});assert.equal(me.status,200);assert.equal((await me.json()).user.email,'restart@example.net');
});
