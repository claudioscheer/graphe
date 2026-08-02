/**
 * Native select decoration (VS Code-style chevron wrap).
 */
import { Icons } from './icons.js';

export function decorateNativeSelect(selectEl: HTMLSelectElement | null): void {
  if (!selectEl || selectEl.parentElement?.classList.contains('app-select-native-wrap')) return;

  const wrapper = document.createElement('span');
  wrapper.className = 'app-select-native-wrap';
  selectEl.parentNode?.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  const chevron = Icons.create('chevron-down', 'w-3 h-3 app-select-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  wrapper.appendChild(chevron);
}
