// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const pickerMock = vi.hoisted(() => {
  const instances: Array<{
    el: HTMLDivElement;
    setSelected: ReturnType<typeof vi.fn>;
    setModules: ReturnType<typeof vi.fn>;
  }> = [];
  const create = vi.fn(() => {
    const instance = {
      el: document.createElement('div'),
      setSelected: vi.fn(),
      setModules: vi.fn(),
    };
    instance.el.className = 'mock-module-picker';
    instances.push(instance);
    return instance;
  });
  return { create, instances };
});

vi.mock('../../src/renderer/app/module-picker.js', () => ({
  ModulePicker: {
    create: pickerMock.create,
  },
}));

async function loadEditor(): Promise<typeof import('../../src/renderer/app/module-editor.js')> {
  vi.resetModules();
  pickerMock.instances.length = 0;
  pickerMock.create.mockClear();
  return import('../../src/renderer/app/module-editor.js');
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function editableState(overrides: Partial<EditableModuleState> = {}): EditableModuleState {
  return {
    moduleId: 'kjv',
    modulePath: '/modules/kjv.sqlite3',
    type: 'bible',
    info: { 'short.title': 'KJV' },
    tables: {
      info: true,
      books: true,
      booksAll: false,
      verses: true,
      commentaries: true,
    },
    infoRows: [
      { name: 'description', value: 'King James' },
      { name: 'language', value: 'en' },
      { name: 'short.title', value: 'KJV' },
      { name: 'strong_numbers', value: 'true' },
    ],
    books: [{ bookNumber: 10, shortName: 'Gen', longName: 'Genesis' }],
    ...overrides,
  };
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
    btn.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('ModuleEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.confirm = vi.fn(() => true);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getEditableModuleState: vi.fn<WindowApi['getEditableModuleState']>().mockResolvedValue(
          editableState()
        ),
        saveInfoValue: vi.fn<WindowApi['saveInfoValue']>().mockResolvedValue(true),
        saveBookNames: vi.fn<WindowApi['saveBookNames']>().mockResolvedValue(true),
        getChapterCount: vi.fn<WindowApi['getChapterCount']>().mockResolvedValue(2),
        getChapter: vi.fn<WindowApi['getChapter']>().mockResolvedValue([
          { verse: 1, text: 'one' },
          { verse: 2, text: 'two' },
        ]),
        getVerseRecord: vi.fn<WindowApi['getVerseRecord']>().mockResolvedValue({
          verse: 1,
          text: 'verse text',
        }),
        saveVerseText: vi.fn<WindowApi['saveVerseText']>().mockResolvedValue(true),
        getCommentaryEntry: vi.fn<WindowApi['getCommentaryEntry']>().mockResolvedValue({
          text: 'commentary text',
        }),
        saveCommentaryText: vi.fn<WindowApi['saveCommentaryText']>().mockResolvedValue(true),
        deleteModule: vi.fn<WindowApi['deleteModule']>().mockResolvedValue(true),
      },
    });
  });

  it('opens modules, saves info/books/verses/commentaries, updates modules, and deletes', async () => {
    const { ModuleEditor } = await loadEditor();
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    ModuleEditor.init([{ id: 'kjv', type: 'bible', displayName: 'KJV' }], { onSaved, onDeleted });

    await ModuleEditor.open('kjv', 'info');
    await flushPromises();

    expect(ModuleEditor.isOpen()).toBe(true);
    expect(pickerMock.instances[0].setSelected).toHaveBeenCalledWith('kjv');
    expect(document.querySelector('.module-editor-subtitle')?.textContent).toBe('bible module');
    expect(document.querySelector('.module-editor-path')?.textContent).toContain('/modules/kjv.sqlite3');
    expect(document.querySelectorAll('.module-editor-tab')).toHaveLength(4);

    const description = document.querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    description.value = 'Updated description';
    buttonByText('Save Info').click();
    await flushPromises();
    expect(window.api.saveInfoValue).toHaveBeenCalledWith('kjv', 'description', 'Updated description');
    expect(onSaved).toHaveBeenCalledWith('kjv');
    expect(document.querySelector('.module-editor-status')?.classList.contains('ok')).toBe(true);

    buttonByText('Books').click();
    expect(document.querySelector<HTMLInputElement>('input.module-editor-input')?.value).toBe('Gen');
    const bookInputs = document.querySelectorAll<HTMLInputElement>('input.module-editor-input');
    bookInputs[0].value = 'Gn';
    bookInputs[1].value = 'Genesis Updated';
    buttonByText('Save Book').click();
    await flushPromises();
    expect(window.api.saveBookNames).toHaveBeenCalledWith('kjv', 10, {
      shortName: 'Gn',
      longName: 'Genesis Updated',
    });

    buttonByText('Verses').click();
    await flushPromises();
    expect(window.api.getChapterCount).toHaveBeenCalledWith('kjv', 10);
    expect(window.api.getChapter).toHaveBeenCalledWith('kjv', 10, 1);
    expect(window.api.getVerseRecord).toHaveBeenCalledWith('kjv', 10, 1, 1);
    const verseText = document.querySelector<HTMLTextAreaElement>('textarea.large') as HTMLTextAreaElement;
    verseText.value = 'updated verse';
    buttonByText('Save verse').click();
    await flushPromises();
    expect(window.api.saveVerseText).toHaveBeenCalledWith('kjv', 10, 1, 1, 'updated verse');

    buttonByText('Commentaries').click();
    const numberInputs = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    numberInputs[0].value = '1';
    numberInputs[1].value = '1';
    buttonByText('Load commentary').click();
    await flushPromises();
    expect(window.api.getCommentaryEntry).toHaveBeenCalledWith('kjv', 10, 1, 1);
    const commentaryText = document.querySelector<HTMLTextAreaElement>('textarea.large') as HTMLTextAreaElement;
    expect(commentaryText.value).toBe('commentary text');
    commentaryText.value = 'updated commentary';
    buttonByText('Save commentary').click();
    await flushPromises();
    expect(window.api.saveCommentaryText).toHaveBeenCalledWith('kjv', 10, 1, 1, 'updated commentary');

    ModuleEditor.setModules([{ id: 'web', type: 'bible', displayName: 'WEB' }]);
    expect(pickerMock.instances[0].setModules).toHaveBeenCalledWith([
      { id: 'web', type: 'bible', displayName: 'WEB' },
    ]);

    window.confirm = vi.fn(() => false);
    buttonByText('Delete module').click();
    await flushPromises();
    expect(window.api.deleteModule).not.toHaveBeenCalled();

    window.confirm = vi.fn(() => true);
    buttonByText('Delete module').click();
    await flushPromises();
    expect(window.api.deleteModule).toHaveBeenCalledWith('kjv');
    expect(ModuleEditor.isOpen()).toBe(false);
    expect(onDeleted).toHaveBeenCalledWith('kjv');
  });

  it('renders loading, save, delete, and empty-table errors', async () => {
    const { ModuleEditor } = await loadEditor();
    ModuleEditor.init([{ id: 'kjv', type: 'bible', displayName: 'KJV' }]);

    window.api.getEditableModuleState = vi
      .fn<WindowApi['getEditableModuleState']>()
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValue(editableState({ books: [] }));
    await ModuleEditor.open('kjv', 'info');
    await flushPromises();
    expect(document.querySelector('.module-editor-status')?.textContent).toContain('load failed');

    await ModuleEditor.open('kjv', 'books');
    await flushPromises();
    expect(document.querySelector('.module-editor-body')?.textContent).toContain(
      'No editable books rows'
    );
    buttonByText('Verses').click();
    expect(document.querySelector('.module-editor-body')?.textContent).toContain('No books found');

    window.api.getEditableModuleState = vi
      .fn<WindowApi['getEditableModuleState']>()
      .mockResolvedValue(editableState());
    await ModuleEditor.open('kjv', 'info');
    await flushPromises();
    window.api.saveInfoValue = vi.fn<WindowApi['saveInfoValue']>().mockRejectedValue('no save');
    buttonByText('Save Info').click();
    await flushPromises();
    expect(document.querySelector('.module-editor-status')?.textContent).toContain('no save');

    window.api.deleteModule = vi.fn<WindowApi['deleteModule']>().mockRejectedValue({
      message: 'delete failed',
    });
    buttonByText('Delete module').click();
    await flushPromises();
    expect(document.querySelector('.module-editor-status')?.textContent).toContain('delete failed');

    ModuleEditor.close();
    expect(ModuleEditor.isOpen()).toBe(false);
    await ModuleEditor.open(null);
    expect(ModuleEditor.isOpen()).toBe(false);
  });
});
