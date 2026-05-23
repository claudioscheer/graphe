import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcListener = (event: object, ...args: JsonValue[]) => void;

const electronMock = vi.hoisted(() => {
  const listeners = new Map<string, IpcListener>();
  const invoke = vi.fn((channel: string, ...args: JsonValue[]) =>
    Promise.resolve({ channel, args })
  );
  const send = vi.fn((channel: string, ...args: JsonValue[]) => ({ channel, args }));
  const on = vi.fn((channel: string, listener: IpcListener) => {
    listeners.set(channel, listener);
  });
  const removeListener = vi.fn((channel: string, listener: IpcListener) => {
    if (listeners.get(channel) === listener) listeners.delete(channel);
  });
  const exposeInMainWorld = vi.fn((name: string, value: WindowApi) => ({ name, value }));

  return {
    listeners,
    invoke,
    send,
    on,
    removeListener,
    exposeInMainWorld,
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMock.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    send: electronMock.send,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
}));

describe('preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.listeners.clear();
    electronMock.invoke.mockClear();
    electronMock.send.mockClear();
    electronMock.on.mockClear();
    electronMock.removeListener.mockClear();
    electronMock.exposeInMainWorld.mockClear();
  });

  it('exposes the API and forwards invoke/send calls to the expected channels', async () => {
    const { api } = await import('../src/preload.ts');

    await api.getModules();
    await api.getBooks('kjv');
    await api.getAllBooks();
    await api.getChapterCount('kjv', 10);
    await api.getChapter('kjv', 10, 1);
    await api.searchVerses('kjv', 'faith');
    await api.searchVersesLimited('kjv', 'faith', 5);
    await api.getDictionaryEntry('strong', 'G3056');
    await api.lookupAllStrongDicts('G3056', ['strong']);
    await api.searchDictionaryTopics('strong', 'G', 10);
    await api.getDictionaryCognates('strong', 'G3056');
    await api.getDictionaryMeta('strong');
    await api.resolveMorphology({ morphCode: 'N-NSF' });
    await api.getDictionaryTopicCount('strong');
    await api.getDictionaryTopicsByPrefix('strong', 'G', 10, 0);
    await api.getDictionaryRandomTopics('strong', 3);
    await api.getCrossReferences(10, 1, ['cross']);
    await api.getCommentary('comm', 10, 1);
    await api.getCommentaryBooks('comm');
    await api.getCommentaryCoverage('comm');
    await api.getModulePath('kjv');
    await api.getEditableModuleState('kjv');
    await api.deleteModule('kjv');
    await api.saveInfoValue('kjv', 'name', 'value');
    await api.deleteInfoValue('kjv', 'name');
    await api.saveBookNames('kjv', 10, { shortName: 'Gen' });
    await api.getVerseRecord('kjv', 10, 1, 1);
    await api.saveVerseText('kjv', 10, 1, 1, 'text');
    await api.getCommentaryEntry('comm', 10, 1, 1);
    await api.saveCommentaryText('comm', 10, 1, 1, 'text');
    await api.getAppState();
    await api.saveAppState({ settings: { language: 'en' } });
    api.showVerseContextMenu({ hasSelection: true });
    api.showStrongsContextMenu({ strongsNumber: 'G3056', paneId: 'pane-1' });
    await api.getAppVersion();
    await api.getPendingUpdate();
    await api.openExternal('https://example.test');
    api.installModules();
    await api.selectConvertFiles();
    await api.selectConvertFolder();
    await api.convertSingleFile('/tmp/module.ont');
    await api.finishConvert([{ ok: true, name: 'module' }], 'install');
    await api.cleanupConvert();

    expect(electronMock.exposeInMainWorld).toHaveBeenCalledWith('api', api);
    expect(electronMock.invoke).toHaveBeenCalledWith('get-books', 'kjv');
    expect(electronMock.invoke).toHaveBeenCalledWith('save-book-names', 'kjv', 10, {
      shortName: 'Gen',
    });
    expect(electronMock.send).toHaveBeenCalledWith('install-modules');
  });

  it('keeps one listener per channel and forwards listener payloads', async () => {
    const { api, setSingleListener } = await import('../src/preload.ts');
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const strongs = vi.fn<(payload: StrongsActionPayload) => void>();
    const update = vi.fn<(payload: UpdateInfo) => void>();

    api.onOpenSettings(first);
    electronMock.listeners.get('open-settings')?.({});
    api.onOpenSettings(second);
    electronMock.listeners.get('open-settings')?.({});
    setSingleListener('open-settings', null);
    api.onStrongsSearch(strongs);
    electronMock.listeners.get('strongs-search')?.({}, { strongsNumber: 'G3056' });
    api.onUpdateAvailable(update);
    electronMock.listeners.get('update-available')?.({}, { version: '1.2.3', url: 'url' });

    api.onSplitH(() => undefined);
    api.onSplitV(() => undefined);
    api.onSplitHCommentary(() => undefined);
    api.onSplitVCommentary(() => undefined);
    api.onContextMenuCopy(() => undefined);
    api.onStrongsLookup(() => undefined);
    api.onOpenAbout(() => undefined);
    api.onOpenModuleEditor(() => undefined);
    api.onOpenConvertModules(() => undefined);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(electronMock.removeListener).toHaveBeenCalledTimes(2);
    expect(strongs).toHaveBeenCalledWith({ strongsNumber: 'G3056' });
    expect(update).toHaveBeenCalledWith({ version: '1.2.3', url: 'url' });
    expect(
      electronMock.on.mock.calls.some(
        ([channel, listener]) => channel === 'split-h' && typeof listener === 'function'
      )
    ).toBe(true);
    expect(
      electronMock.on.mock.calls.some(
        ([channel, listener]) => channel === 'open-convert-modules' && typeof listener === 'function'
      )
    ).toBe(true);
  });
});
