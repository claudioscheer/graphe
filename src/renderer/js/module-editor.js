const ModuleEditor = (() => {
  let modules = [];
  let onSaved = null;
  let state = null;
  let activeTab = 'info';

  let overlay;
  let moduleSelect;
  let modulePathEl;
  let moduleTypeEl;
  let tabBar;
  let bodyEl;
  let statusEl;

  function init(moduleList, opts = {}) {
    modules = Array.isArray(moduleList) ? [...moduleList] : [];
    onSaved = typeof opts.onSaved === 'function' ? opts.onSaved : null;
    buildDom();
  }

  function buildDom() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'module-editor-overlay';
    overlay.className = 'module-editor-overlay hidden';

    const modal = document.createElement('div');
    modal.className = 'module-editor-modal';

    const header = document.createElement('div');
    header.className = 'module-editor-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'module-editor-title-wrap';

    const title = document.createElement('h2');
    title.className = 'module-editor-title';
    title.textContent = 'Module Editor';

    moduleTypeEl = document.createElement('p');
    moduleTypeEl.className = 'module-editor-subtitle';

    titleWrap.append(title, moduleTypeEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'module-editor-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', close);

    header.append(titleWrap, closeBtn);

    const toolbar = document.createElement('div');
    toolbar.className = 'module-editor-toolbar';

    moduleSelect = document.createElement('select');
    moduleSelect.className =
      'app-select pl-2 pr-8 py-1 rounded-sm border border-brand-400 dark:border-night-500 bg-brand-50 dark:bg-night-700 text-sm text-brand-900 dark:text-night-50 cursor-pointer';
    for (const mod of modules) {
      const opt = document.createElement('option');
      opt.value = mod.id;
      opt.textContent = Utils.getModuleDisplayName(mod);
      moduleSelect.appendChild(opt);
    }
    moduleSelect.addEventListener('change', () => open(moduleSelect.value, activeTab));

    modulePathEl = document.createElement('code');
    modulePathEl.className = 'module-editor-path';

    toolbar.append(moduleSelect, modulePathEl);

    tabBar = document.createElement('div');
    tabBar.className = 'module-editor-tabs';

    bodyEl = document.createElement('div');
    bodyEl.className = 'module-editor-body';

    statusEl = document.createElement('div');
    statusEl.className = 'module-editor-status';

    modal.append(header, toolbar, tabBar, bodyEl, statusEl);
    overlay.appendChild(modal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });

    document.body.appendChild(overlay);
  }

  function isOpen() {
    return overlay && !overlay.classList.contains('hidden');
  }

  function close() {
    if (!overlay) return;
    overlay.classList.add('hidden');
    clearStatus();
  }

  async function open(moduleId, tab) {
    if (!overlay || !moduleId) return;
    overlay.classList.remove('hidden');
    moduleSelect.value = moduleId;
    activeTab = tab || activeTab || 'info';
    showStatus('Loading module data...');

    try {
      state = await window.api.getEditableModuleState(moduleId);
      moduleTypeEl.textContent = `${state.type} module`;
      modulePathEl.textContent = `\u2066${state.modulePath || ''}\u2069`;
      renderTabs();
      renderActiveTab();
      clearStatus();
    } catch (err) {
      showStatus(`Failed to load module data: ${err.message || err}`, false);
    }
  }

  function showStatus(message, ok) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('ok', ok === true);
    statusEl.classList.toggle('error', ok === false);
  }

  function clearStatus() {
    showStatus('');
  }

  async function reloadState(keepTab = true) {
    if (!state) return;
    const moduleId = state.moduleId;
    state = await window.api.getEditableModuleState(moduleId);
    if (!keepTab) activeTab = 'info';
    moduleTypeEl.textContent = `${state.type} module`;
    modulePathEl.textContent = `\u2066${state.modulePath || ''}\u2069`;
    renderTabs();
    renderActiveTab();
  }

  async function afterSave(message) {
    showStatus(message, true);
    await reloadState();
    if (onSaved) onSaved(state.moduleId);
  }

  function getInfoValue(name, fallback = '') {
    const row = (state.infoRows || []).find((entry) => entry.name === name);
    if (!row || row.value == null) return fallback;
    return String(row.value);
  }

  function createField(labelText, control) {
    const wrap = document.createElement('label');
    wrap.className = 'module-editor-field';

    const label = document.createElement('span');
    label.className = 'module-editor-label';
    label.textContent = labelText;

    wrap.append(label, control);
    return wrap;
  }

  function renderTabs() {
    tabBar.innerHTML = '';
    if (!state) return;

    const tabs = [
      { id: 'info', label: 'Info', enabled: state.tables.info },
      { id: 'books', label: 'Books', enabled: state.tables.books || state.tables.booksAll },
      { id: 'verses', label: 'Verses', enabled: state.tables.verses },
      { id: 'commentaries', label: 'Commentaries', enabled: state.tables.commentaries },
    ].filter((tab) => tab.enabled);

    if (!tabs.some((tab) => tab.id === activeTab) && tabs.length > 0) {
      activeTab = tabs[0].id;
    }

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `module-editor-tab ${tab.id === activeTab ? 'is-active' : ''}`;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        activeTab = tab.id;
        renderTabs();
        renderActiveTab();
      });
      tabBar.appendChild(btn);
    }
  }

  function renderActiveTab() {
    bodyEl.innerHTML = '';
    if (!state) return;

    if (activeTab === 'info') {
      renderInfoTab();
      return;
    }
    if (activeTab === 'books') {
      renderBooksTab();
      return;
    }
    if (activeTab === 'verses') {
      renderVersesTab();
      return;
    }
    if (activeTab === 'commentaries') renderCommentariesTab();
  }

  function renderInfoTab() {
    const form = document.createElement('div');
    form.className = 'module-editor-form';

    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'module-editor-textarea';
    descriptionInput.value = getInfoValue('description');

    const languageInput = document.createElement('input');
    languageInput.type = 'text';
    languageInput.className = 'module-editor-input';
    languageInput.value = getInfoValue('language');

    const shortTitleInput = document.createElement('input');
    shortTitleInput.type = 'text';
    shortTitleInput.className = 'module-editor-input';
    shortTitleInput.value = getInfoValue('short.title');

    const strongWrap = document.createElement('label');
    strongWrap.className = 'module-editor-toggle';
    const strongToggle = document.createElement('input');
    strongToggle.type = 'checkbox';
    strongToggle.checked = getInfoValue('strong_numbers', 'false').toLowerCase() === 'true';
    const strongLabel = document.createElement('span');
    strongLabel.textContent = "Strong's numbers enabled";
    strongWrap.append(strongToggle, strongLabel);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'module-editor-btn primary';
    saveBtn.textContent = 'Save Info';
    saveBtn.addEventListener('click', async () => {
      try {
        await Promise.all([
          window.api.saveInfoValue(state.moduleId, 'description', descriptionInput.value),
          window.api.saveInfoValue(state.moduleId, 'language', languageInput.value),
          window.api.saveInfoValue(state.moduleId, 'short.title', shortTitleInput.value),
          window.api.saveInfoValue(
            state.moduleId,
            'strong_numbers',
            strongToggle.checked ? 'true' : 'false'
          ),
        ]);
        await afterSave('Saved module info');
      } catch (err) {
        showStatus(`Failed to save info: ${err.message || err}`, false);
      }
    });

    form.append(
      createField('description', descriptionInput),
      createField('language', languageInput),
      createField('short.title', shortTitleInput),
      strongWrap,
      saveBtn
    );
    bodyEl.appendChild(form);
  }

  function renderBooksTab() {
    const wrap = document.createElement('div');
    wrap.className = 'module-editor-form';

    const books = state.books || [];
    if (books.length === 0) {
      wrap.textContent = 'No editable books rows found in this module.';
      bodyEl.appendChild(wrap);
      return;
    }

    const bookSelect = document.createElement('select');
    bookSelect.className = 'module-editor-input';
    for (const book of books) {
      const option = document.createElement('option');
      option.value = String(book.bookNumber);
      option.textContent = `${I18n.bookName(book.bookNumber).short} (${book.bookNumber})`;
      bookSelect.appendChild(option);
    }

    const shortInput = document.createElement('input');
    shortInput.type = 'text';
    shortInput.className = 'module-editor-input';

    const longInput = document.createElement('input');
    longInput.type = 'text';
    longInput.className = 'module-editor-input';

    const hydrate = () => {
      const selected = books.find((book) => String(book.bookNumber) === bookSelect.value);
      shortInput.value = selected?.shortName || '';
      longInput.value = selected?.longName || '';
    };

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'module-editor-btn primary';
    saveBtn.textContent = 'Save Book';
    saveBtn.addEventListener('click', async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      if (!bookNumber) {
        showStatus('Select a book first', false);
        return;
      }

      try {
        await window.api.saveBookNames(state.moduleId, bookNumber, {
          shortName: shortInput.value,
          longName: longInput.value,
        });
        await afterSave(`Saved book ${bookNumber}`);
      } catch (err) {
        showStatus(`Failed to save book ${bookNumber}: ${err.message || err}`, false);
      }
    });

    bookSelect.addEventListener('change', hydrate);

    wrap.append(
      createField('Book', bookSelect),
      createField('short_name', shortInput),
      createField('long_name', longInput),
      saveBtn
    );
    bodyEl.appendChild(wrap);
    hydrate();
  }

  function renderVersesTab() {
    const wrap = document.createElement('div');
    wrap.className = 'module-editor-form';

    const books = state.books || [];
    if (books.length === 0) {
      wrap.textContent = 'No books found for this module.';
      bodyEl.appendChild(wrap);
      return;
    }

    const bookSelect = document.createElement('select');
    bookSelect.className = 'module-editor-input';
    for (const book of books) {
      const option = document.createElement('option');
      option.value = String(book.bookNumber);
      option.textContent = `${I18n.bookName(book.bookNumber).short} (${book.bookNumber})`;
      bookSelect.appendChild(option);
    }

    const chapterSelect = document.createElement('select');
    chapterSelect.className = 'module-editor-input';

    const verseSelect = document.createElement('select');
    verseSelect.className = 'module-editor-input';

    const verseText = document.createElement('textarea');
    verseText.className = 'module-editor-textarea large';
    verseText.placeholder = 'Verse text';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'module-editor-btn primary';
    saveBtn.textContent = 'Save verse';

    const setSaveEnabled = (enabled) => {
      saveBtn.disabled = !enabled;
    };

    const populateChapterOptions = async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      chapterSelect.innerHTML = '';
      verseSelect.innerHTML = '';
      verseText.value = '';
      setSaveEnabled(false);
      if (!bookNumber) return;

      try {
        const count = await window.api.getChapterCount(state.moduleId, bookNumber);
        for (let chapter = 1; chapter <= count; chapter++) {
          const option = document.createElement('option');
          option.value = String(chapter);
          option.textContent = String(chapter);
          chapterSelect.appendChild(option);
        }
        await populateVerseOptions();
      } catch (err) {
        showStatus(`Failed to load chapters: ${err.message || err}`, false);
      }
    };

    const populateVerseOptions = async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      const chapter = parseInt(chapterSelect.value, 10);
      verseSelect.innerHTML = '';
      verseText.value = '';
      setSaveEnabled(false);
      if (!bookNumber || !chapter) return;

      try {
        const chapterRows = await window.api.getChapter(state.moduleId, bookNumber, chapter);
        for (const row of chapterRows) {
          const option = document.createElement('option');
          option.value = String(row.verse);
          option.textContent = String(row.verse);
          verseSelect.appendChild(option);
        }
        setSaveEnabled(chapterRows.length > 0);
        if (chapterRows.length > 0) {
          await loadVerse();
        }
      } catch (err) {
        showStatus(`Failed to load verses: ${err.message || err}`, false);
      }
    };

    const loadVerse = async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      const chapter = parseInt(chapterSelect.value, 10);
      const verse = parseInt(verseSelect.value, 10);
      if (!bookNumber || !chapter || !verse) {
        showStatus('Select book, chapter and verse first', false);
        return;
      }
      try {
        const row = await window.api.getVerseRecord(state.moduleId, bookNumber, chapter, verse);
        if (!row) {
          verseText.value = '';
          showStatus('Verse not found', false);
          return;
        }
        verseText.value = row.text || '';
        showStatus(`Loaded ${I18n.bookName(bookNumber).short} ${chapter}:${verse}`, true);
      } catch (err) {
        showStatus(`Failed to load verse: ${err.message || err}`, false);
      }
    };

    const saveVerse = async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      const chapter = parseInt(chapterSelect.value, 10);
      const verse = parseInt(verseSelect.value, 10);
      if (!bookNumber || !chapter || !verse) {
        showStatus('Select book, chapter and verse first', false);
        return;
      }
      try {
        await window.api.saveVerseText(state.moduleId, bookNumber, chapter, verse, verseText.value);
        if (onSaved) onSaved(state.moduleId);
        showStatus(`Saved ${I18n.bookName(bookNumber).short} ${chapter}:${verse}`, true);
      } catch (err) {
        showStatus(`Failed to save verse: ${err.message || err}`, false);
      }
    };

    bookSelect.addEventListener('change', populateChapterOptions);
    chapterSelect.addEventListener('change', populateVerseOptions);
    verseSelect.addEventListener('change', loadVerse);
    saveBtn.addEventListener('click', saveVerse);

    const actionRow = document.createElement('div');
    actionRow.className = 'module-editor-actions';
    actionRow.append(saveBtn);

    wrap.append(
      createField('Book', bookSelect),
      createField('Chapter', chapterSelect),
      createField('Verse', verseSelect),
      createField('Text', verseText),
      actionRow
    );
    bodyEl.appendChild(wrap);

    populateChapterOptions();
  }

  function renderCommentariesTab() {
    const wrap = document.createElement('div');
    wrap.className = 'module-editor-form';

    const books = state.books || [];
    if (books.length === 0) {
      wrap.textContent = 'No books found for this module.';
      bodyEl.appendChild(wrap);
      return;
    }

    const bookSelect = document.createElement('select');
    bookSelect.className = 'module-editor-input';
    for (const book of books) {
      const option = document.createElement('option');
      option.value = String(book.bookNumber);
      option.textContent = `${I18n.bookName(book.bookNumber).short} (${book.bookNumber})`;
      bookSelect.appendChild(option);
    }

    const chapterInput = document.createElement('input');
    chapterInput.type = 'number';
    chapterInput.className = 'module-editor-input';
    chapterInput.min = '1';

    const verseFromInput = document.createElement('input');
    verseFromInput.type = 'number';
    verseFromInput.className = 'module-editor-input';
    verseFromInput.min = '1';

    const text = document.createElement('textarea');
    text.className = 'module-editor-textarea large';
    text.placeholder = 'Commentary text';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'module-editor-btn';
    loadBtn.textContent = 'Load commentary';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'module-editor-btn primary';
    saveBtn.textContent = 'Save commentary';

    loadBtn.addEventListener('click', async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      const chapter = parseInt(chapterInput.value, 10);
      const verseFrom = parseInt(verseFromInput.value, 10);
      if (!bookNumber || !chapter || !verseFrom) {
        showStatus('Choose book/chapter/verse first', false);
        return;
      }

      try {
        const entry = await window.api.getCommentaryEntry(
          state.moduleId,
          bookNumber,
          chapter,
          verseFrom
        );
        if (!entry) {
          text.value = '';
          showStatus('Commentary entry not found', false);
          return;
        }
        text.value = entry.text || '';
        showStatus(`Loaded commentary ${I18n.bookName(bookNumber).short} ${chapter}:${verseFrom}`, true);
      } catch (err) {
        showStatus(`Failed to load commentary: ${err.message || err}`, false);
      }
    });

    saveBtn.addEventListener('click', async () => {
      const bookNumber = parseInt(bookSelect.value, 10);
      const chapter = parseInt(chapterInput.value, 10);
      const verseFrom = parseInt(verseFromInput.value, 10);
      if (!bookNumber || !chapter || !verseFrom) {
        showStatus('Choose book/chapter/verse first', false);
        return;
      }

      try {
        await window.api.saveCommentaryText(state.moduleId, bookNumber, chapter, verseFrom, text.value);
        if (onSaved) onSaved(state.moduleId);
        showStatus(`Saved commentary ${I18n.bookName(bookNumber).short} ${chapter}:${verseFrom}`, true);
      } catch (err) {
        showStatus(`Failed to save commentary: ${err.message || err}`, false);
      }
    });

    const actionRow = document.createElement('div');
    actionRow.className = 'module-editor-actions';
    actionRow.append(loadBtn, saveBtn);

    wrap.append(
      createField('Book', bookSelect),
      createField('Chapter', chapterInput),
      createField('Verse from', verseFromInput),
      createField('Text', text),
      actionRow
    );
    bodyEl.appendChild(wrap);
  }

  return {
    init,
    open,
    close,
    isOpen,
  };
})();

window.ModuleEditor = ModuleEditor;
