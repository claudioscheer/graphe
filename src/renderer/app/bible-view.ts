/**
 * bible-view.js - Verse rendering with Strong's number parsing.
 */

type BookNameResolver = (bookNumber: number) => string;

interface CasePairExtraction {
  value: string;
  nextIndex: number;
}

interface VerseRangeExtraction {
  range: string | null;
  text: string;
}

interface ExtendedAnnotations {
  pr?: string;
  pbr?: string;
  og?: string;
  es?: string;
  ln?: string;
  gk?: string;
  [key: string]: string | undefined;
}

interface RenderChapterOptions {
  crossRefs?: CrossReference[];
  crossRefMode?: 'inline' | 'hidden' | 'popover' | string;
  bookNameResolver?: BookNameResolver;
  strongsPrefix?: string;
}

interface VerseTextWrapper extends HTMLDivElement {
  _crossRefsByVerse?: Map<number, CrossReference[]>;
  _bookNameResolver?: BookNameResolver;
}

interface VerseLineElement extends HTMLDivElement {
  _footnotes?: string[];
}

interface BibleViewApi {
  renderChapter(
    container: HTMLElement,
    verses: VerseRecord[],
    showStrongs: boolean,
    bookNumber: number,
    opts?: RenderChapterOptions
  ): void;
  scrollToVerse(container: HTMLElement, verseNum: number): void;
  selectAdjacentVerse(container: HTMLElement, direction: -1 | 1, shiftHeld: boolean): void;
  getSelectedText(container: HTMLElement): string;
  toggleVerseRefs(verseLine: HTMLElement): void;
  parseVerseText(
    text: string,
    showStrongs: boolean,
    strongsPrefix: string,
    footnotes?: string[]
  ): string;
  normalizeTheWordWordAnnotations(text: string, strongsPrefix: string): string;
}

