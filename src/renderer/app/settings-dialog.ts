/**
 * Settings dialog — theme, language, font size, Strong's dicts, cross-ref modules.
 */
import { AppStateStore } from './app-state-store.js';
import { I18n } from './i18n.js';
import { ModulePicker } from './module-picker.js';
import { PaneManager } from './pane-manager.js';
import { Utils } from './utils.js';
import { WorkbenchShell } from './workbench-shell.js';
import { decorateNativeSelect } from './ui-select.js';

type SettingsApiInstance = Required<Pick<SettingsApi, 'open'>> &
  Pick<SettingsApi, 'close' | 'init'> & {
    isOpen(): boolean;
    initStrongsDicts(allDictModules: ModuleRecord[]): void;
    initCrossRefModules(allCrossRefModules: ModuleRecord[]): void;
  };

export const Settings: SettingsApiInstance = (() => {
  const html = document.documentElement;
  const overlay = document.getElementById('settings-overlay') as HTMLDivElement | null;
  const themeToggle = document.getElementById('settings-theme-toggle') as HTMLButtonElement | null;
  const themeLabel = document.getElementById('settings-theme-label') as HTMLElement | null;
  const langSelect = document.getElementById('settings-lang-select') as HTMLSelectElement | null;
  const fontSizeSelect = document.getElementById('settings-font-size') as HTMLSelectElement | null;
  const closeBtn = document.getElementById('settings-close') as HTMLButtonElement | null;
  const pinnedRefModalToggle = document.getElementById(
    'settings-pinned-ref-modal'
  ) as HTMLInputElement | null;

  function isDark(): boolean {
    return html.classList.contains('dark');
  }

  function applyTheme(dark: boolean): void {
    if (dark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    updateThemeLabel();
  }

  function updateThemeLabel(): void {
    themeLabel.setAttribute('data-i18n', isDark() ? 'dark' : 'light');
    themeLabel.textContent = I18n.t(isDark() ? 'dark' : 'light');
  }

  function applyFontSize(size: number): void {
    html.style.setProperty('--font-size', size + 'px');
    fontSizeSelect.value = String(size);
  }

  function open(): void {
    langSelect.value = I18n.getCurrentLang();
    fontSizeSelect.value = String(AppStateStore.getSettings().fontSize || 20);
    if (pinnedRefModalToggle)
      pinnedRefModalToggle.checked = AppStateStore.getSettings().openPinnedRefsInModal === true;
    updateThemeLabel();
    overlay.classList.remove('hidden');
  }

  function close(): void {
    overlay.classList.add('hidden');
  }

  function isOpen(): boolean {
    return !overlay.classList.contains('hidden');
  }

  function init(initialSettings: AppSettings = {}): void {
    decorateNativeSelect(langSelect);
    decorateNativeSelect(fontSizeSelect);

    const initialTheme = initialSettings.theme || localStorage.getItem('graphe-theme');
    const initialLang = initialSettings.language || localStorage.getItem('graphe-lang') || 'pt';

    I18n.setLang(initialLang);
    langSelect.value = initialLang;

    if (initialTheme) {
      applyTheme(initialTheme === 'dark');
    } else {
      applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    const initialFontSize = initialSettings.fontSize || 20;
    applyFontSize(initialFontSize);

    AppStateStore.setSettings({
      theme: isDark() ? 'dark' : 'light',
      language: initialLang,
      fontSize: initialFontSize,
      openPinnedRefsInModal: initialSettings.openPinnedRefsInModal === true,
    });

    if (pinnedRefModalToggle)
      pinnedRefModalToggle.checked = initialSettings.openPinnedRefsInModal === true;
  }

  // Theme toggle
  themeToggle.addEventListener('click', () => {
    const dark = html.classList.toggle('dark');
    const theme = dark ? 'dark' : 'light';
    localStorage.setItem('graphe-theme', theme);
    AppStateStore.setSettings({ theme });
    updateThemeLabel();
    WorkbenchShell.updateStatus(PaneManager.getPane(PaneManager.getActivePaneId()));
  });

  // Language change
  langSelect.addEventListener('change', () => {
    const language = langSelect.value;
    I18n.setLang(language);
    localStorage.setItem('graphe-lang', language);
    AppStateStore.setSettings({ language });
    if (!document.getElementById('no-modules-message')) {
      PaneManager.render();
    }
    WorkbenchShell.refreshLabels();
    updateThemeLabel();
  });

  // Font size change
  fontSizeSelect.addEventListener('change', () => {
    const fontSize = parseInt(fontSizeSelect.value, 10);
    applyFontSize(fontSize);
    AppStateStore.setSettings({ fontSize });
  });

  if (pinnedRefModalToggle) {
    pinnedRefModalToggle.addEventListener('change', () => {
      AppStateStore.setSettings({ openPinnedRefsInModal: pinnedRefModalToggle.checked });
    });
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function initStrongsDicts(allDictModules: ModuleRecord[]): void {
    const section = document.getElementById('settings-strongs-section');
    const list = document.getElementById('settings-strongs-list');
    if (!section || !list) return;
    if (allDictModules.length === 0) {
      section.classList.add('hidden');
      list.innerHTML = '';
      AppStateStore.setSettings({ strongsDicts: null });
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';

    const current = AppStateStore.getSettings().strongsDicts;
    const currentId = Array.isArray(current) ? current[0] : current || null;
    const selectedId = allDictModules.some((mod) => mod.id === currentId) ? currentId : null;
    if (currentId && !selectedId) AppStateStore.setSettings({ strongsDicts: null });

    const strongsPicker = ModulePicker.create({
      modules: allDictModules,
      selectedId,
      moduleType: 'dictionary',
      truncateLength: 50,
      allowNone: true,
      noneLabel: I18n.t('coverageNone'),
      showFavorites: false,
      className:
        'w-full pl-2 pr-8 py-1 rounded-sm border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50',
      onChange: (moduleId: string | null) => {
        AppStateStore.setSettings({ strongsDicts: moduleId ? [moduleId] : null });
      },
    });
    list.appendChild(strongsPicker.el);
  }

  function initCrossRefModules(allCrossRefModules: ModuleRecord[]): void {
    const section = document.getElementById('settings-crossref-section');
    const list = document.getElementById('settings-crossref-list');
    if (!section || !list) return;
    if (allCrossRefModules.length === 0) {
      section.classList.add('hidden');
      list.innerHTML = '';
      AppStateStore.setSettings({ crossRefModules: null });
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';

    const current = AppStateStore.getSettings().crossRefModules;
    const moduleIds = new Set(allCrossRefModules.map((mod) => mod.id));
    const selectedIds = Array.isArray(current) ? current.filter((id) => moduleIds.has(id)) : [];
    if (Array.isArray(current) && selectedIds.length !== current.length) {
      AppStateStore.setSettings({ crossRefModules: selectedIds.length > 0 ? selectedIds : null });
    }

    for (const mod of allCrossRefModules) {
      const label = document.createElement('label');
      label.className = 'settings-checkbox-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = mod.id;
      cb.checked = selectedIds.includes(mod.id);
      cb.addEventListener('change', () => {
        const checked = Array.from(
          list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
        ).map((b) => b.value);
        AppStateStore.setSettings({ crossRefModules: checked.length > 0 ? checked : null });
        PaneManager.reloadAllChapters();
      });
      const text = document.createElement('span');
      text.className = 'settings-checkbox-text';
      const displayName = Utils.getModuleDisplayName(mod);
      text.textContent = Utils.truncateText(displayName, 50);
      text.title = displayName;
      label.appendChild(cb);
      label.appendChild(text);
      list.appendChild(label);
    }
  }

  return {
    open,
    close,
    isOpen,
    init,
    initStrongsDicts,
    initCrossRefModules,
  };
})();
