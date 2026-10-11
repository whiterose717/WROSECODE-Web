/* WROSECODE CLI Docs — static commands, safe copy buttons and download selection. */
(() => {
  'use strict';
  const release = 'https://github.com/whiterose717/WROSECODE-CLI/releases/download/v1.0.0/';
  const platforms = {
    linux: {
      file: 'wrosecode-linux-x86_64',
      name: 'LINUX X64',
      command: `curl -fL ${release}wrosecode-linux-x86_64 -o wrosecode\nchmod +x wrosecode\n./wrosecode --version`
    },
    mac: {
      file: 'wrosecode-darwin-aarch64',
      name: 'MACOS ARM64',
      command: `curl -fL ${release}wrosecode-darwin-aarch64 -o wrosecode\nchmod +x wrosecode\n./wrosecode --version`
    },
    windows: {
      file: 'wrosecode-windows-x86_64.exe',
      name: 'WINDOWS X64',
      command: `# PowerShell\nInvoke-WebRequest '${release}wrosecode-windows-x86_64.exe' -OutFile 'wrosecode.exe'\n.\\wrosecode.exe --version`
    }
  };
  const selector = document.querySelectorAll('[data-install-platform]');
  function setPlatform(platform) {
    const current = platforms[platform];
    if (!current) return;
    const command = document.getElementById('nativeCommand');
    const download = document.getElementById('nativeDownloadLink');
    const checksum = document.getElementById('nativeChecksumLink');
    if (!command || !download || !checksum) return;
    command.textContent = current.command;
    download.href = release + current.file;
    download.textContent = `DOWNLOAD ${current.name} ↗`;
    checksum.href = release + current.file + '.sha256';
    selector.forEach(btn => {
      const active = btn.dataset.installPlatform === platform;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  selector.forEach(btn => btn.addEventListener('click', () => setPlatform(btn.dataset.installPlatform)));
  // Only copy from declared, static <code> elements — never from untrusted challenge content.
  document.querySelectorAll('button[data-copy-target]').forEach(btn => btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.copyTarget);
    if (!target) return;
    const contents = target.textContent;
    const original = btn.textContent;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contents);
      } else {
        const tmp = document.createElement('textarea');
        tmp.value = contents;
        tmp.setAttribute('readonly', '');
        tmp.style.position = 'fixed';
        tmp.style.left = '-9999px';
        document.body.appendChild(tmp);
        tmp.select();
        const copied = document.execCommand('copy');
        tmp.remove();
        if (!copied) throw Error('Clipboard unavailable');
      }
      btn.textContent = 'COPIED ✓';
    } catch (_) {
      btn.textContent = 'SELECT TEXT TO COPY';
    }
    window.setTimeout(() => { btn.textContent = original; }, 1600);
  }));
  // Separate docs-page mobile nav; homepage retains its existing behavior in app.js.
  const menu = document.getElementById('docMenuToggle');
  const mobile = document.getElementById('docMobileNav');
  if (menu && mobile) {
    menu.addEventListener('click', () => {
      const expanded = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!expanded));
      mobile.hidden = expanded;
    });
    mobile.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', 'false');
      mobile.hidden = true;
    }));
  }
  const links = Array.from(document.querySelectorAll('.docs-sidebar > a'));
  if (links.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => {
        links.forEach(link => {
          const active = link.getAttribute('href') === '#' + entry.target.id;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, {rootMargin: '-12% 0px -70% 0px'});
    document.querySelectorAll('.doc-section[id]').forEach(section => observer.observe(section));
  }
})();
