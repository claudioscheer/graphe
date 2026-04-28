# Workspace Tabs Global Row Design

## Goal

Move workspace tabs into a compact global row above the existing app header. The row should make workspaces feel like top-level app context while preserving the current pane toolbar and workspace behaviors.

## Chosen Approach

Use a two-row workbench header:

- `workbench-workspace-strip`: new top row containing workspace tabs and the add button.
- `workbench-top-strip`: existing app header row containing the brand area, command/navigation trigger, and top actions.

The current workspace tab controls remain the same: click to activate, double-click the label to rename, close button when more than one workspace exists, and plus button to create a workspace.

## Components

- `WorkbenchShell.createTopStrip()` will no longer render workspace tabs inside `workbench-top-left`.
- A new `WorkbenchShell.createWorkspaceStrip()` function will create the tablist row.
- `WorkbenchShell.init()` will append the workspace strip before the existing top strip.
- Existing workspace rendering functions will continue to target `workspaceTabsEl`.

## Layout And Styling

The workspace strip should be about 26px tall, full width, visually connected to the current header, and restrained. Tabs should be small and horizontally constrained so long workspace names truncate instead of resizing the header. The active workspace should read as selected without drawing attention away from the reading panes.

Dark mode should mirror the existing header colors. The row should use existing UI variables where possible and avoid introducing a new color system.

## Data Flow

No persistence or state model changes are needed. `WorkspaceManager` continues to send tab state through `WorkbenchShell.setWorkspaceTabs()`, and `WorkbenchShell` continues to call the existing activate, create, rename, and close handlers from `app.js`.

## Error Handling

The existing defensive behavior remains:

- Missing tab state renders an empty row with the add button.
- Invalid handler callbacks are ignored.
- Rename with an empty value cancels back to the current rendered tab.
- Close behavior remains blocked when only one workspace exists.

## Testing

Manual verification is sufficient for this layout-only change:

- Start the app and confirm the workspace tab row appears above the app header.
- Create, activate, rename, and close a workspace.
- Confirm long names truncate.
- Confirm dark mode styling remains legible.
- Confirm the SQLite module load error does not reappear after the earlier Electron rebuild.
