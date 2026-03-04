/**
 * Shared tag sanitization for MyBible SQLite3 converters.
 *
 * Both the theWord and MySword converters use these functions to normalize
 * Strong's tags and filter unsupported HTML-like markup from verse text.
 */

function normalizeStrongNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
}

function sanitizeStrongTags(text) {
  let tokenIndex = 0;
  const tokens = [];

  let result = String(text || '').replace(/<S[^>]*>[\s\S]*?<\/S>/gi, (pair) => {
    const contentMatch = pair.match(/^<S[^>]*>([\s\S]*?)<\/S>$/i);
    const rawInner = contentMatch ? contentMatch[1] : '';
    const innerText = rawInner.replace(/<[^>]+>/g, '');
    const number = normalizeStrongNumber(innerText);
    if (!number) return '';
    const token = `__GRAPHE_S_TOKEN_${tokenIndex++}__`;
    tokens.push({ token, value: `<S>${number}</S>` });
    return token;
  });

  result = result.replace(/<S[^>]*>/gi, '');
  result = result.replace(/<\/S>/gi, '');

  for (const { token, value } of tokens) {
    result = result.replaceAll(token, value);
  }

  return result;
}

function sanitizeSupportedTags(text) {
  const allowedOpenClose = new Set(['i', 'f', 'j', 'h', 'm', 'l']);
  const canonicalTag = (name) => (name === 'j' ? 'J' : name);
  return String(text || '').replace(/<[^>]*>/g, (tag) => {
    if (/^<pb\s*\/?>$/i.test(tag)) return '<pb/>';
    if (/^<(E|O|T|OG|OH|TG|TH|X)>$/.test(tag)) return tag;
    if (/^<(e|o|t|og|oh|tg|th|x)>$/.test(tag)) return tag;

    const closeMatch = tag.match(/^<\/\s*([a-z0-9]+)\s*>$/i);
    if (closeMatch) {
      const name = closeMatch[1].toLowerCase();
      if (name === 's') return '</S>';
      if (allowedOpenClose.has(name)) return `</${canonicalTag(name)}>`;
      return '';
    }

    const openMatch = tag.match(/^<\s*([a-z0-9]+)(?:\s+[^>]*)?\s*>$/i);
    if (!openMatch) return '';

    const name = openMatch[1].toLowerCase();
    if (name === 's') return '<S>';
    if (allowedOpenClose.has(name)) return `<${canonicalTag(name)}>`;
    return '';
  });
}

module.exports = { normalizeStrongNumber, sanitizeStrongTags, sanitizeSupportedTags };
