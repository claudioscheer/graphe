/**
 * Update-available banner.
 */
import { I18n } from './i18n.js';

let dismissedUpdateVersion: string | null = null;

export function showUpdateBanner({ version, url }: UpdateInfo): void {
  const banner = document.getElementById('update-banner');
  const text = document.getElementById('update-banner-text');
  const link = document.getElementById('update-banner-link');
  const close = document.getElementById('update-banner-close');
  if (!banner || !text || !link || !close) return;
  if (!version || dismissedUpdateVersion === version) return;

  text.textContent = I18n.t('updateAvailable').replace('{version}', version);
  link.onclick = () => window.api.openExternal(url);
  close.onclick = () => {
    dismissedUpdateVersion = version;
    banner.classList.add('hidden');
  };
  banner.classList.remove('hidden');
}
