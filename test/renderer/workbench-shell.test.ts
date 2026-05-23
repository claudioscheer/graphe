// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

type WorkbenchModule = typeof import('../../src/renderer/app/workbench-shell.js');
type I18nModule = typeof import('../../src/renderer/app/i18n.js');

async function loadWorkbench(): Promise<WorkbenchModule & I18nModule> {
  vi.resetModules();
  const [workbench, i18n] = await Promise.all([
    import('../../src/renderer/app/workbench-shell.js'),
    import('../../src/renderer/app/i18n.js'),
  ]);
  return { ...workbench, ...i18n };
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  el.click();
}

function keyboard(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('WorkbenchShell', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="host"><main id="pane-root"></main></div>';
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        installModules: vi.fn(),
      },
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });
  });

  it('does nothing without a pane root', async () => {
    document.body.innerHTML = '<div></div>';
    const { WorkbenchShell } = await loadWorkbench();

    WorkbenchShell.init(null);

    expect(document.getElementById('app-layout')).toBeNull();
    expect(WorkbenchShell.getViewContainer('search')).toBeNull();
  });

  it('builds the shell, handles view state, modules, tabs, commands, and resizing', async () => {
    const { WorkbenchShell, I18n } = await loadWorkbench();
    I18n.setLang('en');
    const handlers = {
      openSettings: vi.fn(),
      openAbout: vi.fn(),
      openNavigation: vi.fn(),
      openConvertModules: vi.fn(),
      openModuleEditor: vi.fn(),
    };
    const stateChange = vi.fn();
    WorkbenchShell.setStateChangeListener(stateChange);

    const modules: ModuleRecord[] = [
      { id: 'kjv', type: 'bible', displayName: 'KJV' },
      { id: 'strong', type: 'dictionary', displayName: 'Strong' },
      { id: 'comm', type: 'commentary', displayName: 'Notes' },
      { id: 'cross', type: 'crossreference', displayName: 'Crossrefs' },
    ];
    WorkbenchShell.init(
      { activeView: 'dictionary', collapsed: true, widthRatio: 0.9 },
      {
        modules,
        bibleModules: [modules[0]],
        dictModules: [modules[1]],
        commentaryModules: [modules[2]],
        crossRefModules: [modules[3]],
        handlers,
      }
    );

    const layout = document.getElementById('app-layout') as HTMLElement;
    expect(layout).toBeTruthy();
    expect(layout.classList.contains('workbench-sidebar-collapsed')).toBe(true);
    expect(WorkbenchShell.getState()).toEqual({
      version: 1,
      activeView: 'dictionary',
      collapsed: true,
      widthRatio: 0.6,
    });
    expect(WorkbenchShell.getViewContainer('dictionary')?.classList.contains('is-active')).toBe(true);
    expect(WorkbenchShell.getViewContainer('missing')).toBe(WorkbenchShell.getViewContainer('search'));

    click('[title="F3"]');
    click('.workbench-top-btn');
    click('.workbench-activity-group-bottom .workbench-activity-btn');
    expect(handlers.openNavigation).toHaveBeenCalledTimes(1);
    expect(handlers.openAbout).toHaveBeenCalledTimes(1);
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);

    click('[data-view-id="modules"]');
    expect(WorkbenchShell.getState()).toMatchObject({ activeView: 'modules', collapsed: false });
    expect(stateChange).toHaveBeenLastCalledWith(WorkbenchShell.getState());
    expect(document.querySelector('.workbench-sidebar-title')?.textContent).toBe('Modules');
    expect(document.querySelectorAll('.workbench-module-stat strong')).toHaveLength(4);

    click('.workbench-command-btn');
    click('.workbench-command-btn:nth-child(2)');
    click('.workbench-module-row');
    expect(window.api.installModules).toHaveBeenCalledTimes(1);
    expect(handlers.openConvertModules).toHaveBeenCalledTimes(1);
    expect(handlers.openModuleEditor).toHaveBeenCalledWith('kjv');

    click('.workbench-sidebar-toggle');
    expect(WorkbenchShell.getState().collapsed).toBe(true);
    WorkbenchShell.activateSidebar('unknown', { focus: true });
    expect(WorkbenchShell.getState()).toMatchObject({ activeView: 'search', collapsed: false });

    WorkbenchShell.setModules();
    expect(document.querySelector('.workbench-empty')?.textContent).toBe('No Bible modules found.');

    const tabHandlers = {
      activate: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      close: vi.fn(),
    };
    WorkbenchShell.setWorkspaceTabs(
      {
        activeWorkspaceId: 'a',
        items: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
      },
      tabHandlers
    );
    expect(document.querySelectorAll('.workspace-tab')).toHaveLength(2);
    click('[data-workspace-id="b"]');
    click('.workspace-tab-add');
    click('[data-workspace-id="a"] .workspace-tab-close');
    expect(tabHandlers.activate).toHaveBeenCalledWith('b');
    expect(tabHandlers.create).toHaveBeenCalledTimes(1);
    expect(tabHandlers.close).toHaveBeenCalledWith('a');

    const label = document.querySelector('[data-workspace-id="b"] .workspace-tab-label') as HTMLElement;
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('.workspace-tab-input') as HTMLInputElement;
    input.value = ' Renamed ';
    keyboard(input, 'Enter');
    expect(tabHandlers.rename).toHaveBeenCalledWith('b', 'Renamed');

    WorkbenchShell.setWorkspaceTabs({ activeWorkspaceId: 'b', items: [{ id: 'b', name: 'Beta' }] });
    const singleLabel = document.querySelector('.workspace-tab-label') as HTMLElement;
    singleLabel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const cancelInput = document.querySelector<HTMLInputElement>('.workspace-tab-input') as HTMLInputElement;
    cancelInput.value = '';
    keyboard(cancelInput, 'Enter');
    expect(document.querySelector('.workspace-tab-input')).toBeNull();

    document.querySelector<HTMLElement>('.workspace-tab-label')?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true })
    );
    const escapeInput = document.querySelector<HTMLInputElement>('.workspace-tab-input') as HTMLInputElement;
    keyboard(escapeInput, 'Escape');
    expect(document.querySelector('.workspace-tab-input')).toBeNull();

    const sidebar = document.getElementById('left-sidebar') as HTMLElement;
    Object.defineProperty(sidebar, 'offsetWidth', { configurable: true, value: 300 });
    const divider = document.querySelector('.workbench-sidebar-divider') as HTMLElement;
    divider.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(sidebar.style.width).toBe('450px');
    expect(WorkbenchShell.getState().widthRatio).toBe(0.45);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    window.dispatchEvent(new Event('resize'));
    expect(sidebar.style.width).toBe('360px');

    I18n.setLang('pt');
    WorkbenchShell.refreshLabels();
    expect(document.querySelector('.workbench-command-label')?.textContent).toContain('Digite');
    WorkbenchShell.setCurrentLookup('G3056');
    WorkbenchShell.updateStatus({ paneType: 'bible' });
  });

  it('uses the default sidebar width when saved state has no width ratio', async () => {
    const { WorkbenchShell } = await loadWorkbench();

    WorkbenchShell.init(null);

    expect(WorkbenchShell.getState().widthRatio).toBe(0.3);
    expect(document.getElementById('left-sidebar')?.style.width).toBe('300px');
  });
});
