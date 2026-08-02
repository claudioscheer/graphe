/**
 * About dialog.
 */
export const AboutDialog = (() => {
  const overlay = document.getElementById('about-overlay');
  const closeBtn = document.getElementById('about-close');
  const versionEl = document.getElementById('about-version');
  const repoBtn = document.getElementById('about-link-repo');
  const issuesBtn = document.getElementById('about-link-issues');

  let versionLoaded = false;

  function isOpen(): boolean {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  async function open(): Promise<void> {
    if (!overlay) return;
    if (!versionLoaded) {
      try {
        const version = await window.api.getAppVersion();
        if (versionEl) versionEl.textContent = `v${version}`;
      } catch (_) {
        /* ignore */
      }
      versionLoaded = true;
    }
    overlay.classList.remove('hidden');
  }

  function close(): void {
    if (!overlay) return;
    overlay.classList.add('hidden');
  }

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  if (repoBtn) {
    repoBtn.addEventListener('click', () => {
      window.api.openExternal('https://github.com/claudioscheer/graphe');
    });
  }
  if (issuesBtn) {
    issuesBtn.addEventListener('click', () => {
      window.api.openExternal('https://github.com/claudioscheer/graphe/issues');
    });
  }

  return { open, close, isOpen };
})();
