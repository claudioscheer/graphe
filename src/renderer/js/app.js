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
      openPinnedRefsInModal: false,
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

  return {
    init,
    setSettings,
    setPaneManager,
    getSettings,
    getPaneManager,
    setSearchPanel,
    getSearchPanel,
    setDictPanel,
    getDictPanel,
  };
})();

function renderNoModulesMessage() {
  const paneRoot = document.getElementById('pane-root');
  if (!paneRoot) return;

  paneRoot.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.id = 'no-modules-message';
  wrapper.className = 'flex flex-col items-center justify-center h-full gap-4 text-brand-600 dark:text-night-300 text-lg';

  const message = document.createElement('div');
  message.setAttribute('data-i18n', 'noModules');
  message.textContent = I18n.t('noModules');
  wrapper.appendChild(message);

  const btn = document.createElement('button');
  btn.setAttribute('data-i18n', 'installModules');
  btn.textContent = I18n.t('installModules');
  btn.className = 'text-brand-600 dark:text-night-300 underline cursor-pointer hover:opacity-80';
  btn.addEventListener('click', () => window.api.installModules());
  wrapper.appendChild(btn);

  paneRoot.appendChild(wrapper);
}

/** Settings dialog — theme + language controls */
const Settings = (() => {
  const html = document.documentElement;
  const overlay = document.getElementById('settings-overlay');
  const themeToggle = document.getElementById('settings-theme-toggle');
  const themeLabel = document.getElementById('settings-theme-label');
  const langSelect = document.getElementById('settings-lang-select');
  const fontSizeSelect = document.getElementById('settings-font-size');
  const closeBtn = document.getElementById('settings-close');
  const pinnedRefModalToggle = document.getElementById('settings-pinned-ref-modal');

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
    if (pinnedRefModalToggle)
      pinnedRefModalToggle.checked = AppStateStore.getSettings().openPinnedRefsInModal === true;
    updateThemeLabel();
    overlay.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
  }

  function isOpen() {
    return !overlay.classList.contains('hidden');
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
        const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(
          (b) => b.value
        );
        AppStateStore.setSettings({ strongsDicts: checked.length > 0 ? checked : null });
      });
      const text = document.createElement('span');
      text.className = 'settings-checkbox-text';
      text.textContent = Utils.getModuleDisplayName(mod);
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
        const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(
          (b) => b.value
        );
        AppStateStore.setSettings({ crossRefModules: checked.length > 0 ? checked : null });
        PaneManager.reloadAllChapters();
      });
      const text = document.createElement('span');
      text.className = 'settings-checkbox-text';
      text.textContent = Utils.getModuleDisplayName(mod);
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

window.Settings = Settings;

