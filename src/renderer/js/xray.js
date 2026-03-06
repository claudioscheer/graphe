/**
 * xray.js — Verse X-Ray window: comprehensive single-verse analysis
 */
import { BibleView } from './bible-view.js';
import { I18n } from './i18n.js';
import { Icons } from './icons.js';

const XRay = (() => {
  let dossier = null;
  let highlightedStrong = null;
  let moduleId, bookNumber, chapter, verse;
  const chainVisited = new Set();

  function init() {
    const params = new URLSearchParams(window.location.search);
    moduleId = params.get('moduleId');
    bookNumber = Number(params.get('bookNumber'));
    chapter = Number(params.get('chapter'));
    verse = Number(params.get('verse'));

    // Apply theme from localStorage
    const theme = localStorage.getItem('graphe-theme');
    if (theme === 'dark') document.documentElement.classList.add('dark');

    // Apply saved language for i18n
    const lang = localStorage.getItem('graphe-lang') || 'pt';
    I18n.setLang(lang);

    document.addEventListener('keydown', onKeyDown);
    loadDossier();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (highlightedStrong) {
        clearHighlight();
      } else {
        window.close();
      }
    } else if (e.key === 'ArrowLeft') {
      navigatePrev();
    } else if (e.key === 'ArrowRight') {
      navigateNext();
    }
  }

  async function loadDossier() {
    showLoading(true);
    try {
      dossier = await window.api.getVerseDossier({ moduleId, bookNumber, chapter, verse });
      chainVisited.clear();
      chainVisited.add(`${bookNumber}-${chapter}-${verse}`);
      render();
    } catch (err) {
      console.error('Failed to load dossier:', err);
      document.getElementById('xray-content').innerHTML =
        `<div class="xray-error">${escapeHtml(I18n.t('xrayLoadError'))}</div>`;
      document.getElementById('xray-content').classList.remove('hidden');
    }
    showLoading(false);
  }

  function showLoading(show) {
    const loadingEl = document.getElementById('xray-loading');
    if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
  }

  function navigatePrev() {
    if (verse > 1) {
      verse--;
      loadDossier();
    }
  }

  function navigateNext() {
    if (
      dossier &&
      dossier.atAGlance.chapterVerseCount &&
      verse < dossier.atAGlance.chapterVerseCount
    ) {
      verse++;
      loadDossier();
    }
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripMarkup(text) {
    if (!text) return '';
    return text
      .replace(/<S[^>]*>[\s\S]*?<\/S>/gi, '')
      .replace(/<W[HG][^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function render() {
    const content = document.getElementById('xray-content');
    content.innerHTML = '';
    content.classList.remove('hidden');

    const ref = dossier.reference;
    const bookNameStr = I18n.bookName(ref.bookNumber).short;
    document.title = `${bookNameStr} ${ref.chapter}:${ref.verse} — X-Ray`;

    content.appendChild(renderHeader());
    content.appendChild(renderAtAGlance());
    if (dossier.translations.length > 1) {
      content.appendChild(renderTranslations());
    }
    if (dossier.words.length > 0) {
      content.appendChild(renderWords());
    }
    if (dossier.crossRefs.length > 0) {
      content.appendChild(renderCrossRefs());
    }
    if (dossier.reverseCrossRefHeatMap && Object.keys(dossier.reverseCrossRefHeatMap).length > 0) {
      content.appendChild(renderHeatMap());
    }
    if (dossier.commentaries.length > 0) {
      content.appendChild(renderCommentaries());
    }
    content.appendChild(renderFacts());

    window.scrollTo(0, 0);
  }

  // ── Section: Header ──
  function renderHeader() {
    const ref = dossier.reference;
    const bookNameStr = I18n.bookName(ref.bookNumber).short;
    const section = el('section', 'xray-section xray-header-section');

    const nav = el('div', 'xray-header-nav');

    const prevBtn = el('button', 'xray-nav-btn');
    prevBtn.appendChild(Icons.create('arrow-left', 'w-4 h-4'));
    prevBtn.title = I18n.t('xrayPrevVerse');
    prevBtn.disabled = verse <= 1;
    prevBtn.addEventListener('click', navigatePrev);

    const refLabel = el('h1', 'xray-ref-title');
    refLabel.textContent = `${bookNameStr} ${ref.chapter}:${ref.verse}`;

    const nextBtn = el('button', 'xray-nav-btn');
    nextBtn.appendChild(Icons.create('arrow-right', 'w-4 h-4'));
    nextBtn.title = I18n.t('xrayNextVerse');
    nextBtn.disabled =
      dossier.atAGlance.chapterVerseCount && verse >= dossier.atAGlance.chapterVerseCount;
    nextBtn.addEventListener('click', navigateNext);

    nav.append(prevBtn, refLabel, nextBtn);
    section.appendChild(nav);

    // Module name subtitle
    const modLabel = el('div', 'xray-module-label');
    modLabel.textContent = dossier.primaryDisplayName;
    section.appendChild(modLabel);

    // Hero verse text
    const heroText = el('div', 'xray-hero-verse');
    const hasStrongs = dossier.atAGlance.strongsNumbers.length > 0;
    heroText.innerHTML = BibleView.parseVerseText(
      dossier.verseText,
      hasStrongs,
      dossier.strongsPrefix,
      []
    );
    section.appendChild(heroText);

    return section;
  }

  // ── Section: At a Glance ──
  function renderAtAGlance() {
    const g = dossier.atAGlance;
    const { details, content } = sectionTitle(I18n.t('xrayAtAGlance'));

    const grid = el('div', 'xray-glance-grid');

    grid.appendChild(glanceCard(String(g.translationCount), I18n.t('xrayTranslations')));
    grid.appendChild(glanceCard(String(g.crossRefCount), I18n.t('xrayCrossrefs')));
    grid.appendChild(glanceCard(String(g.commentaryCount), I18n.t('xrayCommentaries')));
    grid.appendChild(glanceCard(String(g.strongsNumbers.length), I18n.t('xrayStrongsNumbers')));

    content.appendChild(grid);
    return details;
  }

  function glanceCard(value, label) {
    const card = el('div', 'xray-glance-card');
    const valEl = el('div', 'xray-glance-value');
    valEl.textContent = value;
    const labelEl = el('div', 'xray-glance-label');
    labelEl.textContent = label;
    card.append(valEl, labelEl);
    return card;
  }

  // ── Section: Translation Comparison ──
  function renderTranslations() {
    const { details, content } = sectionTitle(I18n.t('xrayTranslationComparison'));

    const table = el('div', 'xray-translations');
    for (const tr of dossier.translations) {
      const row = el('div', 'xray-translation-row');
      const nameEl = el('span', 'xray-translation-name');
      nameEl.textContent = tr.displayName;
      const textEl = el('span', 'xray-translation-text');
      if (tr.hasStrongs) {
        textEl.innerHTML = BibleView.parseVerseText(tr.text, true, tr.strongsPrefix, []);
        nameEl.classList.add('has-strongs');
      } else {
        textEl.innerHTML = BibleView.parseVerseText(tr.text, false, tr.strongsPrefix, []);
      }
      row.append(nameEl, textEl);
      table.appendChild(row);
    }
    content.appendChild(table);
    return details;
  }

  // ── Section: Word-by-Word X-Ray ──
  function renderWords() {
    const { details, content } = sectionTitle(I18n.t('xrayWordByWord'));

    const intro = el('p', 'xray-section-intro');
    intro.textContent = I18n.t('xrayClickWordHint');
    content.appendChild(intro);

    const grid = el('div', 'xray-words-grid');
    for (const word of dossier.words) {
      const card = el('div', 'xray-word-card');
      card.dataset.strong = word.strongsNumber;

      if (highlightedStrong === word.strongsNumber) {
        card.classList.add('xray-highlighted');
      }

      const firstEntry = word.dictEntries[0]?.entry;

      // Strong's number (topic label)
      const snEl = el('div', 'xray-word-topic');
      snEl.textContent = word.strongsNumber;

      // Lexeme (large text)
      const lexemeEl = el('div', 'xray-word-lexeme');
      lexemeEl.textContent = firstEntry?.lexeme || firstEntry?.topic || word.strongsNumber;

      // Transliteration / pronunciation
      const metaParts = [firstEntry?.transliteration, firstEntry?.pronunciation].filter(Boolean);
      let metaEl = null;
      if (metaParts.length > 0) {
        metaEl = el('div', 'xray-word-meta');
        metaEl.textContent = metaParts.join(' \u2022 ');
      }

      // Short definition
      let shortDefEl = null;
      if (firstEntry?.short_definition) {
        shortDefEl = el('div', 'xray-word-short-def');
        shortDefEl.textContent = firstEntry.short_definition;
      }

      // Frequency
      const freqEl = el('div', 'xray-word-freq');
      freqEl.textContent =
        word.frequency === 1
          ? I18n.t('xrayOccurrenceSingular')
          : I18n.t('xrayOccurrences').replace('{count}', word.frequency || 0);

      card.append(snEl, lexemeEl);
      if (metaEl) card.appendChild(metaEl);
      if (shortDefEl) card.appendChild(shortDefEl);
      card.appendChild(freqEl);

      // "More" button — reveals full definition + additional dict entries
      const fullDef = firstEntry?.definition || firstEntry?.text || '';
      const hasAdditionalDicts = word.dictEntries.length > 1;
      if (fullDef || hasAdditionalDicts) {
        const moreBtn = el('button', 'xray-word-more-btn');
        moreBtn.textContent = I18n.t('xrayShowFullDef');

        const expandedEl = el('div', 'xray-word-expanded');
        expandedEl.style.display = 'none';

        // Full definition from first dict
        if (fullDef) {
          const defBlock = el('div', 'xray-word-definition');
          const dictLabel = el('div', 'xray-word-dict-label');
          dictLabel.textContent =
            word.dictEntries[0]?.displayName || word.dictEntries[0]?.moduleId || '';
          defBlock.appendChild(dictLabel);
          const defContent = el('div', 'xray-word-def-content');
          defContent.innerHTML = fullDef;
          defBlock.appendChild(defContent);
          expandedEl.appendChild(defBlock);
        }

        // Additional dict entries
        for (let i = 1; i < word.dictEntries.length; i++) {
          const de = word.dictEntries[i];
          const defBlock = el('div', 'xray-word-definition');
          const dictLabel = el('div', 'xray-word-dict-label');
          dictLabel.textContent = de.displayName || de.moduleId;
          defBlock.appendChild(dictLabel);
          const defContent = el('div', 'xray-word-def-content');
          defContent.innerHTML =
            de.entry?.definition ||
            de.entry?.text ||
            de.entry?.short_definition ||
            '<em>No definition</em>';
          defBlock.appendChild(defContent);
          expandedEl.appendChild(defBlock);
        }

        // Cognates
        if (word.cognates && word.cognates.length > 0) {
          const cogEl = el('div', 'xray-word-cognates');
          cogEl.textContent = I18n.t('xrayRelated').replace(
            '{list}',
            word.cognates.map((c) => c.topic || c).join(', ')
          );
          expandedEl.appendChild(cogEl);
        }

        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isVisible = expandedEl.style.display !== 'none';
          expandedEl.style.display = isVisible ? 'none' : 'block';
          moreBtn.textContent = isVisible ? I18n.t('xrayShowFullDef') : I18n.t('xrayHide');
        });

        card.appendChild(moreBtn);
        card.appendChild(expandedEl);
      }

      card.addEventListener('click', () => {
        if (highlightedStrong === word.strongsNumber) {
          clearHighlight();
        } else {
          setHighlight(word.strongsNumber);
        }
      });

      grid.appendChild(card);
    }

    content.appendChild(grid);
    return details;
  }

  function setHighlight(strongsNumber) {
    highlightedStrong = strongsNumber;
    // Highlight word cards
    document.querySelectorAll('.xray-word-card').forEach((c) => {
      c.classList.toggle('xray-highlighted', c.dataset.strong === strongsNumber);
    });
    // Highlight matching Strong's spans in hero verse and translations
    document.querySelectorAll('.strongs').forEach((span) => {
      const text = span.textContent.trim().toUpperCase();
      span.classList.toggle('xray-strongs-highlighted', text === strongsNumber.toUpperCase());
    });
    // Highlight translation rows containing matching Strong's
    document.querySelectorAll('.xray-translation-row').forEach((row) => {
      const matches = [...row.querySelectorAll('.strongs')].some(
        (s) => s.textContent.trim().toUpperCase() === strongsNumber.toUpperCase()
      );
      row.classList.toggle('xray-row-highlighted', matches);
    });
  }

  function clearHighlight() {
    highlightedStrong = null;
    document.querySelectorAll('.xray-highlighted').forEach((c) => {
      c.classList.remove('xray-highlighted');
    });
    document.querySelectorAll('.xray-strongs-highlighted').forEach((c) => {
      c.classList.remove('xray-strongs-highlighted');
    });
    document.querySelectorAll('.xray-row-highlighted').forEach((c) => {
      c.classList.remove('xray-row-highlighted');
    });
  }

  // ── Section: Cross-References ──
  function renderCrossRefs() {
    const { details, content } = sectionTitle(I18n.t('xrayCrossReferences'));
    details.id = 'xray-crossrefs-section';

    const intro = el('p', 'xray-section-intro');
    intro.textContent =
      dossier.crossRefs.length === 1
        ? I18n.t('xrayCrossRefIntroSingular')
        : I18n.t('xrayCrossRefIntro').replace('{count}', dossier.crossRefs.length);
    content.appendChild(intro);

    const hint = el('p', 'xray-section-hint');
    hint.appendChild(Icons.create('star', 'w-3 h-3'));
    hint.appendChild(document.createTextNode(' ' + I18n.t('xrayVotesExplanation')));
    content.appendChild(hint);

    const list = el('div', 'xray-crossrefs');
    for (const ref of dossier.crossRefs) {
      list.appendChild(buildCrossRefItem(ref));
    }

    content.appendChild(list);
    return details;
  }

  function buildCrossRefItem(ref) {
    const item = el('div', 'xray-crossref-item');

    const topRow = el('div', 'xray-crossref-top');

    const refLabel = el('span', 'xray-crossref-label');
    const bookName = I18n.bookName(ref.bookTo).short;
    const verseRange =
      ref.verseToEnd && ref.verseToEnd !== ref.verseToStart
        ? `${ref.verseToStart}-${ref.verseToEnd}`
        : ref.verseToStart;
    refLabel.textContent = `${bookName} ${ref.chapterTo}:${verseRange}`;
    topRow.appendChild(refLabel);

    if (ref.votes) {
      const votesEl = el('span', 'xray-crossref-votes');
      votesEl.appendChild(Icons.create('star', 'w-3 h-3'));
      votesEl.appendChild(document.createTextNode(` ${ref.votes}`));
      votesEl.title = I18n.t('xrayConfidenceTooltip').replace('{votes}', ref.votes);
      topRow.appendChild(votesEl);
    }

    // Chain explore button
    const chainBtn = el('button', 'xray-chain-btn');
    chainBtn.appendChild(Icons.create('chevron-right', 'w-3 h-3'));
    chainBtn.title = I18n.t('xrayChainExplore');
    chainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = item.querySelector(
        ':scope > .xray-chain-nested, :scope > .xray-chain-no-refs'
      );
      if (existing) {
        const hidden = existing.style.display === 'none';
        existing.style.display = hidden ? '' : 'none';
        chainBtn.classList.toggle('xray-chain-btn-open', hidden);
      } else {
        expandChainRef(item, ref.bookTo, ref.chapterTo, ref.verseToStart, chainVisited, 0);
        chainBtn.classList.add('xray-chain-btn-open');
      }
    });
    topRow.appendChild(chainBtn);

    item.appendChild(topRow);

    if (ref.previewText) {
      const preview = el('div', 'xray-crossref-preview');
      preview.textContent = ref.previewText;
      item.appendChild(preview);
    }

    return item;
  }

  // ── Chain Explorer ──
  async function expandChainRef(parentItem, bookTo, chapterTo, verseTo, visited, depth) {
    const key = `${bookTo}-${chapterTo}-${verseTo}`;
    if (visited.has(key) || depth > 5) return;
    visited.add(key);

    const loader = el('div', 'xray-chain-loading');
    loader.textContent = '...';
    parentItem.appendChild(loader);

    try {
      const allRefs = await window.api.getCrossReferences(
        bookTo,
        chapterTo,
        dossier.crossRefModuleIds
      );
      const verseRefs = (allRefs || []).filter((r) => r.verse === verseTo);
      verseRefs.sort((a, b) => (b.votes || 0) - (a.votes || 0));
      loader.remove();

      if (verseRefs.length === 0) {
        const noRefs = el('div', 'xray-chain-no-refs');
        noRefs.textContent = I18n.t('xrayChainNoRefs');
        parentItem.appendChild(noRefs);
        return;
      }

      const nested = el('div', 'xray-chain-nested');
      for (const ref of verseRefs.slice(0, 10)) {
        const item = el('div', 'xray-chain-item');

        const topRow = el('div', 'xray-crossref-top');

        const refLabel = el('span', 'xray-crossref-label');
        const bName = I18n.bookName(ref.bookTo).short;
        const vRange =
          ref.verseToEnd && ref.verseToEnd !== ref.verseToStart
            ? `${ref.verseToStart}-${ref.verseToEnd}`
            : ref.verseToStart;
        refLabel.textContent = `${bName} ${ref.chapterTo}:${vRange}`;
        topRow.appendChild(refLabel);

        if (ref.votes) {
          const votesEl = el('span', 'xray-crossref-votes');
          votesEl.appendChild(Icons.create('star', 'w-3 h-3'));
          votesEl.appendChild(document.createTextNode(` ${ref.votes}`));
          topRow.appendChild(votesEl);
        }

        const nestedKey = `${ref.bookTo}-${ref.chapterTo}-${ref.verseToStart}`;
        if (!visited.has(nestedKey) && depth < 5) {
          const chainBtn = el('button', 'xray-chain-btn');
          chainBtn.appendChild(Icons.create('chevron-right', 'w-3 h-3'));
          chainBtn.title = I18n.t('xrayChainExplore');
          chainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const existing = item.querySelector(
              ':scope > .xray-chain-nested, :scope > .xray-chain-no-refs'
            );
            if (existing) {
              const hidden = existing.style.display === 'none';
              existing.style.display = hidden ? '' : 'none';
              chainBtn.classList.toggle('xray-chain-btn-open', hidden);
            } else {
              expandChainRef(item, ref.bookTo, ref.chapterTo, ref.verseToStart, visited, depth + 1);
              chainBtn.classList.add('xray-chain-btn-open');
            }
          });
          topRow.appendChild(chainBtn);
        }

        item.appendChild(topRow);
        nested.appendChild(item);
      }
      parentItem.appendChild(nested);
    } catch (err) {
      loader.remove();
      console.error('Chain expand error:', err);
    }
  }

  // ── Section: Heat Map ──
  function renderHeatMap() {
    const { details, content } = sectionTitle(I18n.t('xrayReferencedBy'));

    const heatMap = dossier.reverseCrossRefHeatMap;
    const bookNumbers = I18n._BOOK_NUMBERS;
    const counts = Object.values(heatMap);
    const maxCount = Math.max(...counts);
    const totalRefs = counts.reduce((a, b) => a + b, 0);
    const bookCount = counts.length;

    const grid = el('div', 'xray-heatmap-grid');

    for (let i = 0; i < bookNumbers.length; i++) {
      const bn = bookNumbers[i];

      // OT/NT divider between book 390 (Malachi) and 470 (Matthew)
      if (i > 0 && bookNumbers[i - 1] <= 390 && bn >= 470) {
        const divider = el('div', 'xray-heatmap-divider');
        grid.appendChild(divider);
      }

      const cell = el('div', 'xray-heatmap-cell');
      const count = heatMap[bn] || 0;
      const bookNameObj = I18n.bookName(bn);
      cell.textContent = bookNameObj.short;

      if (count > 0) {
        const ratio = count / maxCount;
        let heat;
        if (ratio > 0.75) heat = 4;
        else if (ratio > 0.5) heat = 3;
        else if (ratio > 0.25) heat = 2;
        else heat = 1;
        cell.dataset.heat = heat;
        cell.title = I18n.t('xrayHeatMapTooltip')
          .replace('{book}', bookNameObj.long)
          .replace('{count}', count);
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
          showHeatMapPopup(e, bn, bookNameObj);
        });
      }

      grid.appendChild(cell);
    }

    content.appendChild(grid);

    const summary = el('div', 'xray-heatmap-summary');
    summary.textContent = I18n.t('xrayHeatMapSummary')
      .replace('{count}', totalRefs)
      .replace('{books}', bookCount);
    content.appendChild(summary);

    return details;
  }

  // ── Section: Commentaries ──
  function renderCommentaries() {
    const { details: sectionDetails, content } = sectionTitle(I18n.t('xrayCommentary'));

    const intro = el('p', 'xray-section-intro');
    intro.textContent =
      dossier.commentaries.length === 1
        ? I18n.t('xrayCommentaryIntroSingular')
        : I18n.t('xrayCommentaryIntro').replace('{count}', dossier.commentaries.length);
    content.appendChild(intro);

    for (const cm of dossier.commentaries) {
      const cmDetails = document.createElement('details');
      cmDetails.className = 'xray-commentary-group';

      const summary = document.createElement('summary');
      summary.className = 'xray-commentary-summary';
      summary.textContent = cm.displayName;
      cmDetails.appendChild(summary);

      const body = el('div', 'xray-commentary-body');
      for (const entry of cm.entries) {
        const entryEl = el('div', 'xray-commentary-entry');
        entryEl.innerHTML = entry.text || '';
        body.appendChild(entryEl);
      }
      cmDetails.appendChild(body);
      content.appendChild(cmDetails);
    }

    return sectionDetails;
  }

  // ── Section: Interesting Facts ──
  function renderFacts() {
    const { details, content } = sectionTitle(I18n.t('xrayInterestingFacts'));

    const facts = [];
    const g = dossier.atAGlance;

    // Hapax legomenon
    const hapax = dossier.words.filter((w) => w.frequency === 1);
    if (hapax.length > 0) {
      const strongsList = hapax.map((w) => w.strongsNumber).join(', ');
      if (hapax.length === 1) {
        facts.push(I18n.t('xrayFactHapaxSingular').replace('{strongs}', strongsList));
      } else {
        facts.push(
          I18n.t('xrayFactHapaxPlural')
            .replace('{count}', hapax.length)
            .replace('{strongs}', strongsList)
        );
      }
    }

    // Rare words (2-5 occurrences)
    const rareWords = dossier.words.filter((w) => w.frequency > 1 && w.frequency <= 5);
    if (rareWords.length > 0) {
      facts.push(
        I18n.t('xrayFactRareWords')
          .replace('{count}', rareWords.length)
          .replace('{strongs}', rareWords.map((w) => w.strongsNumber).join(', '))
      );
    }

    // Testament crossover
    if (dossier.crossRefs.length > 0) {
      const hasOT = dossier.crossRefs.some((r) => r.bookTo < 470);
      const hasNT = dossier.crossRefs.some((r) => r.bookTo >= 470);
      if (hasOT && hasNT) {
        facts.push(I18n.t('xrayFactTestamentCrossover'));
      }
    }

    // Word diversity
    if (g.strongsNumbers.length >= 12) {
      facts.push(I18n.t('xrayFactRichVocab').replace('{count}', g.strongsNumbers.length));
    }

    // Verse length
    const plainText = stripMarkup(dossier.verseText);
    const wordCount = plainText ? plainText.split(/\s+/).length : 0;
    if (wordCount > 0 && wordCount <= 5) {
      facts.push(I18n.t('xrayFactShortVerse').replace('{count}', wordCount));
    } else if (wordCount >= 30) {
      facts.push(I18n.t('xrayFactLongVerse').replace('{count}', wordCount));
    }

    // Chapter position
    if (verse === 1) {
      facts.push(I18n.t('xrayFactOpeningVerse'));
    } else if (g.chapterVerseCount && verse === g.chapterVerseCount) {
      facts.push(I18n.t('xrayFactFinalVerse'));
    }

    // Translation unanimity / variance
    if (dossier.translations.length > 1) {
      const plainTexts = dossier.translations.map((t) => t.plainText);
      const uniqueTexts = new Set(plainTexts);
      if (uniqueTexts.size === 1) {
        facts.push(
          I18n.t('xrayFactTransUnanimous').replace('{count}', dossier.translations.length)
        );
      } else if (uniqueTexts.size > dossier.translations.length * 0.8) {
        facts.push(
          I18n.t('xrayFactTransVariance')
            .replace('{unique}', uniqueTexts.size)
            .replace('{total}', dossier.translations.length)
        );
      }
    }

    // High cross-ref count
    if (g.crossRefCount >= 10) {
      facts.push({
        html: true,
        text: `${escapeHtml(I18n.t('xrayFactHighCrossRef').replace('{count}', g.crossRefCount))} <a class="xray-fact-link" data-scroll-to="xray-crossrefs-section">${escapeHtml(I18n.t('xrayFactViewLink'))} </a>`,
      });
    } else if (g.crossRefCount === 0) {
      facts.push(I18n.t('xrayFactNoCrossRef'));
    }

    // Commentary coverage
    if (g.commentaryCount >= 3) {
      facts.push(I18n.t('xrayFactWellCommented').replace('{count}', g.commentaryCount));
    } else if (g.commentaryCount === 0) {
      facts.push(I18n.t('xrayFactNoCommentary'));
    }

    // Frequent words
    const frequentWords = dossier.words.filter((w) => w.frequency >= 500);
    if (frequentWords.length > 0) {
      facts.push(
        I18n.t('xrayFactFrequentWords')
          .replace('{count}', frequentWords.length)
          .replace('{strongs}', frequentWords.map((w) => w.strongsNumber).join(', '))
      );
    }

    // No Strong's
    if (g.strongsNumbers.length === 0 && dossier.verseText) {
      facts.push(I18n.t('xrayFactNoStrongs'));
    }

    if (facts.length === 0) {
      facts.push(I18n.t('xrayFactNoPatterns'));
    }

    const list = el('ul', 'xray-facts-list');
    for (const f of facts) {
      const li = document.createElement('li');
      li.className = 'xray-fact-item';
      if (typeof f === 'object' && f.html) {
        li.innerHTML = f.text;
        // Wire up scroll links
        li.querySelectorAll('.xray-fact-link').forEach((link) => {
          link.appendChild(Icons.create('chevron-right', 'w-3 h-3'));
        });
        li.querySelectorAll('[data-scroll-to]').forEach((link) => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById(link.dataset.scrollTo);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
          });
        });
      } else {
        li.textContent = f;
      }
      list.appendChild(li);
    }
    content.appendChild(list);
    return details;
  }

  // ── Heat Map Popup ──
  function showHeatMapPopup(event, bookNum, bookNameObj) {
    dismissHeatMapPopup();

    const verses = (dossier.reverseCrossRefsByBook || {})[bookNum];
    if (!verses || verses.length === 0) return;

    const popup = el('div', 'xray-heatmap-popup');

    const title = el('div', 'xray-heatmap-popup-title');
    title.textContent = bookNameObj.long;
    popup.appendChild(title);

    const container = el('div', 'xray-heatmap-popup-verses');
    for (const v of verses) {
      const tag = el('span', 'xray-heatmap-popup-verse');
      tag.textContent = `${v.chapter}:${v.verse}`;
      container.appendChild(tag);
    }
    popup.appendChild(container);

    document.body.appendChild(popup);

    // Position near clicked cell
    const rect = event.target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left;

    // Keep within viewport
    if (top + popupRect.height > window.innerHeight) {
      top = rect.top - popupRect.height - 4;
    }
    if (left + popupRect.width > window.innerWidth) {
      left = window.innerWidth - popupRect.width - 8;
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;

    // Close on click outside or Escape
    setTimeout(() => {
      document.addEventListener('click', onPopupOutsideClick);
      document.addEventListener('keydown', onPopupEscape);
    }, 0);
  }

  function dismissHeatMapPopup() {
    const existing = document.querySelector('.xray-heatmap-popup');
    if (existing) existing.remove();
    document.removeEventListener('click', onPopupOutsideClick);
    document.removeEventListener('keydown', onPopupEscape);
  }

  function onPopupOutsideClick(e) {
    const popup = document.querySelector('.xray-heatmap-popup');
    if (popup && !popup.contains(e.target)) {
      dismissHeatMapPopup();
    }
  }

  function onPopupEscape(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismissHeatMapPopup();
    }
  }

  // ── Helpers ──
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function sectionTitle(text) {
    const details = document.createElement('details');
    details.className = 'xray-section';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'xray-section-header';
    const h = el('h2', 'xray-section-title');
    h.textContent = text;
    summary.appendChild(h);
    const chevron = Icons.create('chevron-down', 'w-4 h-4 xray-section-chevron');
    summary.appendChild(chevron);
    details.appendChild(summary);
    const content = el('div', 'xray-section-body');
    details.appendChild(content);
    return { details, content };
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', init);

  return { init };
})();
