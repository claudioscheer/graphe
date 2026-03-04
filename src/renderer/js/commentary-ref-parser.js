(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.CommentaryRefParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function registerAlias(map, alias, bookNum) {
    if (!alias) return;
    const lower = String(alias).toLowerCase();
    if (!map.has(lower)) map.set(lower, bookNum);
    const compact = lower.replace(/\s+/g, '');
    if (compact !== lower && !map.has(compact)) map.set(compact, bookNum);
  }

  function maybeRegisterCommonAliases(map, baseSet, shortName, longName, bookNum) {
    const shortLower = String(shortName || '').toLowerCase();
    const longLower = String(longName || '').toLowerCase();
    // Common aliases found in legacy commentary modules.
    if (shortLower === 'mt' || /mateus|matthew/.test(longLower)) {
      registerAlias(map, 'mat', bookNum);
      registerAlias(map, 'matt', bookNum);
      baseSet.add('mat');
      baseSet.add('matt');
    }
    if (/exodus/.test(longLower)) {
      registerAlias(map, 'exod', bookNum);
      baseSet.add('exod');
    }
    if (/deuteronomy/.test(longLower)) {
      registerAlias(map, 'deut', bookNum);
      baseSet.add('deut');
    }
    if (/joshua/.test(longLower)) {
      registerAlias(map, 'josh', bookNum);
      baseSet.add('josh');
    }
    if (/judges/.test(longLower)) {
      registerAlias(map, 'judg', bookNum);
      baseSet.add('judg');
    }
    if (/zechariah/.test(longLower)) {
      registerAlias(map, 'zech', bookNum);
      baseSet.add('zech');
    }
    if (/proverbs/.test(longLower)) {
      registerAlias(map, 'prov', bookNum);
      registerAlias(map, 'prv', bookNum);
      baseSet.add('prov');
      baseSet.add('prv');
    }
    if (/song of solomon|song of songs|cantares/.test(longLower)) {
      registerAlias(map, 'song', bookNum);
      baseSet.add('song');
    }
    if (/philippians/.test(longLower)) {
      registerAlias(map, 'phil', bookNum);
      baseSet.add('phil');
    }
  }

  function buildReferenceMatcher(bookNamesByLang, bookNumbers) {
    const abbrToBookNum = new Map();
    const baseSet = new Set();

    for (const lang of Object.keys(bookNamesByLang || {})) {
      const names = bookNamesByLang[lang] || [];
      for (let i = 0; i < names.length; i++) {
        const bookNum = bookNumbers[i];
        for (const form of [names[i].short, names[i].long]) {
          const lower = String(form || '').toLowerCase();
          if (!lower) continue;
          registerAlias(abbrToBookNum, lower, bookNum);
          maybeRegisterCommonAliases(abbrToBookNum, baseSet, names[i].short, names[i].long, bookNum);

          const compact = lower.replace(/\s+/g, '');
          if (compact !== lower && !abbrToBookNum.has(compact)) abbrToBookNum.set(compact, bookNum);

          const m = lower.match(/^[123]\s*(.*)/);
          baseSet.add(m ? m[1] : lower);
        }
      }
    }

    const bases = [...baseSet].sort((a, b) => b.length - a.length);
    const pattern = bases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const refRegex = new RegExp(
      `\\b([123])?\\s*(${pattern})(?:\\s+|\\s*\\.\\s*)(\\d{1,3})(?:[.:](\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?`,
      'gi'
    );

    function resolveBook(prefix, abbrev) {
      const base = String(abbrev || '').toLowerCase();
      if (prefix) {
        return (
          abbrToBookNum.get(prefix + base) ||
          abbrToBookNum.get(prefix + ' ' + base) ||
          null
        );
      }
      return abbrToBookNum.get(base) || null;
    }

    function findContinuations(text, context, options = {}) {
      const input = String(text || '');
      const bookNum = parseInt(context?.bookNum, 10);
      const chapter = parseInt(context?.chapter, 10);
      if (!Number.isFinite(bookNum) || !Number.isFinite(chapter)) return [];
      const requireSeparator = options.requireSeparator === true;

      const out = [];
      let lastChapter = chapter;
      let cursor = 0;
      while (cursor < input.length) {
        const tail = input.slice(cursor);
        const continuationMatch = tail.match(
          requireSeparator
            ? /^(\s*[;,]\s*)(\d{1,3})(?:(?:[.:](\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)|(?:\s*[-–]\s*(\d{1,3})))?/
            : /^(\s*(?:[;,]\s*)?)(\d{1,3})(?:(?:[.:](\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)|(?:\s*[-–]\s*(\d{1,3})))?/
        );
        if (!continuationMatch) break;

        const [, leading, firstNum, explicitVerseFrom, explicitVerseTo, rangeVerseTo] =
          continuationMatch;
        const raw = continuationMatch[0].slice(leading.length);
        const start = cursor + leading.length;
        const end = cursor + continuationMatch[0].length;
        if (start >= end) break;

        const n1 = parseInt(firstNum, 10);
        let refChapter = lastChapter;
        let verseFrom = n1;
        let verseTo = n1;
        if (explicitVerseFrom != null) {
          refChapter = n1;
          verseFrom = parseInt(explicitVerseFrom, 10);
          verseTo = explicitVerseTo != null ? parseInt(explicitVerseTo, 10) : verseFrom;
        } else if (rangeVerseTo != null) {
          verseTo = parseInt(rangeVerseTo, 10);
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

    function findMatches(text) {
      const input = String(text || '');
      refRegex.lastIndex = 0;
      const out = [];
      let m;
      while ((m = refRegex.exec(input)) !== null) {
        const prefix = m[1] || '';
        const abbrev = m[2];
        const bookNum = resolveBook(prefix, abbrev);
        if (!bookNum) {
          // Recover from false positives like "...112:1 Psa 119:1-2" where the
          // trailing "1" is misread as a numbered-book prefix.
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

        // Support compact follow-up refs that reuse the same book/chapter context:
        // e.g. "Zech 5:3; 14:12" or "Jo 3:16, 18".
        const continuationStart = m.index + m[0].length;
        const continuationRefs = findContinuations(
          input.slice(continuationStart),
          { bookNum, chapter },
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

  function parseLeadingReferenceFromPlainText(text) {
    const firstLine = String(text || '').trimStart().split(/\r?\n/, 1)[0].trim();
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

  return { buildReferenceMatcher, parseLeadingReferenceFromPlainText };
});
