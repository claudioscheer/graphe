import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { Utils } from './utils.js';

type WorkbenchViewId = 'search' | 'dictionary' | 'modules';
type WorkbenchIconName = Parameters<typeof Icons.create>[0];

interface WorkbenchState {
  version?: number;
  activeView?: string | null;
  collapsed?: boolean;
  widthRatio?: number | null;
}

interface WorkbenchStateSnapshot {
  version: number;
  activeView: WorkbenchViewId;
  collapsed: boolean;
  widthRatio: number | null;
}

interface ModuleLists {
  all: ModuleRecord[];
  bible: ModuleRecord[];
  dictionary: ModuleRecord[];
  commentary: ModuleRecord[];
  crossreference: ModuleRecord[];
}

interface WorkbenchHandlers {
  openSettings?: () => void;
  openAbout?: () => void;
  openNavigation?: () => void;
  openConvertModules?: () => void;
  openModuleEditor?: (moduleId: string) => void;
}

interface WorkbenchInitOptions {
  modules?: ModuleRecord[];
  bibleModules?: ModuleRecord[];
  dictModules?: ModuleRecord[];
  commentaryModules?: ModuleRecord[];
  crossRefModules?: ModuleRecord[];
  handlers?: WorkbenchHandlers;
}

interface ActivateSidebarOptions {
  focus?: boolean;
}

interface WorkspaceTabItem {
  id: string;
  name: string;
}

interface WorkspaceTabsState {
  activeWorkspaceId: string | null;
  items: WorkspaceTabItem[];
}

interface WorkspaceTabHandlers {
  activate?: (workspaceId: string) => void;
  create?: () => void;
  rename?: (workspaceId: string, nextName: string) => void;
  close?: (workspaceId: string) => void;
}

type WorkbenchStateListener = (state: WorkbenchStateSnapshot) => void;