window.showTooltip = function (paneId, message) {
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

const AboutDialog = (() => {
  const overlay = document.getElementById('about-overlay');
  const closeBtn = document.getElementById('about-close');
  const versionEl = document.getElementById('about-version');
  const repoBtn = document.getElementById('about-link-repo');
  const issuesBtn = document.getElementById('about-link-issues');

  let versionLoaded = false;

  function isOpen() {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  async function open() {
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

  function close() {
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

window.api.onOpenAbout(() => AboutDialog.open());
window.api.onOpenSettings(() => Settings.open());
window.api.onSplitH(() => PaneManager.splitActivePane('h'));
window.api.onSplitV(() => PaneManager.splitActivePane('v'));
window.api.onSplitHCommentary(() => PaneManager.splitActivePaneWithType('h', 'commentary'));
window.api.onSplitVCommentary(() => PaneManager.splitActivePaneWithType('v', 'commentary'));

const LoadingScreen = (() => {
  const el = document.getElementById('app-loading-screen');
  const HIDE_DELAY_MS = 1000;
  let hideScheduled = false;

  function hide() {
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

const CrossRefPreview = (() => {
  const overlay = document.getElementById('crossref-preview-overlay');
  const closeBtn = document.getElementById('crossref-preview-close');
  const titleEl = document.getElementById('crossref-preview-title');
  const subtitleEl = document.getElementById('crossref-preview-subtitle');
  const contentEl = document.getElementById('crossref-preview-content');
  const booksByModule = new Map();
  let requestToken = 0;

  function isOpen() {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function close() {
    if (!overlay) return;
    overlay.classList.add('hidden');
  }

  async function getBooks(moduleId) {
    if (booksByModule.has(moduleId)) return booksByModule.get(moduleId);
    const books = await window.api.getBooks(moduleId);
    booksByModule.set(moduleId, books);
    return books;
  }

  function renderMessage(message) {
    if (!contentEl) return;
    contentEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'crossref-preview-empty';
    msg.textContent = message;
    contentEl.appendChild(msg);
  }

  async function open({ moduleId, hasStrongs, bookNumber, chapter, verse }) {
    if (!overlay || !titleEl || !contentEl) return;
    const token = ++requestToken;
    overlay.classList.remove('hidden');
    titleEl.textContent = '...';
    if (subtitleEl) subtitleEl.textContent = moduleId || '';
    renderMessage('...');

    try {
      const verses = await window.api.getChapter(moduleId, bookNumber, chapter);
      if (token !== requestToken) return;

      titleEl.textContent = `${I18n.bookName(bookNumber).short} ${chapter}`;
      if (subtitleEl) subtitleEl.textContent = moduleId || '';

      BibleView.renderChapter(contentEl, verses || [], !!hasStrongs, bookNumber, {
        crossRefs: null,
        crossRefMode: 'none',
      });

      if (verse != null) {
        BibleView.scrollToVerse(contentEl, verse);
      } else {
        contentEl.scrollTop = 0;
      }
    } catch (err) {
      if (token !== requestToken) return;
      renderMessage(I18n.t('refUnavailable'));
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', close);
  }
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  return { open, close, isOpen };
})();

function copySelectedVerses(paneId = PaneManager.getActivePaneId()) {
  const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
  if (!el) return false;
  const text = BibleView.getSelectedText(el);
  if (!text) return false;
  navigator.clipboard.writeText(text).catch((err) => console.warn('Clipboard write failed:', err));
  return true;
}

const lastMousePosition = { x: null, y: null };

document.addEventListener(
  'mousemove',
  (e) => {
    lastMousePosition.x = e.clientX;
    lastMousePosition.y = e.clientY;
  },
  { passive: true }
);

function getPaneFromMousePosition() {
  if (!Number.isFinite(lastMousePosition.x) || !Number.isFinite(lastMousePosition.y)) return null;
  const hovered = document.elementFromPoint(lastMousePosition.x, lastMousePosition.y);
  return hovered ? hovered.closest('[data-pane-id]') : null;
}

function selectAllInPane(paneEl) {
  if (!paneEl) return false;
  const paneId = paneEl.getAttribute('data-pane-id');
  if (!paneId) return false;
  PaneManager.setActivePane(paneId);

  const content = paneEl.querySelector('.pane-content');
  if (!content) return false;

  const verseLines = content.querySelectorAll('.verse-line');
  if (verseLines.length > 0) {
    document
      .querySelectorAll('.pane-content .verse-selected')
      .forEach((el) => el.classList.remove('verse-selected'));
    verseLines.forEach((line) => line.classList.add('verse-selected'));
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    return true;
  }

  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(content);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// Left-click on a Strong's number → dictionary lookup
document.addEventListener('click', (e) => {
  // Verse click → scroll synced commentary panes
  const verseLine = e.target.closest('.verse-line');
  if (verseLine && !e.target.closest('.crossref-link')) {
    const paneEl = verseLine.closest('[data-pane-id]');
    if (paneEl) {
      const verseNum = parseInt(verseLine.dataset.verse, 10);
      if (!isNaN(verseNum)) {
        PaneManager.notifyVerseClick(paneEl.getAttribute('data-pane-id'), verseNum);
      }
    }
  }

  // Cross-reference link click → navigate pane
  const refEl = e.target.closest('.crossref-link');
  if (refEl) {
    e.preventDefault();
    const paneEl = refEl.closest('[data-pane-id]');
    if (!paneEl) return;
    const paneId = paneEl.getAttribute('data-pane-id');
    const bookTo = parseInt(refEl.dataset.bookTo, 10);
    const chapterTo = parseInt(refEl.dataset.chapterTo, 10);
    if (isNaN(bookTo) || isNaN(chapterTo)) return;
    const verseTo = refEl.dataset.verseTo ? parseInt(refEl.dataset.verseTo, 10) : null;
    if (verseTo !== null && isNaN(verseTo)) return;
    const target = PaneManager.getNavigationTarget(paneId);
    const pinnedTarget = PaneManager.getLinkTargetPaneId();
    const openPinnedRefsInModal = AppStateStore.getSettings().openPinnedRefsInModal === true;
    if (
      openPinnedRefsInModal &&
      pinnedTarget &&
      paneId === pinnedTarget &&
      target === pinnedTarget
    ) {
      const targetPane = PaneManager.getPane(target);
      if (targetPane && targetPane.paneType === 'bible') {
        CrossRefPreview.open({
          moduleId: targetPane.moduleId,
          hasStrongs: targetPane.hasStrongs,
          bookNumber: bookTo,
          chapter: chapterTo,
          verse: verseTo,
        });
        return;
      }
    }
    PaneManager.navigatePane(target, bookTo, chapterTo, verseTo)
      .then((ok) => {
        if (!ok) showTooltip(target, I18n.t('refUnavailable'));
      })
      .catch((err) => console.warn('Cross-ref navigation failed:', err));
    return;
  }

  // Commentary bible reference click → navigate pane
  const commentaryRef = e.target.closest('.commentary-ref[data-bhref]');
  if (commentaryRef) {
    e.preventDefault();
    const raw = decodeURIComponent(commentaryRef.dataset.bhref.trim());
    // Parse "B:<book> <ch>:<vs>" or "#b<book>.<ch>.<vs>" formats
    const bMatch = raw.match(/^B:(\d+)\s+(\d+):(\d+)/i);
    const hashMatch = raw.match(/^#b(\d+)\.(\d+)\.(\d+)/i);
    const m = bMatch || hashMatch;
    if (!m) return;
    // Canonical book_number values in Protestant Bible order (1-66 → internal IDs)
    const CANONICAL_BOOK_IDS = [
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240,
      250, 260, 290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460,
      470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650,
      660, 670, 680, 690, 700, 710, 720, 730,
    ];
    let bookNumber = parseInt(m[1], 10);
    if (hashMatch) {
      // #b format uses sequential 1-66 index; convert to internal book number
      bookNumber = CANONICAL_BOOK_IDS[bookNumber - 1];
      if (!bookNumber) return;
    }
    const chapter = parseInt(m[2], 10);
    const verse = parseInt(m[3], 10);
    const paneId = PaneManager.getActivePaneId();
    const target = PaneManager.getNavigationTarget(paneId);
    PaneManager.navigatePane(target, bookNumber, chapter, verse)
      .then((ok) => {
        if (!ok) showTooltip(target, I18n.t('refUnavailable'));
      })
      .catch((err) => console.warn('Commentary ref navigation failed:', err));
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

window.api.onStrongsSearch(({ strongsNumber, paneId }) => {
  SearchPanel.search(`strong:${strongsNumber}`);
});

window.api.onStrongsLookup(({ strongsNumber, paneId }) => {
  DictPanel.lookup(strongsNumber);
});

document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement || {}).tagName;
  const inputFocused = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  const overlayOpen =
    !document.getElementById('settings-overlay').classList.contains('hidden') ||
    !document.getElementById('nav-overlay').classList.contains('hidden') ||
    CrossRefPreview.isOpen() ||
    AboutDialog.isOpen();

  if (e.key === 'Escape' && AboutDialog.isOpen()) {
    e.preventDefault();
    AboutDialog.close();
    return;
  }

  if (e.key === 'Escape' && CrossRefPreview.isOpen()) {
    e.preventDefault();
    CrossRefPreview.close();
    return;
  }

  if (e.key === 'Escape' && Settings.isOpen()) {
    e.preventDefault();
    Settings.close();
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
      window.api
        .getBooks(pane.moduleId)
        .then((books) => Navigation.open(paneId, books))
        .catch((err) => console.warn('Failed to open navigation:', err));
    }
    return;
  }

  if (inputFocused || overlayOpen) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'a') {
    e.preventDefault();
    const paneUnderMouse = getPaneFromMousePosition();
    if (paneUnderMouse) {
      selectAllInPane(paneUnderMouse);
      return;
    }
    const activePane = document.querySelector(`[data-pane-id="${PaneManager.getActivePaneId()}"]`);
    if (activePane) selectAllInPane(activePane);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    PaneManager.cycleActivePane();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (window.getSelection().toString()) return;
    const paneId = PaneManager.getActivePaneId();
    const el = document.querySelector(`[data-pane-id="${paneId}"] .pane-content`);
    if (el && el.querySelectorAll('.verse-selected').length) {
      e.preventDefault();
      copySelectedVerses(paneId);
      el.querySelectorAll('.verse-selected').forEach((v) => v.classList.remove('verse-selected'));
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

let dismissedUpdateVersion = null;

function showUpdateBanner({ version, url }) {
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

window.api.onUpdateAvailable(showUpdateBanner);

window.api
  .getPendingUpdate()
  .then((updateInfo) => {
    if (updateInfo) showUpdateBanner(updateInfo);
  })
  .catch(() => {
    /* ignore */
  });

(async function () {
  try {
    const loadedState = await window.api.getAppState().catch(() => null);
    AppStateStore.init(loadedState);

    Settings.init(AppStateStore.getSettings());
    I18n.updateAll();

    const modules = await window.api.getModules();
    const bibleModules = modules.filter((m) => m.type === 'bible');
    const dictModules = modules.filter((m) => m.type === 'dictionary');
    const crossRefModules = modules.filter((m) => m.type === 'crossreference');
    const commentaryModulesList = modules.filter((m) => m.type === 'commentary');

    if (bibleModules.length === 0) {
      renderNoModulesMessage();
      return;
    }

    Navigation.init();

    PaneManager.setStateChangeListener((paneState) => {
      AppStateStore.setPaneManager(paneState);
    });

    PaneManager.init(bibleModules, AppStateStore.getPaneManager(), commentaryModulesList);

    SearchPanel.setStateChangeListener((searchState) => {
      AppStateStore.setSearchPanel(searchState);
    });
    SearchPanel.init(bibleModules, AppStateStore.getSearchPanel());

    DictPanel.setStateChangeListener((dictState) => {
      AppStateStore.setDictPanel(dictState);
    });
    DictPanel.init(dictModules, AppStateStore.getDictPanel());

    Settings.initStrongsDicts(dictModules);
    Settings.initCrossRefModules(crossRefModules);

    await PaneManager.waitForInitialLoad();
  } finally {
    LoadingScreen.hide();
  }
})();
