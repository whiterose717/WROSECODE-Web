from playwright.sync_api import sync_playwright
from pathlib import Path
import os, subprocess, tempfile, socket, time
root=Path(__file__).resolve().parent.parent
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
base=f'http://127.0.0.1:{port}'
with tempfile.TemporaryDirectory() as tmp:
    env=os.environ.copy();env.update({'PORT':str(port),'PUBLIC_BASE_URL':base,'DATA_DIR':tmp,'BRIDGE_MODE':'cli','SIGNUP_MODE':'closed','WROSECODE_BIN':str(root/'tests/fake-cli.mjs'),'ADMIN_EMAIL':'owner@example.com','ADMIN_PASSWORD':'a_very_long_testing_password'})
    subprocess.run(['node',str(root/'scripts/create-admin.mjs')],cwd=root,env=env,check=True,capture_output=True)
    server=subprocess.Popen(['node',str(root/'server/server.mjs')],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        import urllib.request
        for i in range(60):
            try:
                urllib.request.urlopen(base+'/api/health',timeout=.3)
                break
            except Exception: time.sleep(.1)
        else: raise RuntimeError('server not ready')
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server','--proxy-bypass-list=*'])
            for width,height,label in [(1440,900,'desktop'),(390,844,'mobile')]:
                context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
                page=context.new_page();err=[];page.on('pageerror',lambda e:err.append(str(e)))
                page.goto(base+'/index.html');assert page.get_by_text('YOUR KALI TERMINAL.').count()>0
                assert page.get_by_role('link',name='OPEN WEB CONSOLE',exact=False).count()>0
                page.goto(base+'/login.html');assert page.locator('#googleLogin.disabled').count()==1
                page.locator('#email').fill('owner@example.com');page.locator('#password').fill('a_very_long_testing_password');page.locator('#authSubmit').click()
                page.wait_for_url('**/console.html',timeout=8000);page.get_by_text('Your machine.').wait_for(timeout=7000)
                if label=='mobile':page.locator('#mobileSidebar').click();assert page.locator('#sidebar.open').count()==1
                page.locator('#prompt').fill('List the repository files');page.locator('#sendChat').click();page.get_by_text('Test execution finished').wait_for(timeout=10000)
                assert page.locator('#transcript').inner_text().find('List the repository files')>=0
                if label=='mobile':page.locator('#mobileSidebar').click()
                page.locator('[data-view="ctf"]').click();page.locator('#artifactInput').set_input_files({'name':'ctf.txt','mimeType':'text/plain','buffer':b'authorized fixture'})
                page.locator('#authorizedScope').check();page.locator('#startCtf').click();page.locator('.candidate-tag').wait_for(timeout=10000)
                assert page.locator('#candidateCount').inner_text()=='1';assert 'UNVERIFIED' in page.locator('#candidates').inner_text()
                page.locator('#ctfStatus').get_by_text('COMPLETED').wait_for(timeout=10000)
                if label=='desktop':
                    page.locator('[data-view="providers"]').click();page.locator('#refreshProviders').click();page.get_by_text('anthropic: ready').wait_for(timeout=4000)
                    assert 'DO_NOT_EXPOSE' not in page.locator('#providerOutput').inner_text()
                    page.locator('[data-view="chat"]').click()
                page.screenshot(path=f'/mnt/data/wrose-web-console-{label}.png',full_page=True)
                assert not err,err
                assert page.evaluate('document.documentElement.scrollWidth')<=width+2,(label,page.evaluate('document.documentElement.scrollWidth'))
                print(label,'PASS', 'console screenshots; no JS errors')
                context.close()
            browser.close()
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill()
