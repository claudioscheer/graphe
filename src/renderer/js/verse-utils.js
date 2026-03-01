/**
 * verse-utils.js — Shared plain-text extraction from raw verse markup
 */
const VerseUtils = (() => {
  function cleanText(text) {
    if (!text) return '';
    let s = String(text);
    // Remove <n>...</n> verse-range tags
    s = s.replace(/<n>[\s\S]*?<\/n>/gi, '');
    // Replace tags with spaces to prevent word merging
    s = s.replace(/<pb\s*\/?>/gi, ' ');
    s = s.replace(/<S>[\s\S]*?<\/S>/gi, ' ');
    s = s.replace(/<f>[\s\S]*?<\/f>/gi, ' ');
    s = s.replace(/<i>([\s\S]*?)<\/i>/gi, '$1');
    s = s.replace(/<[^>]+>/g, ' ');
    // Collapse multiple spaces
    s = s.replace(/\s+/g, ' ');
    return s.trim();
  }

  return { cleanText };
})();
