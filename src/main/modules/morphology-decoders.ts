import type {
  DecodeSource,
  LanguageStrings,
  LocalizedLabel,
  MorphologyDecodeResult,
  MorphologyKind,
  MorphologySegment,
  SupportedLang,
} from './morphology-types';
import {
  BUILTIN_LANGUAGE,
  DEFAULT_LANG,
  ROBINSON_PARTS,
  ROBINSON_VALUES,
  SUPPORTED_LANGS,
} from './morphology-i18n-data';

function isSupportedLang(value: string): value is SupportedLang {
  return SUPPORTED_LANGS.includes(value as SupportedLang);
}

function normalizeBuiltInLang(lang: string | null | undefined): SupportedLang {
  const normalized = String(lang || DEFAULT_LANG)
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return isSupportedLang(normalized) ? normalized : DEFAULT_LANG;
}

export function getLangStrings(lang: string | null | undefined): LanguageStrings {
  return BUILTIN_LANGUAGE[normalizeBuiltInLang(lang)];
}

function localizeLookup(
  map: Record<string, LocalizedLabel> | undefined,
  key: string,
  lang: string | null | undefined
): string | null {
  const labels = map?.[key];
  if (!labels) return null;
  const builtInLang = normalizeBuiltInLang(lang);
  return labels[builtInLang] || labels[DEFAULT_LANG] || null;
}

function formatSegment(label: string, value: string): string {
  return label ? `${label}: ${value}` : value;
}

function buildDisplayText(segments: MorphologySegment[]): string {
  return segments.map((segment) => segment.text).join(' | ');
}

export function buildResult(
  rawCode: string,
  source: DecodeSource,
  segments: MorphologySegment[],
  topicRef: string | null = null
): MorphologyDecodeResult {
  return {
    rawCode,
    source,
    segments,
    displayText: buildDisplayText(segments),
    topicRef,
  };
}

const COMPACT_VALUE_KINDS: readonly Exclude<MorphologyKind, 'partOfSpeech' | 'unknown'>[] = [
  'stem',
  'aspect',
  'tense',
  'voice',
  'mood',
  'person',
  'gender',
  'number',
  'state',
  'case',
  'degree',
  'suffix',
];

function decodeCompactCode(
  rawCode: string | null | undefined,
  lang: string | null | undefined
): MorphologyDecodeResult | null {
  const strings = getLangStrings(lang);
  const normalizedCode = String(rawCode || '').trim();
  const tokens = normalizedCode.split('.').filter(Boolean);
  if (tokens.length === 0) return null;

  const [first, ...rest] = tokens;
  const partOfSpeechValues = strings.values.partOfSpeech || {};
  if (!normalizedCode.includes('.') && !partOfSpeechValues[first]) return null;
  const segments: MorphologySegment[] = [];
  const partOfSpeech = partOfSpeechValues[first];
  if (partOfSpeech) {
    segments.push({
      kind: 'partOfSpeech',
      code: first,
      text: formatSegment(strings.categories.partOfSpeech, partOfSpeech),
    });
  } else if (tokens.some((token) => token.length > 1)) {
    segments.push({
      kind: 'unknown',
      code: first,
      text: formatSegment(strings.categories.unknown, first),
    });
  } else {
    return null;
  }

  for (const token of rest) {
    const normalized = token.toLowerCase();
    let kind: MorphologyKind | null = null;
    let value = '';

    for (const candidate of COMPACT_VALUE_KINDS) {
      const match = strings.values[candidate]?.[normalized];
      if (match) {
        kind = candidate;
        value = match;
        break;
      }
    }

    if (!kind) {
      segments.push({
        kind: 'unknown',
        code: token,
        text: formatSegment(strings.categories.unknown, token),
      });
      continue;
    }

    segments.push({
      kind,
      code: token,
      text: formatSegment(strings.categories[kind], value),
    });
  }

  return buildResult(normalizedCode, 'builtin-compact', segments);
}

