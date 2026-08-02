import type { Database as DatabaseInstance } from 'better-sqlite3';

export type SupportedLang = 'en' | 'pt' | 'es';
export type MorphologyKind =
  | 'partOfSpeech'
  | 'stem'
  | 'aspect'
  | 'tense'
  | 'person'
  | 'gender'
  | 'number'
  | 'state'
  | 'case'
  | 'degree'
  | 'voice'
  | 'mood'
  | 'suffix'
  | 'unknown';
export type SegmentKind = MorphologyKind | 'table';
export type DecodeSource =
  | 'builtin-compact'
  | 'builtin-robinson'
  | 'builtin-bsb'
  | 'table'
  | 'bible-table'
  | 'dict-table'
  | 'unknown';

export interface LanguageStrings {
  applicableTo: string;
  categories: Record<MorphologyKind, string>;
  values: Partial<Record<MorphologyKind, Record<string, string>>>;
}

export interface LocalizedLabel {
  en: string;
  pt: string;
  es: string;
}

export type RobinsonValues = Partial<Record<MorphologyKind, Record<string, LocalizedLabel>>>;

export interface MorphologySegment {
  kind: SegmentKind;
  code: string;
  text: string;
}

export interface MorphologyDecodeResult {
  rawCode: string;
  source: DecodeSource;
  segments: MorphologySegment[];
  displayText: string;
  topicRef: string | null;
}

export interface MorphologyTableInfo {
  hasIndications?: boolean;
  hasLanguageColumn?: boolean;
}

export interface ModuleHandle {
  db: DatabaseInstance;
  info?: Record<string, string>;
  morphology?: MorphologyTableInfo | null;
}

export interface ResolveMorphologyParams {
  bibleHandle?: ModuleHandle | null;
  dictHandle?: ModuleHandle | null;
  morphCode?: string | null;
  uiLanguage?: string | null;
}

export interface PreferredLanguageParams {
  uiLanguage?: string | null;
  dictLanguage?: string | null;
}

export interface MorphologyMeaningRow {
  indication: string;
  applicableTo: string;
  language: string;
  meaning: string;
}

export interface MorphologyTopicRow {
  topic: string | null;
}
