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

  return { cleanText };
})();
