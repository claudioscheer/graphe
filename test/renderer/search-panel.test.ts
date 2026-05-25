// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SearchPanelModule = typeof import('../../src/renderer/app/search-panel.js');

const workbenchMock = vi.hoisted(() => ({
  activateSidebar: vi.fn(),
}));

const pickerMock = vi.hoisted(() => {
  type PickerOptions = {
    onChange?: (moduleId: string | null) => void;
    modules?: ModuleRecord[];
    selectedId?: string | null;
  };
  const instances: Array<{
    el: HTMLDivElement;
    options: PickerOptions;
    setSelected: ReturnType<typeof vi.fn>;
    setModules: ReturnType<typeof vi.fn>;
  }> = [];
  const create = vi.fn((options: PickerOptions) => {
    const el = document.createElement('div');
    el.className = 'mock-module-picker';
    const instance = {
      el,
      options,
      setSelected: vi.fn(),
      setModules: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });
  return { create, instances };
});

vi.mock('../../src/renderer/app/workbench-shell.js', () => ({
  WorkbenchShell: workbenchMock,
}));

vi.mock('../../src/renderer/app/module-picker.js', () => ({
  ModulePicker: {
    create: pickerMock.create,
  },
}));

async function loadSearchPanel(): Promise<SearchPanelModule> {
  vi.resetModules();
  pickerMock.instances.length = 0;
  pickerMock.create.mockClear();
  workbenchMock.activateSidebar.mockClear();
  return import('../../src/renderer/app/search-panel.js');
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function key(input: HTMLInputElement, value: string, keyName = 'Enter'): void {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
}

describe('SearchPanel', () => {
  const modules: ModuleRecord[] = [
    { id: 'kjv', type: 'bible', displayName: 'KJV' },
    { id: 'web', type: 'bible', displayName: 'WEB' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div><div id="pane-root"></div>';
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getBooks: vi.fn<WindowApi['getBooks']>().mockResolvedValue([
          { bookNumber: 10, shortName: 'Gen', longName: 'Genesis' },
          { bookNumber: 470, shortName: 'Matt', longName: 'Matthew' },
        ]),
        searchVerses: vi.fn<WindowApi['searchVerses']>().mockResolvedValue([
          {
            moduleId: 'kjv',
            bookNumber: 470,
            chapter: 5,
            verse: 3,
            text: 'Blessed are the poor in spirit for theirs is the kingdom',
          },
          {
            moduleId: 'kjv',
            bookNumber: 10,
            chapter: 1,
            verse: 1,
            text: 'In the beginning God created the heavens and the earth',
          },
        ]),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the panel, restores saved searches, renders sorted results, and opens selections', async () => {
    const { SearchPanel } = await loadSearchPanel();
    const onStateChange = vi.fn();
    const onOpenResult = vi.fn();
    SearchPanel.setStateChangeListener(onStateChange);

    SearchPanel.init(
      modules,
      { moduleId: 'web', query: 'God', widthRatio: 0.2 },
      document.getElementById('mount'),
      { onOpenResult }
    );
    await flushPromises();

    expect(pickerMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedId: 'web',
        moduleType: 'bible',
      })
    );
    expect(window.api.getBooks).toHaveBeenCalledWith('web');
    expect(window.api.searchVerses).toHaveBeenCalledWith('web', 'God');
    expect(document.querySelector('.search-panel-status')?.textContent).toBe('2 resultados');
    expect(
      Array.from(document.querySelectorAll('.search-result-ref')).map((el) => el.textContent)
    ).toEqual(['Gn 1:1', 'Mt 5:3']);
    expect(document.querySelector('.search-result-text mark')?.textContent).toBe('God');
    expect(onStateChange).toHaveBeenLastCalledWith({ moduleId: 'web', query: 'God' });

    document
      .querySelector<HTMLElement>('.search-result-item')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(onOpenResult).toHaveBeenCalledWith({
      moduleId: 'web',
      bookNumber: 10,
      chapter: 1,
      verse: 1,
      openInNewWorkspace: true,
    });

    const input = document.querySelector<HTMLInputElement>('.panel-search-input') as HTMLInputElement;
    const blur = vi.spyOn(input, 'blur');
    key(input, '', 'Escape');
    expect(blur).toHaveBeenCalled();

    key(input, 'x');
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe(
      'Digite pelo menos 2 caracteres.'
    );

    key(input, '');
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe('');

    input.value = 'faith';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>('.input-clear-btn')?.style.display).toBe('');
    document.querySelector<HTMLButtonElement>('.input-clear-btn')?.click();
    expect(input.value).toBe('');
    expect(document.querySelector('.search-panel-hint')?.textContent).toBe(
      'Digite sua pesquisa para buscar.'
    );
  });

  it('searches as the user types with debounce and keeps Enter immediate', async () => {
    vi.useFakeTimers();
    const { SearchPanel } = await loadSearchPanel();
    SearchPanel.init(modules, null, document.getElementById('mount'));
    await flushPromises();

    const input = document.querySelector<HTMLInputElement>('.panel-search-input') as HTMLInputElement;
    vi.mocked(window.api.searchVerses).mockClear();

    input.value = 'faith';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(299);
    expect(window.api.searchVerses).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(window.api.searchVerses).toHaveBeenCalledTimes(1);
    expect(window.api.searchVerses).toHaveBeenLastCalledWith('kjv', 'faith');

    input.value = 'hope';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
    expect(window.api.searchVerses).toHaveBeenCalledTimes(2);
    expect(window.api.searchVerses).toHaveBeenLastCalledWith('kjv', 'hope');

    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(window.api.searchVerses).toHaveBeenCalledTimes(2);
  });

  it('ignores stale async search results after a newer query runs', async () => {
    const { SearchPanel } = await loadSearchPanel();
    SearchPanel.init(modules, null, document.getElementById('mount'));
    await flushPromises();

    let resolveFirst: (value: SearchResult[]) => void = () => undefined;
    let resolveSecond: (value: SearchResult[]) => void = () => undefined;
    window.api.searchVerses = vi
      .fn<WindowApi['searchVerses']>()
      .mockImplementationOnce(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            resolveSecond = resolve;
          })
      );

    SearchPanel.search('first');
    await flushPromises();
    SearchPanel.search('second');
    await flushPromises();

    resolveSecond([]);
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe(
      'Nenhum resultado encontrado.'
    );

    resolveFirst([
      {
        moduleId: 'kjv',
        bookNumber: 10,
        chapter: 1,
        verse: 1,
        text: 'first result',
      },
    ]);
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe(
      'Nenhum resultado encontrado.'
    );
    expect(document.querySelectorAll('.search-result-item')).toHaveLength(0);
  });

  it('handles picker changes, Strong searches, errors, empty results, and module resets', async () => {
    const { SearchPanel } = await loadSearchPanel();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onStateChange = vi.fn();
    SearchPanel.setStateChangeListener(onStateChange);
    SearchPanel.init(modules, null, document.getElementById('mount'));
    await flushPromises();

    pickerMock.instances[0].options.onChange?.('web');
    await flushPromises();
    expect(onStateChange).toHaveBeenLastCalledWith({ moduleId: 'web', query: '' });
    expect(window.api.getBooks).toHaveBeenCalledWith('web');

    window.api.searchVerses = vi.fn<WindowApi['searchVerses']>().mockResolvedValue([
      {
        moduleId: 'web',
        bookNumber: 10,
        chapter: 1,
        verse: 1,
        text: 'created<S>H1254</S> the world',
      },
    ]);
    SearchPanel.search('strong:H1254 created');
    await flushPromises();
    expect(workbenchMock.activateSidebar).toHaveBeenLastCalledWith('search', { focus: true });
    expect(document.querySelector('.search-result-text')?.innerHTML).toContain('strongs-tag');
    expect(document.querySelector('.search-result-text')?.innerHTML).toContain('<mark>');

    window.api.searchVerses = vi.fn<WindowApi['searchVerses']>().mockResolvedValue([]);
    SearchPanel.search('missing');
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe(
      'Nenhum resultado encontrado.'
    );

    window.api.searchVerses = vi
      .fn<WindowApi['searchVerses']>()
      .mockRejectedValue({ message: 'search failed' });
    SearchPanel.search('error');
    await flushPromises();
    expect(document.querySelector('.search-panel-status')?.textContent).toBe('search failed');

    window.api.getBooks = vi.fn<WindowApi['getBooks']>().mockRejectedValue(new Error('books failed'));
    SearchPanel.setSelectedModule('missing');
    SearchPanel.setSelectedModule(null);
    SearchPanel.setSelectedModule('kjv');
    await flushPromises();

    SearchPanel.setModules([{ id: 'asv', type: 'bible', displayName: 'ASV' }]);
    await flushPromises();
    expect(warn).toHaveBeenCalledWith('Failed to prefetch books:', expect.any(Error));
    expect(pickerMock.instances[0].setModules).toHaveBeenCalledWith([
      { id: 'asv', type: 'bible', displayName: 'ASV' },
    ]);
    expect(pickerMock.instances[0].setSelected).toHaveBeenCalledWith('asv');
    expect(SearchPanel.getState()).toEqual({ moduleId: 'asv', query: 'error' });

    SearchPanel.setModules(null);
    SearchPanel.search('faith');
    await flushPromises();
    expect(SearchPanel.getState()).toEqual({ moduleId: null, query: 'faith' });
    SearchPanel.focusInput();
    expect(workbenchMock.activateSidebar).toHaveBeenLastCalledWith('search', { focus: true });
    warn.mockRestore();
  });

  it('returns early when no host is available', async () => {
    document.body.innerHTML = '';
    const { SearchPanel } = await loadSearchPanel();

    SearchPanel.init(modules, null, null);

    expect(document.getElementById('search-panel')).toBeNull();
  });
});
