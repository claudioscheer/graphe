// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18n } from '../../src/renderer/js/i18n.js';
import { Navigation, setNavigationPaneManager } from '../../src/renderer/js/navigation.js';

type NavigatePane = (
  paneId: string | null,
  bookNumber: number,
  chapter: number,
  verse?: number | null
) => Promise<boolean>;

function keydown(target: Element | Document, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    I18n.setLang('en');
    document.body.innerHTML = `
      <div id="nav-overlay" class="hidden">
        <button id="nav-close"></button>
        <button id="nav-back" class="hidden"></button>
        <input id="nav-input" />
        <div id="nav-grid"></div>
      </div>
    `;
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getChapterCount: vi.fn<WindowApi['getChapterCount']>().mockResolvedValue(2),
        getChapter: vi.fn<WindowApi['getChapter']>().mockResolvedValue([
          { verse: 1, text: 'one' },
          { verse: 2, text: 'two' },
          { verse: 2, text: 'duplicate' },
          { verse: Number.NaN, text: 'invalid' },
        ]),
      },
    });
  });

  it('navigates through book, chapter, verse, quick input, back, and close interactions', async () => {
    const paneManager = {
      getPane: vi.fn(() => ({ moduleId: 'kjv' })),
      navigatePane: vi.fn<NavigatePane>().mockResolvedValue(true),
    };
    setNavigationPaneManager(paneManager);
    Navigation.init();

    const books = [
      { bookNumber: 10, shortName: 'Gen', longName: 'Genesis' },
      { bookNumber: 470, shortName: 'Mat', longName: 'Matthew' },
    ];
    Navigation.open('pane-1', books);

    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('.nav-book-btn')).toHaveLength(2);
    expect(document.querySelector('.nav-book-btn')?.textContent).toBe('Gen');

    document.querySelector<HTMLButtonElement>('.nav-book-btn')?.click();
    await flushPromises();
    expect(window.api.getChapterCount).toHaveBeenCalledWith('kjv', 10);
    expect(document.querySelectorAll('.nav-chapter-btn')).toHaveLength(2);

    document.getElementById('nav-back')?.click();
    expect(document.querySelectorAll('.nav-book-btn')).toHaveLength(2);

    document.querySelector<HTMLButtonElement>('.nav-book-btn')?.click();
    await flushPromises();
    document.querySelector<HTMLButtonElement>('.nav-chapter-btn')?.click();
    await flushPromises();
    expect(window.api.getChapter).toHaveBeenCalledWith('kjv', 10, 1);
    expect(document.querySelectorAll('.nav-verse-btn')).toHaveLength(2);

    document.getElementById('nav-back')?.click();
    await flushPromises();
    expect(document.querySelectorAll('.nav-chapter-btn')).toHaveLength(2);

    document.querySelector<HTMLButtonElement>('.nav-chapter-btn')?.click();
    await flushPromises();

    document.querySelectorAll<HTMLButtonElement>('.nav-verse-btn')[1].click();
    expect(paneManager.navigatePane).toHaveBeenLastCalledWith('pane-1', 10, 1, 2);
    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(true);

    Navigation.open('pane-1', books);
    const input = document.getElementById('nav-input') as HTMLInputElement;
    input.value = 'Gen 2:1';
    keydown(input, 'Enter');
    await flushPromises();
    expect(paneManager.navigatePane).toHaveBeenLastCalledWith('pane-1', 10, 2, 1);

    Navigation.open('pane-1', books);
    input.value = 'not a ref';
    keydown(input, 'Enter');
    await flushPromises();
    expect(paneManager.navigatePane).toHaveBeenCalledTimes(2);

    Navigation.open('pane-1', books);
    keydown(document, 'Escape');
    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(true);

    Navigation.open('pane-1', books);
    document.getElementById('nav-close')?.click();
    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(true);

    Navigation.open('pane-1', books);
    document.getElementById('nav-overlay')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(true);
  });

  it('navigates directly to a chapter when no verse numbers are available', async () => {
    window.api.getChapter = vi.fn<WindowApi['getChapter']>().mockResolvedValue([]);
    const paneManager = {
      getPane: vi.fn(() => ({ moduleId: 'kjv' })),
      navigatePane: vi.fn<NavigatePane>().mockResolvedValue(true),
    };
    setNavigationPaneManager(paneManager);
    Navigation.init();
    Navigation.open('pane-2', [{ bookNumber: 10, shortName: 'Gen', longName: 'Genesis' }]);

    document.querySelector<HTMLButtonElement>('.nav-book-btn')?.click();
    await flushPromises();
    document.querySelector<HTMLButtonElement>('.nav-chapter-btn')?.click();
    await flushPromises();

    expect(paneManager.navigatePane).toHaveBeenCalledWith('pane-2', 10, 1);
    expect(document.getElementById('nav-overlay')?.classList.contains('hidden')).toBe(true);
  });

  it('returns early when no pane is active or quick input is empty/unavailable', async () => {
    const paneManager = {
      getPane: vi.fn(() => null),
      navigatePane: vi.fn<NavigatePane>().mockResolvedValue(true),
    };
    setNavigationPaneManager(paneManager);
    Navigation.init();
    Navigation.open('pane-3', [{ bookNumber: 10, shortName: 'Gen', longName: 'Genesis' }]);

    document.querySelector<HTMLButtonElement>('.nav-book-btn')?.click();
    await flushPromises();
    expect(window.api.getChapterCount).not.toHaveBeenCalled();

    const input = document.getElementById('nav-input') as HTMLInputElement;
    input.value = '';
    keydown(input, 'Enter');
    input.value = 'Gen 1';
    keydown(input, 'Enter');
    await flushPromises();
    expect(paneManager.navigatePane).not.toHaveBeenCalled();
  });
});