export const WorkbenchShell = (() => {
  const VIEW_IDS = new Set<WorkbenchViewId>(['search', 'dictionary', 'modules']);
  const DEFAULT_WIDTH = 300;
  const MIN_WIDTH = 220;
  const MAX_WIDTH_RATIO = 0.6;

  let onStateChange: WorkbenchStateListener | null = null;
  let activeView: WorkbenchViewId = 'search';
  let collapsed = false;
  let widthRatio: number | null = null;
  let rootEl: HTMLDivElement | null = null;
  let activityBarEl: HTMLElement | null = null;
  let sidebarEl: HTMLElement | null = null;
  let sidebarTitleEl: HTMLDivElement | null = null;
  let sidebarContentEl: HTMLDivElement | null = null;
  let dividerEl: HTMLDivElement | null = null;
  let editorEl: HTMLElement | null = null;
  let commandLabelEl: HTMLSpanElement | null = null;
  let settingsButtonEl: HTMLButtonElement | null = null;
  let workspaceTabsEl: HTMLDivElement | null = null;
  let workspaceTabsState: WorkspaceTabsState = { activeWorkspaceId: null, items: [] };
  let workspaceHandlers: WorkspaceTabHandlers = {};
  let viewContainers: Partial<Record<WorkbenchViewId, HTMLElement>> = {};
  let activityButtons: Partial<Record<WorkbenchViewId, HTMLButtonElement>> = {};
  let moduleLists: ModuleLists = {
    all: [],
    bible: [],
    dictionary: [],
    commentary: [],
    crossreference: [],
  };
  let handlers: WorkbenchHandlers = {};

  function init(savedState: WorkbenchState | null, options: WorkbenchInitOptions = {}): void {
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
    editorEl.append(createWorkspaceStrip(), paneRoot);

    mainEl.append(activityBarEl, sidebarEl, dividerEl, editorEl);
    rootEl.appendChild(mainEl);
    body.appendChild(rootEl);

    window.addEventListener('resize', syncWidthToViewport);
    renderModulesView();
    applyActiveView();
    updateStatus();
  }

  function createTopStrip(): HTMLElement {
    const top = document.createElement('header');
    top.className = 'workbench-top-strip';

    const left = document.createElement('div');
    left.className = 'workbench-top-left';

    const brand = document.createElement('div');
    brand.className = 'workbench-brand';
    const logo = document.createElement('img');
    logo.src = './graphe.png';
    logo.alt = '';
    logo.className = 'workbench-brand-mark';
    const name = document.createElement('span');
    name.textContent = 'Graphe';
    brand.append(logo, name);
    left.appendChild(brand);

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

    top.append(left, command, actions);
    return top;
  }

  function createWorkspaceStrip(): HTMLDivElement {
    const strip = document.createElement('div');
    strip.className = 'workbench-workspace-strip';

    workspaceTabsEl = document.createElement('div');
    workspaceTabsEl.className = 'workspace-tabs';
    workspaceTabsEl.setAttribute('role', 'tablist');
    workspaceTabsEl.setAttribute('aria-label', 'Workspaces');
    strip.appendChild(workspaceTabsEl);

    renderWorkspaceTabs();
    return strip;
  }

  function createTopButton(
    iconName: WorkbenchIconName,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workbench-top-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(Icons.create(iconName, 'w-4 h-4'));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildActivityBar(container: HTMLElement): void {
    const items: Array<{ id: WorkbenchViewId; icon: WorkbenchIconName; label: string }> = [
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

  function createSidebarHeader(): HTMLElement {
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

  function buildViews(container: HTMLElement): void {
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

  function renderModulesView(): void {
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

  function setModules(nextModuleLists: WorkbenchInitOptions = {}): void {
    moduleLists = {
      all: nextModuleLists.modules || [],
      bible: nextModuleLists.bibleModules || [],
      dictionary: nextModuleLists.dictModules || [],
      commentary: nextModuleLists.commentaryModules || [],
      crossreference: nextModuleLists.crossRefModules || [],
    };
    renderModulesView();
  }

  function createCommandButton(
    iconName: WorkbenchIconName,
    label: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workbench-command-btn';
    btn.append(Icons.create(iconName, 'w-4 h-4'), document.createTextNode(label));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createStat(label: string, count: number): HTMLDivElement {
    const stat = document.createElement('div');
    stat.className = 'workbench-module-stat';
    const value = document.createElement('strong');
    value.textContent = String(count);
    const text = document.createElement('span');
    text.textContent = label;
    stat.append(value, text);
    return stat;
  }

  function createModuleRow(mod: ModuleRecord, type: string): HTMLButtonElement {
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

  function createEmptyState(message: string): HTMLDivElement {
    const empty = document.createElement('div');
    empty.className = 'workbench-empty';
    empty.textContent = message;
    return empty;
  }

  function activateSidebar(viewId: string, options: ActivateSidebarOptions = {}): void {
    const normalized = normalizeViewId(viewId);
    activeView = normalized;
    if (options.focus || collapsed) collapsed = false;
    applyActiveView();
    emitStateChange();
  }

  function applyActiveView(): void {
    if (!rootEl) return;
    rootEl.classList.toggle('workbench-sidebar-collapsed', collapsed);
    if (sidebarTitleEl) sidebarTitleEl.textContent = getViewLabel(activeView);
    for (const id of VIEW_IDS) {
      const container = viewContainers[id];
      if (container) container.classList.toggle('is-active', id === activeView);
    }
    for (const id of VIEW_IDS) {
      const button = activityButtons[id];
      if (!button) continue;
      const selected = id === activeView && !collapsed;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }

  function normalizeViewId(viewId: string | null | undefined): WorkbenchViewId {
    return VIEW_IDS.has(viewId as WorkbenchViewId) ? (viewId as WorkbenchViewId) : 'search';
  }

  function getViewLabel(viewId: string): string {
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

  function getViewContainer(viewId: string): HTMLElement | null {
    return viewContainers[normalizeViewId(viewId)] || null;
  }

  function setStateChangeListener(listener: WorkbenchStateListener | null): void {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange(): void {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState(): WorkbenchStateSnapshot {
    return {
      version: 1,
      activeView,
      collapsed,
      widthRatio,
    };
  }

  function setWorkspaceTabs(
    tabState: Partial<WorkspaceTabsState> | null,
    handlers: WorkspaceTabHandlers = {}
  ): void {
    workspaceTabsState = {
      activeWorkspaceId: tabState?.activeWorkspaceId || null,
      items: Array.isArray(tabState?.items) ? tabState.items : [],
    };
    workspaceHandlers = handlers || {};
    renderWorkspaceTabs();
  }

  function renderWorkspaceTabs(): void {
    if (!workspaceTabsEl) return;
    workspaceTabsEl.innerHTML = '';
    const items = workspaceTabsState.items || [];
    for (const item of items) {
      workspaceTabsEl.appendChild(createWorkspaceTab(item, items.length));
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'workspace-tab-add';
    addBtn.title = I18n.t('workspaceNew');
    addBtn.setAttribute('aria-label', I18n.t('workspaceNew'));
    addBtn.appendChild(Icons.create('plus', 'w-3.5 h-3.5'));
    addBtn.addEventListener('click', () => {
      if (typeof workspaceHandlers.create === 'function') workspaceHandlers.create();
    });
    workspaceTabsEl.appendChild(addBtn);
  }

  function createWorkspaceTab(item: WorkspaceTabItem, itemCount: number): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'workspace-tab';
    tab.dataset.workspaceId = item.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute(
      'aria-selected',
      item.id === workspaceTabsState.activeWorkspaceId ? 'true' : 'false'
    );
    tab.classList.toggle('is-active', item.id === workspaceTabsState.activeWorkspaceId);
    tab.title = item.name;

    const label = document.createElement('span');
    label.className = 'workspace-tab-label';
    label.textContent = item.name;
    label.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      enterWorkspaceRename(tab, item);
    });
    tab.appendChild(label);

    if (itemCount > 1) {
      const closeBtn = document.createElement('span');
      closeBtn.className = 'workspace-tab-close';
      closeBtn.title = I18n.t('workspaceClose');
      closeBtn.setAttribute('aria-label', I18n.t('workspaceClose'));
      closeBtn.appendChild(Icons.create('x', 'w-3 h-3'));
      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof workspaceHandlers.close === 'function') workspaceHandlers.close(item.id);
      });
      tab.appendChild(closeBtn);
    }

    tab.addEventListener('click', () => {
      if (typeof workspaceHandlers.activate === 'function') workspaceHandlers.activate(item.id);
    });

    return tab;
  }

  function enterWorkspaceRename(tab: HTMLButtonElement, item: WorkspaceTabItem): void {
    tab.innerHTML = '';
    tab.classList.add('is-renaming');
    const input = document.createElement('input');
    input.className = 'workspace-tab-input';
    input.value = item.name;
    input.setAttribute('aria-label', I18n.t('workspaceRename'));
    tab.appendChild(input);

    const commit = (): void => {
      const nextName = input.value.trim();
      if (nextName && typeof workspaceHandlers.rename === 'function') {
        workspaceHandlers.rename(item.id, nextName);
      } else {
        renderWorkspaceTabs();
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        renderWorkspaceTabs();
      }
    });
    input.addEventListener('blur', commit);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  function getViewportWidth(): number {
    return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  }

  function resolveInitialWidthRatio(savedState: WorkbenchState | null): number {
    if (savedState && Number.isFinite(savedState.widthRatio)) {
      return Math.min(MAX_WIDTH_RATIO, Math.max(0.12, Number(savedState.widthRatio)));
    }
    return Math.min(MAX_WIDTH_RATIO, Math.max(0.12, DEFAULT_WIDTH / getViewportWidth()));
  }

  function clampWidth(width: number): number {
    const maxWidth = Math.max(MIN_WIDTH + 40, Math.floor(getViewportWidth() * MAX_WIDTH_RATIO));
    return Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(width)));
  }

  function syncWidthToViewport(): void {
    if (!sidebarEl) return;
    const nextWidth = clampWidth(Math.round(getViewportWidth() * (widthRatio || 0.24)));
    sidebarEl.style.width = nextWidth + 'px';
  }

  function setupDividerDrag(): void {
    if (!dividerEl || !sidebarEl) return;
    const divider = dividerEl;
    const sidebar = sidebarEl;
    divider.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      divider.classList.add('dragging');
      const startX = event.clientX;
      const startWidth = sidebar.offsetWidth;

      const onMove = (moveEvent: MouseEvent): void => {
        const nextWidth = clampWidth(startWidth + (moveEvent.clientX - startX));
        sidebar.style.width = nextWidth + 'px';
        widthRatio = Math.min(MAX_WIDTH_RATIO, Math.max(0.12, nextWidth / getViewportWidth()));
      };

      const onUp = (): void => {
        divider.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        emitStateChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setCurrentLookup(label: string): void {
    void label;
  }

  function refreshLabels(): void {
    if (commandLabelEl) commandLabelEl.textContent = I18n.t('navPlaceholder');
    if (settingsButtonEl) {
      settingsButtonEl.title = I18n.t('settings');
      settingsButtonEl.setAttribute('aria-label', I18n.t('settings'));
    }
    for (const id of VIEW_IDS) {
      const button = activityButtons[id];
      if (!button) continue;
      const label = getViewLabel(id);
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    if (sidebarTitleEl) sidebarTitleEl.textContent = getViewLabel(activeView);
    renderModulesView();
    renderWorkspaceTabs();
    applyActiveView();
  }

  function updateStatus(activePane?: PaneSnapshot | null): void {
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
    setModules,
    setWorkspaceTabs,
  };
})();
