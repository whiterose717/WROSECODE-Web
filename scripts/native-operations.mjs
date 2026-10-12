// Explicitly approved device-local operations, always scoped to WROSE_WORKSPACE_ROOT.
// This file is not included in Cloudflare Pages' public build.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';

export function parseArgv(command){
 if(typeof command!=='string'||command.length>800||/[\r\n\0]/.test(command))throw Error('Invalid terminal command');
 let args=[],word='',quote='',inWord=false;
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(quote){if(c===quote){quote='';continue}if(c==='\\'&&command[i+1]===quote){word+=command[++i];continue}word+=c;inWord=true;continue}
  if(c==='"'||c==="'"){quote=c;inWord=true;continue}
  if(/\s/.test(c)){if(inWord){args.push(word);word='';inWord=false}continue}
  // No shell interpretation: $, |, ; and > are ordinary args.
  word+=c;inWord=true;
 }
 if(quote)throw Error('Unclosed quote');if(inWord)args.push(word);
 if(!args.length||args[0].startsWith('-')||args[0].length>180||args.length>80)throw Error('Empty or excessive command');
 return args;
}

export async function scopedPath(root,requested,{allowMissing=false}={}){
 if(typeof requested!=='string'||requested.length>240||requested.startsWith('/')||path.win32.isAbsolute(requested)||requested.includes('\\')||requested.includes('\0')||requested.split('/').includes('..'))throw Error('Path must be relative to the approved workspace');
 const base=await fs.realpath(root);
 const full=path.resolve(base,requested||'.');
 if(full!==base&&!full.startsWith(base+path.sep))throw Error('Path is outside workspace');
 // Resolve all ancestors, excluding symlinks that jump outside root.
 const existing=allowMissing?path.dirname(full):full;
 const actual=await fs.realpath(existing);
 if(actual!==base&&!actual.startsWith(base+path.sep))throw Error('Symlink resolves outside workspace');
 if(allowMissing){try{const st=await fs.lstat(full);if(st.isSymbolicLink())throw Error('Refusing to overwrite symbolic links')}catch(e){if(e.code!=='ENOENT')throw e}}
 return full;
}

export async function requestLocalApproval(summary,{input=process.stdin,output=process.stdout,timeoutMs=30_000}={}){
 if(!input.isTTY)return false;
 const rl=createInterface({input,output});let timer;
 try{
  const answer=await Promise.race([rl.question(`\n[WROSECODE LOCAL APPROVAL]\n${summary}\nAllow ON THIS DEVICE? Type yes (default NO): `),new Promise(resolve=>{timer=setTimeout(()=>resolve(''),timeoutMs);timer.unref?.()})]);
  return String(answer).trim().toLowerCase()==='yes';
 }finally{clearTimeout(timer);rl.close()}
}

export async function fileOperation(root,request,report){
 const {op}=request;if(!['list','read','write'].includes(op))throw Error('Unsupported file operation');
 const target=await scopedPath(root,request.path,{allowMissing:op==='write'});
 if(op==='list'){
  const s=await fs.lstat(target);if(!s.isDirectory())throw Error('Not a directory');
  const all=(await fs.readdir(target,{withFileTypes:true})).slice(0,120).map(f=>`${f.isDirectory()?'[DIR]':f.isSymbolicLink()?'[LINK]':'[FILE]'} ${f.name}`);
  await report(all.join('\n')||'(directory empty)');return;
 }
 if(op==='read'){
  const s=await fs.lstat(target);if(!s.isFile()||s.size>128_000)throw Error('Only regular files up to 128 KB may be read');
  const fd=await fs.open(target,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
  try{const b=await fd.readFile();if(b.includes(0))throw Error('Binary file; use the CLI tool to inspect it locally');await report(b.toString('utf8').slice(0,90_000))}finally{await fd.close()};return;
 }
 if(typeof request.content!=='string'||Buffer.byteLength(request.content,'utf8')>100_000)throw Error('Invalid content');
 const fd=await fs.open(target,constants.O_CREAT|constants.O_WRONLY|constants.O_TRUNC|(constants.O_NOFOLLOW||0),0o600);
 try{await fd.writeFile(request.content)}finally{await fd.close()}
 await report(`Wrote ${Buffer.byteLength(request.content,'utf8')} bytes to ${request.path}`);
}

export async function runTerminal(root,command,report,isCancelled){
 const [executable,...args]=parseArgv(command);
 // No shell, no arbitrary environment injection, and no path outside configured cwd.
 const child=spawn(executable,args,{cwd:root,shell:false,windowsHide:true,env:{...process.env,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let chunks=0,chain=Promise.resolve();const emit=data=>{chunks+=data.length;if(chunks>300_000){child.kill('SIGTERM');return}chain=chain.then(()=>report(data.toString('utf8'))).catch(()=>{})};
 child.stdout.on('data',emit);child.stderr.on('data',emit);
 const watcher=setInterval(()=>{if(isCancelled())child.kill('SIGTERM')},1000);watcher.unref();
 const timeout=setTimeout(()=>child.kill('SIGTERM'),120_000);timeout.unref();
 try{const result=await new Promise(resolve=>{child.once('error',err=>{chain=chain.then(()=>report(`Command error: ${err.message}`)).catch(()=>{});resolve(1)});child.once('close',(code,signal)=>resolve(code??(signal?130:1)))});await chain;return result}
 finally{clearInterval(watcher);clearTimeout(timeout)}
}
