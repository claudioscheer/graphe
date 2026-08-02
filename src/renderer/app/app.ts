/**
 * app.ts — Entry point: wire dialogs, workbench shell, and module bootstrap.
 */
import { AboutDialog } from './about-dialog.js';
import { AppStateStore } from './app-state-store.js';
import { ConvertModal } from './convert-modal.js';
import { openNavigationForActivePane, openSearchResult } from './content-interactions.js';
import { DictPanel } from './dict-panel.js';
import { I18n } from './i18n.js';
import { LoadingScreen } from './loading-screen.js';
import { ModuleEditor } from './module-editor.js';
import { Navigation, setNavigationPaneManager } from './navigation.js';
import { PaneManager } from './pane-manager.js';
import { SearchPanel } from './search-panel.js';
import { Settings } from './settings-dialog.js';
import { installWindowTooltip } from './tooltip.js';
import { showUpdateBanner } from './update-banner.js';
import { WorkbenchShell } from './workbench-shell.js';
import { WorkspaceManager } from './workspace-manager.js';

// Side-effect: register content click/keyboard handlers
import './content-interactions.js';

type WorkbenchStatePatch = Parameters<typeof AppStateStore.setWorkbench>[0];
type SearchPanelStatePatch = Parameters<typeof AppStateStore.setSearchPanel>[0];
type DictPanelStatePatch = Parameters<typeof AppStateStore.setDictPanel>[0];

