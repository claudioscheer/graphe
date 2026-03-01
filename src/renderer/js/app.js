/**
 * app.js — Entry point, initializes settings, language, and pane state persistence
 */

const AppStateStore = (() => {
  let state = {
    settings: {
      theme: null,
      language: 'pt',
      fontSize: 20,
      strongsDicts: null,
      crossRefModules: null,
      semanticSearchEnabled: false,
      semanticModelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      semanticResultCount: 5,
    },
    paneManager: null,
    searchPanel: null,
    dictPanel: null,
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
      dictPanel: loadedState.dictPanel || null,
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

  function setDictPanel(nextDictPanel) {
    state.dictPanel = nextDictPanel;
    scheduleSave();
  }

  function getDictPanel() {
    return state.dictPanel;
  }

  return { init, setSettings, setPaneManager, getSettings, getPaneManager, setSearchPanel, getSearchPanel, setDictPanel, getDictPanel };
})();

/** Settings dialog — theme + language controls */
const Settings = (() => {
  const html = document.documentElement;
  const overlay = document.getElementById('settings-overlay');
  const themeToggle = document.getElementById('settings-theme-toggle');
  const themeLabel = document.getElementById('settings-theme-label');
  const langSelect = document.getElementById('settings-lang-select');
  const fontSizeSelect = document.getElementById('settings-font-size');
  const closeBtn = document.getElementById('settings-close');
  const semanticSection = document.getElementById('settings-semantic-section');
  const semanticModuleSelect = document.getElementById('settings-semantic-module');
  const semanticStatus = document.getElementById('settings-semantic-status');
  const semanticProgress = document.getElementById('settings-semantic-progress');
  const semanticBuildBtn = document.getElementById('settings-semantic-build');
  const semanticCancelBtn = document.getElementById('settings-semantic-cancel');
  const semanticEnableToggle = document.getElementById('settings-semantic-enable');
  const semanticCountInput = document.getElementById('settings-semantic-count');

  let semanticModules = [];
  let semanticJobId = null;
  let semanticPollTimer = null;

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

  function applyFontSize(size) {
    html.style.setProperty('--font-size', size + 'px');
    fontSizeSelect.value = size;
  }

  function open() {
    langSelect.value = I18n.getCurrentLang();
    fontSizeSelect.value = AppStateStore.getSettings().fontSize || 20;
    if (semanticEnableToggle) semanticEnableToggle.checked = AppStateStore.getSettings().semanticSearchEnabled === true;
    if (semanticCountInput) semanticCountInput.value = AppStateStore.getSettings().semanticResultCount || 5;
    updateThemeLabel();
    overlay.classList.remove('hidden');
    refreshSemanticStatus();
  }

  function close() {
    overlay.classList.add('hidden');
    clearSemanticPoll();
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

    const initialFontSize = initialSettings.fontSize || 20;
    applyFontSize(initialFontSize);

    AppStateStore.setSettings({
      theme: isDark() ? 'dark' : 'light',
      language: initialLang,
      fontSize: initialFontSize,
      semanticSearchEnabled: initialSettings.semanticSearchEnabled === true,
      semanticModelId: initialSettings.semanticModelId || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      semanticResultCount: Math.max(1, parseInt(initialSettings.semanticResultCount || 5, 10) || 5),
    });

    if (semanticEnableToggle) semanticEnableToggle.checked = initialSettings.semanticSearchEnabled === true;
    if (semanticCountInput) semanticCountInput.value = Math.max(1, parseInt(initialSettings.semanticResultCount || 5, 10) || 5);
  }

  function syncSearchPanelSemanticSettings() {
    if (typeof SearchPanel !== 'undefined' && SearchPanel.setSemanticOptions) {
      const s = AppStateStore.getSettings();
      SearchPanel.setSemanticOptions({
        enabled: s.semanticSearchEnabled === true,
        resultCount: Math.max(1, parseInt(s.semanticResultCount || 5, 10) || 5),
      });
    }
  }

  function clearSemanticPoll() {
    if (semanticPollTimer) {
      clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function getSemanticStatusLabel(status) {
    switch (status) {
      case 'ready':
        return I18n.t('semanticStatusReady');
      case 'building':
        return I18n.t('semanticStatusBuilding');
      case 'stale':
        return I18n.t('semanticStatusStale');
      case 'error':
        return I18n.t('semanticStatusError');
      default:
        return I18n.t('semanticStatusMissing');
    }
  }

  function updateSemanticStatusLine(row) {
    if (!semanticStatus) return;
    const label = getSemanticStatusLabel((row && row.status) || 'missing');
    const withDate = row && row.builtAt
      ? `${label} (${new Date(row.builtAt).toLocaleString()})`
      : label;
    const withErr = row && row.error ? `${withDate} - ${row.error}` : withDate;
    semanticStatus.textContent = withErr;
  }

  async function refreshSemanticStatus() {
    if (!semanticSection || !semanticModuleSelect || semanticModules.length === 0) return;
    const moduleId = semanticModuleSelect.value;
    if (!moduleId) return;

    try {
      const row = await window.api.getSemanticIndexStatus(moduleId);
      updateSemanticStatusLine(row);
    } catch (err) {
      semanticStatus.textContent = err && err.message ? err.message : String(err);
    }
  }

  async function pollSemanticProgress() {
    if (!semanticJobId) return;

    const progress = await window.api.getSemanticIndexProgress(semanticJobId);
    if (!progress) {
      semanticJobId = null;
      clearSemanticPoll();
      semanticProgress.textContent = '';
      semanticCancelBtn.classList.add('hidden');
      semanticBuildBtn.removeAttribute('disabled');
      await refreshSemanticStatus();
      return;
    }

    if (progress.total > 0) {
      semanticProgress.textContent = I18n.t('semanticProgress')
        .replace('{done}', progress.done)
        .replace('{total}', progress.total)
        .replace('{phase}', progress.phase);
    } else {
      semanticProgress.textContent = I18n.t('semanticPreparing');
    }

    if (progress.status === 'done' || progress.status === 'error' || progress.status === 'cancelled') {
      semanticJobId = null;
      clearSemanticPoll();
      semanticCancelBtn.classList.add('hidden');
      semanticBuildBtn.removeAttribute('disabled');
      await refreshSemanticStatus();
    }
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

  // Font size change
  fontSizeSelect.addEventListener('change', () => {
    const fontSize = parseInt(fontSizeSelect.value, 10);
    applyFontSize(fontSize);
    AppStateStore.setSettings({ fontSize });
  });

  if (semanticModuleSelect) {
    semanticModuleSelect.addEventListener('change', () => {
      refreshSemanticStatus();
    });
  }

  if (semanticBuildBtn) {
    semanticBuildBtn.addEventListener('click', async () => {
      if (!semanticModuleSelect || !semanticModuleSelect.value) return;
      const { jobId } = await window.api.buildSemanticIndex(semanticModuleSelect.value);
      semanticJobId = jobId;
      semanticBuildBtn.setAttribute('disabled', 'disabled');
      semanticCancelBtn.classList.remove('hidden');
      clearSemanticPoll();
      semanticPollTimer = setInterval(() => {
        pollSemanticProgress().catch((err) => {
          semanticProgress.textContent = err && err.message ? err.message : String(err);
        });
      }, 500);
      pollSemanticProgress();
    });
  }

  if (semanticCancelBtn) {
    semanticCancelBtn.addEventListener('click', async () => {
      if (!semanticJobId) return;
      await window.api.cancelSemanticIndexBuild(semanticJobId);
    });
  }

  if (semanticEnableToggle) {
    semanticEnableToggle.addEventListener('change', () => {
      AppStateStore.setSettings({ semanticSearchEnabled: semanticEnableToggle.checked });
      syncSearchPanelSemanticSettings();
    });
  }

  if (semanticCountInput) {
    semanticCountInput.addEventListener('change', () => {
      const value = Math.max(1, Math.min(50, parseInt(semanticCountInput.value || '5', 10) || 5));
      semanticCountInput.value = value;
      AppStateStore.setSettings({ semanticResultCount: value });
      syncSearchPanelSemanticSettings();
    });
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function initStrongsDicts(allDictModules) {
    const section = document.getElementById('settings-strongs-section');
    const list = document.getElementById('settings-strongs-list');
    if (!section || !list || allDictModules.length === 0) return;

    section.classList.remove('hidden');
    list.innerHTML = '';

    const current = AppStateStore.getSettings().strongsDicts;

    for (const mod of allDictModules) {
      const label = document.createElement('label');
      label.className = 'settings-checkbox-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = mod.id;
      cb.checked = Array.isArray(current) && current.includes(mod.id);
      cb.addEventListener('change', () => {
        const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
        AppStateStore.setSettings({ strongsDicts: checked.length > 0 ? checked : null });
      });
      const text = document.createElement('span');
      text.className = 'settings-checkbox-text';
      text.textContent = mod.description;
      label.appendChild(cb);
      label.appendChild(text);
      list.appendChild(label);
    }
  }

  function initCrossRefModules(allCrossRefModules) {
    const section = document.getElementById('settings-crossref-section');
    const list = document.getElementById('settings-crossref-list');
    if (!section || !list || allCrossRefModules.length === 0) return;

    section.classList.remove('hidden');
    list.innerHTML = '';

    const current = AppStateStore.getSettings().crossRefModules;

    for (const mod of allCrossRefModules) {
      const label = document.createElement('label');
      label.className = 'settings-checkbox-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = mod.id;
      cb.checked = Array.isArray(current) && current.includes(mod.id);
      cb.addEventListener('change', () => {
        const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
        AppStateStore.setSettings({ crossRefModules: checked.length > 0 ? checked : null });
        PaneManager.reloadAllChapters();
      });
      const text = document.createElement('span');
      text.className = 'settings-checkbox-text';
      text.textContent = mod.description;
      label.appendChild(cb);
      label.appendChild(text);
      list.appendChild(label);
    }
  }

  function initSemanticIndex(allBibleModules) {
    if (!semanticSection || !semanticModuleSelect) return;
    semanticModules = allBibleModules || [];
    semanticModuleSelect.innerHTML = '';

    if (semanticModules.length === 0) {
      semanticSection.classList.add('hidden');
      return;
    }

    semanticSection.classList.remove('hidden');
    for (const mod of semanticModules) {
      const opt = document.createElement('option');
      opt.value = mod.id;
      opt.textContent = mod.id;
      semanticModuleSelect.appendChild(opt);
    }

    refreshSemanticStatus();
  }

  return { open, close, init, initStrongsDicts, initCrossRefModules, initSemanticIndex, syncSearchPanelSemanticSettings };
})();

window.Settings = Settings;

window.showTooltip = function(paneId, message) {
  const paneEl = document.querySelector(`[data-pane-id="${paneId}"]`);
  if (!paneEl) return;
  const content = paneEl.querySelector('.pane-content');
  if (!content) return;

  // Remove any existing tooltip in this pane
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
};

window.api.onOpenSettings(() => Settings.open());
window.api.onSplitH(() => PaneManager.splitActivePane('h'));
window.api.onSplitV(() => PaneManager.splitActivePane('v'));

const LoadingScreen = (() => {
  const el = document.getElementById('app-loading-screen');

  function hide() {
    if (!el) return;
    el.classList.add('is-hidden');
    el.setAttribute('aria-busy', 'false');
    setTimeout(() => {
      if (el && el.parentElement) el.parentElement.removeChild(el);
    }, 240);
  }

  return { hide };
})();

(async function () {
  try {
    const loadedState = await window.api.getAppState().catch(() => null);
    AppStateStore.init(loadedState);

    Settings.init(AppStateStore.getSettings());
    I18n.updateAll();

    const modules = await window.api.getModules();
    const bibleModules = modules.filter(m => m.type === 'bible');
    const dictModules = modules.filter(m => m.type === 'dictionary');
    const crossRefModules = modules.filter(m => m.type === 'crossreference');

    if (bibleModules.length === 0) {
      document.getElementById('pane-root').innerHTML =
        '<div class="flex items-center justify-center h-full text-brand-600 dark:text-night-300 text-lg">' +
        I18n.t('noModules') + '</div>';
      return;
    }

    Navigation.init();

    PaneManager.setStateChangeListener((paneState) => {
      AppStateStore.setPaneManager(paneState);
    });

    PaneManager.init(bibleModules, AppStateStore.getPaneManager());

    SearchPanel.setStateChangeListener((searchState) => {
      AppStateStore.setSearchPanel(searchState);
    });
    SearchPanel.init(bibleModules, AppStateStore.getSearchPanel());
    Settings.syncSearchPanelSemanticSettings();

    DictPanel.setStateChangeListener((dictState) => {
      AppStateStore.setDictPanel(dictState);
    });
    DictPanel.init(dictModules, AppStateStore.getDictPanel());

    Settings.initStrongsDicts(dictModules);
    Settings.initCrossRefModules(crossRefModules);
    Settings.initSemanticIndex(bibleModules);

    await PaneManager.waitForInitialLoad();

  function copySelectedVerses(paneId = PaneManager.getActivePaneId()) {
    const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
    if (!el) return false;
    const text = BibleView.getSelectedText(el);
    if (!text) return false;
    navigator.clipboard.writeText(text);
    return true;
  }

  // Left-click on a Strong's number → dictionary lookup
  document.addEventListener('click', (e) => {
    // Cross-reference link click → navigate pane
    const refEl = e.target.closest('.crossref-link');
    if (refEl) {
      e.preventDefault();
      const paneEl = refEl.closest('[data-pane-id]');
      if (!paneEl) return;
      const paneId = paneEl.getAttribute('data-pane-id');
      const bookTo = parseInt(refEl.dataset.bookTo, 10);
      const chapterTo = parseInt(refEl.dataset.chapterTo, 10);
      const verseTo = refEl.dataset.verseTo ? parseInt(refEl.dataset.verseTo, 10) : null;
      const target = PaneManager.getNavigationTarget(paneId);
      PaneManager.navigatePane(target, bookTo, chapterTo, verseTo)
        .then(ok => { if (!ok) showTooltip(target, I18n.t('refUnavailable')); });
      return;
    }

    const strongsEl = e.target.closest('.strongs');
    if (strongsEl) {
      e.preventDefault();
      const strongsNumber = strongsEl.textContent.trim();
      DictPanel.lookup(strongsNumber);
    }
  });

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
    SearchPanel.search(`strong:${strongsNumber}`);
  });

  window.api.onStrongsLookup((_event, { strongsNumber, paneId }) => {
    DictPanel.lookup(strongsNumber);
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

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (window.getSelection().toString()) return;
      const paneId = PaneManager.getActivePaneId();
      const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
      if (el && el.querySelectorAll('.verse-selected').length) {
        e.preventDefault();
        copySelectedVerses(paneId);
        el.querySelectorAll('.verse-selected').forEach(v => v.classList.remove('verse-selected'));
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paneId = PaneManager.getActivePaneId();
      const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
      if (el) {
        BibleView.selectAdjacentVerse(el, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      }
    }
  });

  } finally {
    LoadingScreen.hide();
  }
})();
