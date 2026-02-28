/**
 * verse-utils.js — Shared plain-text extraction from raw verse markup
 */
const VerseUtils = (() => {
  function cleanText(text) {
    let s = text;
    // Remove <n>...</n> verse-range tags
    s = s.replace(/<n>[\s\S]*?<\/n>/gi, '');
    // Remove <f>...</f> footnotes (content and all)
    s = s.replace(/<f>[\s\S]*?<\/f>/gi, '');
    // Remove <S>...</S> Strong's numbers
    s = s.replace(/<S>[\s\S]*?<\/S>/gi, '');
    // Strip any remaining tags (<pb/>, <i>, etc.)
    s = s.replace(/<[^>]+>/g, '');
    // Collapse multiple spaces
    s = s.replace(/ {2,}/g, ' ');
    return s.trim();
  }

  return { cleanText };
})();
