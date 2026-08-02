import type { Database as DatabaseInstance } from 'better-sqlite3';
import type {
  MorphologyDecodeResult,
  MorphologyMeaningRow,
  MorphologySegment,
  MorphologyTopicRow,
  ModuleHandle,
  PreferredLanguageParams,
  ResolveMorphologyParams,
} from './morphology-types';
import { DEFAULT_LANG } from './morphology-i18n-data';
import { buildResult, getLangStrings, parseMorphologyMeaning } from './morphology-decoders';

function preferredLookupLanguages({ uiLanguage, dictLanguage }: PreferredLanguageParams): string[] {
  const langs: string[] = [];
  const push = (value: string | null | undefined): void => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized || langs.includes(normalized)) return;
    langs.push(normalized);
  };
  push(dictLanguage);
  push(uiLanguage);
  push('en');
  push('');
  return langs;
}

function queryMorphologyMeaning(
  db: DatabaseInstance,
  hasLanguageColumn: boolean,
  indication: string,
  applicableTo: string,
  lang: string
): MorphologyMeaningRow | null {
  const applicableValues = applicableTo ? [applicableTo, ''] : [''];
  const conditions: string[] = [];
  const params: string[] = [indication];
  if (hasLanguageColumn) {
    if (lang === '') {
      conditions.push("(language IS NULL OR trim(language) = '')");
    } else {
      conditions.push('lower(language) = ?');
      params.push(lang);
    }
  }
  conditions.push(`applicable_to IN (${applicableValues.map(() => '?').join(', ')})`);
  params.push(...applicableValues);
  const sql = `
    SELECT indication, applicable_to AS applicableTo, ${hasLanguageColumn ? 'language,' : "'' AS language,"} meaning
    FROM morphology_indications
    WHERE indication = ?
      AND ${conditions.join(' AND ')}
    ORDER BY CASE applicable_to WHEN ? THEN 0 ELSE 1 END
    LIMIT 1
  `;
  params.push(applicableTo || '');
  return (db.prepare(sql).get(...params) as MorphologyMeaningRow | undefined) || null;
}

function resolveMorphologyTopic(db: DatabaseInstance, indication: string): string | null {
  try {
    const row = db
      .prepare('SELECT topic FROM morphology_topics WHERE indication = ? LIMIT 1')
      .get(indication) as MorphologyTopicRow | undefined;
    return row?.topic || null;
  } catch (_) {
    return null;
  }
}

function splitMorphCode(rawCode: string | null | undefined): string[] {
  return String(rawCode || '')
    .trim()
    .split(/[.\-]/)
    .filter(Boolean);
}

function resolveFromModuleTables(
  db: DatabaseInstance,
  rawCode: string,
  langs: string[],
  hasLanguageColumn: boolean
): MorphologyDecodeResult | null {
  const parts = splitMorphCode(rawCode);
  if (parts.length === 0) return null;

  for (const lang of langs) {
    const segments: MorphologySegment[] = [];
    let matchedAny = false;
    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];
      const applicableTo = i === 0 ? '' : parts[0];
      const row = queryMorphologyMeaning(db, hasLanguageColumn, token, applicableTo, lang);
      if (!row) {
        segments.push({
          kind: 'unknown',
          code: token,
          text: token,
        });
        continue;
      }
      matchedAny = true;
      const text = row.applicableTo
        ? `${getLangStrings(lang || DEFAULT_LANG).applicableTo} ${row.applicableTo}: ${row.meaning}`
        : row.meaning;
      segments.push({
        kind: 'table',
        code: token,
        text,
      });
    }
    if (matchedAny) {
      return buildResult(rawCode, 'table', segments, resolveMorphologyTopic(db, rawCode));
    }
  }

  return null;
}

function normalizeUiLanguage(value: string | null | undefined): string {
  return (
    String(value || DEFAULT_LANG)
      .trim()
      .toLowerCase()
      .slice(0, 2) || DEFAULT_LANG
  );
}

function resolveMorphology({
  bibleHandle,
  dictHandle,
  morphCode,
  uiLanguage,
}: ResolveMorphologyParams): MorphologyDecodeResult | null {
  const rawCode = String(morphCode || '').trim();
  const lang = normalizeUiLanguage(uiLanguage);
  if (!rawCode) return null;

  const dictLanguage = dictHandle?.info?.language || dictHandle?.info?.articles_language || '';
  const langs = preferredLookupLanguages({ uiLanguage: lang, dictLanguage });

  if (bibleHandle?.morphology?.hasIndications) {
    const tableResult = resolveFromModuleTables(
      bibleHandle.db,
      rawCode,
      langs,
      Boolean(bibleHandle.morphology.hasLanguageColumn)
    );
    if (tableResult) {
      return { ...tableResult, source: 'bible-table' };
    }
  }

  if (dictHandle?.morphology?.hasIndications) {
    const tableResult = resolveFromModuleTables(
      dictHandle.db,
      rawCode,
      [dictLanguage.toLowerCase(), ''],
      false
    );
    if (tableResult) {
      return { ...tableResult, source: 'dict-table' };
    }
  }

  return (
    parseMorphologyMeaning(rawCode, lang) || {
      rawCode,
      source: 'unknown',
      segments: [{ kind: 'unknown', code: rawCode, text: rawCode }],
      displayText: rawCode,
      topicRef: null,
    }
  );
}

export { resolveMorphology, parseMorphologyMeaning };

if (typeof module !== 'undefined')
  module.exports = {
    resolveMorphology,
    parseMorphologyMeaning,
  };
