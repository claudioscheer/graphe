# Workspace Tabs Design

## Goal

Add top-level workspace tabs to Graphe so users can keep separate study contexts without managing several unrelated panes in one layout.

The feature should make tabs mean "study workspace", not "translation", "commentary", or "pane". Splits remain the way users compare resources inside a workspace.

## User Model

A workspace is a complete study surface. A user might have one workspace for Romans 8, another for Psalms, and another for sermon preparation. Switching workspace tabs swaps the study context while keeping global tools available.

This avoids the complexity of VS Code-style nested tab groups. Graphe already has panes, split panes, module selectors, pinned panes, search, dictionary, and commentary sync. Adding tabs inside every split would make the interface harder to explain.

## Scope

In scope:

- Top-level workspace tabs in the workbench chrome.
- Create a new workspace.
- Rename a workspace by double-clicking its tab label.
- Close a workspace from a close button on the tab.
- Confirm before closing a workspace.
- Persist all workspaces across app restarts.
- Route search result clicks into the current workspace.
- Support opening a search result in a new workspace with `Cmd/Ctrl+Click`.

Out of scope for the first version:

- VS Code-style tab stacks inside each split.
- Dragging tabs between split groups.
- Cloning the current workspace layout when creating a new workspace.
- Reordering workspace tabs.
- Workspace colors, icons, or saved templates.

## Workspace State

Each workspace owns its own `PaneManager` state:

- Split tree.
- Pane states.
- Active pane.
- Pinned link target.
- Selected modules per pane.
- Current book, chapter, and selected verse per pane.
- Pane navigation history.
- Commentary pane sync target.

The following state remains global:

- Search panel state and results.
- Dictionary panel state.
- Modules view.
- Settings.
- Theme.
- Language.
- Font size.
- Sidebar active view, collapsed state, and width.

## Default Workspace

On first launch, Graphe creates one workspace using the current default layout behavior:

- If commentary modules exist, use the existing Bible plus commentary split default.
- If not, use a single Bible pane.

This preserves the current first-run experience.

## New Workspace Behavior

When the user creates a workspace manually, the workspace starts with one Bible pane using the default Bible module.

When the user opens a search result in a new workspace with `Cmd/Ctrl+Click`, the workspace starts with one Bible pane navigated directly to that result. The workspace receives an automatic name based on the passage, such as `Romans 8`.

Manual new workspaces can receive a default name such as `Workspace 2` until renamed.

## Tab Interactions

Clicking a workspace tab activates that workspace.

Double-clicking a workspace tab label enters rename mode. Rename mode should use an inline text input in the tab. Pressing `Enter` commits the new name. Pressing `Escape` cancels. Empty names are rejected and keep the previous name.

Each workspace tab has a close button. Closing prompts the user for confirmation before removing the workspace. The prompt should include the workspace name so the user knows what is being closed.

The last remaining workspace cannot be closed. Hide the close button when only one workspace exists.

## Search Result Routing

Search remains global in the sidebar.

Normal click on a search result routes within the active workspace:

1. If the workspace has a pinned Bible pane, open the result there.
2. Otherwise, if the active pane is a Bible pane, open the result there.
3. Otherwise, open the result in the first Bible pane in the workspace.
4. If the workspace has no Bible pane because restored state was invalid, create one and open the result there.

`Cmd/Ctrl+Click` opens the search result in a new workspace with a single Bible pane. The new workspace becomes active.

This gives predictable behavior while preserving the current pinned-pane workflow.

## Architecture

Introduce a `WorkspaceManager` layer above `PaneManager`.

`WorkspaceManager` owns:

- Workspace list.
- Active workspace ID.
- Workspace names.
- Workspace creation.
- Workspace rename.
- Workspace close with confirmation flow.
- Serialization and restoration of workspace state.

`PaneManager` should continue to own only one active split tree at a time. When the active workspace changes, `WorkspaceManager` stores the outgoing `PaneManager` state, restores the incoming workspace state into `PaneManager`, and triggers a render.

This keeps the recursive split system focused and avoids mixing workspace concerns into pane rendering.

## Persistence

Add a new app-state section:

```js
workspaces: {
  version: 1,
  activeWorkspaceId: 'workspace-1',
  items: [
    {
      id: 'workspace-1',
      name: 'Romans 8',
      paneManager: '<serialized PaneManager state>'
    }
  ]
}
```

For migration, if existing app state has `paneManager` but no `workspaces`, create one workspace from the existing `paneManager` state. This preserves current user layouts.

After migration, keep the legacy `paneManager` field as a read-only fallback for one release. New saves write through `workspaces`.

## UI Placement

Place workspace tabs in the top workbench chrome near the brand and command strip. The tab bar should be compact and should not reduce reading space more than necessary.

Each tab should show:

- Workspace name.
- Active state.
- Close button.

The tab bar should include a plus button for creating a new workspace.

## Error Handling

If a workspace's saved pane state cannot be restored, fall back to a single Bible pane and keep the workspace name.

If a saved active workspace ID is missing, activate the first valid workspace.

If all saved workspaces are invalid, create one default workspace.

If a close confirmation is cancelled, no state changes are made.

## Testing

Manual verification:

- Existing users with saved `paneManager` state are migrated into one workspace.
- Creating a workspace starts with one Bible pane.
- Switching workspaces restores distinct split layouts and active panes.
- Search result normal click uses pinned pane first.
- Search result normal click falls back to active Bible pane.
- Search result normal click from commentary opens in the first Bible pane.
- `Cmd/Ctrl+Click` on a search result creates a new workspace and navigates to the result.
- Double-click rename commits with `Enter` and cancels with `Escape`.
- Close button asks before closing.
- Last workspace cannot be closed.
- Workspaces persist after app restart.

Automated coverage should include state normalization, migration from legacy `paneManager`, and search result routing rules.
