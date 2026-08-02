/**
 * App loading screen hide helper.
 */
export const LoadingScreen = (() => {
  const el = document.getElementById('app-loading-screen');
  const HIDE_DELAY_MS = 1000;
  let hideScheduled = false;

  function hide(): void {
    if (!el || hideScheduled) return;
    hideScheduled = true;
    setTimeout(() => {
      el.classList.add('is-hidden');
      el.setAttribute('aria-busy', 'false');
      setTimeout(() => {
        if (el && el.parentElement) el.parentElement.removeChild(el);
      }, 240);
    }, HIDE_DELAY_MS);
  }

  return { hide };
})();
