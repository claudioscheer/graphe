/**
 * verse-utils.js — Shared plain-text extraction from raw verse markup
 */
const VerseUtils = (() => {
  function cleanText(text) {
    if (!text) return '';
    let s = String(text);
    // Remove <n>...</n> verse-range tags
    s = s.replace(/<n>[\s\S]*?<\/n>/gi, '');
    // Remove case-paired original-language content: <O>...<o>, <OG>...<og>, <OH>...<oh>
    s = s.replace(/<O[GH]?>([\s\S]*?)<o[gh]?>/g, '');
    // Remove case-paired transliteration: <T>...<t>, <TG>...<tg>, <TH>...<th>
    s = s.replace(/<T[GH]?>([\s\S]*?)<t[gh]?>/g, '');
    // Remove extended annotations: <X>...<x>
    s = s.replace(/<X>[\s\S]*?<x>/gi, '');
    // Remove morphology/lemma tags
    s = s.replace(/<m>[\s\S]*?<\/m>/gi, '');
    s = s.replace(/<l>[\s\S]*?<\/l>/gi, '');
    // Replace tags with spaces to prevent word merging
    s = s.replace(/<pb\s*\/?>/gi, ' ');
    s = s.replace(/<S>[\s\S]*?<\/S>/gi, ' ');
    s = s.replace(/<f>[\s\S]*?<\/f>/gi, ' ');
    s = s.replace(/<i>([\s\S]*?)<\/i>/gi, '$1');
    // Keep <E>...<e> content (translated text) but strip the tags
    s = s.replace(/<E>([\s\S]*?)<e>/g, '$1');
    // Remove all remaining tags
    s = s.replace(/<[^>]+>/g, ' ');
    // Collapse multiple spaces
    s = s.replace(/\s+/g, ' ');
    return s.trim();
  }

  /**
   * Clean verse text but preserve matching Strong's numbers inline.
   * Matched Strong's numbers are shown as superscripts on the preceding word.
   * @param {string} text - Raw verse markup
   * @param {Array<{prefix: string, number: string}>} strongNumbers - e.g. [{prefix:'H',number:'1234'}]
   * @returns {string} HTML string with <mark> and <sup> for matched Strong's
   */
  function cleanTextWithStrongs(text, strongNumbers) {
    if (!text) return '';
    let s = String(text);
    // Remove non-Strong's markup (same as cleanText)
    s = s.replace(/<n>[\s\S]*?<\/n>/gi, '');
    s = s.replace(/<O[GH]?>([\s\S]*?)<o[gh]?>/g, '');
    s = s.replace(/<T[GH]?>([\s\S]*?)<t[gh]?>/g, '');
    s = s.replace(/<X>[\s\S]*?<x>/gi, '');
    s = s.replace(/<m>[\s\S]*?<\/m>/gi, '');
    s = s.replace(/<l>[\s\S]*?<\/l>/gi, '');
    s = s.replace(/<pb\s*\/?>/gi, ' ');
    s = s.replace(/<f>[\s\S]*?<\/f>/gi, ' ');
    s = s.replace(/<i>([\s\S]*?)<\/i>/gi, '$1');
    s = s.replace(/<E>([\s\S]*?)<e>/g, '$1');

    // Build set of matched Strong's numbers in both forms: "H802" and "802"
    const matchSet = new Set();
    for (const sn of strongNumbers) {
      const full = (sn.prefix + sn.number).toUpperCase();
      matchSet.add(full);
      matchSet.add(sn.number.toUpperCase());
    }

    // Process <S>NUMBER</S> tags: mark preceding word if Strong's matches
    s = s.replace(/(\S+)\s*<S>([\s\S]*?)<\/S>/gi, (_, word, code) => {
      const normalized = code.trim().toUpperCase();
      if (matchSet.has(normalized)) {
        return `<mark>${word} <span class="strongs-tag">[${normalized}]</span></mark>`;
      }
      return word;
    });

    // Remove remaining tags, but preserve <mark> and <sup> from Strong's highlighting
    s = s.replace(/<(?!\/?(?:mark|span)\b)[^>]+>/g, ' ');
    s = s.replace(/\s+/g, ' ');
    return s.trim();
  }

  return { cleanText, cleanTextWithStrongs };
})();
