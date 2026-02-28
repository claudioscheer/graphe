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
      defEl.innerHTML = formatDefinition(entry.definition);
      bindCrossRefs(defEl);
      frag.appendChild(defEl);
    }

    contentEl.appendChild(frag);
  }

  /**
   * Parses a raw definition string into structured HTML.
   * Strips leading <b>lexeme</b><p/>, extracts etymology/grammar preamble,
   * and converts numbered items (1, 1a, 1a1, 2, etc.) into nested lists.
   */
  function formatDefinition(html) {
    // Strip leading <b>...</b> and <p/> (redundant with lexeme field)
    let text = html.replace(/^\s*<b>[^<]*<\/b>\s*<p\s*\/?>\s*/i, '');

    // Preserve <a> tags by replacing them with placeholders
    const anchors = [];
    text = text.replace(/<a\b[^>]*>.*?<\/a>/gi, (match) => {
      anchors.push(match);
      return `\x00LINK${anchors.length - 1}\x00`;
    });

    // Restore anchor placeholders
    function restoreAnchors(s) {
      return s.replace(/\x00LINK(\d+)\x00/g, (_, idx) => anchors[parseInt(idx)]);
    }

    // Find the definition items: labels like "1 ", "1a ", "2b1 "
    // These are definition numbers: a digit optionally followed by a lowercase letter
    // and optionally another digit, surrounded by spaces.
    // We need to distinguish definition labels from numbers in grammar codes
    // (e.g. "tdnt - 1 682 117 n f"). Strategy: find the first "1 " that starts
    // actual definitions — definition "1" always comes first.
    const defStartRegex = /(?:^|\s)(1)\s+([a-z])/;
    const defStartMatch = defStartRegex.exec(text);

    if (!defStartMatch) {
      // No numbered definitions found — render as plain text
      return '<div class="dict-def-preamble">' + restoreAnchors(text.trim()) + '</div>';
    }

    const preamble = text.substring(0, defStartMatch.index).trim();
    const defText = text.substring(defStartMatch.index).trim();

    // Now split the definition text into numbered items
    // Match: space-boundary, then a label (digit(s) + optional letter + optional digit), then space + lowercase
    const itemRegex = /(?:^|\s)(\d+[a-z]?\d?)\s+(?=[a-z\x00])/g;
    const rawIndices = [];
    let match;

    while ((match = itemRegex.exec(defText)) !== null) {
      rawIndices.push({
        label: match[1],
        start: match.index,
        contentStart: match.index + match[0].length - 1,
      });
    }

    // Filter out false positives by validating sequential structure.
    // Valid labels must follow logically: 1, 1a, 1a1, 1b, 2, 2a, etc.
    // A top-level number N is valid if N <= lastTopLevel + 1.
    // A sub-item like "Na" is valid if N == current top-level number.
    const indices = [];
    let lastTopNum = 0;

    for (const idx of rawIndices) {
      const topNum = parseInt(idx.label);
      const level = getLevel(idx.label);

      if (level === 0) {
        // Top-level: must be next in sequence (or same for repeated)
        if (topNum <= lastTopNum + 1) {
          indices.push(idx);
          lastTopNum = topNum;
        }
      } else {
        // Sub-item: its numeric prefix must match the last top-level number
        if (topNum === lastTopNum) {
          indices.push(idx);
        }
      }
    }

    // Extract each numbered item's text
    const items = [];
    for (let i = 0; i < indices.length; i++) {
      const end = i + 1 < indices.length ? indices[i + 1].start : defText.length;
      items.push({
        label: indices[i].label,
        text: defText.substring(indices[i].contentStart, end).trim(),
      });
    }

    // Build HTML output
    let out = '';

    if (preamble) {
      // Clean up grammar codes for display
      out += '<div class="dict-def-preamble">' + restoreAnchors(preamble) + '</div>';
    }

    if (items.length > 0) {
      out += buildNestedList(items, restoreAnchors);
    }

    return out;
  }

  /**
   * Builds nested <ol> lists from numbered items.
   * Items like "1", "2" are top-level; "1a", "1b" nest under "1"; "4a1" nests under "4a".
   */
  function buildNestedList(items, restoreAnchors) {
    let html = '<ol class="dict-def-list">';
    let i = 0;

    while (i < items.length) {
      const item = items[i];
      const level = getLevel(item.label);

      if (level === 0) {
        html += '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

        // Collect sub-items
        const subItems = [];
        let j = i + 1;
        while (j < items.length && getLevel(items[j].label) > 0) {
          subItems.push(items[j]);
          j++;
        }

        if (subItems.length > 0) {
          html += buildSubList(subItems, restoreAnchors);
        }

        html += '</li>';
        i = j;
      } else {
        html += '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text) + '</li>';
        i++;
      }
    }

    html += '</ol>';
    return html;
  }

  function buildSubList(items, restoreAnchors) {
    let html = '<ol class="dict-def-sublist">';
    let i = 0;

    while (i < items.length) {
      const item = items[i];
      html += '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

      // Check for deeper nesting (e.g. "4a1" under "4a")
      const deepItems = [];
      let j = i + 1;
      while (j < items.length && getLevel(items[j].label) > getLevel(item.label)) {
        deepItems.push(items[j]);
        j++;
      }

      if (deepItems.length > 0) {
        html += '<ol class="dict-def-sublist">';
        for (const di of deepItems) {
          html += '<li><span class="dict-def-label">' + di.label + '</span> ' + restoreAnchors(di.text) + '</li>';
        }
        html += '</ol>';
      }

      html += '</li>';
      i = j > i + 1 ? j : i + 1;
    }

    html += '</ol>';
    return html;
  }

  function getLevel(label) {
    if (/^\d+[a-z]\d+$/.test(label)) return 2;
    if (/^\d+[a-z]$/.test(label)) return 1;
    return 0;
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
