import { I18n } from './i18n.js';

export const WorkspaceManager = (() => {
  const DEFAULT_WORKSPACE_ID = 'workspace-1';

  let state = null;
  let onStateChange = null;
  let onActiveWorkspaceChange = null;
  let idCounter = 1;

  function init(savedState, legacyPaneManagerState) {
    state = normalizeState(savedState, legacyPaneManagerState);
    idCounter = getMaxWorkspaceNumber(state.items);
    emitStateChange();
  }

  function normalizeState(savedState, legacyPaneManagerState) {
    if (savedState && typeof savedState === 'object' && Array.isArray(savedState.items)) {
      const items = savedState.items
        .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
        .map((item, index) => ({
          id: item.id,
          name: normalizeName(item.name, index + 1),
          paneManager:
            item.paneManager && typeof item.paneManager === 'object' ? item.paneManager : null,
        }));
      if (items.length > 0) {
        const activeWorkspaceId = items.some((item) => item.id === savedState.activeWorkspaceId)
          ? savedState.activeWorkspaceId
          : items[0].id;
        return { version: 1, activeWorkspaceId, items };
      }
    }

    return {
      version: 1,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      items: [
        {
          id: DEFAULT_WORKSPACE_ID,
          name: defaultWorkspaceName(1),
          paneManager:
            legacyPaneManagerState && typeof legacyPaneManagerState === 'object'
              ? legacyPaneManagerState
              : null,
        },
      ],
    };
  }

  function getMaxWorkspaceNumber(items) {
    let max = 0;
    for (const item of items) {
      const match = String(item.id || '').match(/^workspace-(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return Math.max(1, max);
  }

  function defaultWorkspaceName(index) {
    const translated = I18n.t('workspaceDefaultName');
    return translated && translated !== 'workspaceDefaultName'
      ? translated.replace('{number}', index)
      : `Workspace ${index}`;
  }

  function normalizeName(name, fallbackIndex) {
    if (typeof name === 'string' && name.trim()) return name.trim();
    return defaultWorkspaceName(fallbackIndex);
  }

  function makeWorkspaceId() {
    idCounter += 1;
    return `workspace-${idCounter}`;
  }

  function getActiveWorkspace() {
    if (!state) return null;
    return (
      state.items.find((item) => item.id === state.activeWorkspaceId) || state.items[0] || null
    );
  }

  function getActivePaneState() {
    return getActiveWorkspace()?.paneManager || null;
  }

  function getState() {
    if (!state) return null;
    return {
      version: 1,
      activeWorkspaceId: state.activeWorkspaceId,
      items: state.items.map((item) => ({
        id: item.id,
        name: item.name,
        paneManager: item.paneManager || null,
      })),
    };
  }

  function getTabState() {
    if (!state) return { activeWorkspaceId: null, items: [] };
    return {
      activeWorkspaceId: state.activeWorkspaceId,
      items: state.items.map((item) => ({ id: item.id, name: item.name })),
    };
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function setActiveWorkspaceChangeListener(listener) {
    onActiveWorkspaceChange = typeof listener === 'function' ? listener : null;
  }

  function updateActivePaneState(paneManagerState) {
    const active = getActiveWorkspace();
    if (!active) return;
    active.paneManager = paneManagerState || null;
    emitStateChange();
  }

  function activateWorkspace(workspaceId, currentPaneManagerState) {
    if (!state || workspaceId === state.activeWorkspaceId) return null;
    const next = state.items.find((item) => item.id === workspaceId);
    if (!next) return null;
    updateActivePaneStateWithoutEmit(currentPaneManagerState);
    state.activeWorkspaceId = workspaceId;
    emitStateChange();
    if (onActiveWorkspaceChange) onActiveWorkspaceChange(next.paneManager || null);
    return next;
  }

  function createWorkspace(options = {}) {
    if (!state) return null;
    const id = makeWorkspaceId();
    const item = {
      id,
      name:
        typeof options.name === 'string' && options.name.trim()
          ? options.name.trim()
          : defaultWorkspaceName(state.items.length + 1),
      paneManager: createSingleBiblePaneState(options.location || null),
    };
    state.items.push(item);
    state.activeWorkspaceId = id;
    emitStateChange();
    if (onActiveWorkspaceChange) onActiveWorkspaceChange(item.paneManager);
    return item;
  }

  function renameWorkspace(workspaceId, nextName) {
    if (!state) return false;
    const item = state.items.find((candidate) => candidate.id === workspaceId);
    const name = typeof nextName === 'string' ? nextName.trim() : '';
    if (!item || !name) return false;
    item.name = name;
    emitStateChange();
    return true;
  }

  function closeWorkspace(workspaceId, currentPaneManagerState) {
    if (!state || state.items.length <= 1) return false;
    const index = state.items.findIndex((item) => item.id === workspaceId);
    if (index < 0) return false;

    updateActivePaneStateWithoutEmit(currentPaneManagerState);
    state.items.splice(index, 1);

    let shouldLoadNextWorkspace = false;
    let nextPaneManagerState = null;
    if (state.activeWorkspaceId === workspaceId) {
      const next = state.items[Math.max(0, index - 1)] || state.items[0];
      state.activeWorkspaceId = next.id;
      nextPaneManagerState = next.paneManager || null;
      shouldLoadNextWorkspace = true;
    }

    emitStateChange();
    if (shouldLoadNextWorkspace && onActiveWorkspaceChange) {
      onActiveWorkspaceChange(nextPaneManagerState);
    }
    return true;
  }

  function getWorkspaceName(workspaceId) {
    return state?.items.find((item) => item.id === workspaceId)?.name || '';
  }

  function updateActivePaneStateWithoutEmit(paneManagerState) {
    const active = getActiveWorkspace();
    if (!active || !paneManagerState) return;
    active.paneManager = paneManagerState;
  }

  function createSingleBiblePaneState(location) {
    const bookNumber = Number.isInteger(location?.bookNumber) ? location.bookNumber : 10;
    const chapter = Number.isInteger(location?.chapter) ? location.chapter : 1;
    const selectedVerse = Number.isInteger(location?.verse) ? location.verse : null;
    return {
      activePaneId: 'pane-1',
      linkTargetPaneId: null,
      tree: { type: 'leaf', paneId: 'pane-1' },
      panes: {
        'pane-1': {
          paneType: 'bible',
          windowLabel: 'A',
          moduleId: location?.moduleId || null,
          bookNumber,
          chapter,
          bookShortName: '',
          selectedVerse,
          navHistory: [],
          navHistoryIdx: -1,
        },
      },
    };
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange(getState(), getTabState());
  }

  return {
    init,
    getActivePaneState,
    getState,
    getTabState,
    setStateChangeListener,
    setActiveWorkspaceChangeListener,
    updateActivePaneState,
    activateWorkspace,
    createWorkspace,
    renameWorkspace,
    closeWorkspace,
    getWorkspaceName,
  };
})();
