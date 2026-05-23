// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceManager } from '../../src/renderer/js/workspace-manager.js';

const legacyPaneState: PaneManagerState = {
  activePaneId: 'pane-legacy',
  panes: { 'pane-legacy': { paneType: 'bible' } },
};

describe('WorkspaceManager', () => {
  beforeEach(() => {
    localStorage.clear();
    WorkspaceManager.setStateChangeListener(null);
    WorkspaceManager.setActiveWorkspaceChangeListener(null);
  });

  it('starts empty before init and creates a default workspace from legacy pane state', () => {
    expect(WorkspaceManager.getState()).toBeNull();
    expect(WorkspaceManager.getTabState()).toEqual({ activeWorkspaceId: null, items: [] });
    expect(WorkspaceManager.getActivePaneState()).toBeNull();

    const onStateChange = vi.fn();
    WorkspaceManager.setStateChangeListener(onStateChange);
    WorkspaceManager.init(null, legacyPaneState);

    expect(WorkspaceManager.getState()).toEqual({
      version: 1,
      activeWorkspaceId: 'workspace-1',
      items: [
        {
          id: 'workspace-1',
          name: 'Estudo 1',
          paneManager: legacyPaneState,
        },
      ],
    });
    expect(WorkspaceManager.getTabState()).toEqual({
      activeWorkspaceId: 'workspace-1',
      items: [{ id: 'workspace-1', name: 'Estudo 1' }],
    });
    expect(onStateChange).toHaveBeenCalledWith(WorkspaceManager.getState(), WorkspaceManager.getTabState());
  });

  it('normalizes saved workspaces, activates, renames, creates, and closes them', () => {
    const onStateChange = vi.fn();
    const onActiveWorkspaceChange = vi.fn();
    WorkspaceManager.setStateChangeListener(onStateChange);
    WorkspaceManager.setActiveWorkspaceChangeListener(onActiveWorkspaceChange);
    WorkspaceManager.init({
      activeWorkspaceId: 'missing',
      items: [
        { id: 'workspace-2', name: '  Existing  ', paneManager: { activePaneId: 'pane-2' } },
        { id: 'custom', name: '', paneManagerState: { activePaneId: 'pane-custom' } },
        null,
        { id: 7, name: 'bad' },
      ],
    } as unknown as WorkspaceState);

    expect(WorkspaceManager.getState()).toEqual({
      version: 1,
      activeWorkspaceId: 'workspace-2',
      items: [
        { id: 'workspace-2', name: 'Existing', paneManager: { activePaneId: 'pane-2' } },
        { id: 'custom', name: 'Estudo 2', paneManager: { activePaneId: 'pane-custom' } },
      ],
    });
    expect(WorkspaceManager.activateWorkspace('workspace-2', { activePaneId: 'unchanged' })).toBeNull();
    expect(WorkspaceManager.activateWorkspace('missing')).toBeNull();

    const activated = WorkspaceManager.activateWorkspace('custom', { activePaneId: 'saved-current' });
    expect(activated).toEqual({
      id: 'custom',
      name: 'Estudo 2',
      paneManager: { activePaneId: 'pane-custom' },
    });
    expect(onActiveWorkspaceChange).toHaveBeenLastCalledWith({ activePaneId: 'pane-custom' });
    expect(WorkspaceManager.getState()?.items[0].paneManager).toEqual({
      activePaneId: 'saved-current',
    });

    expect(WorkspaceManager.renameWorkspace('custom', '  Renamed  ')).toBe(true);
    expect(WorkspaceManager.renameWorkspace('custom', '   ')).toBe(false);
    expect(WorkspaceManager.renameWorkspace('missing', 'Name')).toBe(false);
    expect(WorkspaceManager.getWorkspaceName('custom')).toBe('Renamed');
    expect(WorkspaceManager.getWorkspaceName('missing')).toBe('');

    const created = WorkspaceManager.createWorkspace({
      name: '  New Study  ',
      location: { moduleId: 'kjv', bookNumber: 470, chapter: 5, verse: 3 },
    });
    expect(created).toEqual(
      expect.objectContaining({
        id: 'workspace-3',
        name: 'New Study',
        paneManager: expect.objectContaining({
          activePaneId: 'pane-1',
          panes: {
            'pane-1': expect.objectContaining({
              moduleId: 'kjv',
              bookNumber: 470,
              chapter: 5,
              selectedVerse: 3,
            }),
          },
        }),
      })
    );
    expect(onActiveWorkspaceChange).toHaveBeenLastCalledWith(created?.paneManager);
    expect(WorkspaceManager.updateActivePaneState({ activePaneId: 'updated' })).toBeUndefined();
    expect(WorkspaceManager.getActivePaneState()).toEqual({ activePaneId: 'updated' });

    expect(WorkspaceManager.closeWorkspace('missing')).toBe(false);
    expect(WorkspaceManager.closeWorkspace('workspace-2')).toBe(true);
    expect(WorkspaceManager.closeWorkspace('workspace-3', { activePaneId: 'closing-current' })).toBe(true);
    expect(onActiveWorkspaceChange).toHaveBeenLastCalledWith({ activePaneId: 'pane-custom' });
    expect(WorkspaceManager.closeWorkspace('custom')).toBe(false);
  });

  it('uses default names and default Bible location when creating unnamed workspaces', () => {
    WorkspaceManager.init({ activeWorkspaceId: 'workspace-1', items: [] } as unknown as WorkspaceState);
    const created = WorkspaceManager.createWorkspace();

    expect(created?.name).toBe('Estudo 2');
    expect(created?.paneManager?.panes['pane-1']).toEqual(
      expect.objectContaining({
        moduleId: null,
        bookNumber: 10,
        chapter: 1,
        selectedVerse: null,
      })
    );
  });
});
