/**
 * Dictionary content link binding (Strong's, topics, bible refs, V. cross-refs).
 */
import { parseBibleHref, type ParsedBibleRef } from './bible-ref.js';
import { buildReferenceMatcher } from './commentary-ref-parser.js';
import { isExternalHref, normalizeTopicCandidate } from './dict-topic.js';
import { I18n } from './i18n.js';
import { PaneManager } from './pane-manager.js';

interface ReferenceMatch {
  raw: string;
  index: number;
  endIndex: number;
  bookNum: number;
  chapter: number;
  verseFrom: number | null;
  verseTo?: number | null;
}

interface ReferenceContext {
  bookNum: number;
  chapter: number;
}

interface ReferenceMatcherApi {
  findMatches(text: string | null | undefined): ReferenceMatch[];
  findContinuations(text: string | null | undefined, context: ReferenceContext): ReferenceMatch[];
}

export interface DictLinkHandlers {
  ensureCurrentInHistory(): void;
  lookup(strongsNumber: string, skipHistory?: boolean): void | Promise<void>;
  lookupWord(
    topic: string,
    moduleId?: string | null,
    skipHistory?: boolean,
    options?: { preserveActivity?: boolean }
  ): void | Promise<void>;
}

let handlers: DictLinkHandlers | null = null;
let bibleRefMatcher: ReferenceMatcherApi | null = null;
let bibleRefMatcherLang: string | null = null;

export function setDictLinkHandlers(next: DictLinkHandlers): void {
  handlers = next;
}

function ensureCurrentInHistory(): void {
  handlers?.ensureCurrentInHistory();
}

function lookup(strongsNumber: string, skipHistory = false): void | Promise<void> {
  return handlers?.lookup(strongsNumber, skipHistory);
}

function lookupWord(
  topic: string,
  moduleId: string | null = null,
  skipHistory = false,
  options: { preserveActivity?: boolean } = {}
): void | Promise<void> {
  return handlers?.lookupWord(topic, moduleId, skipHistory, options);
}

export function bindStrongsCrossRefs(container: HTMLElement): void {
  // Mark TWOT refs as non-navigable.
  const twotLinks = container.querySelectorAll<HTMLAnchorElement>('a.T, a[class="T"]');
  for (const link of twotLinks) {
    link.removeAttribute('href');
    link.classList.add('dict-twot-ref');
  }
}

export async function resolveTopicInModule(
  moduleId: string | null,
  candidate: string | null | undefined
): Promise<string | null> {
  const topic = normalizeTopicCandidate(candidate);
  if (!moduleId || !topic) return null;

  try {
    const exact = await window.api.getDictionaryEntry(moduleId, topic);
    if (exact) return topic;
  } catch (_) {}

  try {
    const results = await window.api.searchDictionaryTopics(moduleId, topic, 20);
    if (!Array.isArray(results) || results.length === 0) return null;
    const lower = topic.toLowerCase();
    const exactCI = results.find((t) => String(t).toLowerCase() === lower);
    return exactCI || results[0];
  } catch (_) {
    return null;
  }
}

export function bindDictionaryTopicLinks(container: HTMLElement, moduleId: string): void {
  function bindRedirect(link: HTMLAnchorElement, hrefCandidate: string): void {
    if (link.dataset.dictRedirectBound === '1') return;
    link.dataset.dictRedirectBound = '1';
    link.classList.add('dict-crossref');
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const hrefTopic = normalizeTopicCandidate(hrefCandidate || '');
      const textTopic = normalizeTopicCandidate(link.textContent || '');

      let target = await resolveTopicInModule(moduleId, hrefTopic);
      if (!target && textTopic && textTopic.toLowerCase() !== hrefTopic.toLowerCase()) {
        target = await resolveTopicInModule(moduleId, textTopic);
      }
      if (!target) target = textTopic || hrefTopic;
      if (!target) return;

      ensureCurrentInHistory();
      lookupWord(target, moduleId, false);
    });
  }

  const allLinks = container.querySelectorAll<HTMLAnchorElement>('a');
  for (const link of allLinks) {
    if (link.classList.contains('dict-bible-ref')) continue;
    if (link.classList.contains('dict-twot-ref')) continue;
    const href = (link.getAttribute('href') || '').trim();

    if (isExternalHref(href)) {
      if (link.dataset.dictRedirectBound === '1') continue;
      link.dataset.dictRedirectBound = '1';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.api.openExternal(href);
      });
      continue;
    }

    if (/^s:/i.test(href) || /^b:/i.test(href) || /^#b/i.test(href)) {
      if (/^b:/i.test(href) || /^#b/i.test(href)) continue;
    }

    if (href) link.removeAttribute('href');
    bindRedirect(link, href);
  }
}

