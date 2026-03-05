/**
 * sanitize.js — Shared HTML sanitization utilities.
 */
export const Sanitize = (() => {
  const dangerousTags = 'script, iframe, object, embed, form, link, meta';
  const urlAttrs = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);
  const legacyPresentationalAttrs = new Set([
    'align',
    'background',
    'bgcolor',
    'border',
    'cellpadding',
    'cellspacing',
    'color',
    'face',
    'height',
    'hspace',
    'size',
    'valign',
    'vspace',
    'width',
  ]);

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const dangerous = doc.querySelectorAll(dangerousTags);
    for (const el of dangerous) el.remove();

    const all = doc.body.querySelectorAll('*');
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = (attr.value || '').trim();
        if (
          name.startsWith('on') ||
          name === 'style' ||
          name === 'srcdoc' ||
          legacyPresentationalAttrs.has(name)
        ) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (urlAttrs.has(name) && !isSafeUrl(value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    return doc.body.innerHTML;
  }

  function isSafeUrl(value) {
    if (!value) return true;
    if (
      value.startsWith('#') ||
      value.startsWith('/') ||
      value.startsWith('./') ||
      value.startsWith('../')
    ) {
      return true;
    }
    const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
    if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return false;
    if (normalized.startsWith('data:')) {
      return normalized.startsWith('data:image/');
    }
    return (
      normalized.startsWith('http:') ||
      normalized.startsWith('https:') ||
      normalized.startsWith('mailto:') ||
      normalized.startsWith('tel:') ||
      normalized.startsWith('b:') ||
      normalized.startsWith('s:')
    );
  }

  return { sanitizeHtml, isSafeUrl };
})();
