/**
 * Commentary pane shell: module picker, sync badge, coverage/all-commentaries actions.
 */
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { ModulePicker } from './module-picker.js';
import type { PaneStateRecord } from './pane-model.js';
import { getPaneDisplayLabel } from './pane-labels.js';
import { Utils } from './utils.js';

export interface CommentaryPaneChromeDeps {
  paneId: string;
  pane: PaneStateRecord;
  panes: Record<string, PaneStateRecord>;
  commentaryModules: ModuleRecord[];
  biblePaneIds: string[];
  onActivate(): void;
  onModuleChange(moduleId: string): void | Promise<void>;
  onSyncTargetChange(syncedToPaneId: string | null): void;
  onOpenCoverage(): void;
  onOpenAllCommentaries(): void;
  onClose(): void;
}

export function createCommentaryPaneElement(deps: CommentaryPaneChromeDeps): HTMLElement {
  const {
    paneId,
    pane,
    panes,
    commentaryModules,
    biblePaneIds,
    onActivate,
    onModuleChange,
    onSyncTargetChange,
    onOpenCoverage,
    onOpenAllCommentaries,
    onClose,
  } = deps;

  const el = document.createElement('div');
  el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
  el.dataset.paneId = paneId;
  el.addEventListener('mousedown', () => onActivate());

  const toolbar = document.createElement('div');
  toolbar.className =
    'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

  const commentaryPicker = ModulePicker.create({
    modules: Utils.sortCommentaryModules(commentaryModules),
    selectedId: pane.moduleId,
    moduleType: 'commentary',
    className: 'rounded mr-1 text-xs',
    onChange: async (moduleId: string): Promise<void> => {
      await onModuleChange(moduleId);
    },
  });
  const select = commentaryPicker.el;

  const navLabel = document.createElement('span');
  navLabel.className =
    'commentary-nav-label px-2 py-1 text-sm font-medium text-brand-700 dark:text-night-200';
  navLabel.textContent = '';

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'commentary-badge-control';
  badgeWrap.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());

  if (
    !pane.syncedToPaneId ||
    !panes[pane.syncedToPaneId] ||
    panes[pane.syncedToPaneId].paneType !== 'bible'
  ) {
    pane.syncedToPaneId = null;
  }

  const badgeBtn = document.createElement('button');
  badgeBtn.type = 'button';
  badgeBtn.className = 'pane-id-badge pane-id-badge--clickable';
  badgeBtn.textContent = getPaneDisplayLabel(panes, paneId);
  badgeBtn.title = I18n.t('commentarySyncHint');
  badgeBtn.setAttribute('aria-expanded', 'false');
  badgeBtn.setAttribute('aria-haspopup', 'menu');

  const badgeMenu = document.createElement('div');
  badgeMenu.className = 'commentary-badge-menu hidden';
  badgeMenu.setAttribute('role', 'menu');
  badgeMenu.tabIndex = -1;

  let isBadgeMenuOpen = false;
  let badgeMenuDocListener: ((e: MouseEvent) => void) | null = null;

  const setBadgeMenuOpen = (open: boolean): void => {
    isBadgeMenuOpen = open;
    badgeMenu.classList.toggle('hidden', !open);
    badgeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (!badgeMenuDocListener) {
        badgeMenuDocListener = (e: MouseEvent): void => {
          if (!badgeWrap.isConnected) {
            document.removeEventListener('mousedown', badgeMenuDocListener);
            badgeMenuDocListener = null;
            return;
          }
          if (e.target instanceof Node && !badgeWrap.contains(e.target)) setBadgeMenuOpen(false);
        };
        document.addEventListener('mousedown', badgeMenuDocListener);
      }
      badgeMenu.focus();
    } else if (badgeMenuDocListener) {
      document.removeEventListener('mousedown', badgeMenuDocListener);
      badgeMenuDocListener = null;
    }
  };

  const selectSyncTarget = (value: string): void => {
    pane.syncedToPaneId = value || null;
    onSyncTargetChange(pane.syncedToPaneId);
    badgeBtn.textContent = getPaneDisplayLabel(panes, paneId);
    const selectedValue = pane.syncedToPaneId || '';
    for (const item of Array.from(badgeMenu.children) as HTMLElement[]) {
      const selected = item.dataset.value === selectedValue;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
    setBadgeMenuOpen(false);
  };

  const syncOptions = [
    { value: '', label: I18n.t('commentarySyncNone') },
    ...biblePaneIds.map((biblePaneId) => ({
      value: biblePaneId,
      label: `${I18n.t('commentarySyncBiblePrefix')} ${getPaneDisplayLabel(panes, biblePaneId)}`,
    })),
  ];

  for (const option of syncOptions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'commentary-badge-menu-item';
    item.dataset.value = option.value;
    item.textContent = option.label;
    item.setAttribute('role', 'menuitemradio');
    const selected = (pane.syncedToPaneId || '') === option.value;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-checked', selected ? 'true' : 'false');
    item.addEventListener('click', () => selectSyncTarget(option.value));
    badgeMenu.appendChild(item);
  }

  if (biblePaneIds.length === 0) {
    pane.syncedToPaneId = null;
    badgeBtn.classList.add('opacity-60', 'cursor-not-allowed');
    badgeBtn.disabled = true;
  }

  badgeBtn.addEventListener('click', () => {
    if (badgeBtn.disabled) return;
    setBadgeMenuOpen(!isBadgeMenuOpen);
  });

  badgeBtn.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !isBadgeMenuOpen) {
      e.preventDefault();
      setBadgeMenuOpen(true);
    } else if (e.key === 'Escape' && isBadgeMenuOpen) {
      e.preventDefault();
      setBadgeMenuOpen(false);
    }
  });

  badgeMenu.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setBadgeMenuOpen(false);
      badgeBtn.focus();
    }
  });

  badgeWrap.addEventListener('focusout', () => {
    if (!isBadgeMenuOpen) return;
    setTimeout(() => {
      if (!badgeWrap.contains(document.activeElement)) setBadgeMenuOpen(false);
    }, 0);
  });

  badgeWrap.append(badgeBtn, badgeMenu);

  const infoBtn = document.createElement('button');
  infoBtn.className =
    'cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
  infoBtn.appendChild(Icons.create('info'));
  infoBtn.title = I18n.t('commentaryCoverage');
  infoBtn.addEventListener('click', () => onOpenCoverage());

  const allCommBtn = document.createElement('button');
  allCommBtn.className =
    'cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
  allCommBtn.appendChild(Icons.create('book-open'));
  allCommBtn.title = I18n.t('allCommentaries');
  allCommBtn.addEventListener('click', () => onOpenAllCommentaries());

  const closeBtn = document.createElement('button');
  closeBtn.className =
    'pane-close-btn cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
  closeBtn.appendChild(Icons.create('x'));
  closeBtn.title = I18n.t('closePane');
  closeBtn.addEventListener('click', () => onClose());

  toolbar.append(badgeWrap, select, navLabel, spacer, allCommBtn, infoBtn, closeBtn);

  const content = document.createElement('div');
  content.className = 'pane-content flex-1 overflow-y-auto';

  el.appendChild(toolbar);
  el.appendChild(content);
  return el;
}
