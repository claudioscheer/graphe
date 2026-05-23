// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Icons } from '../../src/renderer/js/icons.js';
import { I18n } from '../../src/renderer/js/i18n.js';
import { Sanitize } from '../../src/renderer/js/sanitize.js';
import { Utils } from '../../src/renderer/js/utils.js';
import { VerseUtils } from '../../src/renderer/js/verse-utils.js';

describe('renderer utility helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('escapes, truncates, names, and sorts modules', () => {
    expect(Utils.escapeHtml('<tag attr="x">&')).toBe('&lt;tag attr=&quot;x&quot;&gt;&amp;');
    expect(Utils.truncateText(null)).toBe('');
    expect(Utils.truncateText('abcdef', 3)).toBe('abc');
    expect(Utils.truncateText('abcdef', 0)).toBe('');
    expect(Utils.getModuleDisplayName({ id: 'id', listLabel: 'List' })).toBe('List');
    expect(Utils.getModuleDisplayName({ id: 'id', displayName: 'Display' })).toBe('Display');
    expect(Utils.getModuleDisplayName({ id: 'id', shortTitle: 'Short' })).toBe('Short');
    expect(Utils.getModuleDisplayName({ id: 'id', description: 'Description' })).toBe(
      'Description'
    );
    expect(Utils.getModuleDisplayName({ id: 'id' })).toBe('id');

    const modules = [
      { id: 'z', type: 'dictionary', displayName: 'Zulu' },
      { id: 'b', type: 'bible', displayName: 'Bible 10' },
      { id: 'a', type: 'bible', displayName: 'Bible 2' },
    ];

    expect(Utils.sortBibleModules(modules).map((module) => module.id)).toEqual(['a', 'b']);
    expect(Utils.sortCommentaryModules(modules).map((module) => module.id)).toEqual([
      'a',
      'b',
      'z',
    ]);
  });

  it('sanitizes html while preserving safe links and image data urls', () => {
    expect(
      Sanitize.sanitizeHtml(
        '<script>x</script><a href="javascript:alert(1)" onclick="x()">bad</a>' +
          '<a href="https://example.test" style="color:red">ok</a>' +
          '<img src="data:image/png;base64,abc" width="10"><form></form>'
      )
    ).toBe('<a>bad</a><a href="https://example.test">ok</a><img src="data:image/png;base64,abc">');

    expect(Sanitize.isSafeUrl(null)).toBe(true);
    expect(Sanitize.isSafeUrl('#anchor')).toBe(true);
    expect(Sanitize.isSafeUrl('/path')).toBe(true);
    expect(Sanitize.isSafeUrl('./path')).toBe(true);
    expect(Sanitize.isSafeUrl('../path')).toBe(true);
    expect(Sanitize.isSafeUrl('mailto:test@example.test')).toBe(true);
    expect(Sanitize.isSafeUrl('tel:555')).toBe(true);
    expect(Sanitize.isSafeUrl('B:1 1:1')).toBe(true);
    expect(Sanitize.isSafeUrl('S:G3056')).toBe(true);
    expect(Sanitize.isSafeUrl('data:text/html;base64,abc')).toBe(false);
    expect(Sanitize.isSafeUrl(' java\nscript:alert(1)')).toBe(false);
    expect(Sanitize.isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('cleans verse text and preserves selected Strong tags', () => {
    const raw =
      '<n>range</n><O>α<o><T>alpha<t><X>x<x><m>m</m><l>l</l>' +
      'In <i>the</i> beginning<pb/>God<S>H430</S><f>note</f><E>made<e><bad>tag</bad>';

    expect(VerseUtils.cleanText(raw)).toBe('In the beginning God made tag');
    expect(VerseUtils.cleanTextWithStrongs(raw, [{ prefix: 'H', number: '430' }])).toBe(
      'In the beginning <mark>God <span class="strongs-tag">[H430]</span></mark> made tag'
    );
    expect(VerseUtils.cleanText(null)).toBe('');
    expect(VerseUtils.cleanTextWithStrongs(null, [])).toBe('');
    expect(VerseUtils.cleanTextWithStrongs('Word<S>G3056</S>', [{ prefix: 'H', number: '430' }])).toBe(
      'Word'
    );
  });

  it('creates lucide icons and rejects missing names', () => {
    const icon = Icons.create('book-open', 'custom');

    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.getAttribute('class')).toContain('lucide-book-open custom');
    expect(() => Icons.create('missing' as Parameters<typeof Icons.create>[0])).toThrow(
      'Unknown icon: missing'
    );
  });
});