export function bindBibleRefs(container: HTMLElement): void {
  linkifyPlainTextBibleRefs(container);

  const links = container.querySelectorAll<HTMLAnchorElement>('a');
  for (const link of links) {
    if (link.dataset.bibleRefBound === '1') continue;
    const href = (link.getAttribute('href') || '').trim();
    let parsedRef: ParsedBibleRef | null = null;
    if (link.dataset.bookNumber && link.dataset.chapter) {
      parsedRef = {
        bookNumber: parseInt(link.dataset.bookNumber, 10),
        chapter: parseInt(link.dataset.chapter, 10),
        verse: link.dataset.verse ? parseInt(link.dataset.verse, 10) : 1,
      };
    }
    if (!parsedRef) parsedRef = parseBibleHref(href, { requireVerse: true });
    if (!parsedRef) {
      parsedRef = parseBibleRefFromText(link.textContent || '');
    }
    if (!parsedRef) continue;

    link.removeAttribute('href');
    link.classList.add('dict-bible-ref');

    const bookNumber = parsedRef.bookNumber;
    const chapter = parsedRef.chapter;
    const verse = parsedRef.verse ?? 1;
    link.dataset.bibleRefBound = '1';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const paneId = PaneManager.getActivePaneId();
      const target = PaneManager.getNavigationTarget(paneId);
      PaneManager.navigatePane(target, bookNumber, chapter, verse)
        .then((ok) => {
          if (!ok && target) window.showTooltip?.(target, I18n.t('refUnavailable'));
        })
        .catch((err) => console.warn('Bible ref navigation failed:', err));
    });
  }
}

export function linkifyPlainTextBibleRefs(container: HTMLElement): void {
  const matcher = getBibleRefMatcher();
  if (!matcher) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode instanceof Text) textNodes.push(currentNode);
  }

  let lastRefContext: ReferenceContext | null = null;
  for (const node of textNodes) {
    if (!node.parentNode) continue;
    const refAncestor = node.parentElement && node.parentElement.closest('a');
    if (refAncestor) {
      const href = (refAncestor.getAttribute('href') || '').trim();
      const parsed =
        parseBibleHref(href, { requireVerse: true }) ||
        parseBibleRefFromText(refAncestor.textContent || '');
      if (parsed) lastRefContext = { bookNum: parsed.bookNumber, chapter: parsed.chapter };
      continue;
    }

    const text = node.textContent || '';
    let matches = matcher.findMatches(text);
    if (matches.length === 0 && lastRefContext) {
      matches = matcher.findContinuations(text, lastRefContext);
    }
    if (matches.length === 0) continue;

    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    for (const match of matches) {
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }
      const link = document.createElement('a');
      link.className = 'dict-bible-ref';
      link.dataset.bookNumber = String(match.bookNum);
      link.dataset.chapter = String(match.chapter);
      if (Number.isFinite(match.verseFrom)) link.dataset.verse = String(match.verseFrom);
      link.textContent = match.raw;
      frag.appendChild(link);
      lastIdx = match.endIndex;
    }
    if (lastIdx > 0) {
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
      const last = matches[matches.length - 1];
      if (last && Number.isFinite(last.bookNum) && Number.isFinite(last.chapter)) {
        lastRefContext = { bookNum: last.bookNum, chapter: last.chapter };
      }
    }
  }
}

export function getBibleRefMatcher(): ReferenceMatcherApi | null {
  const lang = I18n.getCurrentLang();
  if (bibleRefMatcher && bibleRefMatcherLang === lang) return bibleRefMatcher;
  bibleRefMatcher = buildReferenceMatcher(I18n._bookNames, I18n._BOOK_NUMBERS);
  bibleRefMatcherLang = lang;
  return bibleRefMatcher;
}

export function parseBibleRefFromText(rawText: string | null | undefined): ParsedBibleRef | null {
  const text = String(rawText || '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const matcher = getBibleRefMatcher();
  if (!matcher) return null;
  const matches = matcher.findMatches(text);
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const m = matches[0];
  if (!m || !Number.isFinite(m.bookNum) || !Number.isFinite(m.chapter)) return null;
  const verse = Number.isFinite(m.verseFrom) ? m.verseFrom : 1;
  return {
    bookNumber: m.bookNum,
    chapter: m.chapter,
    verse,
  };
}

export function bindVCrossRefs(container: HTMLElement): void {
  // Find "V. TOPIC" patterns in text nodes and make them clickable
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const replacements: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node instanceof Text && /V\.\s+[A-ZÀ-Ú]/.test(node.textContent || '')) {
      replacements.push(node);
    }
  }

  for (const textNode of replacements) {
    const frag = document.createDocumentFragment();
    const text = textNode.textContent || '';
    // Match "V. WORD" or "V. WORD WORD" (uppercase words after V.)
    const regex = /V\.\s+([A-ZÀ-Ú][A-ZÀ-Ú\s,]*[A-ZÀ-Ú])/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      // Text before the match
      if (m.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
      }
      // Create clickable cross-ref
      const span = document.createElement('span');
      span.className = 'dict-vcrossref';
      span.textContent = m[0];
      const topic = m[1].trim();
      span.addEventListener('click', () => {
        ensureCurrentInHistory();
        lookupWord(topic);
      });
      frag.appendChild(span);
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
    }
    if (lastIdx > 0) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}