function decodeRobinsonCode(
  rawCode: string | null | undefined,
  lang: string | null | undefined
): MorphologyDecodeResult | null {
  const strings = getLangStrings(lang);
  const code = String(rawCode || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z](?:-[A-Z0-9]+)+$/.test(code)) return null;

  const [part, ...rest] = code.split('-');
  if (!ROBINSON_PARTS[part]) return null;
  const segments: MorphologySegment[] = [];
  const partLabel = localizeLookup(ROBINSON_VALUES.partOfSpeech, part, lang);
  if (partLabel) {
    segments.push({
      kind: 'partOfSpeech',
      code: part,
      text: formatSegment(strings.categories.partOfSpeech, partLabel),
    });
  }

  const firstBlock = rest[0] || '';
  if (firstBlock && /^[NGDAVBL][SPD][MFN]$/.test(firstBlock)) {
    const [caseCode, numberCode, genderCode] = firstBlock.split('');
    const triplet: Array<[MorphologyKind, string]> = [
      ['case', caseCode],
      ['number', numberCode],
      ['gender', genderCode],
    ];
    for (const [kind, token] of triplet) {
      const label = localizeLookup(ROBINSON_VALUES[kind], token, lang);
      if (!label) continue;
      segments.push({
        kind,
        code: token,
        text: formatSegment(strings.categories[kind], label),
      });
    }
    if (rest[1]) {
      const degree = localizeLookup(ROBINSON_VALUES.degree, rest[1], lang);
      if (degree) {
        segments.push({
          kind: 'degree',
          code: rest[1],
          text: formatSegment(strings.categories.degree, degree),
        });
      } else {
        segments.push({
          kind: 'unknown',
          code: rest[1],
          text: formatSegment(strings.categories.unknown, rest[1]),
        });
      }
    }
    return buildResult(code, 'builtin-robinson', segments);
  }

  if (part === 'V' && firstBlock && /^[PIFAXYRLT][AMPDENU][ISOMNPRDGU]$/.test(firstBlock)) {
    const [tenseCode, voiceCode, moodCode] = firstBlock.split('');
    const triplet: Array<[MorphologyKind, string]> = [
      ['tense', tenseCode],
      ['voice', voiceCode],
      ['mood', moodCode],
    ];
    for (const [kind, token] of triplet) {
      const label = localizeLookup(ROBINSON_VALUES[kind], token, lang);
      if (!label) continue;
      segments.push({
        kind,
        code: token,
        text: formatSegment(strings.categories[kind], label),
      });
    }
    if (rest[1] && /^[123][SPD]$/.test(rest[1])) {
      const [personCode, numberCode] = rest[1].split('');
      const person = localizeLookup(ROBINSON_VALUES.person, personCode, lang);
      const number = localizeLookup(ROBINSON_VALUES.number, numberCode, lang);
      if (person) {
        segments.push({
          kind: 'person',
          code: personCode,
          text: formatSegment(strings.categories.person, person),
        });
      }
      if (number) {
        segments.push({
          kind: 'number',
          code: numberCode,
          text: formatSegment(strings.categories.number, number),
        });
      }
    }
    return buildResult(code, 'builtin-robinson', segments);
  }

  return null;
}

function decodeBsbCode(
  rawCode: string | null | undefined,
  lang: string | null | undefined
): MorphologyDecodeResult | null {
  const strings = getLangStrings(lang);
  const code = String(rawCode || '').trim();
  if (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)+$/.test(code)) return null;
  const [part, ...rest] = code.split('-');
  if (!part) return null;

  const normalizedPart = part.toLowerCase();
  const partValues = strings.values.partOfSpeech || {};
  const partValue = partValues[normalizedPart] || part;
  const segments: MorphologySegment[] = [
    {
      kind: 'partOfSpeech',
      code: part,
      text: formatSegment(strings.categories.partOfSpeech, partValue),
    },
  ];

  const codes = rest[0] || '';
  if (/^[NGDAVBL][MFN][SPD]$/.test(codes)) {
    const [caseCode, genderCode, numberCode] = codes.toUpperCase().split('');
    const mapped: Array<[MorphologyKind, string]> = [
      ['case', caseCode],
      ['gender', genderCode],
      ['number', numberCode],
    ];
    for (const [kind, token] of mapped) {
      const label = localizeLookup(ROBINSON_VALUES[kind], token, lang);
      if (!label) continue;
      segments.push({
        kind,
        code: token,
        text: formatSegment(strings.categories[kind], label),
      });
    }
    if (rest[1]) {
      const degree = localizeLookup(ROBINSON_VALUES.degree, rest[1].toUpperCase(), lang);
      if (degree) {
        segments.push({
          kind: 'degree',
          code: rest[1],
          text: formatSegment(strings.categories.degree, degree),
        });
      }
    }
    return buildResult(code, 'builtin-bsb', segments);
  }

  if (/^[PIFAXYRLT][AMPDENU][ISOMNPRDGU]$/.test(codes)) {
    const [tenseCode, voiceCode, moodCode] = codes.toUpperCase().split('');
    const triplet: Array<[MorphologyKind, string]> = [
      ['tense', tenseCode],
      ['voice', voiceCode],
      ['mood', moodCode],
    ];
    for (const [kind, token] of triplet) {
      const label = localizeLookup(ROBINSON_VALUES[kind], token, lang);
      if (!label) continue;
      segments.push({
        kind,
        code: token,
        text: formatSegment(strings.categories[kind], label),
      });
    }
    if (rest[1] && /^[123][SPD]$/.test(rest[1])) {
      const [personCode, numberCode] = rest[1].split('');
      const person = localizeLookup(ROBINSON_VALUES.person, personCode, lang);
      const number = localizeLookup(ROBINSON_VALUES.number, numberCode, lang);
      if (person) {
        segments.push({
          kind: 'person',
          code: personCode,
          text: formatSegment(strings.categories.person, person),
        });
      }
      if (number) {
        segments.push({
          kind: 'number',
          code: numberCode,
          text: formatSegment(strings.categories.number, number),
        });
      }
    }
    return buildResult(code, 'builtin-bsb', segments);
  }

  return null;
}

export function parseMorphologyMeaning(
  rawCode: string | null | undefined,
  lang: string | null | undefined
): MorphologyDecodeResult | null {
  return (
    decodeCompactCode(rawCode, lang) ||
    decodeRobinsonCode(rawCode, lang) ||
    decodeBsbCode(rawCode, lang)
  );
}
