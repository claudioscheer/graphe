import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { Utils } from './utils.js';

export const WorkbenchShell = (() => {
  const VIEW_IDS = new Set(['search', 'dictionary', 'modules']);
  const DEFAULT_WIDTH = 300;
  const MIN_WIDTH = 220;
  const MAX_WIDTH_RATIO = 0.6;

  let onStateChange = null;
  let activeView = 'search';
  let collapsed = false;
  let widthRatio = null;
  let rootEl = null;
  let activityBarEl = null;
  let sidebarEl = null;
  let sidebarTitleEl = null;
  let sidebarContentEl = null;
  let dividerEl = null;
  let editorEl = null;
  let commandLabelEl = null;
  let settingsButtonEl = null;
  let viewContainers = {};
  let activityButtons = {};
  let moduleLists = {
    all: [],
    bible: [],
    dictionary: [],
    commentary: [],
    crossreference: [],
  };
  let handlers = {};

  function init(savedState, options = {}) {
    const paneRoot = document.getElementById('pane-root');
    if (!paneRoot || rootEl) return;

    moduleLists = {
      all: options.modules || [],
      bible: options.bibleModules || [],
      dictionary: options.dictModules || [],
      commentary: options.commentaryModules || [],
      crossreference: options.crossRefModules || [],
    };
    handlers = options.handlers || {};
    activeView = normalizeViewId(savedState?.activeView || 'search');
    collapsed = savedState?.collapsed === true;
    widthRatio = resolveInitialWidthRatio(savedState);

    const body = paneRoot.parentElement;
    rootEl = document.createElement('div');
    rootEl.id = 'app-layout';
    rootEl.className = 'workbench-shell';

    rootEl.appendChild(createTopStrip());

    const mainEl = document.createElement('div');
    mainEl.className = 'workbench-main';

    activityBarEl = document.createElement('nav');
    activityBarEl.className = 'workbench-activity-bar';
    activityBarEl.setAttribute('aria-label', 'Workbench');
    buildActivityBar(activityBarEl);

    sidebarEl = document.createElement('aside');
    sidebarEl.id = 'left-sidebar';
    sidebarEl.className = 'workbench-sidebar';
    sidebarEl.style.width = clampWidth(Math.round(getViewportWidth() * widthRatio)) + 'px';
    sidebarEl.appendChild(createSidebarHeader());

    sidebarContentEl = document.createElement('div');
    sidebarContentEl.className = 'workbench-sidebar-content';
    sidebarEl.appendChild(sidebarContentEl);
    buildViews(sidebarContentEl);

    dividerEl = document.createElement('div');
    dividerEl.className = 'split-divider split-divider-h workbench-sidebar-divider';
    setupDividerDrag();

    editorEl = document.createElement('main');
    editorEl.className = 'workbench-editor';

    body.removeChild(paneRoot);
    editorEl.appendChild(paneRoot);

    mainEl.append(activityBarEl, sidebarEl, dividerEl, editorEl);
    rootEl.appendChild(mainEl);
    body.appendChild(rootEl);

    window.addEventListener('resize', syncWidthToViewport);
    renderModulesView();
    applyActiveView();
    updateStatus();
  }

  function createTopStrip() {
    const top = document.createElement('header');
    top.className = 'workbench-top-strip';

    const brand = document.createElement('div');
    brand.className = 'workbench-brand';
    const logo = document.createElement('img');
    logo.src = '../../assets/graphe.png';
    logo.alt = '';
    logo.className = 'workbench-brand-mark';
    const name = document.createElement('span');
    name.textContent = 'Graphe';
    brand.append(logo, name);

    const command = document.createElement('button');
    command.type = 'button';
    command.className = 'workbench-command-strip';
    command.title = 'F3';
    commandLabelEl = document.createElement('span');
    commandLabelEl.className = 'workbench-command-label';
    commandLabelEl.textContent = I18n.t('navPlaceholder');
    command.append(Icons.create('search', 'w-3.5 h-3.5'), commandLabelEl);
    command.addEventListener('click', () => {
      if (typeof handlers.openNavigation === 'function') handlers.openNavigation();
    });

    const actions = document.createElement('div');
    actions.className = 'workbench-top-actions';

    const aboutBtn = createTopButton('info', I18n.t('aboutTitle'), () => {
      if (typeof handlers.openAbout === 'function') handlers.openAbout();
    });
    actions.appendChild(aboutBtn);

    top.append(brand, command, actions);
    return top;
  }

  function createTopButton(iconName, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workbench-top-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(Icons.create(iconName, 'w-4 h-4'));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildActivityBar(container) {
    const items = [
      { id: 'search', icon: 'search', label: I18n.t('search') },
      { id: 'dictionary', icon: 'book-marked', label: I18n.t('dictionary') },
      { id: 'modules', icon: 'library', label: I18n.t('workbenchModules') },
    ];

    const topGroup = document.createElement('div');
    topGroup.className = 'workbench-activity-group';

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'workbench-activity-btn';
      btn.dataset.viewId = item.id;
      btn.title = item.label;
      btn.setAttribute('aria-label', item.label);
      btn.appendChild(Icons.create(item.icon, 'w-5 h-5'));
      btn.addEventListener('click', () => activateSidebar(item.id, { focus: true }));
      activityButtons[item.id] = btn;
      topGroup.appendChild(btn);
    }

    const bottomGroup = document.createElement('div');
    bottomGroup.className = 'workbench-activity-group workbench-activity-group-bottom';

    settingsButtonEl = document.createElement('button');
    settingsButtonEl.type = 'button';
    settingsButtonEl.className = 'workbench-activity-btn';
    settingsButtonEl.title = I18n.t('settings');
    settingsButtonEl.setAttribute('aria-label', I18n.t('settings'));
    settingsButtonEl.appendChild(Icons.create('settings', 'w-5 h-5'));
    settingsButtonEl.addEventListener('click', () => {
      if (typeof handlers.openSettings === 'function') handlers.openSettings();
    });
    bottomGroup.appendChild(settingsButtonEl);

    container.append(topGroup, bottomGroup);
  }

  function createSidebarHeader() {
    const header = document.createElement('div');
    header.className = 'workbench-sidebar-header';
    sidebarTitleEl = document.createElement('div');
    sidebarTitleEl.className = 'workbench-sidebar-title';
    header.appendChild(sidebarTitleEl);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'workbench-sidebar-toggle';
    collapseBtn.title = I18n.t('workbenchToggleSidebar');
    collapseBtn.setAttribute('aria-label', I18n.t('workbenchToggleSidebar'));
    collapseBtn.appendChild(Icons.create('panel-left-close', 'w-4 h-4'));
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      applyActiveView();
      emitStateChange();
    });
    header.appendChild(collapseBtn);
    return header;
  }

  function buildViews(container) {
    viewContainers = {};
    for (const id of VIEW_IDS) {
      const view = document.createElement('section');
      view.className = 'workbench-sidebar-view';
      view.dataset.viewId = id;
      viewContainers[id] = view;
      container.appendChild(view);
    }

    renderModulesView();
  }

  function renderModulesView() {
    const view = viewContainers.modules;
    if (!view) return;
    view.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'workbench-view-actions';
    actions.append(
      createCommandButton('library', I18n.t('installModules'), () => window.api.installModules()),
      createCommandButton('files', I18n.t('convertModules'), () => {
        if (typeof handlers.openConvertModules === 'function') handlers.openConvertModules();
      })
    );
    view.appendChild(actions);

    const stats = document.createElement('div');
    stats.className = 'workbench-module-stats';
    stats.append(
      createStat('Bible', moduleLists.bible.length),
      createStat(I18n.t('dictionary'), moduleLists.dictionary.length),
      createStat(I18n.t('commentary'), moduleLists.commentary.length),
      createStat(I18n.t('crossReferences'), moduleLists.crossreference.length)
    );
    view.appendChild(stats);

    const list = document.createElement('div');
    list.className = 'workbench-module-list';
    for (const mod of moduleLists.all || []) {
      list.appendChild(createModuleRow(mod, mod.type || 'module'));
    }
    if (!moduleLists.all.length) {
      list.appendChild(createEmptyState(I18n.t('noModules')));
    }
    view.appendChild(list);
  }

  function createCommandButton(iconName, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workbench-command-btn';
    btn.append(Icons.create(iconName, 'w-4 h-4'), document.createTextNode(label));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createStat(label, count) {
    const stat = document.createElement('div');
    stat.className = 'workbench-module-stat';
    const value = document.createElement('strong');
    value.textContent = String(count);
    const text = document.createElement('span');
    text.textContent = label;
    stat.append(value, text);
    return stat;
  }

  function createModuleRow(mod, type) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'workbench-module-row';
    row.title = Utils.getModuleDisplayName(mod);
    row.addEventListener('click', () => {
      if (typeof handlers.openModuleEditor === 'function') handlers.openModuleEditor(mod.id);
    });

    const name = document.createElement('span');
    name.className = 'workbench-module-row-name';
    name.textContent = Utils.getModuleDisplayName(mod);

    const meta = document.createElement('span');
    meta.className = 'workbench-module-row-meta';
    meta.textContent = type;

    row.append(name, meta);
    return row;
  }

  function createEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'workbench-empty';
    empty.textContent = message;
    return empty;
  }

  function activateSidebar(viewId, options = {}) {
    const normalized = normalizeViewId(viewId);
    activeView = normalized;
    if (options.focus || collapsed) collapsed = false;
    applyActiveView();
    emitStateChange();
  }

  function applyActiveView() {
    if (!rootEl) return;
    rootEl.classList.toggle('workbench-sidebar-collapsed', collapsed);
    if (sidebarTitleEl) sidebarTitleEl.textContent = getViewLabel(activeView);
    for (const [id, container] of Object.entries(viewContainers)) {
      container.classList.toggle('is-active', id === activeView);
    }
    for (const [id, button] of Object.entries(activityButtons)) {
      const selected = id === activeView && !collapsed;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }

  function normalizeViewId(viewId) {
    return VIEW_IDS.has(viewId) ? viewId : 'search';
  }

  function getViewLabel(viewId) {
    switch (viewId) {
      case 'dictionary':
        return I18n.t('dictionary');
      case 'modules':
        return I18n.t('workbenchModules');
      case 'search':
      default:
        return I18n.t('search');
    }
  }

  function getViewContainer(viewId) {
    return viewContainers[normalizeViewId(viewId)] || null;
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState() {
    return {
      version: 1,
      activeView,
      collapsed,
      widthRatio,
    };
  }

  function getViewportWidth() {
    return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  }

  function resolveInitialWidthRatio(savedState) {
    if (savedState && Number.isFinite(savedState.widthRatio)) {
      return Math.min(MAX_WIDTH_RATIO, Math.max(0.12, Number(savedState.widthRatio)));
    }
    return Math.min(MAX_WIDTH_RATIO, Math.max(0.12, DEFAULT_WIDTH / getViewportWidth()));
  }

  function clampWidth(width) {
    const maxWidth = Math.max(MIN_WIDTH + 40, Math.floor(getViewportWidth() * MAX_WIDTH_RATIO));
    return Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(width)));
  }

  function syncWidthToViewport() {
    if (!sidebarEl) return;
    const nextWidth = clampWidth(Math.round(getViewportWidth() * (widthRatio || 0.24)));
    sidebarEl.style.width = nextWidth + 'px';
  }

  function setupDividerDrag() {
    dividerEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dividerEl.classList.add('dragging');
      const startX = event.clientX;
      const startWidth = sidebarEl.offsetWidth;

      const onMove = (moveEvent) => {
        const nextWidth = clampWidth(startWidth + (moveEvent.clientX - startX));
        sidebarEl.style.width = nextWidth + 'px';
        widthRatio = Math.min(MAX_WIDTH_RATIO, Math.max(0.12, nextWidth / getViewportWidth()));
      };

      const onUp = () => {
        dividerEl.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        emitStateChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setCurrentLookup(label) {
    void label;
  }

  function refreshLabels() {
    if (commandLabelEl) commandLabelEl.textContent = I18n.t('navPlaceholder');
    if (settingsButtonEl) {
      settingsButtonEl.title = I18n.t('settings');
      settingsButtonEl.setAttribute('aria-label', I18n.t('settings'));
    }
    for (const [id, button] of Object.entries(activityButtons)) {
      const label = getViewLabel(id);
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    if (sidebarTitleEl) sidebarTitleEl.textContent = getViewLabel(activeView);
    renderModulesView();
    applyActiveView();
  }

  function updateStatus(activePane) {
    void activePane;
  }

  return {
    init,
    activateSidebar,
    getViewContainer,
    setStateChangeListener,
    getState,
    setCurrentLookup,
    updateStatus,
    refreshLabels,
  };
})();
