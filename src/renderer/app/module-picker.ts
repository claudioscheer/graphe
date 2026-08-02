/**
 * module-picker.js — Searchable dropdown with favorites for module selection
 */
import { AppStateStore } from './app-state-store.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';
import { Utils } from './utils.js';

type PickerModuleType = 'bible' | 'dictionary' | 'commentary' | 'crossreference' | string;

export interface ModulePickerOptions {
  modules?: ModuleRecord[];
  selectedId?: string | null;
  moduleType?: PickerModuleType;
  onChange?: (moduleId: string | null) => void;
  className?: string;
  truncateLength?: number;
  allowNone?: boolean;
  noneLabel?: string;
  showFavorites?: boolean;
}

interface ModulePickerDropdown {
  dd: HTMLDivElement;
  search: HTMLInputElement;
  list: HTMLDivElement;
}

export interface ModulePickerInstance {
  el: HTMLDivElement;
  setSelected(id: string | null): void;
  setModules(newModules: ModuleRecord[]): void;
  destroy(): void;
  open(): void;
  _close(): void;
  readonly _dropdown: HTMLDivElement | null;
}

interface ModulePickerItem {
  id: string;
  name: string;
  fileId?: string;
  isFav: boolean;
  isNone: boolean;
  divider?: false;
}

interface ModulePickerDivider {
  divider: true;
}

type ModulePickerListItem = ModulePickerItem | ModulePickerDivider;
type FavoritesListener = (moduleType: PickerModuleType) => void;

