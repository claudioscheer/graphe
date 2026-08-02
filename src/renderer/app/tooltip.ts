/**
 * In-pane transient tooltip overlay.
 */
export function showTooltip(paneId: string, message: string): void {
  const paneEl = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
  if (!paneEl) return;
  const content = paneEl.querySelector<HTMLElement>('.pane-content');
  if (!content) return;

  const existing = content.querySelector('.app-tooltip-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'app-tooltip-overlay';

  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  tip.textContent = message;

  overlay.appendChild(tip);
  content.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('app-tooltip-hiding');
    overlay.addEventListener('transitionend', () => overlay.remove());
  }, 2500);
}

export function installWindowTooltip(): void {
  window.showTooltip = showTooltip;
}
