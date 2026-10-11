/* WROSECODE /CTF — self-contained, browser-local inspection demo.
 * No remote requests, target exploitation, scripts, archive extraction, or flag submission.
 * All local inputs and outputs are explicitly labelled as unverified.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAX_FILES = 12;
  const MAX_TOTAL = 48 * 1024 * 1024;
  const MAX_READ = 16 * 1024 * 1024;
  const MAX_TEXT = 2 * 1024 * 1024;
  const MAX_LOG = 24;
  const MAX_FINDINGS = 40;
  const CATEGORIES = ['Forensics', 'Cryptography', 'Web', 'Reverse Engineering', 'Pwn', 'Steganography', 'OSINT', 'Misc'];
  const patterns = {
    'Forensics': [/forensic|pcap|packet|wireshark|network traffic|memory dump|log analys|disk image|volatility|exif|timeline|email header/i, 4],
    'Cryptography': [/cryptograph|cipher|base64|base32|rot13|xor|rsa|aes|vigen[eè]re|encode|decode|hash|modular|substitut/i, 4],
    'Web': [/web app|website|http|xss|sql injection|sqli|csrf|server|cookie|endpoint|html|javascript|php|api|burp/i, 4],
    'Reverse Engineering': [/revers(e|ing)|disassembl|decompil|bytecode|firmware|debug|asm|assembly|function|opcode|malware|binary analys/i, 4],
    'Pwn': [/buffer overflow|rop|pwn|heap|stack overflow|ret2libc|format string|shellcode|exploit binary|elf exploit/i, 4],
    'Steganography': [/steganograph|hidden image|lsb|pixel|concealed|audio spectrogram|watermark|hidden message/i, 4],
    'OSINT': [/osint|open.source.intelligence|geolocat|social media|public record|reconnaissance|satellite|identify location/i, 4],
    'Misc': [/misc|puzzle|qr code|logic|riddle|game|challenge/i, 1]
  };
  const byExtension = {
    pcap:'Forensics',pcapng:'Forensics',evtx:'Forensics',log:'Forensics',eml:'Forensics',pst:'Forensics',mem:'Forensics',raw:'Forensics',
    pem:'Cryptography',key:'Cryptography',enc:'Cryptography',gpg:'Cryptography',asc:'Cryptography',
    html:'Web',htm:'Web',php:'Web',js:'Web',jsx:'Web',css:'Web',har:'Web',
    so:'Reverse Engineering',dll:'Reverse Engineering',dex:'Reverse Engineering',class:'Reverse Engineering',wasm:'Reverse Engineering',apk:'Reverse Engineering',
    elf:'Pwn',exe:'Reverse Engineering',
    png:'Steganography',jpg:'Steganography',jpeg:'Steganography',gif:'Steganography',bmp:'Steganography',wav:'Steganography',mp3:'Steganography',flac:'Steganography',
    geojson:'OSINT',gpx:'OSINT',kml:'OSINT'
  };
  const TEXT_TYPES = new Set(['txt','md','log','json','xml','html','htm','js','ts','py','rs','c','cpp','h','php','sh','go','yaml','yml','ini','csv','vba','ps1','sql','svg','conf','cfg','toml','pem','asc','css','bat','java']);
  const state = { files: [], scanning: false, lastResult: null, cache: new WeakMap() };
  const safeText = (v) => String(v == null ? '' : v);
  const nameFor = (f) => safeText(f.name).slice(0, 170);
  const humanSize = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  const hexOf = (a) => Array.from(a, b => b.toString(16).padStart(2,'0')).join('');
  const clipText = (s,n=150) => safeText(s).length > n ? safeText(s).slice(0,n-1)+'…' : safeText(s);

  function log(message) {
    const host = $('logLines');
    if (host.children.length >= MAX_LOG) host.firstElementChild.remove();
    const line = document.createElement('div');
    const marker = document.createElement('span');
    marker.textContent = '>';
    line.append(marker, document.createTextNode(' ' + clipText(message, 300)));
    host.append(line);
    host.scrollTop = host.scrollHeight;
  }
  function message(txt, success=false) {
    const el = $('formMessage');
    el.textContent = txt;
    el.classList.toggle('success', success);
  }
  function setBusy(busy) {
    state.scanning = busy;
    $('analyzeButton').disabled = busy;
    $('analyzeButton').textContent = busy ? 'INSPECTING ARTIFACTS…' : '✳  RUN LOCAL INSPECTION  ↗';
    $('resetButton').disabled = busy;
    $('resultLabel').textContent = busy ? 'PROCESSING' : state.lastResult ? 'COMPLETE' : 'IDLE / 00';
  }
  function setStatus(label, icon='◇') {
    $('resultStatusText').textContent = label;
    $('statusIcon').textContent = icon;
  }
  function updateSelected() {
    const target = $('selectedFiles');
    target.replaceChildren();
    if (state.files.length === 0) {target.textContent = 'NO ARTIFACTS SELECTED';return;}
    for (const file of state.files) {
      const chip = document.createElement('span');chip.className = 'file-pill';
      chip.title = nameFor(file);chip.textContent = `${nameFor(file)} / ${humanSize(file.size)}`;
      target.appendChild(chip);
    }
  }
  function chooseFiles(files) {
    if (state.scanning) return;
    const inputFiles = Array.from(files).filter(x => x instanceof File);
    if (!inputFiles.length) return;
    if (inputFiles.length > MAX_FILES) {message(`Maximum ${MAX_FILES} artifacts per inspection.`);return;}
    const total = inputFiles.reduce((n,f) => n+f.size,0);
    if (total > MAX_TOTAL) {message(`Total files exceed ${humanSize(MAX_TOTAL)} safety limit.`);return;}
    state.files = inputFiles;
    updateSelected();
    message(`${inputFiles.length} local file(s) selected. No upload occurs.`, true);
  }
  function magic(bytes, filename) {
    const ascii = (start,n) => String.fromCharCode(...bytes.slice(start,start+n));
    const starts = (...values) => values.every((b,i)=>bytes[i]===b);
    if (starts(0x7f,0x45,0x4c,0x46)) return ['ELF executable','Reverse Engineering'];
    if (starts(0x4d,0x5a)) return ['PE / DOS executable','Reverse Engineering'];
    if (starts(0x50,0x4b,0x03,0x04)||starts(0x50,0x4b,0x05,0x06)) return ['ZIP archive','Forensics'];
    if (starts(0x89,0x50,0x4e,0x47,0x0d,0x0a)) return ['PNG image','Steganography'];
    if (starts(0xff,0xd8,0xff)) return ['JPEG image','Steganography'];
    if (ascii(0,4)==='%PDF') return ['PDF document','Forensics'];
    if (ascii(0,4)==='GIF8') return ['GIF image','Steganography'];
    if (ascii(0,4)==='RIFF') return ['RIFF media container','Steganography'];
    if (starts(0x1f,0x8b)) return ['GZIP archive','Forensics'];
    if (starts(0x37,0x7a,0xbc,0xaf,0x27,0x1c)) return ['7z archive','Forensics'];
    if (starts(0x52,0x61,0x72,0x21,0x1a,0x07)) return ['RAR archive','Forensics'];
    if (starts(0xd4,0xc3,0xb2,0xa1)||starts(0xa1,0xb2,0xc3,0xd4)||starts(0xa1,0xb2,0x3c,0x4d)||starts(0x4d,0x3c,0xb2,0xa1)) return ['PCAP network capture','Forensics'];
    if (starts(0x0a,0x0d,0x0d,0x0a)) return ['PCAPNG network capture','Forensics'];
    if (ascii(0,6)==='SQLite') return ['SQLite database','Forensics'];
    if (starts(0x00,0x61,0x73,0x6d)) return ['WebAssembly binary','Reverse Engineering'];
    if (starts(0xfe,0xed,0xfa,0xce)||starts(0xfe,0xed,0xfa,0xcf)||starts(0xcf,0xfa,0xed,0xfe)||starts(0xce,0xfa,0xed,0xfe)) return ['Mach-O executable','Reverse Engineering'];
    const ext = filename.split('.').pop().toLowerCase();
    return [TEXT_TYPES.has(ext) ? 'Text / source artifact' : 'Unknown signature', byExtension[ext] || null];
  }
  function isTextLike(bytes,ext) {
    if (!TEXT_TYPES.has(ext) || bytes.length===0) return false;
    const take=Math.min(bytes.length,2048);let printable=0;
    for(let i=0;i<take;i++){const x=bytes[i];if(x===0)return false;if(x===9||x===10||x===13||(x>=32&&x<127)||x>=128)printable++;}
    return printable/take>.91;
  }
  function findCandidates(text, source) {
    const found=[];const rx=/\b[A-Za-z][A-Za-z0-9_]{0,23}\{[A-Za-z0-9_!@#$%^&*().:/+=\-]{4,128}\}/g;
    let match;
    while((match=rx.exec(text)) && found.length<14) {
      if (match[0].length <= 154) found.push({value:match[0], source, level:'PATTERN IN SOURCE — UNVERIFIED', verification:'Not independently verified', offset:match.index});
    }
    return found;
  }
  function inspectZip(bytes) {
    // Read central directory only; do not decompress or open archive entries.
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)<=bytes.length){eocd=i;break;}}
    if(eocd<0)return {ok:false, reason:'ZIP directory absent or unsupported'};
    const count=view.getUint16(eocd+10,true),dirSize=view.getUint32(eocd+12,true),offset=view.getUint32(eocd+16,true);
    if(count===65535||dirSize===0xffffffff||offset===0xffffffff)return {ok:false,reason:'ZIP64 directory is not parsed by this demo'};
    if(count>10000||offset>bytes.length||dirSize>bytes.length-offset)return {ok:false,reason:'Invalid or oversized central directory'};
    let cursor=offset,totalUnpacked=0,unsafe=0,suspicious=0;
    const names=[];
    for(let i=0;i<count;i++){
      if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)return {ok:false,reason:'Malformed ZIP central directory'};
      const compressed=view.getUint32(cursor+20,true),uncompressed=view.getUint32(cursor+24,true);
      const nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);
      if(cursor+46+nameLength+extra+comment>bytes.length)return {ok:false,reason:'Truncated ZIP filename'};
      const name=new TextDecoder('utf-8',{fatal:false}).decode(bytes.subarray(cursor+46,cursor+46+nameLength));
      totalUnpacked+=uncompressed;
      if(/(^\/|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$))/.test(name))unsafe++;
      if(uncompressed>128*1024*1024||(compressed>0&&uncompressed/compressed>1000))suspicious++;
      if(names.length<12)names.push(name.slice(0,120));
      cursor+=46+nameLength+extra+comment;
    }
    return {ok:true,count,names,unsafe,suspicious,totalUnpacked};
  }
  async function inspectFile(file) {
    if(state.cache.has(file))return {...state.cache.get(file),cacheHit:true};
    const ext=file.name.includes('.')?file.name.split('.').pop().toLowerCase():'';
    const findings=[];const candidates=[];
    const result={name:nameFor(file),bytes:file.size,extension:ext,signature:'Unknown',hash:null,findings,candidates,category:null,cacheHit:false};
    if(file.size>MAX_READ) {
      const header=new Uint8Array(await file.slice(0,64).arrayBuffer());
      const kind=magic(header,file.name);result.signature=kind[0];result.category=kind[1];
      findings.push({name:`${result.name}: ${kind[0]}`,detail:`${humanSize(file.size)} · metadata only (read limit ${humanSize(MAX_READ)})`,source:result.name});
      findings.push({name:`${result.name}: content skipped`,detail:'File exceeds browser analysis read budget; hash and deep inspection skipped',source:result.name});
      state.cache.set(file,result);return result;
    }
    const raw=new Uint8Array(await file.arrayBuffer());
    const kind=magic(raw.slice(0,64),file.name);result.signature=kind[0];result.category=kind[1];
    findings.push({name:`${result.name}: ${kind[0]}`,detail:`Detected from signature or extension · ${humanSize(file.size)}`,source:result.name});
    if(globalThis.crypto?.subtle) {
      result.hash=hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)));
      findings.push({name:`SHA-256: ${result.name}`,detail:result.hash,source:result.name});
    } else {
      findings.push({name:`SHA-256 unavailable: ${result.name}`,detail:'Open on HTTPS or localhost to enable Web Crypto hashing',source:result.name});
    }
    if(kind[0]==='ZIP archive') {
      const zip=inspectZip(raw);
      if(zip.ok) {
        findings.push({name:`ZIP directory: ${zip.count} entries`,detail:`Listing only · declared unpacked total ${humanSize(zip.totalUnpacked)} · ${zip.names.slice(0,7).join(', ')||'(empty)'}`,source:result.name});
        if(zip.unsafe||zip.suspicious||zip.totalUnpacked>128*1024*1024) findings.push({name:`ZIP safety warning`,detail:`Unsafe paths: ${zip.unsafe}; suspicious size ratios: ${zip.suspicious}; entries not extracted`,source:result.name});
      }else findings.push({name:`ZIP metadata unavailable`,detail:zip.reason,source:result.name});
    }
    if(file.size<=MAX_TEXT&&isTextLike(raw,ext)) {
      const content=new TextDecoder('utf-8',{fatal:false}).decode(raw);
      candidates.push(...findCandidates(content,result.name));
      findings.push({name:`Text inspected: ${result.name}`,detail:`${content.length.toLocaleString()} characters · scanned for candidate flag syntax`,source:result.name});
    } else if(file.size>MAX_TEXT) {
      findings.push({name:`Deep text inspection skipped: ${result.name}`,detail:`Text scan budget ${humanSize(MAX_TEXT)} per file`,source:result.name});
    }
    state.cache.set(file,result);
    return result;
  }
  async function inspectConcurrently(files, limit, task) {
    const out=new Array(files.length);let index=0;
    async function worker() {
      while(index<files.length) {
        const current=index++;
        try{out[current]={ok:true,result:await task(files[current])};}
        catch(error){out[current]={ok:false,name:nameFor(files[current]),error:String(error?.message||error)};}
      }
    }
    await Promise.all(Array.from({length:Math.min(limit,files.length)},()=>worker()));
    return out;
  }
  function classify(description,fileResults) {
    const scores=Object.fromEntries(CATEGORIES.map(x=>[x,0]));
    const fragments=[description];
    for(const item of fileResults){fragments.push(item.name);if(item.category)scores[item.category]+=5;
      if(item.signature==='ELF executable')scores.Pwn+=3;
      if(item.signature==='ZIP archive')scores.Forensics+=2;
      if(item.signature==='PDF document')scores.Forensics+=2;
    }
    const input=fragments.join(' ').slice(0,13000);
    for(const [category,[regex,weight]] of Object.entries(patterns)){
      regex.lastIndex=0; if(regex.test(input))scores[category]+=weight;
    }
    const extSet=new Set(fileResults.map(f=>f.extension));
    for(const extension of extSet){const category=byExtension[extension];if(category)scores[category]+=2;}
    const sorted=Object.entries(scores).filter(([,value])=>value>0).sort((a,b)=>b[1]-a[1]);
    return sorted.slice(0,4).map(([name,score])=>({name,score,relative:Math.max(15,Math.round(score/sorted[0][1]*100))}));
  }
  async function runInspection(event) {
    event.preventDefault();
    if(state.scanning)return;
    if(!$('scopeCheckbox').checked){message('Confirm authorized CTF/lab scope before inspection.');return;}
    const name=$('challengeName').value.trim().slice(0,120);
    const desc=$('challengeDesc').value.trim().slice(0,6000);
    if(!name&&!desc&&!state.files.length){message('Add a challenge description or at least one local artifact.');return;}
    message('');setBusy(true);setStatus('INSPECTING', '◌');
    const began=performance.now();
    log(`Scope confirmed for ${name||'untitled challenge'}.`);
    log(`Artifact workload: ${state.files.length} file(s), bounded concurrency 2.`);
    try{
      const inspected=await inspectConcurrently(state.files,2,inspectFile);
      const fileResults=[];const errors=[];let hits=0;
      for(const item of inspected){if(item.ok){fileResults.push(item.result);if(item.result.cacheHit)hits++;}else errors.push(item);}
      const findings=[];
      if(name)findings.push({name:'Challenge reference',detail:name,source:'Challenge input'});
      if(desc)findings.push({name:'Challenge description present',detail:`${desc.length} characters; not independently verified`,source:'Challenge input'});
      for(const f of fileResults)findings.push(...f.findings);
      for(const error of errors)findings.push({name:`Could not inspect ${error.name}`,detail:error.error,source:error.name});
      const candidates=[];
      if(desc)candidates.push(...findCandidates(desc,'Challenge description'));
      for(const f of fileResults)candidates.push(...f.candidates);
      const uniq=new Map();for(const candidate of candidates)if(!uniq.has(candidate.value))uniq.set(candidate.value,candidate);
      const category=classify(desc,fileResults);
      const elapsed=Math.round(performance.now()-began);
      const result={schemaVersion:1,mode:'browser-local-inspection',backendConnected:false,scopeConfirmed:true,challenge:{name:name||'Untitled',description:desc},artifacts:fileResults.map(x=>({name:x.name,size:x.bytes,signature:x.signature,sha256:x.hash})),categories:category.map(x=>({category:x.name,heuristicScore:x.score})),findings:findings.slice(0,MAX_FINDINGS),candidates:Array.from(uniq.values()).slice(0,20).map(c=>({...c,status:'UNVERIFIED'})),verifiedSolve:false,errors,cacheHits:hits,elapsedMs:elapsed};
      state.lastResult=result;renderResults(result);
      log(`Finished: ${fileResults.length} artifacts, ${result.findings.length} findings, ${result.candidates.length} unverified candidate(s).`);
      log(`Local inspection ${elapsed} ms, ${hits} in-memory artifact cache hit(s).`);
      if(errors.length)log(`${errors.length} artifact inspection failure(s); see findings.`);
      message(`Inspection complete. Nothing was uploaded. No candidate was marked solved.`,true);
      setStatus(errors.length?'INSPECTED / WARNINGS':'INSPECTED / NOT SOLVED',errors.length?'!':'✓');
    }catch(error){log(`Inspection failed: ${error.message||'unknown error'}`);setStatus('INSPECTION FAILED','!');message(`Inspection error: ${String(error.message||error)}`);}
    finally{setBusy(false);}
  }
  function renderResults(result) {
    $('filesCount').textContent=String(result.artifacts.length).padStart(2,'0');
    $('findingsCount').textContent=String(result.findings.length).padStart(2,'0');
    $('candidatesCount').textContent=String(result.candidates.length).padStart(2,'0');
    $('evidenceCountLabel').textContent=`${result.findings.length} ITEMS`;
    const cats=$('categoryResults');cats.replaceChildren();
    if(!result.categories.length) cats.innerHTML='<div class="result-empty">Insufficient category evidence. Add details or artifacts.</div>';
    else {
      const max=result.categories[0].heuristicScore;
      for(const cat of result.categories) {
        const bar=document.createElement('div');bar.className='category-row';
        const label=document.createElement('span');label.textContent=cat.category;
        const track=document.createElement('div');track.className='category-track';
        const fill=document.createElement('div');fill.className='category-fill';fill.style.width=`${Math.max(15,Math.round(cat.heuristicScore/max*100))}%`;track.append(fill);
        const score=document.createElement('span');score.className='category-score';score.textContent=`${cat.heuristicScore}pt`;
        bar.append(label,track,score);cats.append(bar);
      }
      const hint=document.createElement('div');hint.className='category-explainer';hint.textContent='Relative heuristic signals only; these are not calibrated probabilities.';cats.append(hint);
    }
    const evidence=$('evidenceResults');evidence.replaceChildren();
    if(!result.findings.length)evidence.innerHTML='<div class="result-empty">No supported findings available.</div>';
    for(const item of result.findings) {
      const row=document.createElement('div');row.className='evidence-item';
      const symbol=document.createElement('span');symbol.className='evidence-symbol';symbol.textContent='◇';
      const body=document.createElement('div');const headline=document.createElement('strong');headline.textContent=clipText(item.name,190);
      const desc=document.createElement('small');desc.textContent=clipText(item.detail,600);
      body.append(headline,desc);row.append(symbol,body);evidence.append(row);
    }
    const candidates=$('candidateResults');candidates.replaceChildren();
    if(!result.candidates.length)candidates.innerHTML='<div class="result-empty">No flag-format candidate detected. This does not mean no flag exists.</div>';
    for(const item of result.candidates) {
      const row=document.createElement('div');row.className='candidate-item';
      const value=document.createElement('code');value.textContent=item.value;
      const desc=document.createElement('small');desc.textContent=`UNVERIFIED · Literal match in ${item.source} · No independent verifier`;
      row.append(value,desc);candidates.append(row);
    }
    $('footerInfo').textContent=`${result.elapsedMs} MS LOCAL · ${result.cacheHits} CACHE HITS`;
    $('exportButton').disabled=false;
  }
  function reset() {
    if(state.scanning)return;
    $('analysisForm').reset();$('filesInput').value='';state.files=[];state.lastResult=null;updateSelected();
    $('categoryResults').innerHTML='<div class="result-empty">Classification will appear after inspection.</div>';
    $('evidenceResults').innerHTML='<div class="result-empty">No evidence collected yet.</div>';
    $('candidateResults').innerHTML='<div class="result-empty">No candidate strings found.</div>';
    $('evidenceCountLabel').textContent='0 ITEMS';
    $('filesCount').textContent='00';$('findingsCount').textContent='00';$('candidatesCount').textContent='00';
    $('footerInfo').textContent='NO ACTIVE INVESTIGATION';$('exportButton').disabled=true;
    $('logLines').replaceChildren();log('Ready for authorized local inspection.');log('No data leaves this browser.');
    setStatus('AWAITING INPUT','◇');$('resultLabel').textContent='IDLE / 00';message('');
  }
  const samples={
    forensics:{name:'capture-inspection-demo',description:'Authorized local training example: inspect a PCAP network capture and investigate possible suspicious HTTP traffic. No live target is involved.',file:'notes.log',content:'2026-01-01 12:00:00 INFO Captured training data.\n2026-01-01 12:00:01 INFO No malicious packets are present in this illustrative fixture.\n'},
    crypto:{name:'encoding-exercise-demo',description:'Authorized local training example: a cryptography puzzle with Base64 encoding and a substitution cipher. Determine the encoding, but do not treat a format match as a verified solution.',file:'cipher.txt',content:'Training puzzle: QmFzZTY0 is the word Base64 encoded.\nThis sample contains no real challenge flag.\n'},
    web:{name:'web-triage-demo',description:'Authorized local training example: review an HTML and JavaScript artifact for hints about an HTTP web application. No external network requests or exploitation.',file:'index.html',content:'<!DOCTYPE html><html><head><title>CTF Training UI</title></head><body><p>Safe local fixture, no backend.</p></body></html>'}
  };
  function loadSample(kind) {
    if(state.scanning)return;
    const sample=samples[kind];if(!sample)return;
    $('challengeName').value=sample.name;$('challengeDesc').value=sample.description;
    state.files=[new File([sample.content],sample.file,{type:'text/plain',lastModified:1})];
    updateSelected();message('Sample fixture loaded. Confirm scope and run local inspection.',true);
    log(`Synthetic ${kind} sample loaded; no real-world target.`);
  }
  function exportJSON() {
    if(!state.lastResult)return;
    const content=JSON.stringify(state.lastResult,null,2);
    const blob=new Blob([content],{type:'application/json'});
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
    const safeName=state.lastResult.challenge.name.toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,55)||'challenge';
    anchor.href=url;anchor.download=`wrosecode-${safeName}-inspection.json`;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    log('Local inspection report exported (JSON).');
  }
  function init() {
    $('year').textContent=String(new Date().getFullYear());
    $('analysisForm').addEventListener('submit',runInspection);
    $('filesInput').addEventListener('change',(event)=>chooseFiles(event.target.files));
    $('dropzone').addEventListener('click',()=>$('filesInput').click());
    $('dropzone').addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('filesInput').click();}});
    for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';$('dropzone').classList.add('drag-over');});
    for(const type of ['dragleave','dragend'])$('dropzone').addEventListener(type,event=>{event.preventDefault();$('dropzone').classList.remove('drag-over');});
    $('dropzone').addEventListener('drop',event=>{event.preventDefault();$('dropzone').classList.remove('drag-over');chooseFiles(event.dataTransfer.files);});
    $('resetButton').addEventListener('click',reset);
    $('exportButton').addEventListener('click',exportJSON);
    document.querySelectorAll('[data-sample]').forEach(button=>button.addEventListener('click',()=>loadSample(button.dataset.sample)));
    const menu=$('menuToggle');
    menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!open));$('mobileNav').hidden=open;});
    $('mobileNav').querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');$('mobileNav').hidden=true;}));
  }
  init();
})();
