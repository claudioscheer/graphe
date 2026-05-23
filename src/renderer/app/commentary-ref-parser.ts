interface BookName {
  short: string;
  long: string;
}

type BookNamesByLang = Record<string, BookName[]>;
type BookAliasMap = Map<string, number>;

interface ReferenceContext {
  bookNum: number | string;
  chapter: number | string;
  verseFrom?: number | null;
  verseTo?: number | null;
}

interface ContinuationOptions {
  requireSeparator?: boolean;
}

interface ParsedReference {
  raw: string;
  index: number;
  endIndex: number;
  bookNum: number;
  chapter: number;
  verseFrom: number | null;
  verseTo: number | null;
}

interface ReferenceMatcher {
  findMatches(text: string | null | undefined): ParsedReference[];
  findContinuations(
    text: string | null | undefined,
    context: ReferenceContext,
    options?: ContinuationOptions
  ): ParsedReference[];
}

interface RegisterBookAliasOptions {
  numberedOnly?: boolean;
}

function foldDiacritics(value: string | number | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function registerAlias(map: BookAliasMap, alias: string | null | undefined, bookNum: number): void {
  if (!alias) return;
  const lower = String(alias).toLowerCase();
  if (!map.has(lower)) map.set(lower, bookNum);
  const compact = lower.replace(/\s+/g, '');
  if (compact !== lower && !map.has(compact)) map.set(compact, bookNum);
  const folded = foldDiacritics(alias);
  if (folded && !map.has(folded)) map.set(folded, bookNum);
  const foldedCompact = folded.replace(/\s+/g, '');
  if (foldedCompact !== folded && !map.has(foldedCompact)) map.set(foldedCompact, bookNum);
}

function maybeRegisterCommonAliases(
  map: BookAliasMap,
  baseSet: Set<string>,
  shortName: string,
  longName: string,
  bookNum: number
): void {
  const shortLower = String(shortName || '').toLowerCase();
  const longLower = String(longName || '').toLowerCase();
  const shortFold = foldDiacritics(shortName);
  const longFold = foldDiacritics(longName);
  const numberedPrefix =
    (shortLower.match(/^([123])\s*/) ||
      longLower.match(/^([123])\s*/) ||
      longFold.match(/^([123])\s*/))?.[1] || '';
  const registerBookAlias = (
    alias: string,
    { numberedOnly = false }: RegisterBookAliasOptions = {}
  ): void => {
    if (!alias) return;
    if (numberedOnly && numberedPrefix) {
      registerAlias(map, `${numberedPrefix}${alias}`, bookNum);
      registerAlias(map, `${numberedPrefix} ${alias}`, bookNum);
    } else {
      registerAlias(map, alias, bookNum);
    }
    baseSet.add(alias);
  };
  if (shortLower === 'mt' || /mateus|matthew/.test(longLower) || /mateus|matthew/.test(longFold)) {
    registerBookAlias('mat');
    registerBookAlias('matt');
  }
  if (/exodus/.test(longLower) || /exodus/.test(longFold)) {
    registerBookAlias('exod');
  }
  if (/deuteronomy/.test(longLower) || /deuteronomy/.test(longFold)) {
    registerBookAlias('deut');
  }
  if (/joshua/.test(longLower) || /joshua/.test(longFold)) {
    registerBookAlias('josh');
  }
  if (/judges/.test(longLower) || /judges/.test(longFold)) {
    registerBookAlias('judg');
  }
  if (/zechariah/.test(longLower) || /zechariah/.test(longFold)) {
    registerBookAlias('zech');
  }
  if (/isaiah|isaias/.test(longLower) || /isaiah|isaias/.test(longFold)) {
    registerBookAlias('isa');
  }
  if (/jeremiah|jeremias/.test(longLower) || /jeremiah|jeremias/.test(longFold)) {
    registerBookAlias('jer');
  }
  if (
    /proverbs/.test(longLower) ||
    /proverb/.test(longFold) ||
    shortFold === 'pv' ||
    shortFold === 'pr'
  ) {
    registerBookAlias('prov');
    registerBookAlias('prv');
    registerBookAlias('pro');
    registerBookAlias('pró');
  }
  if (
    /song of solomon|song of songs|cantares/.test(longLower) ||
    /song of solomon|song of songs|cantares/.test(longFold)
  ) {
    registerBookAlias('song');
  }
  if (/philippians|filipenses/.test(longLower) || /philippians|filipenses/.test(longFold)) {
    registerBookAlias('phil');
  }
  if (/corinthians|corintios/.test(longLower) || /corinthians|corintios/.test(longFold)) {
    registerBookAlias('cor', { numberedOnly: true });
    registerBookAlias('corinth', { numberedOnly: true });
  }
  if (/philemon|filemom|filemon/.test(longLower) || /philemon|filemom|filemon/.test(longFold)) {
    registerBookAlias('philem');
  }
  if (/samuel/.test(longLower) || /samuel/.test(longFold)) {
    registerBookAlias('sam', { numberedOnly: true });
  }
  if (/psalm|psalms|salmo|salmos/.test(longLower) || /psalm|psalms|salmo|salmos/.test(longFold)) {
    registerBookAlias('psalm');
    registerBookAlias('salmo');
    registerBookAlias('ps');
  }
}

function buildReferenceMatcher(
  bookNamesByLang: BookNamesByLang,
  bookNumbers: number[]
): ReferenceMatcher {
  const abbrToBookNum: BookAliasMap = new Map();
  const baseSet = new Set<string>();

  for (const lang of Object.keys(bookNamesByLang || {})) {
    const names = bookNamesByLang[lang] || [];
    for (let i = 0; i < names.length; i++) {
      const bookNum = bookNumbers[i];
      const name = names[i];
      if (!name) continue;
      for (const form of [name.short, name.long]) {
        const lower = String(form || '').toLowerCase();
        if (!lower) continue;
        registerAlias(abbrToBookNum, lower, bookNum);
        maybeRegisterCommonAliases(abbrToBookNum, baseSet, name.short, name.long, bookNum);

        const compact = lower.replace(/\s+/g, '');
        if (compact !== lower && !abbrToBookNum.has(compact)) abbrToBookNum.set(compact, bookNum);
        const folded = foldDiacritics(form);
        if (folded) {
          baseSet.add(folded);
          const foldedCompact = folded.replace(/\s+/g, '');
          if (foldedCompact) baseSet.add(foldedCompact);
        }

        const m = lower.match(/^[123]\s*(.*)/);
        baseSet.add(m ? m[1] : lower);
        const mFolded = folded && folded.match(/^[123]\s*(.*)/);
        if (mFolded) baseSet.add(mFolded[1]);
      }
    }
  }

  const bases = [...baseSet].sort((a, b) => b.length - a.length);
  const pattern = bases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const refRegex = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:([123])(?:\\1)?\\s*\\.?\\s*)?(${pattern})(?:\\s+|\\s*\\.\\s*)(\\d{1,3})(?:\\s*[.:]\\s*(?:[.:]\\s*)*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?`,
    'giu'
  );

  function resolveBook(prefix: string, abbrev: string): number | null {
    const base = String(abbrev || '').toLowerCase();
    const foldedBase = foldDiacritics(abbrev);
    if (prefix) {
      return (
        abbrToBookNum.get(prefix + base) ||
        abbrToBookNum.get(prefix + ' ' + base) ||
        abbrToBookNum.get(prefix + foldedBase) ||
        abbrToBookNum.get(prefix + ' ' + foldedBase) ||
        null
      );
    }
    return abbrToBookNum.get(base) || abbrToBookNum.get(foldedBase) || null;
  }

  function findContinuations(
    text: string | null | undefined,
    context: ReferenceContext,
    options: ContinuationOptions = {}
  ): ParsedReference[] {
    const input = String(text || '');
    const bookNum = parseInt(String(context.bookNum), 10);
    const chapter = parseInt(String(context.chapter), 10);
    if (!Number.isFinite(bookNum) || !Number.isFinite(chapter)) return [];
    const requireSeparator = options.requireSeparator === true;
    const hasVerseContext =
      context != null &&
      (Object.prototype.hasOwnProperty.call(context, 'verseFrom') ||
        Object.prototype.hasOwnProperty.call(context, 'verseTo'));
    const chapterOnlyContext =
      hasVerseContext && context?.verseFrom == null && context?.verseTo == null;

    const out: ParsedReference[] = [];
    let lastChapter = chapter;
    let cursor = 0;
    while (cursor < input.length) {
      const tail = input.slice(cursor);
      const continuationMatch = tail.match(
        requireSeparator
          ? /^((?:\s*\.\s*\d{1,3})*)(\s*[;,]\s*(?:\.+\s*)?)(\d{1,3})(?:(?:\s*[.:]\s*(?:[.:]\s*)*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)|(?:\s*[-–]\s*(\d{1,3})))?/
          : /^(\s*(?:[;,]\s*(?:\.+\s*)?)?)(\d{1,3})(?:(?:\s*[.:]\s*(?:[.:]\s*)*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)|(?:\s*[-–]\s*(\d{1,3})))?/
      );
      if (!continuationMatch) break;

      const skipped = requireSeparator ? continuationMatch[1] : '';
      const leading = requireSeparator ? continuationMatch[2] : continuationMatch[1];
      const firstNum = requireSeparator ? continuationMatch[3] : continuationMatch[2];
      const explicitVerseFrom = requireSeparator ? continuationMatch[4] : continuationMatch[3];
      const explicitVerseTo = requireSeparator ? continuationMatch[5] : continuationMatch[4];
      const rangeVerseTo = requireSeparator ? continuationMatch[6] : continuationMatch[5];
      const raw = continuationMatch[0].slice(skipped.length + leading.length);
      const start = cursor + skipped.length + leading.length;
      const end = cursor + continuationMatch[0].length;
      if (start >= end) break;
      const trailing = tail.slice(continuationMatch[0].length);
      if (
        explicitVerseFrom == null &&
        rangeVerseTo == null &&
        (/^\s+[A-ZÀ-ÖØ-Þ]/.test(trailing) || /^\s*(?:\.\s*)+[A-ZÀ-ÖØ-Þ]/.test(trailing))
      ) {
        break;
      }

      const n1 = parseInt(firstNum, 10);
      let refChapter = chapterOnlyContext ? n1 : lastChapter;
      let verseFrom = chapterOnlyContext ? null : n1;
      let verseTo = chapterOnlyContext ? null : n1;
      if (explicitVerseFrom != null) {
        refChapter = n1;
        verseFrom = parseInt(explicitVerseFrom, 10);
        verseTo = explicitVerseTo != null ? parseInt(explicitVerseTo, 10) : verseFrom;
      } else if (rangeVerseTo != null) {
        if (chapterOnlyContext) {
          refChapter = n1;
        } else {
          verseTo = parseInt(rangeVerseTo, 10);
        }
      }

      out.push({
        raw,
        index: start,
        endIndex: end,
        bookNum,
        chapter: refChapter,
        verseFrom,
        verseTo,
      });

      lastChapter = refChapter;
      cursor = end;
    }
    return out;
  }

  function findMatches(text: string | null | undefined): ParsedReference[] {
    const input = String(text || '');
    refRegex.lastIndex = 0;
    const out: ParsedReference[] = [];
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(input)) !== null) {
      const prefix = m[1] || '';
      const abbrev = m[2];
      const bookNum = resolveBook(prefix, abbrev);
      if (!bookNum) {
        if (prefix) refRegex.lastIndex = m.index + 1;
        continue;
      }
      const chapter = parseInt(m[3], 10);
      const verseFrom = m[4] ? parseInt(m[4], 10) : null;
      const verseTo = m[5] ? parseInt(m[5], 10) : verseFrom;
      out.push({
        raw: m[0],
        index: m.index,
        endIndex: m.index + m[0].length,
        bookNum,
        chapter,
        verseFrom,
        verseTo,
      });

      const continuationStart = m.index + m[0].length;
      const continuationRefs = findContinuations(
        input.slice(continuationStart),
        { bookNum, chapter, verseFrom, verseTo },
        { requireSeparator: true }
      );
      for (const c of continuationRefs) {
        out.push({
          ...c,
          index: c.index + continuationStart,
          endIndex: c.endIndex + continuationStart,
        });
      }
    }
    return out;
  }

  return { findMatches, findContinuations };
}

function parseLeadingReferenceFromPlainText(
  text: string | null | undefined
): Pick<ParsedReference, 'chapter' | 'verseFrom' | 'verseTo'> | null {
  const firstLine = String(text || '')
    .trimStart()
    .split(/\r?\n/, 1)[0]
    .trim();
  const match = firstLine.match(
    /^(?:[\[({]\s*)?(?:(?:[1-3]\s*)?[A-Za-zÀ-ÖØ-öø-ÿ.]+(?:\s+|\s*\.\s*))?(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?\b/
  );
  if (!match) return null;

  const chapter = parseInt(match[1], 10);
  const verseFrom = match[2] ? parseInt(match[2], 10) : 1;
  const verseTo = match[3] ? parseInt(match[3], 10) : verseFrom;
  if (!Number.isFinite(chapter) || !Number.isFinite(verseFrom) || !Number.isFinite(verseTo)) {
    return null;
  }
  return { chapter, verseFrom, verseTo };
}

export { buildReferenceMatcher, parseLeadingReferenceFromPlainText };
