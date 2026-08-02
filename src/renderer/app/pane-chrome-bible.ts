/**
 * Bible pane shell: toolbar, module picker, nav, options menu, quick-switch bar.
 */
import { AppStateStore } from './app-state-store.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { ModulePicker, type ModulePickerInstance } from './module-picker.js';
import { Navigation } from './navigation.js';
import type { NavDirection, PaneStateRecord } from './pane-model.js';
import { getPaneDisplayLabel } from './pane-labels.js';
import { Utils } from './utils.js';

export interface BiblePaneChromeDeps {
  paneId: string;
  pane: PaneStateRecord;
  panes: Record<string, PaneStateRecord>;
  modules: ModuleRecord[];
  linkTargetPaneId: string | null;
  onActivate(): void;
  onModuleChange(moduleId: string): void | Promise<void>;
  onPrevChapter(): void;
  onNextChapter(): void;
  onClose(): void;
  onSetLinkTarget(): void;
  onClearLinkTarget(): void;
  attachNavHistoryLongPress(button: HTMLButtonElement, direction: NavDirection): void;
  registerPicker(picker: ModulePickerInstance): void;
  switchModule(moduleId: string): void | Promise<void>;
}

export function createBiblePaneElement(deps: BiblePaneChromeDeps): HTMLElement {
  const {
    paneId,
    pane,
    panes,
    modules,
    linkTargetPaneId,
    onActivate,
    onModuleChange,
    onPrevChapter,
    onNextChapter,
    onClose,
    onSetLinkTarget,
    onClearLinkTarget,
    attachNavHistoryLongPress,
    registerPicker,
    switchModule,
  } = deps;

  const el = document.createElement('div');
  el.className = 'pane-shell flex flex-col h-full w-full min-w-0 min-h-0';
  el.dataset.paneId = paneId;
  el.addEventListener('mousedown', () => onActivate());

  const toolbar = document.createElement('div');
  toolbar.className =
    'pane-toolbar flex items-center gap-1 px-2 py-1 border-b border-brand-300 dark:border-night-600 bg-brand-100 dark:bg-night-800 flex-shrink-0';

  const picker = ModulePicker.create({
    modules: Utils.sortBibleModules(modules),
    selectedId: pane.moduleId,
    moduleType: 'bible',
    className: 'rounded mr-1 text-xs',
    onChange: async (moduleId: string): Promise<void> => {
      await onModuleChange(moduleId);
    },
  });
  registerPicker(picker);
  const select = picker.el;

  const prevBtn = document.createElement('button');
  prevBtn.className =
    'nav-prev-btn cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
  const prevIcon = Icons.create('chevron-left');
  prevIcon.setAttribute('width', '16');
  prevIcon.setAttribute('height', '16');
  prevIcon.style.flexShrink = '0';
  prevBtn.appendChild(prevIcon);
  const prevBtnLabel = document.createElement('span');
  prevBtnLabel.className = 'nav-prev-label';
  prevBtn.appendChild(prevBtnLabel);
  prevBtn.title = I18n.t('prevChapter');
  prevBtn.addEventListener('click', () => onPrevChapter());

  const navBtn = document.createElement('button');
  navBtn.className =
    'nav-btn cursor-pointer transition-colors text-sm font-medium min-w-[80px] inline-flex items-center justify-center gap-1.5';
  const navBtnLabel = document.createElement('span');
  navBtnLabel.className = 'nav-btn-label';
  navBtnLabel.textContent = '...';
  navBtn.appendChild(navBtnLabel);
  navBtn.addEventListener('click', async () => {
    try {
      const books = await window.api.getBooks(pane.moduleId);
      Navigation.open(paneId, books);
    } catch (err) {
      console.warn('Failed to open navigation:', err);
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className =
    'nav-next-btn cursor-pointer transition-colors inline-flex items-center justify-center gap-1';
  const nextBtnLabel = document.createElement('span');
  nextBtnLabel.className = 'nav-next-label';
  nextBtn.appendChild(nextBtnLabel);
  const nextIcon = Icons.create('chevron-right');
  nextIcon.setAttribute('width', '16');
  nextIcon.setAttribute('height', '16');
  nextIcon.style.flexShrink = '0';
  nextBtn.appendChild(nextIcon);
  nextBtn.title = I18n.t('nextChapter');
  nextBtn.addEventListener('click', () => onNextChapter());

  const navGroup = document.createElement('div');
  navGroup.className = 'nav-group';
  navGroup.append(prevBtn, navBtn, nextBtn);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className =
    'pane-back-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
  backBtn.disabled = true;
  backBtn.appendChild(Icons.create('arrow-left', 'w-3.5 h-3.5'));
  const backBtnLabel = document.createElement('span');
  backBtnLabel.className = 'pane-options-menu-label';
  backBtnLabel.textContent = I18n.t('crossRefBackTooltip');
  backBtn.appendChild(backBtnLabel);
  backBtn.title = I18n.t('crossRefBackTooltip');
  attachNavHistoryLongPress(backBtn, 'back');

  const forwardBtn = document.createElement('button');
  forwardBtn.type = 'button';
  forwardBtn.className =
    'pane-forward-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
  forwardBtn.disabled = true;
  forwardBtn.appendChild(Icons.create('arrow-right', 'w-3.5 h-3.5'));
  const forwardBtnLabel = document.createElement('span');
  forwardBtnLabel.className = 'pane-options-menu-label';
  forwardBtnLabel.textContent = I18n.t('crossRefForwardTooltip');
  forwardBtn.appendChild(forwardBtnLabel);
  forwardBtn.title = I18n.t('crossRefForwardTooltip');
  attachNavHistoryLongPress(forwardBtn, 'forward');

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className =
    'pane-pin-btn pane-options-menu-item cursor-pointer transition-colors inline-flex items-center';
  const isPinned = linkTargetPaneId === paneId;
  pinBtn.appendChild(Icons.create(isPinned ? 'pin' : 'pin-off'));
  const pinBtnLabel = document.createElement('span');
  pinBtnLabel.className = 'pane-options-menu-label';
  pinBtnLabel.textContent = isPinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
  pinBtn.appendChild(pinBtnLabel);
  pinBtn.title = isPinned ? I18n.t('unpinLinkTarget') : I18n.t('pinLinkTarget');
  if (isPinned) pinBtn.classList.add('pane-link-target');
  pinBtn.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());
  pinBtn.addEventListener('click', () => {
    if (linkTargetPaneId === paneId) {
      onClearLinkTarget();
    } else {
      onSetLinkTarget();
    }
  });

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'pane-options-control';
  optionsWrap.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());

  const optionsBtn = document.createElement('button');
  optionsBtn.type = 'button';
  optionsBtn.className =
    'pane-options-btn cursor-pointer transition-colors inline-flex items-center justify-center';
  optionsBtn.appendChild(Icons.create('ellipsis'));
  optionsBtn.title = I18n.t('paneOptions');
  optionsBtn.setAttribute('aria-haspopup', 'menu');
  optionsBtn.setAttribute('aria-expanded', 'false');

  const optionsMenu = document.createElement('div');
  optionsMenu.className = 'pane-options-menu hidden';
  optionsMenu.setAttribute('role', 'menu');
  optionsMenu.tabIndex = -1;

  let isOptionsMenuOpen = false;
  let optionsMenuDocListener: ((e: MouseEvent) => void) | null = null;

  const setOptionsMenuOpen = (open: boolean): void => {
    isOptionsMenuOpen = open;
    optionsMenu.classList.toggle('hidden', !open);
    optionsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (!optionsMenuDocListener) {
        optionsMenuDocListener = (e: MouseEvent): void => {
          if (!optionsWrap.isConnected) {
            document.removeEventListener('mousedown', optionsMenuDocListener);
            optionsMenuDocListener = null;
            return;
          }
          if (e.target instanceof Node && !optionsWrap.contains(e.target))
            setOptionsMenuOpen(false);
        };
        document.addEventListener('mousedown', optionsMenuDocListener);
      }
      optionsMenu.focus();
    } else if (optionsMenuDocListener) {
      document.removeEventListener('mousedown', optionsMenuDocListener);
      optionsMenuDocListener = null;
    }
  };

  [backBtn, forwardBtn, pinBtn].forEach((btn) => {
    btn.setAttribute('role', 'menuitem');
    btn.addEventListener('click', () => setOptionsMenuOpen(false));
  });

  optionsBtn.addEventListener('click', () => setOptionsMenuOpen(!isOptionsMenuOpen));
  optionsBtn.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !isOptionsMenuOpen) {
      e.preventDefault();
      setOptionsMenuOpen(true);
    } else if (e.key === 'Escape' && isOptionsMenuOpen) {
      e.preventDefault();
      setOptionsMenuOpen(false);
    }
  });
  optionsMenu.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOptionsMenuOpen(false);
      optionsBtn.focus();
    }
  });
  optionsWrap.addEventListener('focusout', () => {
    if (!isOptionsMenuOpen) return;
    setTimeout(() => {
      if (!optionsWrap.contains(document.activeElement)) setOptionsMenuOpen(false);
    }, 0);
  });
  optionsMenu.append(backBtn, forwardBtn, pinBtn);
  optionsWrap.append(optionsBtn, optionsMenu);

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  const closeBtn = document.createElement('button');
  closeBtn.className =
    'pane-close-btn cursor-pointer transition-colors text-sm inline-flex items-center justify-center';
  closeBtn.appendChild(Icons.create('x'));
  closeBtn.title = I18n.t('closePane');
  closeBtn.addEventListener('click', () => onClose());

  const idBadge = document.createElement('span');
  idBadge.className = 'pane-id-badge';
  idBadge.textContent = getPaneDisplayLabel(panes, paneId);

  toolbar.append(idBadge, select, navGroup, spacer, optionsWrap, closeBtn);

  const content = document.createElement('div');
  content.className = 'pane-content flex-1 overflow-y-auto';

  const quickBar = document.createElement('div');
  quickBar.className = 'pane-quick-switch';
  quickBar.dataset.paneId = paneId;

  // Populate quick bar immediately (element may not be in document yet)
  const favs = (AppStateStore.getSettings().favoriteModules || {}).bible || [];
  if (favs.length === 0) {
    quickBar.style.display = 'none';
  } else {
    quickBar.style.display = '';
    for (const favId of favs) {
      const mod = modules.find((m) => m.id === favId);
      if (!mod) continue;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pane-quick-pill' + (favId === pane.moduleId ? ' is-active' : '');
      pill.textContent = mod.shortTitle || mod.id;
      pill.title = Utils.getModuleDisplayName(mod);
      pill.addEventListener('click', () => {
        void switchModule(favId);
      });
      quickBar.appendChild(pill);
    }
  }

  el.appendChild(toolbar);
  el.appendChild(quickBar);
  el.appendChild(content);
  return el;
}
