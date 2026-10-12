import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const login=readFileSync(new URL('../login.html',import.meta.url),'utf8');
const consoleHtml=readFileSync(new URL('../console.html',import.meta.url),'utf8');
test('email password login/signup UI includes confirmation and no social buttons',()=>{
 assert.match(login,/id="authForm"/);
 assert.match(login,/id="confirmPassword"/);
 assert.match(login,/id="switchAuth"/);
 assert.doesNotMatch(login,/id="googleLogin"|id="githubLogin"/);
 assert.doesNotMatch(consoleHtml,/id="linkGoogle"|id="linkGithub"/);
});
test('full screen chat selectors and CTF candidates remain integrated',()=>{
 assert.match(consoleHtml,/id="chatDevice"/);
 assert.match(consoleHtml,/id="chatOptions"/);
 assert.match(consoleHtml,/id="flagDiscovery"/);
 assert.match(consoleHtml,/id="candidates"/);
});
