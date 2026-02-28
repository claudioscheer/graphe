/**
 * app.js — Entry point, initializes settings, language, and pane state persistence
 */

const AppStateStore = (() => {
  let state = {
    settings: {
      theme: null,
      language: 'pt',
    },
    paneManager: null,
    searchPanel: null,
  };

  let saveTimer = null;

  function init(loadedState) {
    if (!loadedState || typeof loadedState !== 'object') return;
    state = {
      ...state,
      ...loadedState,
      settings: {
        ...state.settings,
        ...(loadedState.settings || {}),
      },
      searchPanel: loadedState.searchPanel || null,
    };
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.api.saveAppState(state).catch((err) => {
        console.error('Failed to save app state:', err);
      });
    }, 200);
  }

  function setSettings(nextSettings) {
    state.settings = {
      ...state.settings,
      ...nextSettings,
    };
    scheduleSave();
  }

  function setPaneManager(nextPaneState) {
    state.paneManager = nextPaneState;
    scheduleSave();
  }

  function getSettings() {
    return state.settings;
  }

  function getPaneManager() {
    return state.paneManager;
  }

  function setSearchPanel(nextSearchPanel) {
    state.searchPanel = nextSearchPanel;
    scheduleSave();
  }

  function getSearchPanel() {
    return state.searchPanel;
  }

  return { init, setSettings, setPaneManager, getSettings, getPaneManager, setSearchPanel, getSearchPanel };
})();

/** Settings dialog — theme + language controls */
const Settings = (() => {
  const html = document.documentElement;
  const overlay = document.getElementById('settings-overlay');
  const themeToggle = document.getElementById('settings-theme-toggle');
  const themeLabel = document.getElementById('settings-theme-label');
  const langSelect = document.getElementById('settings-lang-select');
  const closeBtn = document.getElementById('settings-close');

  function isDark() {
    return html.classList.contains('dark');
  }

  function applyTheme(dark) {
    if (dark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    updateThemeLabel();
  }

  function updateThemeLabel() {
    themeLabel.setAttribute('data-i18n', isDark() ? 'dark' : 'light');
    themeLabel.textContent = I18n.t(isDark() ? 'dark' : 'light');
  }

  function open() {
    langSelect.value = I18n.getCurrentLang();
    updateThemeLabel();
    overlay.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
  }

  function init(initialSettings) {
    const initialTheme = initialSettings.theme || localStorage.getItem('graphe-theme');
    const initialLang = initialSettings.language || localStorage.getItem('graphe-lang') || 'pt';

    I18n.setLang(initialLang);
    langSelect.value = initialLang;

    if (initialTheme) {
      applyTheme(initialTheme === 'dark');
    } else {
      applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    AppStateStore.setSettings({
      theme: isDark() ? 'dark' : 'light',
      language: initialLang,
    });
  }

  // Theme toggle
  themeToggle.addEventListener('click', () => {
    const dark = html.classList.toggle('dark');
    const theme = dark ? 'dark' : 'light';
    localStorage.setItem('graphe-theme', theme);
    AppStateStore.setSettings({ theme });
    updateThemeLabel();
  });

  // Language change
  langSelect.addEventListener('change', () => {
    const language = langSelect.value;
    I18n.setLang(language);
    localStorage.setItem('graphe-lang', language);
    AppStateStore.setSettings({ language });
    PaneManager.render();
    updateThemeLabel();
  });

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close, init };
})();

window.Settings = Settings;
window.api.onOpenSettings(() => Settings.open());
window.api.onSplitH(() => PaneManager.splitActivePane('h'));
window.api.onSplitV(() => PaneManager.splitActivePane('v'));

(async function () {
  const loadedState = await window.api.getAppState().catch(() => null);
  AppStateStore.init(loadedState);

  Settings.init(AppStateStore.getSettings());
  I18n.updateAll();

  const modules = await window.api.getModules();

  if (modules.length === 0) {
    document.getElementById('pane-root').innerHTML =
      '<div class="flex items-center justify-center h-full text-gray-500 text-lg">' +
      I18n.t('noModules') + '</div>';
    return;
  }

  Navigation.init();

  PaneManager.setStateChangeListener((paneState) => {
    AppStateStore.setPaneManager(paneState);
  });

  PaneManager.init(modules, AppStateStore.getPaneManager());

  SearchPanel.setStateChangeListener((searchState) => {
    AppStateStore.setSearchPanel(searchState);
  });
  SearchPanel.init(modules, AppStateStore.getSearchPanel());

  function getActivePaneContent() {
    const paneId = PaneManager.getActivePaneId();
    return document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
  }

  function copySelectedVerses() {
    const el = getActivePaneContent();
    if (!el) return false;
    const text = BibleView.getSelectedText(el);
    if (!text) return false;
    navigator.clipboard.writeText(text);
    return true;
  }

  document.addEventListener('contextmenu', (e) => {
    const paneContent = e.target.closest('.pane-content');
    if (!paneContent) return;
    e.preventDefault();

    const strongsEl = e.target.closest('.strongs');
    if (strongsEl) {
      const strongsNumber = strongsEl.textContent.trim();
      const paneEl = paneContent.closest('[data-pane-id]');
      const paneId = paneEl ? paneEl.getAttribute('data-pane-id') : null;
      window.api.showStrongsContextMenu({
        strongsNumber,
        paneId,
        labels: {
          search: I18n.t('strongsSearchOccurrences'),
          lookup: I18n.t('strongsDictionaryLookup'),
        },
      });
      return;
    }

    const hasSelection = paneContent.querySelectorAll('.verse-selected').length > 0;
    window.api.showVerseContextMenu({ hasSelection });
  });

  window.api.onContextMenuCopy(() => copySelectedVerses());

  window.api.onStrongsSearch((_event, { strongsNumber, paneId }) => {
    console.log('Strongs search:', strongsNumber, 'paneId:', paneId);
  });

  window.api.onStrongsLookup((_event, { strongsNumber, paneId }) => {
    console.log('Strongs lookup:', strongsNumber, 'paneId:', paneId);
  });

  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement || {}).tagName;
    const inputFocused = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const overlayOpen = !document.getElementById('settings-overlay').classList.contains('hidden')
      || !document.getElementById('nav-overlay').classList.contains('hidden');

    if (e.key === 'Tab') {
      e.preventDefault();
      PaneManager.cycleActivePane();
      return;
    }

    if (e.key === 'F' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      SearchPanel.focusInput();
      return;
    }

    if (e.key === 'F3') {
      e.preventDefault();
      const paneId = PaneManager.getActivePaneId();
      const pane = PaneManager.getPane(paneId);
      if (pane) {
        window.api.getBooks(pane.moduleId).then((books) => Navigation.open(paneId, books));
      }
      return;
    }

    if (inputFocused || overlayOpen) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paneId = PaneManager.getActivePaneId();
      const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
      if (el) BibleView.selectAdjacentVerse(el, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    }

    if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      if (copySelectedVerses()) e.preventDefault();
    }
  });
})();
