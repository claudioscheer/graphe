/**
 * Navigation history dropdown menu UI for bible panes.
 */
import { I18n } from './i18n.js';
import type { NavDirection, NavHistoryEntry, PaneStateRecord } from './pane-model.js';
import { getNavHistoryEntries } from './pane-history.js';
import { Utils } from './utils.js';

let activeNavHistoryMenu: HTMLElement | null = null;

function buildNavHistoryItemContent(
  entry: NavHistoryEntry,
  modules: ModuleRecord[]
): HTMLElement[] {
  const reference = document.createElement('span');
  reference.className = 'pane-history-reference';
  reference.textContent = formatNavHistoryReference(entry);

  const module = modules.find((m) => m.id === entry.moduleId);
  const moduleLabel = document.createElement('span');
  moduleLabel.className = 'pane-history-module';
  moduleLabel.textContent = module
    ? Utils.truncateText(Utils.getModuleDisplayName(module), 34)
    : '';

  return moduleLabel.textContent ? [reference, moduleLabel] : [reference];
}

export function formatNavHistoryReference(entry: NavHistoryEntry): string {
  const book = I18n.bookName(entry.bookNumber).short;
  const chapter = Number.isInteger(entry.chapter) ? entry.chapter : 1;
  const verse = Number.isInteger(entry.verse) ? `:${entry.verse}` : '';
  return `${book} ${chapter}${verse}`;
}

function positionNavHistoryMenu(menu: HTMLElement, anchorEl: HTMLElement): void {
  const anchorRect = anchorEl.getBoundingClientRect();
  const margin = 6;
  const menuRect = menu.getBoundingClientRect();
  const top = Math.max(margin, anchorRect.top - menuRect.height - margin);
  const left = Math.min(
    window.innerWidth - menuRect.width - margin,
    Math.max(margin, anchorRect.right - menuRect.width)
  );
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function handleNavHistoryOutsidePointer(event: PointerEvent): void {
  if (
    activeNavHistoryMenu &&
    event.target instanceof Node &&
    !activeNavHistoryMenu.contains(event.target)
  ) {
    closeNavHistoryMenu();
  }
}

function handleNavHistoryKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeNavHistoryMenu();
}

export function closeNavHistoryMenu(): void {
  if (!activeNavHistoryMenu) return;
  activeNavHistoryMenu.remove();
  activeNavHistoryMenu = null;
  document.removeEventListener('pointerdown', handleNavHistoryOutsidePointer, true);
  document.removeEventListener('keydown', handleNavHistoryKeydown, true);
  window.removeEventListener('resize', closeNavHistoryMenu);
}

export function showNavHistoryMenu(opts: {
  pane: PaneStateRecord;
  direction: NavDirection;
  anchorEl: HTMLElement;
  modules: ModuleRecord[];
  onSelectIndex(historyIndex: number): void;
}): void {
  const { pane, direction, anchorEl, modules, onSelectIndex } = opts;
  const entries = getNavHistoryEntries(pane, direction);
  if (entries.length === 0) return;

  closeNavHistoryMenu();

  const menu = document.createElement('div');
  menu.className = 'pane-history-menu';
  menu.setAttribute('role', 'menu');

  for (const item of entries) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'pane-history-menu-item';
    option.setAttribute('role', 'menuitem');
    option.append(...buildNavHistoryItemContent(item.entry, modules));
    option.addEventListener('click', () => {
      closeNavHistoryMenu();
      onSelectIndex(item.index);
    });
    menu.appendChild(option);
  }

  document.body.appendChild(menu);
  positionNavHistoryMenu(menu, anchorEl);
  activeNavHistoryMenu = menu;

  setTimeout(() => {
    document.addEventListener('pointerdown', handleNavHistoryOutsidePointer, true);
    document.addEventListener('keydown', handleNavHistoryKeydown, true);
    window.addEventListener('resize', closeNavHistoryMenu, { once: true });
  }, 0);
}
