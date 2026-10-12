import {cpSync,mkdirSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const publicAssets=['index.html','console.html','login.html','docs.html','web-setup.html','styles.css','console.css','docs.css','app.js','console.js','login.js','docs.js','backend.js','lab-bridge.js','favicon.svg','_headers','_redirects','assets'];
for(const name of publicAssets){const source=join(root,name);if(!existsSync(source))throw Error(`Required asset is missing: ${name}`);cpSync(source,join(out,name),{recursive:true});if(name==='backend.js'){const configured=JSON.stringify(process.env.WROSECODE_BACKEND_URL||'');const code=readFileSync(source,'utf8').replace("const configured=(window.WROSECODE_BACKEND||'').trim()",`const configured=(window.WROSECODE_BACKEND||${configured}).trim()`);writeFileSync(join(out,name),code,{mode:0o644})}console.log('Published',name)}
console.log('Only allowlisted static assets published; no .env, data, server or CLI agent source.');
