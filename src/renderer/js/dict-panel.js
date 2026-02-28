/**
 * dict-panel.js — Dictionary panel for Strong's number lookups
 */
const DictPanel = (() => {
  let dictModules = [];
  let selectedDictId = null;
  let onStateChange = null;

  // DOM refs
  let panel, contentEl, select;

  function init(modules, savedState) {
    dictModules = modules;
    if (dictModules.length === 0) return;
    selectedDictId = savedState?.dictModuleId
      || (dictModules[0] && dictModules[0].id)
      || null;
    buildDOM(savedState?.dictHeight);
  }

  function buildDOM(savedHeight) {
    const sidebar = SearchPanel.getSidebar();
    if (!sidebar) return;

    // Vertical split divider between search and dict
    const divider = document.createElement('div');
    divider.className = 'split-divider split-divider-v';
    setupVerticalDivider(divider);

    // Dict panel
    panel = document.createElement('div');
    panel.id = 'dict-panel';
    if (savedHeight) {
      panel.style.flex = 'none';
      panel.style.height = savedHeight + 'px';
    }

    // Header
    const header = document.createElement('div');
    header.className = 'dict-panel-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2';
    const icon = Icons.create('book-open', 'w-4 h-4');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.style.flexShrink = '0';
    titleRow.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'font-semibold text-sm';
    title.setAttribute('data-i18n', 'dictionary');
    title.textContent = I18n.t('dictionary');
    titleRow.appendChild(title);
    header.appendChild(titleRow);

    // Dictionary select
    select = document.createElement('select');
    select.className = 'app-select w-full pl-2 pr-8 py-1 mt-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 cursor-pointer';
    const sorted = [...dictModules].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );
    for (const m of sorted) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      opt.title = m.description;
      if (m.id === selectedDictId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      selectedDictId = select.value;
      emitStateChange();
    });
    header.appendChild(select);
    panel.appendChild(header);

    // Content area
    contentEl = document.createElement('div');
    contentEl.className = 'dict-panel-content';
    contentEl.innerHTML = '<div class="dict-placeholder">' + escapeHtml(I18n.t('dictSelectTopic')) + '</div>';
    panel.appendChild(contentEl);

    sidebar.appendChild(divider);
    sidebar.appendChild(panel);
  }

  function setupVerticalDivider(divider) {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      divider.classList.add('dragging');
      const startY = e.clientY;
      const sidebar = SearchPanel.getSidebar();
      const searchPanel = document.getElementById('search-panel');
      const startSearchH = searchPanel.offsetHeight;
      const startDictH = panel.offsetHeight;

      const onMove = (e2) => {
        const delta = e2.clientY - startY;
        const newSearchH = Math.max(100, startSearchH + delta);
        const newDictH = Math.max(80, startDictH - delta);
        searchPanel.style.flex = 'none';
        searchPanel.style.height = newSearchH + 'px';
        panel.style.flex = 'none';
        panel.style.height = newDictH + 'px';
      };

      const onUp = () => {
        divider.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        emitStateChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  async function lookup(strongsNumber) {
    if (!panel || dictModules.length === 0) return;
    if (!selectedDictId) return;

    contentEl.innerHTML = '';

    try {
      const entry = await window.api.getDictionaryEntry(selectedDictId, strongsNumber);
      if (!entry) {
        contentEl.innerHTML = '<div class="dict-placeholder">' + escapeHtml(I18n.t('dictNoEntry')) + '</div>';
        return;
      }
      renderEntry(entry);
    } catch (err) {
      contentEl.innerHTML = '<div class="dict-placeholder">' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderEntry(entry) {
    const frag = document.createDocumentFragment();

    // Topic heading
    const topicEl = document.createElement('div');
    topicEl.className = 'dict-entry-topic';
    topicEl.textContent = entry.topic;
    frag.appendChild(topicEl);

    // Lexeme (original language word)
    if (entry.lexeme) {
      const lexEl = document.createElement('div');
      lexEl.className = 'dict-entry-lexeme';
      lexEl.textContent = entry.lexeme;
      frag.appendChild(lexEl);
    }

    // Transliteration + pronunciation
    if (entry.transliteration || entry.pronunciation) {
      const metaEl = document.createElement('div');
      metaEl.className = 'dict-entry-meta';
      const parts = [];
      if (entry.transliteration) parts.push(entry.transliteration);
      if (entry.pronunciation) parts.push(entry.pronunciation);
      metaEl.textContent = parts.join(' — ');
      frag.appendChild(metaEl);
    }

    // Short definition
    if (entry.short_definition) {
      const shortEl = document.createElement('div');
      shortEl.className = 'dict-entry-short';
      shortEl.textContent = entry.short_definition;
      frag.appendChild(shortEl);
    }

    // Full definition (HTML)
    if (entry.definition) {
      const defEl = document.createElement('div');
      defEl.className = 'dict-entry-definition';
      defEl.innerHTML = entry.definition;
      bindCrossRefs(defEl);
      frag.appendChild(defEl);
    }

    contentEl.appendChild(frag);
  }

  function bindCrossRefs(container) {
    const links = container.querySelectorAll('a[href^="S:"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const topic = href.replace(/^S:/, '');
      link.removeAttribute('href');
      link.classList.add('dict-crossref');
      link.dataset.topic = topic;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        lookup(topic);
      });
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStateChangeListener(listener) {
    onStateChange = typeof listener === 'function' ? listener : null;
  }

  function emitStateChange() {
    if (!onStateChange) return;
    onStateChange(getState());
  }

  function getState() {
    return {
      dictModuleId: selectedDictId,
      dictHeight: panel ? panel.offsetHeight : null,
    };
  }

  return { init, lookup, setStateChangeListener, getState };
})();
