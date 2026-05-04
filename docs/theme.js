(function () {
    const root = document.documentElement;
    const KEY = 'coficube-theme';
    const saved = localStorage.getItem(KEY);
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initial = saved || (prefersLight ? 'light' : 'dark');
    root.setAttribute('data-theme', initial);

    function updateLabel(btn) {
        const t = root.getAttribute('data-theme');
        btn.textContent = t === 'dark' ? '☀ Light' : '☾ Dark';
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('theme-toggle');
        if (!btn) {
            console.error('[theme] toggle button not found');
        } else {
            updateLabel(btn);
            btn.addEventListener('click', () => {
                const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                root.setAttribute('data-theme', next);
                try {
                    localStorage.setItem(KEY, next);
                } catch (e) {
                    console.error('[theme] persist failed:', e);
                }
                updateLabel(btn);
            });
        }

        const copyBtn = document.getElementById('copy-install');
        const cmdEl = document.getElementById('install-cmd');
        if (copyBtn && cmdEl) {
            copyBtn.addEventListener('click', async () => {
                const text = cmdEl.textContent.trim();
                try {
                    await navigator.clipboard.writeText(text);
                    copyBtn.textContent = '✓ Copied';
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                        copyBtn.classList.remove('copied');
                    }, 1600);
                } catch (e) {
                    console.error('[copy] clipboard write failed:', e);
                    copyBtn.textContent = '✘ Failed';
                }
            });
        } else {
            console.error('[copy] install command elements not found');
        }
    });
})();
