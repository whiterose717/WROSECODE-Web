from pathlib import Path
from playwright.sync_api import sync_playwright
from html import escape
root=Path(__file__).resolve().parent.parent

def page_html(name):
    s=(root/name).read_text()
    for css in ['styles.css','docs.css','console.css']:
        s=s.replace(f'<link rel="stylesheet" href="{css}" />',f'<style>{(root/css).read_text()}</style>')
        s=s.replace(f'<link rel="stylesheet" href="{css}">',f'<style>{(root/css).read_text()}</style>')
    for script in ['app.js','docs.js','console.js','login.js']:
        s=s.replace(f'<script src="{script}" defer></script>',f'<script>{(root/script).read_text()}</script>')
        s=s.replace('src="assets/wrosecode-neon-logo.png"','src="data:image/png;base64,'+__import__('base64').b64encode((root/'assets/wrosecode-neon-logo.png').read_bytes()).decode()+'"')
    import re
    s=re.sub(r'<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>', '', s)
    s=re.sub(r"@import url\('https://fonts\.googleapis[^\n]+\n", '', s)
    return s
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height,label in [(1440,900,'desktop'),(390,844,'mobile')]:
    ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    print('loading index',label,flush=True);page.set_content(page_html('index.html'),wait_until='domcontentloaded',timeout=10000)
    assert page.get_by_text('YOUR KALI TERMINAL.').count()>0
    assert page.locator('.web-console-graphic img').count()==1
    if label=='mobile':
      page.locator('#menuToggle').click()
      assert page.locator('#mobileNav').is_visible()
      assert page.locator('#mobileNav a[href="login.html"]').count()==1
    assert page.evaluate('document.documentElement.scrollWidth')<=width+2
    if label=='desktop':
      # Preserve the original deterministic in-browser CTF lab.
      page.locator('[data-sample="crypto"]').click()
      page.locator('#scopeCheckbox').check()
      page.locator('#analyzeButton').click()
      page.wait_for_timeout(1600)
      assert page.locator('#exportButton').is_enabled()
    page.screenshot(path=f'/mnt/data/wrose-web-home-{label}.png')
    print('loading login',label,flush=True);page.set_content(page_html('login.html'),wait_until='domcontentloaded',timeout=10000)
    assert page.locator('#googleLogin').count()==1 and page.locator('#githubLogin').count()==1
    page.screenshot(path=f'/mnt/data/wrose-web-login-{label}.png')
    page.set_content(page_html('web-setup.html'),wait_until='domcontentloaded',timeout=10000)
    assert page.get_by_text('Connect through Tailscale.').count()>0
    # Stub back-end for safe, deterministic browser layout/interaction tests.
    page.evaluate('''() => { window.fetch = async (path) => ({ ok:true, json: async () => {
      if(path==='/api/me') return {user:{id:'admin',email:'owner@example.com',role:'owner',approved:true,canRun:true}};
      if(path==='/api/config') return {bridge:'mock',signup:'closed',google:false,github:false};
      if(path==='/api/jobs') return {jobs:[]};
      if(path==='/api/providers') return {raw:'MOCK providers'};
      return {ok:true}; } }); }''')
    print('loading console',label,flush=True);page.set_content(page_html('console.html'),wait_until='domcontentloaded',timeout=10000)
    page.wait_for_timeout(100)
    assert page.locator('#engineMode').inner_text()=='SIMULATION MODE'
    if label=='mobile':
      page.locator('#mobileSidebar').click()
      assert page.locator('#sidebar.open').count()==1
    page.locator('[data-view="ctf"]').click()
    assert page.locator('#view-ctf.is-active').count()==1
    assert page.locator('#artifactInput').count()==1
    if label=='mobile':page.locator('#mobileSidebar').click()
    page.locator('[data-view="providers"]').click()
    assert page.locator('#view-providers.is-active').count()==1
    if label=='mobile':page.locator('#mobileSidebar').click()
    page.locator('[data-view="chat"]').click()
    assert page.locator('#view-chat.is-active').count()==1
    page.wait_for_timeout(400)
    page.screenshot(path=f'/mnt/data/wrose-web-console-{label}.png')
    print(label,'width',page.evaluate('document.documentElement.scrollWidth'),'expected',width,'errors',errors)
    assert page.evaluate('document.documentElement.scrollWidth')<=width+2
    assert not errors,errors
    ctx.close()
  browser.close()
print('PASS static browser rendering desktop and mobile')