export const ModulePicker = (() => {
  let openInstance: ModulePickerInstance | null = null;

  function closeOpen(): void {
    if (openInstance) {
      openInstance._close();
      openInstance = null;
    }
  }

  // Close any open picker on outside click
  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (!openInstance) return;
    if (!(e.target instanceof Node)) return;
    if (openInstance.el.contains(e.target)) return;
    if (openInstance._dropdown && openInstance._dropdown.contains(e.target)) return;
    closeOpen();
  });

  function getFavorites(moduleType: PickerModuleType): string[] {
    const settings = AppStateStore.getSettings();
    const favs = settings.favoriteModules;
    if (!favs || !favs[moduleType]) return [];
    return favs[moduleType];
  }

  function setFavorites(moduleType: PickerModuleType, ids: string[]): void {
    const settings = AppStateStore.getSettings();
    const favs = { ...(settings.favoriteModules || {}) };
    favs[moduleType] = ids;
    AppStateStore.setSettings({ favoriteModules: favs });
  }

  function toggleFavorite(moduleType: PickerModuleType, moduleId: string): boolean {
    const favs = getFavorites(moduleType);
    const idx = favs.indexOf(moduleId);
    let nowFav;
    if (idx >= 0) {
      const next = [...favs];
      next.splice(idx, 1);
      setFavorites(moduleType, next);
      nowFav = false;
    } else {
      setFavorites(moduleType, [...favs, moduleId]);
      nowFav = true;
    }
    _fireFavoritesChange(moduleType);
    return nowFav;
  }

  function isDivider(item: ModulePickerListItem): item is ModulePickerDivider {
    return 'divider' in item && item.divider === true;
  }

  function create(options: ModulePickerOptions): ModulePickerInstance {
    const {
      modules = [],
      selectedId = null,
      moduleType = 'bible',
      onChange = () => {},
      className = '',
      truncateLength = 80,
      allowNone = false,
      noneLabel = '\u2014',
      showFavorites = true,
    } = options;

    let currentId: string | null = selectedId;
    let dropdown: ModulePickerDropdown | null = null;
    let isOpen = false;
    let highlightIdx = -1;
    let filteredItems: ModulePickerListItem[] = [];
    let searchValue = '';

    // Wrapper for positioning
    const wrapper = document.createElement('div');
    wrapper.className = 'module-picker-wrapper';

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'module-picker app-select app-select-with-icon ' + className;
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'module-picker-trigger-label';
    trigger.appendChild(triggerLabel);
    const chevron = Icons.create('chevron-down', 'w-3 h-3 app-select-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(chevron);
    updateTriggerText();
    wrapper.appendChild(trigger);

    function getDisplayName(mod: ModuleRecord): string {
      return Utils.getModuleDisplayName(mod);
    }

    function updateTriggerText(): void {
      if (allowNone && !currentId) {
        triggerLabel.textContent = noneLabel;
        trigger.title = '';
        return;
      }
      const mod = modules.find((m) => m.id === currentId);
      if (mod) {
        const name = getDisplayName(mod);
        triggerLabel.textContent = Utils.truncateText(name, truncateLength);
        trigger.title = name;
      } else {
        triggerLabel.textContent = currentId || '\u2014';
        trigger.title = '';
      }
    }

    function buildDropdown(): ModulePickerDropdown {
      const dd = document.createElement('div');
      dd.className = 'module-picker-dropdown';

      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'module-picker-search-wrapper';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'module-picker-search';
      search.setAttribute('data-i18n-placeholder', 'searchPlaceholder');
      search.placeholder = typeof I18n !== 'undefined' ? I18n.t('searchPlaceholder') : 'Search...';

      const clearBtn = document.createElement('button');
      clearBtn.className = 'module-picker-search-clear';
      clearBtn.textContent = '\u00d7';
      clearBtn.style.display = 'none';
      clearBtn.addEventListener('click', () => {
        search.value = '';
        searchValue = '';
        clearBtn.style.display = 'none';
        renderList();
        search.focus();
      });

      search.addEventListener('input', () => {
        searchValue = search.value;
        clearBtn.style.display = searchValue ? '' : 'none';
        renderList();
      });
      search.addEventListener('keydown', onSearchKeydown);

      searchWrapper.appendChild(search);
      searchWrapper.appendChild(clearBtn);
      dd.appendChild(searchWrapper);

      const list = document.createElement('div');
      list.className = 'module-picker-list';
      dd.appendChild(list);

      return { dd, search, list };
    }

    function getItems(): ModulePickerListItem[] {
      const favIds = showFavorites ? getFavorites(moduleType) : [];
      const favSet = new Set(favIds);
      const query = searchValue.toLowerCase().trim();

      const allItems: ModulePickerItem[] = [];
      if (allowNone) {
        allItems.push({ id: '', name: noneLabel, isFav: false, isNone: true });
      }
      for (const m of modules) {
        const name = getDisplayName(m);
        if (query && !name.toLowerCase().includes(query) && !m.id.toLowerCase().includes(query))
          continue;
        allItems.push({ id: m.id, name, fileId: m.id, isFav: favSet.has(m.id), isNone: false });
      }

      // Separate favorites and non-favorites
      const favItems = allItems.filter((i) => i.isFav);
      const nonFavItems = allItems.filter((i) => !i.isFav);

      if (favItems.length > 0) {
        return [...favItems, { divider: true }, ...nonFavItems];
      }
      return nonFavItems;
    }

    function renderList(): void {
      if (!dropdown) return;
      const { list } = dropdown;
      list.innerHTML = '';
      filteredItems = getItems();
      highlightIdx = -1;

      for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i];
        if (isDivider(item)) {
          const div = document.createElement('div');
          div.className = 'module-picker-divider';
          list.appendChild(div);
          continue;
        }

        const row = document.createElement('div');
        row.className = 'module-picker-item';
        if (item.id === currentId || (item.isNone && !currentId)) {
          row.classList.add('is-selected');
        }
        row.dataset.idx = String(i);

        if (showFavorites && !item.isNone) {
          const star = document.createElement('button');
          star.type = 'button';
          star.className = 'module-picker-star' + (item.isFav ? ' is-fav' : '');
          star.innerHTML = item.isFav
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
          star.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());
          star.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const nowFav = toggleFavorite(moduleType, item.id);
            item.isFav = nowFav;
            renderList();
          });
          row.appendChild(star);
        }

        const labelWrap = document.createElement('div');
        labelWrap.className = 'module-picker-label';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'module-picker-name';
        nameSpan.textContent = Utils.truncateText(item.name, truncateLength);
        nameSpan.title = item.name;
        labelWrap.appendChild(nameSpan);
        if (item.fileId && item.fileId !== item.name) {
          const fileSpan = document.createElement('span');
          fileSpan.className = 'module-picker-file';
          fileSpan.textContent = item.fileId;
          labelWrap.appendChild(fileSpan);
        }
        row.appendChild(labelWrap);

        row.addEventListener('click', () => {
          selectItem(item.isNone ? '' : item.id);
        });
        row.addEventListener('mouseenter', () => {
          highlightIdx = i;
          updateHighlight();
        });
        list.appendChild(row);
      }
    }

    function updateHighlight(): void {
      if (!dropdown) return;
      const items = dropdown.list.querySelectorAll<HTMLElement>('.module-picker-item');
      items.forEach((el) => el.classList.remove('is-highlighted'));
      for (const el of items) {
        if (parseInt(el.dataset.idx || '', 10) === highlightIdx) {
          el.classList.add('is-highlighted');
          el.scrollIntoView({ block: 'nearest' });
          break;
        }
      }
    }

    function getSelectableIndices(): number[] {
      const indices: number[] = [];
      for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i];
        if (!('divider' in item && item.divider)) indices.push(i);
      }
      return indices;
    }

    function onSearchKeydown(e: KeyboardEvent): void {
      const selectable = getSelectableIndices();
      if (selectable.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const curPos = selectable.indexOf(highlightIdx);
        highlightIdx = selectable[curPos + 1 < selectable.length ? curPos + 1 : 0];
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const curPos = selectable.indexOf(highlightIdx);
        highlightIdx = selectable[curPos - 1 >= 0 ? curPos - 1 : selectable.length - 1];
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (
          highlightIdx >= 0 &&
          filteredItems[highlightIdx] &&
          !('divider' in filteredItems[highlightIdx] && filteredItems[highlightIdx].divider)
        ) {
          const item = filteredItems[highlightIdx];
          if (!isDivider(item)) selectItem(item.isNone ? '' : item.id);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _close();
      }
    }

    function selectItem(id: string): void {
      currentId = id || null;
      updateTriggerText();
      _close();
      onChange(currentId);
    }

    function openDropdown(): void {
      if (isOpen) return;
      if (openInstance && openInstance !== instance) {
        openInstance._close();
      }
      isOpen = true;
      openInstance = instance;

      searchValue = '';
      const parts = buildDropdown();
      dropdown = parts;

      renderList();
      document.body.appendChild(parts.dd);

      // Position dropdown below trigger
      const rect = trigger.getBoundingClientRect();
      parts.dd.style.left = rect.left + 'px';
      parts.dd.style.top = rect.bottom + 'px';
      parts.dd.style.minWidth = Math.max(220, rect.width) + 'px';

      // Clamp to viewport
      requestAnimationFrame(() => {
        const ddRect = parts.dd.getBoundingClientRect();
        if (ddRect.right > window.innerWidth) {
          parts.dd.style.left = Math.max(0, window.innerWidth - ddRect.width) + 'px';
        }
        if (ddRect.bottom > window.innerHeight) {
          parts.dd.style.top = Math.max(0, rect.top - ddRect.height) + 'px';
        }
        parts.search.focus();
      });

      trigger.classList.add('is-open');
    }

    function _close(): void {
      if (!isOpen) return;
      isOpen = false;
      if (openInstance === instance) openInstance = null;
      if (dropdown) {
        dropdown.dd.remove();
        dropdown = null;
      }
      trigger.classList.remove('is-open');
    }

    trigger.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (isOpen) {
        _close();
      } else {
        openDropdown();
      }
    });

    function setSelected(id: string | null): void {
      currentId = id;
      updateTriggerText();
    }

    function setModules(newModules: ModuleRecord[]): void {
      modules.length = 0;
      modules.push(...newModules);
      updateTriggerText();
    }

    function destroy(): void {
      _close();
      wrapper.remove();
    }

    const instance = {
      el: wrapper,
      setSelected,
      setModules,
      destroy,
      open: openDropdown,
      _close,
      get _dropdown() {
        return dropdown ? dropdown.dd : null;
      },
    };
    return instance;
  }

  const _favListeners: FavoritesListener[] = [];

  function onFavoritesChange(fn: FavoritesListener): void {
    _favListeners.push(fn);
  }

  function _fireFavoritesChange(moduleType: PickerModuleType): void {
    for (const fn of _favListeners) fn(moduleType);
  }

  return { create, closeOpen, onFavoritesChange, getFavorites };
})();
