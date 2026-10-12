from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
s=(root/'console.html').read_text()
css=(root/'console.css').read_text();css=css.replace(css.split('\n')[0],'') if css.startswith('@import') else css
s=s.replace('<link rel="stylesheet" href="console.css">','<style>'+css+'</style>')
for name in ['backend.js','console.js']:
 s=s.replace('<script src="'+name+'" defer></script>','<script>'+ (root/name).read_text()+'</script>')
stub='''<script>
window.WROSECODE_BACKEND = 'https://console.example.test';
window.fetch = async (url, opts={}) => {
 const route=String(url).replace('https://console.example.test','');
 const responses={
 '/api/me':{user:{id:'a',email:'alice@example.com',role:'member',approved:false,canRun:true}},
 '/api/config':{bridge:'disabled',google:false,github:false,signup:'open'},
 '/api/jobs':{jobs:[]},
 '/api/devices':{devices:[{id:'device-uuid',name:'Kali',platform:'linux',cli_version:'v1',online:true,revoked:false,last_seen:Date.now(),capabilities:{chat:true,terminal:true,files:true}}]},
 '/api/providers':{raw:'Local CLI'},
 '/api/ai/providers':{providers:[],encryptionReady:true},
 '/api/devices/sessions':{sessions:[]},
 '/api/ai/sessions':{sessions:[]}
 };
 return {ok:true,json:async()=>responses[route]||{ok:true}};
};
</script>'''
s=s.replace('<script>'+ (root/'backend.js').read_text()+'</script>',stub+'<script>'+ (root/'backend.js').read_text()+'</script>')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height in [(1300,900),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(s,wait_until='domcontentloaded',timeout=15000)
  page.wait_for_timeout(350)
  if width==390:page.locator('#mobileSidebar').click()
  page.locator('[data-view="terminal"]').click()
  assert page.locator('#view-terminal.is-active').count()==1
  assert page.locator('#toolForm').count()==1
  assert page.locator('#toolDevice option').count()>0
  assert page.evaluate('document.documentElement.scrollWidth')<=width+3
  assert not errors,errors
  print('PASS UI',width,errors)
  page.close()
 browser.close()
