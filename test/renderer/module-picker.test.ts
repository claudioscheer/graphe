// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PickerModule = typeof import('../../src/renderer/app/module-picker.js');
type StoreModule = typeof import('../../src/renderer/app/app-state-store.js');
let rafCallbacks: FrameRequestCallback[] = [];

async function loadPicker(): Promise<PickerModule & StoreModule> {
  vi.resetModules();
  const [picker, store] = await Promise.all([
    import('../../src/renderer/app/module-picker.js'),
    import('../../src/renderer/app/app-state-store.js'),
  ]);
  return { ...picker, ...store };
}

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('ModulePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof window.requestAnimationFrame;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        saveAppState: vi.fn<WindowApi['saveAppState']>().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('opens, filters, highlights, selects, clears, and closes module choices', async () => {
    const { AppStateStore, ModulePicker } = await loadPicker();
    AppStateStore.init({ settings: { favoriteModules: { bible: ['web'] } } });
    const onChange = vi.fn();
    const favoritesChanged = vi.fn();
    ModulePicker.onFavoritesChange(favoritesChanged);

    const picker = ModulePicker.create({
      modules: [
        { id: 'kjv', type: 'bible', displayName: 'King James Version' },
        { id: 'web', type: 'bible', displayName: 'World English Bible' },
      ],
      selectedId: 'kjv',
      moduleType: 'bible',
      onChange,
      className: 'custom',
      truncateLength: 12,
      allowNone: true,
      noneLabel: 'None',
    });
    document.body.appendChild(picker.el);
    const trigger = picker.el.querySelector('button') as HTMLButtonElement;
    trigger.getBoundingClientRect = () =>
      ({ left: 250, top: 180, right: 310, bottom: 205, width: 60, height: 25 } as DOMRect);

    expect(trigger.textContent).toContain('King James V');
    expect(ModulePicker.getFavorites('bible')).toEqual(['web']);
    expect(ModulePicker.getFavorites('dictionary')).toEqual([]);

    trigger.click();
    expect(picker._dropdown).toBeTruthy();
    (picker._dropdown as HTMLElement).getBoundingClientRect = () =>
      ({ left: 250, top: 205, right: 500, bottom: 385, width: 220, height: 180 } as DOMRect);
    rafCallbacks.splice(0).forEach((callback) => callback(0));
    expect(trigger.classList.contains('is-open')).toBe(true);
    expect(document.querySelectorAll('.module-picker-item')).toHaveLength(3);
    expect(document.querySelector('.module-picker-divider')).toBeTruthy();
    expect((picker._dropdown as HTMLElement).style.left).toBe('100px');
    expect((picker._dropdown as HTMLElement).style.top).toBe('0px');

    trigger.click();
    expect(picker._dropdown).toBeNull();
    trigger.click();
    expect(picker._dropdown).toBeTruthy();

    const search = document.querySelector<HTMLInputElement>('.module-picker-search') as HTMLInputElement;
    search.value = 'king';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.module-picker-item')).toHaveLength(2);
    expect(document.querySelector('.module-picker-search-clear')?.getAttribute('style')).not.toContain(
      'none'
    );

    click('.module-picker-search-clear');
    expect(search.value).toBe('');
    expect(document.querySelectorAll('.module-picker-item')).toHaveLength(3);

    press(search, 'ArrowDown');
    press(search, 'ArrowUp');
    expect(document.querySelector('.module-picker-item.is-highlighted')).toBeTruthy();
    press(search, 'Enter');
    expect(onChange).toHaveBeenLastCalledWith('kjv');
    expect(trigger.textContent).toContain('King James V');
    expect(picker._dropdown).toBeNull();

    picker.open();
    const webStar = Array.from(document.querySelectorAll<HTMLElement>('.module-picker-item')).find((row) =>
      row.textContent?.includes('World')
    )?.querySelector<HTMLButtonElement>('.module-picker-star') as HTMLButtonElement;
    webStar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    webStar.click();
    expect(ModulePicker.getFavorites('bible')).toEqual([]);
    expect(favoritesChanged).toHaveBeenLastCalledWith('bible');

    const kjvStar = Array.from(document.querySelectorAll<HTMLElement>('.module-picker-item')).find((row) =>
      row.textContent?.includes('King')
    )?.querySelector<HTMLButtonElement>('.module-picker-star') as HTMLButtonElement;
    kjvStar.click();
    expect(ModulePicker.getFavorites('bible')).toEqual(['kjv']);

    document.querySelector<HTMLElement>('.module-picker-item')?.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    Array.from(document.querySelectorAll<HTMLElement>('.module-picker-item'))
      .find((row) => row.textContent?.includes('None'))
      ?.click();
    expect(onChange).toHaveBeenLastCalledWith(null);

    picker.setSelected('missing');
    expect(trigger.textContent).toContain('missing');
    picker.setModules([{ id: 'asv', type: 'bible', displayName: 'American Standard Version' }]);
    picker.setSelected('asv');
    expect(trigger.title).toBe('American Standard Version');

    picker.open();
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(picker._dropdown).toBeNull();

    picker.open();
    ModulePicker.closeOpen();
    expect(picker._dropdown).toBeNull();

    picker.destroy();
    expect(document.body.contains(picker.el)).toBe(false);
    vi.advanceTimersByTime(200);
    expect(window.api.saveAppState).toHaveBeenCalled();
  });

  it('supports non-favorite pickers, empty results, escape close, and single-open behavior', async () => {
    const { ModulePicker } = await loadPicker();
    const first = ModulePicker.create({
      modules: [{ id: 'dict', type: 'dictionary', displayName: 'Dictionary' }],
      selectedId: null,
      moduleType: 'dictionary',
      showFavorites: false,
    });
    const second = ModulePicker.create({
      modules: [{ id: 'comm', type: 'commentary', displayName: 'Commentary' }],
      selectedId: null,
      moduleType: 'commentary',
    });
    document.body.append(first.el, second.el);

    first.open();
    expect(first._dropdown).toBeTruthy();
    second.open();
    expect(first._dropdown).toBeNull();
    expect(second._dropdown).toBeTruthy();

    const search = document.querySelector<HTMLInputElement>('.module-picker-search') as HTMLInputElement;
    search.value = 'missing';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.module-picker-item')).toHaveLength(0);
    press(search, 'ArrowDown');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    press(search, 'Escape');
    expect(second._dropdown).toBeNull();
  });
});

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  el.click();
}