export const BibleView: BibleViewApi = (() => {
  function escapeHtml(text: string | number | null | undefined): string {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function extractCasePairTagAt(
    text: string,
    index: number,
    openings: readonly string[]
  ): CasePairExtraction | null {
    const rest = text.slice(index);
    for (const open of openings) {
      const close = open.toLowerCase();
      const re = new RegExp(`^\\s*<${open}>([\\s\\S]*?)<${close}>`, 'i');
      const match = re.exec(rest);
      if (!match) continue;
      return {
        value: match[1],
        nextIndex: index + match[0].length,
      };
    }
    return null;
  }

  function normalizeStrongNumber(value: string | number | null | undefined): string {
    const match = String(value || '').match(/\d+/);
    return match ? match[0] : '';
  }

  function collectStrongDisplays(segment: string, defaultPrefix: string): string[] {
    const displays: string[] = [];

    segment.replace(/<S[^>]*>([GH]?\d+\w*)<\/S>/gi, (match: string, rawNum: string): string => {
      const num = String(rawNum || '').trim();
      if (!num) return match;
      if (/^[GH]/i.test(num)) {
        displays.push(num.toUpperCase());
      } else {
        const normalized = normalizeStrongNumber(num);
        if (normalized) displays.push(`${defaultPrefix}${normalized}`);
      }
      return match;
    });

    segment.replace(/<W([HG])([^>]*)>/gi, (
      match: string,
      rawPrefix: string,
      rawNum: string
    ): string => {
      const num = normalizeStrongNumber(rawNum);
      if (!num) return match;
      displays.push(`${String(rawPrefix || '').toUpperCase()}${num}`);
      return match;
    });

    return displays;
  }

  function buildInterlinearStrongHtml(strongDisplays: string[]): string {
    if (strongDisplays.length === 0) return '';
    return strongDisplays
      .map((display) => `<span class="strongs">${escapeHtml(display)}</span>`)
      .join(' ');
  }

  function parseExtendedAnnotations(text: string): ExtendedAnnotations {
    const result: ExtendedAnnotations = {};
    for (const pair of text.split('|')) {
      const idx = pair.indexOf('=');
      if (idx > 0) result[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return result;
  }

  // Converts theWord case-paired tags (<E>...<e>, <O>/<OG>...<o>/<og>, <T>/<TG>...<t>/<tg>)
  // into safe HTML spans before the browser parses them as malformed markup.
  function normalizeTheWordWordAnnotations(text: string, strongsPrefix: string): string {
    const input = String(text || '');
    let output = '';
    let pos = 0;

    while (true) {
      const nextTranslation = input.slice(pos).match(/<E>/i);
      if (!nextTranslation || nextTranslation.index == null) {
        output += input.slice(pos);
        break;
      }

      const start = pos + nextTranslation.index;
      output += input.slice(pos, start);

      const transExtract = extractCasePairTagAt(input, start, ['E']);
      if (!transExtract) {
        output += input.slice(start);
        break;
      }

      const translated = transExtract.value;
      let cursor = transExtract.nextIndex;

      const origExtract = extractCasePairTagAt(input, cursor, ['OG', 'OH', 'O']);
      const original = origExtract ? origExtract.value : '';
      if (origExtract) cursor = origExtract.nextIndex;

      const translitExtract = extractCasePairTagAt(input, cursor, ['TG', 'TH', 'T']);
      const transliteration = translitExtract ? translitExtract.value : '';
      if (translitExtract) cursor = translitExtract.nextIndex;

      const nextWordMatch = input.slice(cursor).match(/<E>/i);
      const nextWordStart =
        nextWordMatch && nextWordMatch.index != null ? cursor + nextWordMatch.index : input.length;
      const segment = input.slice(cursor, nextWordStart);
      const strongDisplays = collectStrongDisplays(segment, strongsPrefix || 'H');

      const xMatch = segment.match(/<X>([\s\S]*?)<x>/i);
      const extAnnotations = xMatch ? parseExtendedAnnotations(xMatch[1]) : null;

      const trailing = segment
        .replace(/<RX[^>]*>/gi, '')
        .replace(/<wt>/gi, '')
        .replace(/<S[^>]*>[\s\S]*?<\/S>/gi, '')
        .replace(/<W[HG][^>]*>/gi, '')
        .replace(/<m>[\s\S]*?<\/m>/gi, '')
        .replace(/<l>[\s\S]*?<\/l>/gi, '')
        .replace(/<WT[^>]*>/gi, '')
        .replace(/<X>[\s\S]*?<x>/gi, '')
        .replace(/<(?:E|e|O|o|T|t|OG|og|OH|oh|TG|tg|TH|th)>/g, '');

      const top = `${translated}${trailing}`;
      const hasAnnotations =
        strongDisplays.length > 0 ||
        Boolean(original || transliteration) ||
        Boolean(extAnnotations);
      if (!hasAnnotations) {
        output += top;
      } else {
        const leadingWs = (top.match(/^\s*/) || [''])[0];
        const trailingWs = (top.match(/\s*$/) || [''])[0];
        const topCore = top.slice(leadingWs.length, top.length - trailingWs.length);

        if (!topCore) {
          output += top;
        } else {
          let annotation = '';
          if (strongDisplays.length > 0) {
            annotation += `<span class="verse-word-strong">${buildInterlinearStrongHtml(strongDisplays)}</span>`;
          }
          if (original) {
            annotation += `<span class="verse-word-original">${escapeHtml(original.trim())}</span>`;
          }
          if (transliteration) {
            annotation += `<span class="verse-word-translit">${escapeHtml(transliteration.trim())}</span>`;
          }
          if (extAnnotations) {
            if (extAnnotations.pr) {
              annotation += `<span class="verse-word-pronunciation">${escapeHtml(extAnnotations.pr)}</span>`;
            }
            if (extAnnotations.pbr) {
              annotation += `<span class="verse-word-gloss">${escapeHtml(extAnnotations.pbr)}</span>`;
            }
            if (extAnnotations.og) {
              annotation += `<span class="verse-word-gloss verse-word-gloss-secondary">${escapeHtml(extAnnotations.og)}</span>`;
            }
            if (extAnnotations.es) {
              annotation += `<span class="verse-word-gloss verse-word-gloss-secondary">${escapeHtml(extAnnotations.es)}</span>`;
            }
            if (extAnnotations.ln) {
              annotation += `<span class="verse-word-ref">${escapeHtml('LN ' + extAnnotations.ln)}</span>`;
            }
            if (extAnnotations.gk) {
              annotation += `<span class="verse-word-ref">${escapeHtml('GK ' + extAnnotations.gk)}</span>`;
            }
          }
          output += `${leadingWs}<span class="verse-word">${topCore}<span class="verse-annotation">${annotation}</span></span>${trailingWs}`;
        }
      }

      pos = nextWordStart;
    }

    return output.replace(/<RX[^>]*>/gi, '').replace(/<wt>/gi, '');
  }

  function extractVerseRange(text: string): VerseRangeExtraction {
    const match = text.match(/^<(n|f)>\s*([\d]+(?:\s*[-–]\s*[\d]+)+)\s*<\/\1>\s*/i);
    if (match) return { range: match[2], text: text.slice(match[0].length) };
    return { range: null, text };
  }

  function parseVerseText(
    text: string,
    showStrongs: boolean,
    strongsPrefix: string,
    footnotes: string[] = []
  ): string {
    let fnIndex = 0;
    let html = String(text || '').replace(/<f>([\s\S]*?)<\/f>/gi, (
      _match: string,
      content: string
    ): string => {
      footnotes.push(content.trim());
      fnIndex++;
      const label = String(fnIndex);
      return `<sup class="verse-footnote-marker" data-fn-index="${fnIndex - 1}">${label}</sup>`;
    });

    html = normalizeTheWordWordAnnotations(html, strongsPrefix);
    html = html.replace(/<X>[\s\S]*?<x>/gi, '');
    html = html.replace(/^\s*(<pb\s*\/?>)+/i, '');
    html = html.replace(/<pb\s*\/?>/gi, '<span class="verse-pb"></span>');
    html = html.replace(/<i>([\s\S]*?)<\/i>/gi, '<span class="verse-italic">$1</span>');
    html = html.replace(/<n>[\s\S]*?<\/n>/gi, '');
    html = html.replace(/<J>([\s\S]*?)<\/J>/gi, '<span class="verse-jesus">$1</span>');
    html = html.replace(/<e>([\s\S]*?)<\/e>/gi, '<span class="verse-emphasis">$1</span>');
    html = html.replace(/<t>([\s\S]*?)<\/t>/gi, '<span class="verse-poetry">$1</span>');
    html = html.replace(/<h>([\s\S]*?)<\/h>/gi, '<span class="verse-subheading">$1</span>');

    html = html.replace(
      /<S>(\d+\w*)<\/S>(?:\s*<m>([^<]*)<\/m>)?(?:\s*<l>([^<]*)<\/l>)?/gi,
      (_match: string, num: string, morph: string, lemma: string): string => {
        const attrs: string[] = [];
        if (morph) attrs.push(`morph="${morph}"`);
        if (lemma) attrs.push(`lemma="${lemma}"`);
        return `<S${attrs.length ? ' ' + attrs.join(' ') : ''}>${num}</S>`;
      }
    );

    html = html.replace(/(\w) (?=<S[\s>])/g, '$1');
    html = html.replace(/<\/S><S/gi, '</S> <S');
    if (showStrongs) {
      html = html.replace(
        /<S(?:\s+morph="([^"]*)")?(?:\s+lemma="([^"]*)")?>([GH]?\d+\w*)<\/S>/gi,
        (_match: string, morph: string, lemma: string, num: string): string => {
          const display = /^[GH]/i.test(num) ? num.toUpperCase() : `${strongsPrefix}${num}`;
          const attrs: string[] = [];
          if (morph) attrs.push(`data-morph="${morph}"`);
          if (lemma) attrs.push(`data-lemma="${lemma}"`);
          const titleParts: string[] = [];
          if (lemma) titleParts.push(lemma);
          if (morph) titleParts.push(morph);
          if (titleParts.length) attrs.push(`title="${titleParts.join(' · ')}"`);
          const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
          return `<span class="strongs"${attrStr}>${display}</span>`;
        }
      );
    } else {
      html = html.replace(/<S[^>]*>[\s\S]*?<\/S>/gi, '');
    }

    return html.replace(/ {2,}/g, ' ');
  }

  function formatRefLabel(ref: CrossReference, bookNameResolver?: BookNameResolver): string {
    const bookTo = ref.bookTo || 0;
    const chapterTo = ref.chapterTo || 0;
    const bookName = bookNameResolver ? bookNameResolver(bookTo) : String(bookTo);
    if (ref.verseToStart && ref.verseToEnd && ref.verseToEnd > ref.verseToStart) {
      return `${bookName} ${chapterTo}:${ref.verseToStart}-${ref.verseToEnd}`;
    }
    if (ref.verseToStart) {
      return `${bookName} ${chapterTo}:${ref.verseToStart}`;
    }
    return `${bookName} ${chapterTo}`;
  }

  function createRefLink(ref: CrossReference, bookNameResolver?: BookNameResolver): HTMLSpanElement {
    const link = document.createElement('span');
    link.className = 'crossref-link';
    link.textContent = formatRefLabel(ref, bookNameResolver);
    link.dataset.bookTo = String(ref.bookTo || '');
    link.dataset.chapterTo = String(ref.chapterTo || '');
    link.dataset.verseTo = ref.verseToStart != null ? String(ref.verseToStart) : '';
    return link;
  }

  function getCrossRefTargetKey(ref: CrossReference): string {
    return [
      ref.bookTo,
      ref.chapterTo,
      ref.verseToStart == null ? '' : ref.verseToStart,
      ref.verseToEnd == null ? '' : ref.verseToEnd,
    ].join(':');
  }

  function buildCrossRefsByVerse(crossRefs: CrossReference[]): Map<number, CrossReference[]> {
    const map = new Map<number, CrossReference[]>();
    const seenByVerse = new Map<number, Set<string>>();
    for (const ref of crossRefs) {
      const verse = ref.verse;
      if (!map.has(verse)) {
        map.set(verse, []);
        seenByVerse.set(verse, new Set<string>());
      }
      const targetKey = getCrossRefTargetKey(ref);
      const seen = seenByVerse.get(verse);
      if (!seen || seen.has(targetKey)) continue;
      seen.add(targetKey);
      map.get(verse)?.push(ref);
    }
    return map;
  }

  function renderCrossRefsInline(
    container: VerseTextWrapper,
    crossRefsByVerse: Map<number, CrossReference[]> | null,
    bookNameResolver?: BookNameResolver
  ): void {
    if (!crossRefsByVerse || crossRefsByVerse.size === 0) return;
    const lines = container.querySelectorAll<VerseLineElement>('.verse-line');
    for (const line of lines) {
      const verse = parseInt(line.dataset.verse || '', 10);
      const refs = crossRefsByVerse.get(verse);
      if (!refs || refs.length === 0) continue;
      const span = document.createElement('span');
      span.className = 'crossref-refs';
      for (let i = 0; i < refs.length; i++) {
        if (i > 0) span.appendChild(document.createTextNode(' '));
        span.appendChild(createRefLink(refs[i], bookNameResolver));
      }
      line.appendChild(span);
    }
  }

  function renderChapter(
    container: HTMLElement,
    verses: VerseRecord[],
    showStrongs: boolean,
    bookNumber: number,
    opts: RenderChapterOptions = {}
  ): void {
    const { crossRefs, crossRefMode, bookNameResolver, strongsPrefix: prefixOverride } = opts;
    const strongsPrefix = prefixOverride || (bookNumber < 470 ? 'H' : 'G');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div') as VerseTextWrapper;
    wrapper.className = 'verse-text px-6 py-4';

    const crossRefsByVerse =
      crossRefs && crossRefs.length > 0 ? buildCrossRefsByVerse(crossRefs) : null;

    if (crossRefsByVerse) {
      wrapper._crossRefsByVerse = crossRefsByVerse;
      wrapper._bookNameResolver = bookNameResolver;
    }

    let lastClickedVerse: number | null = null;

    for (const v of verses) {
      const trimmed = v.text.trim();
      if (!trimmed) continue;

      const { range, text: cleanText } = extractVerseRange(trimmed);

      const line = document.createElement('div') as VerseLineElement;
      line.className = 'verse-line';
      line.dataset.verse = String(v.verse);

      const numSpan = document.createElement('span');
      numSpan.className = 'verse-number';
      numSpan.textContent = range || String(v.verse);
      numSpan.id = `v-${v.verse}`;

      const footnotes: string[] = [];
      const textSpan = document.createElement('span');
      textSpan.className = 'verse-content';
      textSpan.innerHTML = parseVerseText(cleanText, showStrongs, strongsPrefix, footnotes);
      if (footnotes.length > 0) line._footnotes = footnotes;

      line.appendChild(numSpan);
      line.appendChild(textSpan);

      line.addEventListener('mousedown', (e: MouseEvent): void => {
        const target = e.target instanceof Element ? e.target : null;
        if (e.shiftKey && !target?.closest('.crossref-link, .verse-footnote-marker')) {
          e.preventDefault();
        }
      });

      line.addEventListener('click', (e: MouseEvent): void => {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('.crossref-link')) return;
        const all = Array.from(wrapper.querySelectorAll<VerseLineElement>('.verse-line'));

        if (e.shiftKey && lastClickedVerse !== null) {
          const lastIdx = all.findIndex((el) => el.dataset.verse === String(lastClickedVerse));
          const curIdx = all.indexOf(line);
          if (lastIdx !== -1 && curIdx !== -1) {
            const from = Math.min(lastIdx, curIdx);
            const to = Math.max(lastIdx, curIdx);
            all.forEach((el) => el.classList.remove('verse-selected'));
            for (let i = from; i <= to; i++) all[i].classList.add('verse-selected');
          }
        } else if (e.ctrlKey || e.metaKey) {
          line.classList.toggle('verse-selected');
          lastClickedVerse = v.verse;
        } else {
          all.forEach((el) => el.classList.remove('verse-selected'));
          line.classList.add('verse-selected');
          lastClickedVerse = v.verse;
        }

        if (e.shiftKey || e.ctrlKey || e.metaKey) clearNativeSelection();
      });

      wrapper.appendChild(line);
    }

    function clearNativeSelection(): void {
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }

    wrapper.addEventListener('click', (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      const marker = target?.closest<HTMLElement>('.verse-footnote-marker') || null;
      const existing = wrapper.querySelector('.verse-footnote-popover');
      if (existing) existing.remove();
      if (!marker) return;
      e.stopPropagation();
      const line = marker.closest<VerseLineElement>('.verse-line');
      if (!line || !line._footnotes) return;
      const idx = parseInt(marker.dataset.fnIndex || '', 10);
      const content = line._footnotes[idx];
      if (!content) return;
      const popover = document.createElement('div');
      popover.className = 'verse-footnote-popover';
      popover.innerHTML = content;
      wrapper.style.position = 'relative';
      const rect = marker.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      popover.style.left = `${rect.left - wrapperRect.left}px`;
      popover.style.top = `${rect.bottom - wrapperRect.top + 4}px`;
      wrapper.appendChild(popover);

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
          popover.remove();
          document.removeEventListener('keydown', onKey);
        }
      };
      document.addEventListener('keydown', onKey);
    });

    if (crossRefMode === 'inline' && crossRefsByVerse) {
      renderCrossRefsInline(wrapper, crossRefsByVerse, bookNameResolver);
    }

    fragment.appendChild(wrapper);
    container.appendChild(fragment);
  }

  function toggleVerseRefs(verseLine: HTMLElement): void {
    const existing = verseLine.querySelector('.crossref-refs');
    if (existing) {
      existing.remove();
      return;
    }
    const wrapper = verseLine.closest<VerseTextWrapper>('.verse-text');
    if (!wrapper || !wrapper._crossRefsByVerse) return;
    const verse = parseInt(verseLine.dataset.verse || '', 10);
    const refs = wrapper._crossRefsByVerse.get(verse);
    if (!refs || refs.length === 0) return;
    const span = document.createElement('span');
    span.className = 'crossref-refs';
    for (let i = 0; i < refs.length; i++) {
      if (i > 0) span.appendChild(document.createTextNode(' '));
      span.appendChild(createRefLink(refs[i], wrapper._bookNameResolver));
    }
    verseLine.appendChild(span);
  }

  function scrollToVerse(container: HTMLElement, verseNum: number): void {
    const el = container.querySelector<HTMLElement>(`#v-${verseNum}`);
    if (!el) return;
    const line = el.closest<HTMLElement>('.verse-line');
    const target = line || el;
    requestAnimationFrame((): void => {
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      container
        .querySelectorAll<HTMLElement>('.verse-selected')
        .forEach((v) => v.classList.remove('verse-selected'));
      target.classList.add('verse-selected');
    });
  }

  function selectAdjacentVerse(container: HTMLElement, direction: -1 | 1, shiftHeld: boolean): void {
    const verses = container.querySelectorAll<HTMLElement>('.verse-line');
    if (verses.length === 0) return;

    const selected = Array.from(container.querySelectorAll<HTMLElement>('.verse-selected'));
    if (selected.length === 0) {
      const target = direction === 1 ? verses[0] : verses[verses.length - 1];
      target.classList.add('verse-selected');
      target.scrollIntoView({ block: 'nearest' });
      return;
    }

    const list = Array.from(verses);
    const anchor = direction === 1 ? selected[selected.length - 1] : selected[0];
    const idx = list.indexOf(anchor);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;

    if (shiftHeld) {
      list[nextIdx].classList.add('verse-selected');
    } else {
      list.forEach((el) => el.classList.remove('verse-selected'));
      list[nextIdx].classList.add('verse-selected');
    }
    list[nextIdx].scrollIntoView({ block: 'nearest' });
  }

  function getSelectedText(container: HTMLElement): string {
    const wrapper = container.querySelector<HTMLElement>('.verse-text');
    if (!wrapper) return '';
    const bookShort = wrapper.dataset.bookShort || '';
    const chapter = wrapper.dataset.chapter || '';
    const selected = wrapper.querySelectorAll<HTMLElement>('.verse-selected');
    if (selected.length === 0) return '';
    const lines: string[] = [];
    for (const el of selected) {
      const verse = el.dataset.verse;
      const content = el.querySelector<HTMLElement>('.verse-content');
      let text = '';
      if (content) {
        const clone = content.cloneNode(true);
        if (clone instanceof HTMLElement) {
          clone
            .querySelectorAll('.strongs, .verse-annotation, .verse-footnote-marker')
            .forEach((s) => s.remove());
          text = clone.textContent?.trim() || '';
        }
      }
      lines.push(`[${bookShort} ${chapter}:${verse}] ${text}`);
    }
    return lines.join('\n');
  }

  return {
    renderChapter,
    scrollToVerse,
    selectAdjacentVerse,
    getSelectedText,
    toggleVerseRefs,
    parseVerseText,
    normalizeTheWordWordAnnotations,
  };
})();