describe('I18n', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('selects supported languages, falls back for unknown keys, and localizes book names', () => {
    expect(I18n.getCurrentLang()).toBe('pt');
    expect(I18n.t('settings')).toBe('Configurações');
    expect(I18n.t('missingKey')).toBe('missingKey');
    expect(I18n.bookName(10)).toEqual({ short: 'Gn', long: 'Gênesis' });
    expect(I18n.bookName(999)).toEqual({ short: '999', long: '999' });
    expect(I18n.findBookByAbbrev('jo')).toBe(220);
    expect(I18n.findBookByAbbrev('j')).toBe(60);
    expect(I18n.findBookByAbbrev('zzz')).toBeNull();

    I18n.setLang('en');
    expect(localStorage.getItem('graphe-lang')).toBe('en');
    expect(I18n.t('settings')).toBe('Settings');
    expect(I18n.bookName(10)).toEqual({ short: 'Gen', long: 'Genesis' });
    expect(I18n.findBookByAbbrev('Gen')).toBe(10);

    I18n.setLang('invalid');
    expect(I18n.getCurrentLang()).toBe('pt');
  });

  it('updates text, placeholder, and title attributes in the DOM', () => {
    document.body.innerHTML = `
      <span data-i18n="search"></span>
      <input data-i18n-placeholder="searchPlaceholder" />
      <button data-i18n-title="settings"></button>
      <textarea data-i18n-placeholder="dictSearchPlaceholder"></textarea>
      <div data-i18n-title="close"></div>
    `;

    I18n.setLang('en');

    expect(document.querySelector('[data-i18n]')?.textContent).toBe('Search');
    expect(document.querySelector('input')?.placeholder).toBe('Search by word...');
    expect(document.querySelector('textarea')?.placeholder).toBe('Search topic...');
    expect(document.querySelector('button')?.getAttribute('title')).toBe('Settings');
    expect(document.querySelector('div')?.getAttribute('title')).toBe('Close');
  });
});

describe('AppStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  it('normalizes loaded state and debounces persistence through window.api', async () => {
    const saveAppState = vi.fn<WindowApi['saveAppState']>().mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { saveAppState },
    });
    vi.resetModules();
    const { AppStateStore } = await import('../../src/renderer/js/app-state-store.js');

    AppStateStore.init({
      settings: { language: 'en', fontSize: 18 },
      workbench: { version: 1, activeView: '', collapsed: true, widthRatio: 0.9 },
      searchPanel: { moduleId: 'kjv', query: 'faith', widthRatio: 0.2 },
      workspaces: {
        activeWorkspaceId: 'missing',
        items: [
          { id: 'a', name: '  First  ', paneManager: { activePaneId: 'pane-1' } },
          { id: 'b', name: '', paneManager: null },
        ],
      },
      dictPanel: { selectedModuleId: 'strong', moduleSearchCache: { strong: 'G3056' } },
    });

    expect(AppStateStore.getSettings()).toMatchObject({ language: 'en', fontSize: 18 });
    expect(AppStateStore.getWorkbench()).toEqual({
      version: 1,
      activeView: 'search',
      collapsed: true,
      widthRatio: 0.6,
    });
    expect(AppStateStore.getWorkspaces()).toEqual({
      version: 1,
      activeWorkspaceId: 'a',
      items: [
        { id: 'a', name: 'First', paneManager: { activePaneId: 'pane-1' } },
        { id: 'b', name: 'Workspace 2', paneManager: null },
      ],
    });
    expect(AppStateStore.getSearchPanel()).toEqual({
      moduleId: 'kjv',
      query: 'faith',
      widthRatio: 0.2,
    });
    expect(AppStateStore.getDictPanel()).toEqual({
      selectedModuleId: 'strong',
      moduleSearchCache: { strong: 'G3056' },
    });

    AppStateStore.setSettings({ theme: 'dark' });
    AppStateStore.setPaneManager({ activePaneId: 'pane-2' });
    AppStateStore.setWorkbench({ widthRatio: 0.3 });
    AppStateStore.setSearchPanel({ moduleId: 'kjv', query: 'hope' });
    AppStateStore.setDictPanel({ selectedModuleId: null, moduleSearchCache: {} });
    vi.advanceTimersByTime(199);
    expect(saveAppState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(saveAppState).toHaveBeenCalledTimes(1);
    expect(AppStateStore.getPaneManager()).toEqual({ activePaneId: 'pane-2' });
    expect(AppStateStore.getWorkbench()).toEqual({
      version: 1,
      activeView: 'search',
      collapsed: true,
      widthRatio: 0.3,
    });
    expect(AppStateStore.getSearchPanel()).toEqual({ moduleId: 'kjv', query: 'hope' });
    expect(AppStateStore.getDictPanel()).toEqual({ selectedModuleId: null, moduleSearchCache: {} });
  });

  it('handles empty init input, invalid workspaces, and save failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const saveAppState = vi.fn<WindowApi['saveAppState']>().mockRejectedValue(new Error('disk'));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { saveAppState },
    });
    vi.resetModules();
    const { AppStateStore } = await import('../../src/renderer/js/app-state-store.js');

    AppStateStore.init(null);
    expect(AppStateStore.getWorkspaces()).toBeNull();
    AppStateStore.setWorkspaces({ items: [] });
    expect(AppStateStore.getWorkspaces()).toBeNull();
    AppStateStore.setSettings({ language: 'pt' });
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to save app state:',
      expect.objectContaining({ message: 'disk' })
    );
    consoleError.mockRestore();
  });
});