function renderNoModulesMessage(): void {
  const paneRoot = document.getElementById('pane-root');
  if (!paneRoot) return;

  paneRoot.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.id = 'no-modules-message';
  wrapper.className =
    'flex flex-col items-center justify-center h-full gap-4 text-brand-600 dark:text-night-300 text-lg';

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

installWindowTooltip();

window.api.onOpenAbout(() => AboutDialog.open());
window.api.onOpenSettings(() => Settings.open());
window.api.onSplitH(() => PaneManager.splitActivePane('h'));
window.api.onSplitV(() => PaneManager.splitActivePane('v'));
window.api.onSplitHCommentary(() => PaneManager.splitActivePaneWithType('h', 'commentary'));
window.api.onSplitVCommentary(() => PaneManager.splitActivePaneWithType('v', 'commentary'));
window.api.onOpenConvertModules(() => ConvertModal.open());
window.api.onUpdateAvailable(showUpdateBanner);

window.api
  .getPendingUpdate()
  .then((updateInfo) => {
    if (updateInfo) showUpdateBanner(updateInfo);
  })
  .catch(() => {
    /* ignore */
  });

(async function (): Promise<void> {
  try {
    const loadedState = await window.api.getAppState().catch((): null => null);
    AppStateStore.init(loadedState);

    Settings.init(AppStateStore.getSettings());
    I18n.updateAll();

    let modules = await window.api.getModules();
    let bibleModules = modules.filter((m) => m.type === 'bible');
    let dictModules = modules.filter((m) => m.type === 'dictionary');
    let crossRefModules = modules.filter((m) => m.type === 'crossreference');
    let commentaryModulesList = modules.filter((m) => m.type === 'commentary');

    if (bibleModules.length === 0) {
      renderNoModulesMessage();
      return;
    }

    setNavigationPaneManager(PaneManager);
    Navigation.init();

    WorkbenchShell.setStateChangeListener((workbenchState: WorkbenchStatePatch) => {
      AppStateStore.setWorkbench(workbenchState);
    });
    WorkbenchShell.init(AppStateStore.getWorkbench(), {
      modules,
      bibleModules,
      dictModules,
      commentaryModules: commentaryModulesList,
      crossRefModules,
      handlers: {
        openSettings: () => Settings.open(),
        openAbout: () => AboutDialog.open(),
        openNavigation: () => openNavigationForActivePane(),
        openConvertModules: () => ConvertModal.open(),
        openModuleEditor: (moduleId: string) => ModuleEditor.open(moduleId, 'info'),
      },
    });

    const updateWorkbenchStatus = () => {
      WorkbenchShell.updateStatus(PaneManager.getPane(PaneManager.getActivePaneId()));
    };
    document.addEventListener('graphe:pane-active-change', updateWorkbenchStatus);

    const workspaceTabHandlers = {
      activate: (workspaceId: string) => {
        WorkspaceManager.activateWorkspace(workspaceId, PaneManager.getState());
      },
      create: () => {
        WorkspaceManager.createWorkspace();
      },
      rename: (workspaceId: string, nextName: string) => {
        WorkspaceManager.renameWorkspace(workspaceId, nextName);
      },
      close: (workspaceId: string) => {
        const name = WorkspaceManager.getWorkspaceName(workspaceId);
        const message = I18n.t('workspaceCloseConfirm').replace('{name}', name);
        if (!window.confirm(message)) return;
        WorkspaceManager.closeWorkspace(workspaceId, PaneManager.getState());
      },
    };

    WorkspaceManager.setStateChangeListener((workspaceState, tabState) => {
      AppStateStore.setWorkspaces(workspaceState);
      WorkbenchShell.setWorkspaceTabs(tabState, workspaceTabHandlers);
    });
    WorkspaceManager.setActiveWorkspaceChangeListener((paneState) => {
      PaneManager.setState(paneState);
      updateWorkbenchStatus();
    });
    WorkspaceManager.init(AppStateStore.getWorkspaces(), AppStateStore.getPaneManager());

    PaneManager.setStateChangeListener((paneState) => {
      WorkspaceManager.updateActivePaneState(paneState);
      updateWorkbenchStatus();
    });

    PaneManager.init(bibleModules, WorkspaceManager.getActivePaneState(), commentaryModulesList);

    const refreshModuleLists = async () => {
      modules = await window.api.getModules();
      bibleModules = modules.filter((m) => m.type === 'bible');
      dictModules = modules.filter((m) => m.type === 'dictionary');
      crossRefModules = modules.filter((m) => m.type === 'crossreference');
      commentaryModulesList = modules.filter((m) => m.type === 'commentary');

      if (bibleModules.length === 0) {
        window.location.reload();
        return;
      }

      WorkbenchShell.setModules({
        modules,
        bibleModules,
        dictModules,
        commentaryModules: commentaryModulesList,
        crossRefModules,
      });
      ModuleEditor.setModules(modules);
      PaneManager.setModules(bibleModules, commentaryModulesList);
      SearchPanel.setModules(bibleModules);
      DictPanel.setModules(dictModules);
      Settings.initStrongsDicts(dictModules);
      Settings.initCrossRefModules(crossRefModules);
      updateWorkbenchStatus();
    };

    ModuleEditor.init(modules, {
      onSaved: () => PaneManager.reloadAllChapters(),
      onDeleted: () => refreshModuleLists(),
    });
    window.api.onOpenModuleEditor(() => {
      const activePane = PaneManager.getPane(PaneManager.getActivePaneId());
      const fallbackModuleId = modules[0] ? modules[0].id : null;
      const moduleId = activePane?.moduleId || fallbackModuleId;
      if (moduleId) ModuleEditor.open(moduleId, 'info');
    });

    SearchPanel.setStateChangeListener((searchState: SearchPanelStatePatch) => {
      AppStateStore.setSearchPanel(searchState);
    });
    SearchPanel.init(
      bibleModules,
      AppStateStore.getSearchPanel(),
      WorkbenchShell.getViewContainer('search'),
      { onOpenResult: openSearchResult }
    );

    DictPanel.setStateChangeListener((dictState: DictPanelStatePatch) => {
      AppStateStore.setDictPanel(dictState);
    });
    DictPanel.init(
      dictModules,
      AppStateStore.getDictPanel(),
      WorkbenchShell.getViewContainer('dictionary')
    );

    Settings.initStrongsDicts(dictModules);
    Settings.initCrossRefModules(crossRefModules);

    await PaneManager.waitForInitialLoad();
    updateWorkbenchStatus();
  } finally {
    LoadingScreen.hide();
  }
})();
