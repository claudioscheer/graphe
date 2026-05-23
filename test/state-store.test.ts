import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => {
  const state = {
    exists: false,
    raw: '',
  };
  const mkdirSync = vi.fn((dir: string, opts: { recursive: boolean }) => ({ dir, opts }));
  const existsSync = vi.fn(() => state.exists);
  const readFileSync = vi.fn(() => state.raw);
  const writeFileSync = vi.fn((file: string, content: string, encoding: string) => ({
    file,
    content,
    encoding,
  }));
  const writeFile = vi.fn((file: string, content: string, encoding: string) =>
    Promise.resolve({ file, content, encoding })
  );

  return {
    state,
    mkdirSync,
    existsSync,
    readFileSync,
    writeFileSync,
    writeFile,
  };
});

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/tester',
  },
  homedir: () => '/home/tester',
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: fsMock.mkdirSync,
    existsSync: fsMock.existsSync,
    readFileSync: fsMock.readFileSync,
    writeFileSync: fsMock.writeFileSync,
    promises: {
      writeFile: fsMock.writeFile,
    },
  },
  mkdirSync: fsMock.mkdirSync,
  existsSync: fsMock.existsSync,
  readFileSync: fsMock.readFileSync,
  writeFileSync: fsMock.writeFileSync,
  promises: {
    writeFile: fsMock.writeFile,
  },
}));

describe('main state store', () => {
  beforeEach(() => {
    vi.resetModules();
    fsMock.state.exists = false;
    fsMock.state.raw = '';
    fsMock.mkdirSync.mockClear();
    fsMock.existsSync.mockClear();
    fsMock.readFileSync.mockClear();
    fsMock.writeFileSync.mockClear();
    fsMock.writeFile.mockClear();
  });

  it('returns default state when no state file exists', async () => {
    const store = await import('../src/main/state-store.ts');

    expect(store.STATE_FILE).toBe('/home/tester/.graphe/state.json');
    expect(store.loadState()).toEqual({
      settings: {
        theme: null,
        language: 'pt',
        fontSize: 20,
        strongsDicts: null,
        favoriteModules: {},
      },
      paneManager: null,
      searchPanel: null,
      dictPanel: null,
    });
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/home/tester/.graphe', { recursive: true });
  });

  it('merges loaded, async-saved, and sync-saved state', async () => {
    fsMock.state.exists = true;
    fsMock.state.raw = JSON.stringify({
      settings: { language: 'en', fontSize: 18 },
      paneManager: { activePaneId: 'pane-1' },
    });
    const store = await import('../src/main/state-store.ts');

    expect(store.loadState()).toMatchObject({
      settings: { language: 'en', fontSize: 18, theme: null },
      paneManager: { activePaneId: 'pane-1' },
    });

    await expect(
      store.saveState({
        settings: { language: 'es' },
        dictPanel: { selectedModuleId: 'strong', moduleSearchCache: {} },
      })
    ).resolves.toMatchObject({
      settings: { language: 'es', fontSize: 20 },
      dictPanel: { selectedModuleId: 'strong' },
    });
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      '/home/tester/.graphe/state.json',
      expect.stringContaining('"language": "es"'),
      'utf8'
    );

    store.saveStateSync();
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      '/home/tester/.graphe/state.json',
      expect.stringContaining('"selectedModuleId": "strong"'),
      'utf8'
    );
  });

  it('falls back to defaults for invalid JSON and skips sync save without cache', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fsMock.state.exists = true;
    fsMock.state.raw = '{broken';
    const store = await import('../src/main/state-store.ts');

    expect(store.loadState().settings.language).toBe('pt');
    store.saveStateSync();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
