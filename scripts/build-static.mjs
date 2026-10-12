import {cpSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const publicAssets=['index.html','console.html','login.html','docs.html','web-setup.html','styles.css','console.css','docs.css','app.js','console.js','login.js','docs.js','backend.js','lab-bridge.js','favicon.svg','_headers','assets'];
for(const name of publicAssets){const source=join(root,name);if(!existsSync(source))throw Error(`Required asset is missing: ${name}`);cpSync(source,join(out,name),{recursive:true});console.log('Published',name)}
console.log('Only allowlisted static assets published; no .env, data, server or CLI agent source.');
