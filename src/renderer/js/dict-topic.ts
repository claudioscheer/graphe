export function isExternalHref(href: string | null | undefined): boolean {
  return /^(https?:|mailto:|tel:)/i.test(String(href || '').trim());
}

export function normalizeTopicCandidate(raw: string | null | undefined): string {
  if (raw == null) return '';
  let value = String(raw).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
  }
  if (!value) return '';

  if (value.startsWith('#') && !/^#b/i.test(value)) {
    value = value.slice(1);
  }

  value = value.split('#')[0];
  value = value.split('?')[0];

  const dPrefixed = value.match(/^d(?:[:\-\s]+)?(.+)$/i);
  if (dPrefixed && dPrefixed[1]) {
    value = dPrefixed[1].trim();
  }

  return value;
}
