//! Built-in morphology decoders and module-table resolver.
//!
//! Morphology decoders. Callers pass [`MorphTables`]
//! instead of SQLite so this crate stays free of a database dependency.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportedLang {
    En,
    Pt,
    Es,
}

impl SupportedLang {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Pt => "pt",
            Self::Es => "es",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MorphologyKind {
    PartOfSpeech,
    Stem,
    Aspect,
    Tense,
    Person,
    Gender,
    Number,
    State,
    Case,
    Degree,
    Voice,
    Mood,
    Suffix,
    Unknown,
    Table,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeSource {
    BuiltinCompact,
    BuiltinRobinson,
    BuiltinBsb,
    Table,
    BibleTable,
    DictTable,
    Unknown,
}

impl DecodeSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BuiltinCompact => "builtin-compact",
            Self::BuiltinRobinson => "builtin-robinson",
            Self::BuiltinBsb => "builtin-bsb",
            Self::Table => "table",
            Self::BibleTable => "bible-table",
            Self::DictTable => "dict-table",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MorphologySegment {
    pub kind: MorphologyKind,
    pub code: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MorphologyDecodeResult {
    pub raw_code: String,
    pub source: DecodeSource,
    pub segments: Vec<MorphologySegment>,
    pub display_text: String,
    pub topic_ref: Option<String>,
}

/// One `morphology_indications` row.
///
/// `language` is `None` when the column is NULL. Dictionary modules are queried
/// with the language column ignored, matching `resolveMorphology`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndicationRow {
    pub indication: String,
    pub applicable_to: String,
    pub language: Option<String>,
    pub meaning: String,
}

impl IndicationRow {
    pub fn new(
        indication: impl Into<String>,
        applicable_to: impl Into<String>,
        language: Option<String>,
        meaning: impl Into<String>,
    ) -> Self {
        Self {
            indication: indication.into(),
            applicable_to: applicable_to.into(),
            language,
            meaning: meaning.into(),
        }
    }
}

/// In-memory morphology tables. `topics` receives the full indication code
/// (`WHERE indication = ?`). The language argument is the lookup language that
/// matched. Topic lookup is not filtered by language.
pub trait MorphTables {
    fn indications(&self) -> Vec<IndicationRow>;

    fn topics(&self, indication: &str, language: Option<&str>) -> Option<String> {
        let _ = (indication, language);
        None
    }
}

/// One open module: schema flags plus `info.language` / `info.articles_language`.
pub struct MorphModule<'a> {
    pub tables: &'a dyn MorphTables,
    pub has_indications: bool,
    pub has_language_column: bool,
    pub info_language: Option<&'a str>,
    pub articles_language: Option<&'a str>,
}

/// Bible tables win over dictionary tables, then the built-in decoders.
pub struct MorphSources<'a> {
    pub bible: Option<MorphModule<'a>>,
    pub dictionary: Option<MorphModule<'a>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanguagePack {
    lang: SupportedLang,
}

impl LanguagePack {
    pub fn lang(self) -> SupportedLang {
        self.lang
    }

    pub fn applicable_to(self) -> &'static str {
        applicable_to_label(self.lang)
    }

    pub fn category(self, kind: MorphologyKind) -> &'static str {
        category_label(self.lang, kind)
    }

    pub fn compact_value(self, kind: MorphologyKind, key: &str) -> Option<&'static str> {
        compact_value(self.lang, kind, key)
    }

    pub fn robinson_value(self, kind: MorphologyKind, key: &str) -> Option<&'static str> {
        robinson_value(self.lang, kind, key)
    }
}

pub fn normalize_builtin_lang(lang: Option<&str>) -> SupportedLang {
    match two_letter_code(lang).as_str() {
        "pt" => SupportedLang::Pt,
        "es" => SupportedLang::Es,
        _ => SupportedLang::En,
    }
}

pub fn get_lang_strings(lang: Option<&str>) -> LanguagePack {
    LanguagePack {
        lang: normalize_builtin_lang(lang),
    }
}

pub fn parse_morphology_meaning(
    raw_code: Option<&str>,
    lang: Option<&str>,
) -> Option<MorphologyDecodeResult> {
    decode_compact_code(raw_code, lang)
        .or_else(|| decode_robinson_code(raw_code, lang))
        .or_else(|| decode_bsb_code(raw_code, lang))
}

pub fn decode_compact_code(
    raw_code: Option<&str>,
    lang: Option<&str>,
) -> Option<MorphologyDecodeResult> {
    let lang = normalize_builtin_lang(lang);
    let normalized = raw_code.unwrap_or("").trim().to_string();
    let tokens: Vec<&str> = normalized
        .split('.')
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.is_empty() {
        return None;
    }

    let first = tokens[0];
    let part = compact_value(lang, MorphologyKind::PartOfSpeech, first);
    if !normalized.contains('.') && part.is_none() {
        return None;
    }

    let mut segments = Vec::new();
    if let Some(part) = part {
        push_value(
            &mut segments,
            MorphologyKind::PartOfSpeech,
            first,
            category_label(lang, MorphologyKind::PartOfSpeech),
            part,
        );
    } else if tokens.iter().any(|token| token.chars().count() > 1) {
        push_value(
            &mut segments,
            MorphologyKind::Unknown,
            first,
            category_label(lang, MorphologyKind::Unknown),
            first,
        );
    } else {
        return None;
    }

    for token in tokens.iter().skip(1) {
        let normalized_token = token.to_lowercase();
        let mut matched = false;
        for kind in COMPACT_VALUE_KINDS {
            if let Some(value) = compact_value(lang, kind, &normalized_token) {
                push_value(
                    &mut segments,
                    kind,
                    token,
                    category_label(lang, kind),
                    value,
                );
                matched = true;
                break;
            }
        }
        if !matched {
            push_value(
                &mut segments,
                MorphologyKind::Unknown,
                token,
                category_label(lang, MorphologyKind::Unknown),
                token,
            );
        }
    }

    Some(build_result(
        &normalized,
        DecodeSource::BuiltinCompact,
        segments,
        None,
    ))
}

pub fn decode_robinson_code(
    raw_code: Option<&str>,
    lang: Option<&str>,
) -> Option<MorphologyDecodeResult> {
    let lang = normalize_builtin_lang(lang);
    let code = raw_code.unwrap_or("").trim().to_uppercase();
    let parts = robinson_parts(&code)?;
    let part = parts[0];
    if !is_robinson_part(part) {
        return None;
    }

    let mut segments = Vec::new();
    if let Some(label) = robinson_value(lang, MorphologyKind::PartOfSpeech, part) {
        push_value(
            &mut segments,
            MorphologyKind::PartOfSpeech,
            part,
            category_label(lang, MorphologyKind::PartOfSpeech),
            label,
        );
    }

    let first_block = parts[1];
    if is_robinson_nominal(first_block) {
        if let Some((case_code, number_code, gender_code)) = triple(first_block) {
            push_robinson(&mut segments, lang, MorphologyKind::Case, case_code);
            push_robinson(&mut segments, lang, MorphologyKind::Number, number_code);
            push_robinson(&mut segments, lang, MorphologyKind::Gender, gender_code);
        }
        if let Some(extra) = parts.get(2).copied() {
            if let Some(label) = robinson_value(lang, MorphologyKind::Degree, extra) {
                push_value(
                    &mut segments,
                    MorphologyKind::Degree,
                    extra,
                    category_label(lang, MorphologyKind::Degree),
                    label,
                );
            } else {
                push_value(
                    &mut segments,
                    MorphologyKind::Unknown,
                    extra,
                    category_label(lang, MorphologyKind::Unknown),
                    extra,
                );
            }
        }
        return Some(build_result(
            &code,
            DecodeSource::BuiltinRobinson,
            segments,
            None,
        ));
    }

    if part == "V" && is_verb_block(first_block) {
        if let Some((tense_code, voice_code, mood_code)) = triple(first_block) {
            push_robinson(&mut segments, lang, MorphologyKind::Tense, tense_code);
            push_robinson(&mut segments, lang, MorphologyKind::Voice, voice_code);
            push_robinson(&mut segments, lang, MorphologyKind::Mood, mood_code);
        }
        if let Some(extra) = parts.get(2).copied() {
            if is_person_number(extra) {
                if let Some((person_code, number_code)) = pair(extra) {
                    push_robinson(&mut segments, lang, MorphologyKind::Person, person_code);
                    push_robinson(&mut segments, lang, MorphologyKind::Number, number_code);
                }
            }
        }
        return Some(build_result(
            &code,
            DecodeSource::BuiltinRobinson,
            segments,
            None,
        ));
    }

    None
}

pub fn decode_bsb_code(
    raw_code: Option<&str>,
    lang: Option<&str>,
) -> Option<MorphologyDecodeResult> {
    let lang = normalize_builtin_lang(lang);
    let code = raw_code.unwrap_or("").trim().to_string();
    let parts = bsb_parts(&code)?;
    let part = parts[0];
    if part.is_empty() {
        return None;
    }

    let normalized_part = part.to_lowercase();
    let part_value =
        compact_value(lang, MorphologyKind::PartOfSpeech, &normalized_part).unwrap_or(part);
    let mut segments = Vec::new();
    push_value(
        &mut segments,
        MorphologyKind::PartOfSpeech,
        part,
        category_label(lang, MorphologyKind::PartOfSpeech),
        part_value,
    );

    let codes = parts[1];
    if is_bsb_nominal(codes) {
        let upper = codes.to_uppercase();
        if let Some((case_code, gender_code, number_code)) = triple(&upper) {
            push_robinson(&mut segments, lang, MorphologyKind::Case, case_code);
            push_robinson(&mut segments, lang, MorphologyKind::Gender, gender_code);
            push_robinson(&mut segments, lang, MorphologyKind::Number, number_code);
        }
        if let Some(extra) = parts.get(2).copied() {
            let key = extra.to_uppercase();
            if let Some(label) = robinson_value(lang, MorphologyKind::Degree, &key) {
                push_value(
                    &mut segments,
                    MorphologyKind::Degree,
                    extra,
                    category_label(lang, MorphologyKind::Degree),
                    label,
                );
            }
        }
        return Some(build_result(
            &code,
            DecodeSource::BuiltinBsb,
            segments,
            None,
        ));
    }

    if is_verb_block(codes) {
        let upper = codes.to_uppercase();
        if let Some((tense_code, voice_code, mood_code)) = triple(&upper) {
            push_robinson(&mut segments, lang, MorphologyKind::Tense, tense_code);
            push_robinson(&mut segments, lang, MorphologyKind::Voice, voice_code);
            push_robinson(&mut segments, lang, MorphologyKind::Mood, mood_code);
        }
        if let Some(extra) = parts.get(2).copied() {
            if is_person_number(extra) {
                if let Some((person_code, number_code)) = pair(extra) {
                    push_robinson(&mut segments, lang, MorphologyKind::Person, person_code);
                    push_robinson(&mut segments, lang, MorphologyKind::Number, number_code);
                }
            }
        }
        return Some(build_result(
            &code,
            DecodeSource::BuiltinBsb,
            segments,
            None,
        ));
    }

    None
}

pub fn resolve_morphology(
    sources: &MorphSources<'_>,
    morph_code: Option<&str>,
    ui_language: Option<&str>,
) -> Option<MorphologyDecodeResult> {
    let raw_code = morph_code.unwrap_or("").trim();
    if raw_code.is_empty() {
        return None;
    }

    let ui = normalize_ui_language(ui_language);
    let dict_language = sources
        .dictionary
        .as_ref()
        .map(info_language_of)
        .unwrap_or_default();
    let bible_langs = preferred_lookup_languages(&ui, &dict_language);

    if let Some(bible) = sources.bible.as_ref() {
        if bible.has_indications {
            if let Some(mut result) = resolve_from_tables(
                bible.tables,
                raw_code,
                &bible_langs,
                bible.has_language_column,
            ) {
                result.source = DecodeSource::BibleTable;
                return Some(result);
            }
        }
    }

    if let Some(dictionary) = sources.dictionary.as_ref() {
        if dictionary.has_indications {
            // Dictionary handles always pass `hasLanguageColumn: false`.
            let dict_langs = vec![dict_language.to_lowercase(), String::new()];
            if let Some(mut result) =
                resolve_from_tables(dictionary.tables, raw_code, &dict_langs, false)
            {
                result.source = DecodeSource::DictTable;
                return Some(result);
            }
        }
    }

    if let Some(decoded) = parse_morphology_meaning(Some(raw_code), Some(ui.as_str())) {
        return Some(decoded);
    }

    Some(build_result(
        raw_code,
        DecodeSource::Unknown,
        vec![MorphologySegment {
            kind: MorphologyKind::Unknown,
            code: raw_code.to_string(),
            text: raw_code.to_string(),
        }],
        None,
    ))
}

const COMPACT_VALUE_KINDS: [MorphologyKind; 12] = [
    MorphologyKind::Stem,
    MorphologyKind::Aspect,
    MorphologyKind::Tense,
    MorphologyKind::Voice,
    MorphologyKind::Mood,
    MorphologyKind::Person,
    MorphologyKind::Gender,
    MorphologyKind::Number,
    MorphologyKind::State,
    MorphologyKind::Case,
    MorphologyKind::Degree,
    MorphologyKind::Suffix,
];

struct TriLabel {
    key: &'static str,
    en: &'static str,
    pt: &'static str,
    es: &'static str,
}

macro_rules! tri {
    ($key:literal, $en:literal, $pt:literal, $es:literal) => {
        TriLabel {
            key: $key,
            en: $en,
            pt: $pt,
            es: $es,
        }
    };
}

macro_rules! same {
    ($key:literal, $label:literal) => {
        TriLabel {
            key: $key,
            en: $label,
            pt: $label,
            es: $label,
        }
    };
}

macro_rules! lang_label {
    ($lang:expr, $en:literal, $pt:literal, $es:literal) => {
        match $lang {
            SupportedLang::En => $en,
            SupportedLang::Pt => $pt,
            SupportedLang::Es => $es,
        }
    };
}

fn applicable_to_label(lang: SupportedLang) -> &'static str {
    lang_label!(lang, "Applicable to", "Aplicável a", "Aplicable a")
}

fn category_label(lang: SupportedLang, kind: MorphologyKind) -> &'static str {
    match kind {
        MorphologyKind::PartOfSpeech => lang_label!(lang, "Part of speech", "Classe", "Clase"),
        MorphologyKind::Stem => lang_label!(lang, "Stem", "Tema", "Tema"),
        MorphologyKind::Aspect => lang_label!(lang, "Aspect", "Aspecto", "Aspecto"),
        MorphologyKind::Tense => lang_label!(lang, "Tense", "Tempo", "Tiempo"),
        MorphologyKind::Person => lang_label!(lang, "Person", "Pessoa", "Persona"),
        MorphologyKind::Gender => lang_label!(lang, "Gender", "Gênero", "Género"),
        MorphologyKind::Number => lang_label!(lang, "Number", "Número", "Número"),
        MorphologyKind::State => lang_label!(lang, "State", "Estado", "Estado"),
        MorphologyKind::Case => lang_label!(lang, "Case", "Caso", "Caso"),
        MorphologyKind::Degree => lang_label!(lang, "Degree", "Grau", "Grado"),
        MorphologyKind::Voice => lang_label!(lang, "Voice", "Voz", "Voz"),
        MorphologyKind::Mood => lang_label!(lang, "Mood", "Modo", "Modo"),
        MorphologyKind::Suffix => {
            lang_label!(
                lang,
                "Pronominal suffix",
                "Sufixo pronominal",
                "Sufijo pronominal"
            )
        }
        MorphologyKind::Unknown => lang_label!(lang, "Code", "Código", "Código"),
        MorphologyKind::Table => "",
    }
}

fn compact_value(lang: SupportedLang, kind: MorphologyKind, key: &str) -> Option<&'static str> {
    let table: &[TriLabel] = match kind {
        MorphologyKind::PartOfSpeech => POS,
        MorphologyKind::Stem => STEM,
        MorphologyKind::Aspect => ASPECT,
        MorphologyKind::Tense => TENSE,
        MorphologyKind::Voice => VOICE,
        MorphologyKind::Mood => MOOD,
        MorphologyKind::Person => PERSON,
        MorphologyKind::Gender => GENDER,
        MorphologyKind::Number => NUMBER,
        MorphologyKind::State => STATE,
        MorphologyKind::Case => CASE,
        MorphologyKind::Degree => DEGREE,
        MorphologyKind::Suffix => SUFFIX,
        MorphologyKind::Unknown | MorphologyKind::Table => return None,
    };
    tri_value(table, lang, key)
}

fn robinson_value(lang: SupportedLang, kind: MorphologyKind, key: &str) -> Option<&'static str> {
    let table: &[TriLabel] = match kind {
        MorphologyKind::PartOfSpeech => ROBINSON_POS,
        MorphologyKind::Case => ROBINSON_CASE,
        MorphologyKind::Number => ROBINSON_NUMBER,
        MorphologyKind::Gender => ROBINSON_GENDER,
        MorphologyKind::Degree => ROBINSON_DEGREE,
        MorphologyKind::Tense => ROBINSON_TENSE,
        MorphologyKind::Voice => ROBINSON_VOICE,
        MorphologyKind::Mood => ROBINSON_MOOD,
        MorphologyKind::Person => ROBINSON_PERSON,
        _ => return None,
    };
    tri_value(table, lang, key)
}

fn tri_value(table: &[TriLabel], lang: SupportedLang, key: &str) -> Option<&'static str> {
    let row = table.iter().find(|row| row.key == key)?;
    Some(match lang {
        SupportedLang::En => row.en,
        SupportedLang::Pt => row.pt,
        SupportedLang::Es => row.es,
    })
}

fn is_robinson_part(part: &str) -> bool {
    ROBINSON_POS.iter().any(|row| row.key == part)
}

const POS: &[TriLabel] = &[
    tri!("subs", "Noun", "Substantivo", "Sustantivo"),
    tri!("noun", "Noun", "Substantivo", "Sustantivo"),
    tri!("nmpr", "Proper noun", "Nome próprio", "Nombre propio"),
    tri!("adj", "Adjective", "Adjetivo", "Adjetivo"),
    tri!("adjv", "Adjective", "Adjetivo", "Adjetivo"),
    tri!("advb", "Adverb", "Advérbio", "Adverbio"),
    tri!("art", "Article", "Artigo", "Artículo"),
    tri!("prep", "Preposition", "Preposição", "Preposición"),
    tri!("conj", "Conjunction", "Conjunção", "Conjunción"),
    tri!("prps", "Pronoun", "Pronome", "Pronombre"),
    tri!("pron", "Pronoun", "Pronome", "Pronombre"),
    tri!("inrg", "Interrogative", "Interrogativo", "Interrogativo"),
    tri!("intej", "Interjection", "Interjeição", "Interjección"),
    tri!("verb", "Verb", "Verbo", "Verbo"),
    tri!("v", "Verb", "Verbo", "Verbo"),
    tri!("ptcp", "Participle", "Particípio", "Participio"),
    tri!("part", "Particle", "Partícula", "Partícula"),
    tri!("ptcl", "Particle", "Partícula", "Partícula"),
    tri!("neg", "Negation", "Negação", "Negación"),
    tri!("det", "Determiner", "Determinante", "Determinante"),
];

const STEM: &[TriLabel] = &[
    same!("qal", "Qal"),
    same!("piel", "Piel"),
    same!("pual", "Pual"),
    same!("hif", "Hifil"),
    same!("hof", "Hofal"),
    tri!("nif", "Niphal", "Nifal", "Nifal"),
    same!("hit", "Hitpael"),
    same!("hithpael", "Hithpael"),
    same!("poel", "Poel"),
    same!("poal", "Poal"),
    same!("pilpel", "Pilpel"),
    same!("polal", "Polal"),
    same!("hithpalpel", "Hithpalpel"),
    same!("peal", "Peal"),
    same!("pael", "Pael"),
    same!("hafel", "Hafel"),
    same!("aphel", "Aphel"),
    same!("shafel", "Shafel"),
    same!("etpaal", "Etpaal"),
    same!("ithpaal", "Ithpaal"),
    same!("polpal", "Polpal"),
    same!("palel", "Palel"),
    same!("pealal", "Pealal"),
    same!("pilel", "Pilel"),
    same!("polel", "Polel"),
    same!("pulal", "Pulal"),
    same!("tifil", "Tifil"),
    same!("tiphil", "Tiphil"),
    same!("hishtafel", "Hishtafel"),
    same!("hishtaphel", "Hishtaphel"),
    same!("hotpaal", "Hotpaal"),
    same!("hitpolel", "Hitpolel"),
    same!("hitpalpel", "Hitpalpel"),
    same!("nitpael", "Nitpael"),
    same!("hitpeel", "Hitpeel"),
    same!("ishtaphel", "Ishtaphel"),
    same!("ithpeel", "Ithpeel"),
    same!("saphal", "Saphal"),
    same!("ithpoel", "Ithpoel"),
    same!("itpeel", "Itpeel"),
    same!("tiphel", "Tiphel"),
    same!("hephal", "Hephal"),
];

const ASPECT: &[TriLabel] = &[
    tri!("perf", "Perfect", "Perfeito", "Perfecto"),
    tri!("impf", "Imperfect", "Imperfeito", "Imperfecto"),
    tri!("impv", "Imperative", "Imperativo", "Imperativo"),
    tri!(
        "infc",
        "Infinitive construct",
        "Infinitivo construto",
        "Infinitivo constructo"
    ),
    tri!(
        "infa",
        "Infinitive absolute",
        "Infinitivo absoluto",
        "Infinitivo absoluto"
    ),
    tri!(
        "ptca",
        "Active participle",
        "Particípio ativo",
        "Participio activo"
    ),
    tri!(
        "ptcp",
        "Active participle",
        "Particípio ativo",
        "Participio activo"
    ),
    tri!(
        "ptcpa",
        "Active participle",
        "Particípio ativo",
        "Participio activo"
    ),
    tri!(
        "ptcm",
        "Middle participle",
        "Particípio médio",
        "Participio medio"
    ),
    tri!(
        "ptcpm",
        "Middle participle",
        "Particípio médio",
        "Participio medio"
    ),
    same!("wayq", "Wayyiqtol"),
    tri!(
        "ptcpp",
        "Passive participle",
        "Particípio passivo",
        "Participio pasivo"
    ),
    tri!(
        "ptcps",
        "Passive participle",
        "Particípio passivo",
        "Participio pasivo"
    ),
    tri!(
        "wayc",
        "Waw consecutive",
        "Waw consecutivo",
        "Waw consecutivo"
    ),
];

const TENSE: &[TriLabel] = &[
    tri!("pres", "Present", "Presente", "Presente"),
    tri!("imperf", "Imperfect", "Imperfeito", "Imperfecto"),
    tri!("fut", "Future", "Futuro", "Futuro"),
    tri!("aor", "Aorist", "Aoristo", "Aoristo"),
    tri!("perf", "Perfect", "Perfeito", "Perfecto"),
    tri!(
        "plup",
        "Pluperfect",
        "Mais-que-perfeito",
        "Pluscuamperfecto"
    ),
    tri!("impf", "Imperfect", "Imperfeito", "Imperfecto"),
    tri!(
        "pluperf",
        "Pluperfect",
        "Mais-que-perfeito",
        "Pluscuamperfecto"
    ),
];

const VOICE: &[TriLabel] = &[
    tri!("act", "Active", "Ativa", "Activa"),
    tri!("mid", "Middle", "Média", "Media"),
    tri!("pas", "Passive", "Passiva", "Pasiva"),
    tri!(
        "midpass",
        "Middle or Passive",
        "Média ou Passiva",
        "Media o Pasiva"
    ),
    tri!("dep", "Deponent", "Depoente", "Deponente"),
];

const MOOD: &[TriLabel] = &[
    tri!("ind", "Indicative", "Indicativo", "Indicativo"),
    tri!("sub", "Subjunctive", "Subjuntivo", "Subjuntivo"),
    tri!("imp", "Imperative", "Imperativo", "Imperativo"),
    tri!("opt", "Optative", "Optativo", "Optativo"),
    tri!("inf", "Infinitive", "Infinitivo", "Infinitivo"),
    tri!("ptc", "Participle", "Particípio", "Participio"),
];

const PERSON: &[TriLabel] = &[
    tri!("p1", "1st", "1\u{00aa}", "1.\u{00aa}"),
    tri!("p2", "2nd", "2\u{00aa}", "2.\u{00aa}"),
    tri!("p3", "3rd", "3\u{00aa}", "3.\u{00aa}"),
    tri!("1", "1st", "1\u{00aa}", "1.\u{00aa}"),
    tri!("2", "2nd", "2\u{00aa}", "2.\u{00aa}"),
    tri!("3", "3rd", "3\u{00aa}", "3.\u{00aa}"),
];

const GENDER: &[TriLabel] = &[
    tri!("m", "Masculine", "Masculino", "Masculino"),
    tri!("f", "Feminine", "Feminino", "Femenino"),
    tri!("n", "Neuter", "Neutro", "Neutro"),
    tri!("c", "Common", "Comum", "Común"),
    tri!("u", "Common", "Comum", "Común"),
];

const NUMBER: &[TriLabel] = &[
    same!("sg", "Singular"),
    same!("pl", "Plural"),
    same!("du", "Dual"),
    same!("s", "Singular"),
    same!("p", "Plural"),
];

const STATE: &[TriLabel] = &[
    tri!("a", "Absolute", "Absoluto", "Absoluto"),
    tri!("c", "Construct", "Construto", "Constructo"),
    tri!("d", "Determined", "Determinado", "Determinado"),
];

const CASE: &[TriLabel] = &[
    tri!("n", "Nominative", "Nominativo", "Nominativo"),
    tri!("g", "Genitive", "Genitivo", "Genitivo"),
    tri!("d", "Dative", "Dativo", "Dativo"),
    tri!("a", "Accusative", "Acusativo", "Acusativo"),
    tri!("v", "Vocative", "Vocativo", "Vocativo"),
];

const DEGREE: &[TriLabel] = &[
    tri!("c", "Comparative", "Comparativo", "Comparativo"),
    tri!("s", "Superlative", "Superlativo", "Superlativo"),
];

const SUFFIX: &[TriLabel] = &[tri!(
    "prs",
    "With pronominal suffix",
    "Com sufixo pronominal",
    "Con sufijo pronominal"
)];

const ROBINSON_POS: &[TriLabel] = &[
    tri!("A", "Adjective", "Adjetivo", "Adjetivo"),
    tri!("C", "Conjunction", "Conjunção", "Conjunción"),
    tri!("D", "Adverb", "Advérbio", "Adverbio"),
    tri!("I", "Interjection", "Interjeição", "Interjección"),
    tri!("N", "Noun", "Substantivo", "Sustantivo"),
    tri!("P", "Pronoun", "Pronome", "Pronombre"),
    tri!("R", "Preposition", "Preposição", "Preposición"),
    tri!("T", "Article", "Artigo", "Artículo"),
    tri!("V", "Verb", "Verbo", "Verbo"),
    tri!("X", "Particle", "Partícula", "Partícula"),
];

const ROBINSON_CASE: &[TriLabel] = &[
    tri!("N", "Nominative", "Nominativo", "Nominativo"),
    tri!("G", "Genitive", "Genitivo", "Genitivo"),
    tri!("D", "Dative", "Dativo", "Dativo"),
    tri!("A", "Accusative", "Acusativo", "Acusativo"),
    tri!("V", "Vocative", "Vocativo", "Vocativo"),
    tri!("B", "Ablative", "Ablativo", "Ablativo"),
    tri!("L", "Locative", "Locativo", "Locativo"),
];

const ROBINSON_NUMBER: &[TriLabel] = &[
    same!("S", "Singular"),
    same!("P", "Plural"),
    same!("D", "Dual"),
];

const ROBINSON_GENDER: &[TriLabel] = &[
    tri!("M", "Masculine", "Masculino", "Masculino"),
    tri!("F", "Feminine", "Feminino", "Femenino"),
    tri!("N", "Neuter", "Neutro", "Neutro"),
];

const ROBINSON_DEGREE: &[TriLabel] = &[
    tri!("C", "Comparative", "Comparativo", "Comparativo"),
    tri!("S", "Superlative", "Superlativo", "Superlativo"),
    tri!("O", "Other", "Outro", "Otro"),
    tri!("P", "Positive", "Positivo", "Positivo"),
];

const ROBINSON_TENSE: &[TriLabel] = &[
    tri!("P", "Present", "Presente", "Presente"),
    tri!("I", "Imperfect", "Imperfeito", "Imperfecto"),
    tri!("F", "Future", "Futuro", "Futuro"),
    tri!("A", "Aorist", "Aoristo", "Aoristo"),
    tri!("X", "Perfect", "Perfeito", "Perfecto"),
    tri!("Y", "Pluperfect", "Mais-que-perfeito", "Pluscuamperfecto"),
    tri!("R", "Perfect", "Perfeito", "Perfecto"),
    tri!("L", "Pluperfect", "Mais-que-perfeito", "Pluscuamperfecto"),
    tri!("T", "Future Perfect", "Futuro Perfeito", "Futuro Perfecto"),
];

const ROBINSON_VOICE: &[TriLabel] = &[
    tri!("A", "Active", "Ativa", "Activa"),
    tri!("M", "Middle", "Média", "Media"),
    tri!("P", "Passive", "Passiva", "Pasiva"),
    tri!("D", "Middle Deponent", "Depoente Médio", "Deponente Medio"),
    tri!(
        "E",
        "Middle or Passive",
        "Média ou Passiva",
        "Media o Pasiva"
    ),
    tri!(
        "N",
        "Middle/Passive Deponent",
        "Depoente Médio/Passivo",
        "Deponente Medio/Pasivo"
    ),
    tri!(
        "O",
        "Passive Deponent",
        "Depoente Passivo",
        "Deponente Pasivo"
    ),
    tri!(
        "U",
        "Middle or Passive",
        "Média ou Passiva",
        "Media o Pasiva"
    ),
];

const ROBINSON_MOOD: &[TriLabel] = &[
    tri!("I", "Indicative", "Indicativo", "Indicativo"),
    tri!("S", "Subjunctive", "Subjuntivo", "Subjuntivo"),
    tri!("O", "Optative", "Optativo", "Optativo"),
    tri!("M", "Imperative", "Imperativo", "Imperativo"),
    tri!("N", "Infinitive", "Infinitivo", "Infinitivo"),
    tri!("P", "Participle", "Particípio", "Participio"),
    tri!(
        "R",
        "Imperative Participle",
        "Particípio Imperativo",
        "Participio Imperativo"
    ),
    tri!("D", "Gerund", "Gerúndio", "Gerundio"),
    tri!("G", "Gerundive", "Gerundivo", "Gerundivo"),
    tri!("U", "Supine", "Supino", "Supino"),
];

const ROBINSON_PERSON: &[TriLabel] = &[
    tri!("1", "1st", "1\u{00aa}", "1.\u{00aa}"),
    tri!("2", "2nd", "2\u{00aa}", "2.\u{00aa}"),
    tri!("3", "3rd", "3\u{00aa}", "3.\u{00aa}"),
];

fn two_letter_code(lang: Option<&str>) -> String {
    let raw = match lang {
        Some(text) if !text.is_empty() => text,
        _ => "en",
    };
    let folded = raw.trim().to_lowercase();
    let code: String = folded.chars().take(2).collect();
    if code.is_empty() {
        "en".to_string()
    } else {
        code
    }
}

/// UI language is sliced to two letters and is not required to be en/pt/es.
/// Built-in labels still fall back to English for unsupported codes.
fn normalize_ui_language(value: Option<&str>) -> String {
    two_letter_code(value)
}

fn info_language_of(module: &MorphModule<'_>) -> String {
    if let Some(language) = module.info_language {
        if !language.is_empty() {
            return language.to_string();
        }
    }
    if let Some(language) = module.articles_language {
        if !language.is_empty() {
            return language.to_string();
        }
    }
    String::new()
}

/// Dictionary language, then UI language, then `en`.
/// An empty token is dropped before decoding.
fn preferred_lookup_languages(ui_language: &str, dict_language: &str) -> Vec<String> {
    let mut langs = Vec::new();
    for value in [dict_language, ui_language, "en", ""] {
        let normalized = value.trim().to_lowercase();
        if normalized.is_empty() || langs.iter().any(|existing| existing == &normalized) {
            continue;
        }
        langs.push(normalized);
    }
    langs
}

fn resolve_from_tables(
    tables: &dyn MorphTables,
    raw_code: &str,
    langs: &[String],
    has_language_column: bool,
) -> Option<MorphologyDecodeResult> {
    let parts = split_morph_code(raw_code);
    if parts.is_empty() {
        return None;
    }
    let rows = tables.indications();
    for lang in langs {
        let mut segments = Vec::new();
        let mut matched_any = false;
        for (index, token) in parts.iter().enumerate() {
            let applicable_to = if index == 0 { "" } else { parts[0].as_str() };
            if let Some(row) = query_meaning(&rows, has_language_column, token, applicable_to, lang)
            {
                matched_any = true;
                let text = if row.applicable_to.is_empty() {
                    row.meaning.clone()
                } else {
                    format!(
                        "{} {}: {}",
                        applicable_to_label(normalize_builtin_lang(non_empty(lang))),
                        row.applicable_to,
                        row.meaning
                    )
                };
                segments.push(MorphologySegment {
                    kind: MorphologyKind::Table,
                    code: token.clone(),
                    text,
                });
            } else {
                segments.push(MorphologySegment {
                    kind: MorphologyKind::Unknown,
                    code: token.clone(),
                    text: token.clone(),
                });
            }
        }
        if matched_any {
            let topic_ref = tables
                .topics(raw_code, non_empty(lang))
                .filter(|topic| !topic.is_empty());
            return Some(build_result(
                raw_code,
                DecodeSource::Table,
                segments,
                topic_ref,
            ));
        }
    }
    None
}

fn non_empty(lang: &str) -> Option<&str> {
    if lang.is_empty() {
        None
    } else {
        Some(lang)
    }
}

fn split_morph_code(raw_code: &str) -> Vec<String> {
    raw_code
        .trim()
        .split(['.', '-'])
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn query_meaning<'a>(
    rows: &'a [IndicationRow],
    has_language_column: bool,
    indication: &str,
    applicable_to: &str,
    lang: &str,
) -> Option<&'a IndicationRow> {
    let mut best_index = None;
    let mut best_rank = i32::MAX;
    for (index, row) in rows.iter().enumerate() {
        if row.indication != indication || !applicable_matches(&row.applicable_to, applicable_to) {
            continue;
        }
        if has_language_column && !language_matches(row.language.as_deref(), lang) {
            continue;
        }
        let rank = if row.applicable_to == applicable_to {
            0
        } else {
            1
        };
        if rank < best_rank {
            best_index = Some(index);
            best_rank = rank;
        }
    }
    best_index.map(|index| &rows[index])
}

fn applicable_matches(row_applicable: &str, applicable_to: &str) -> bool {
    if applicable_to.is_empty() {
        row_applicable.is_empty()
    } else {
        row_applicable == applicable_to || row_applicable.is_empty()
    }
}

fn language_matches(row_language: Option<&str>, lang: &str) -> bool {
    match row_language {
        None => lang.is_empty(),
        Some(value) => {
            if lang.is_empty() {
                value.trim().is_empty()
            } else {
                value.to_lowercase() == lang
            }
        }
    }
}

fn push_value(
    segments: &mut Vec<MorphologySegment>,
    kind: MorphologyKind,
    code: &str,
    label: &str,
    value: &str,
) {
    segments.push(MorphologySegment {
        kind,
        code: code.to_string(),
        text: format_segment(label, value),
    });
}

fn push_robinson(
    segments: &mut Vec<MorphologySegment>,
    lang: SupportedLang,
    kind: MorphologyKind,
    token: &str,
) {
    if let Some(label) = robinson_value(lang, kind, token) {
        push_value(segments, kind, token, category_label(lang, kind), label);
    }
}

fn format_segment(label: &str, value: &str) -> String {
    if label.is_empty() {
        value.to_string()
    } else {
        format!("{label}: {value}")
    }
}

fn build_result(
    raw_code: &str,
    source: DecodeSource,
    segments: Vec<MorphologySegment>,
    topic_ref: Option<String>,
) -> MorphologyDecodeResult {
    let display_text = segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<Vec<_>>()
        .join(" | ");
    MorphologyDecodeResult {
        raw_code: raw_code.to_string(),
        source,
        segments,
        display_text,
        topic_ref,
    }
}

fn robinson_parts(code: &str) -> Option<Vec<&str>> {
    let parts = dash_parts(code)?;
    if !is_single_ascii_upper(parts[0]) || !parts[1..].iter().copied().all(is_ascii_upper_or_digit)
    {
        return None;
    }
    Some(parts)
}

fn bsb_parts(code: &str) -> Option<Vec<&str>> {
    let parts = dash_parts(code)?;
    if !is_ascii_alpha(parts[0]) || !parts[1..].iter().copied().all(is_ascii_alnum) {
        return None;
    }
    Some(parts)
}

fn dash_parts(code: &str) -> Option<Vec<&str>> {
    if !code.contains('-') {
        return None;
    }
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() < 2 || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    Some(parts)
}

fn is_single_ascii_upper(value: &str) -> bool {
    let mut bytes = value.bytes();
    match (bytes.next(), bytes.next()) {
        (Some(byte), None) => byte.is_ascii_uppercase(),
        _ => false,
    }
}

fn is_ascii_upper_or_digit(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn is_ascii_alpha(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_alphabetic())
}

fn is_ascii_alnum(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn is_robinson_nominal(block: &str) -> bool {
    let bytes = block.as_bytes();
    bytes.len() == 3
        && matches!(bytes[0], b'N' | b'G' | b'D' | b'A' | b'V' | b'B' | b'L')
        && matches!(bytes[1], b'S' | b'P' | b'D')
        && matches!(bytes[2], b'M' | b'F' | b'N')
}

fn is_bsb_nominal(block: &str) -> bool {
    let bytes = block.as_bytes();
    bytes.len() == 3
        && matches!(bytes[0], b'N' | b'G' | b'D' | b'A' | b'V' | b'B' | b'L')
        && matches!(bytes[1], b'M' | b'F' | b'N')
        && matches!(bytes[2], b'S' | b'P' | b'D')
}

fn is_verb_block(block: &str) -> bool {
    let bytes = block.as_bytes();
    bytes.len() == 3
        && matches!(
            bytes[0],
            b'P' | b'I' | b'F' | b'A' | b'X' | b'Y' | b'R' | b'L' | b'T'
        )
        && matches!(bytes[1], b'A' | b'M' | b'P' | b'D' | b'E' | b'N' | b'U')
        && matches!(
            bytes[2],
            b'I' | b'S' | b'O' | b'M' | b'N' | b'P' | b'R' | b'D' | b'G' | b'U'
        )
}

fn is_person_number(block: &str) -> bool {
    let bytes = block.as_bytes();
    bytes.len() == 2
        && matches!(bytes[0], b'1' | b'2' | b'3')
        && matches!(bytes[1], b'S' | b'P' | b'D')
}

fn triple(block: &str) -> Option<(&str, &str, &str)> {
    if block.len() == 3 && block.is_ascii() {
        Some((&block[0..1], &block[1..2], &block[2..3]))
    } else {
        None
    }
}

fn pair(block: &str) -> Option<(&str, &str)> {
    if block.len() == 2 && block.is_ascii() {
        Some((&block[0..1], &block[1..2]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Rows {
        indications: Vec<IndicationRow>,
        topics: Vec<(String, String)>,
    }

    impl MorphTables for Rows {
        fn indications(&self) -> Vec<IndicationRow> {
            self.indications.clone()
        }

        fn topics(&self, indication: &str, _language: Option<&str>) -> Option<String> {
            self.topics
                .iter()
                .find(|(key, _)| key == indication)
                .map(|(_, topic)| topic.clone())
        }
    }

    fn row(
        indication: &str,
        applicable_to: &str,
        language: Option<&str>,
        meaning: &str,
    ) -> IndicationRow {
        IndicationRow::new(
            indication,
            applicable_to,
            language.map(str::to_string),
            meaning,
        )
    }

    fn assert_decode(code: &str, lang: &str, source: DecodeSource, display: &str) {
        let result = parse_morphology_meaning(Some(code), Some(lang))
            .unwrap_or_else(|| panic!("expected a decode for {code}"));
        assert_eq!(result.source, source, "{code}");
        assert_eq!(result.display_text, display, "{code}");
    }

    fn empty_sources() -> MorphSources<'static> {
        MorphSources {
            bible: None,
            dictionary: None,
        }
    }

    #[test]
    fn decodes_compact_dot_morphology_codes() {
        assert_decode(
            "subs.f.sg.a",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Noun | Gender: Feminine | Number: Singular | State: Absolute",
        );
    }

    #[test]
    fn decodes_robinson_morphology_codes() {
        assert_decode(
            "N-NSF",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Noun | Case: Nominative | Number: Singular | Gender: Feminine",
        );
    }

    #[test]
    fn decodes_bsb_morphology_codes() {
        assert_decode(
            "Adj-AFP",
            "en",
            DecodeSource::BuiltinBsb,
            "Part of speech: Adjective | Case: Accusative | Gender: Feminine | Number: Plural",
        );
    }

    #[test]
    fn decodes_v_rai_3s() {
        assert_decode(
            "V-RAI-3S",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Verb | Tense: Perfect | Voice: Active | Mood: Indicative | Person: 3rd | Number: Singular",
        );
    }

    #[test]
    fn decodes_v_lai_3p() {
        assert_decode(
            "V-LAI-3P",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Verb | Tense: Pluperfect | Voice: Active | Mood: Indicative | Person: 3rd | Number: Plural",
        );
    }

    #[test]
    fn decodes_v_tai_1s() {
        assert_decode(
            "V-TAI-1S",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Verb | Tense: Future Perfect | Voice: Active | Mood: Indicative | Person: 1st | Number: Singular",
        );
    }

    #[test]
    fn decodes_v_adi_3s() {
        assert_decode(
            "V-ADI-3S",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Verb | Tense: Aorist | Voice: Middle Deponent | Mood: Indicative | Person: 3rd | Number: Singular",
        );
    }

    #[test]
    fn decodes_v_pui_3s() {
        assert_decode(
            "V-PUI-3S",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Verb | Tense: Present | Voice: Middle or Passive | Mood: Indicative | Person: 3rd | Number: Singular",
        );
    }

    #[test]
    fn decodes_n_ndm() {
        assert_decode(
            "N-NDM",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Noun | Case: Nominative | Number: Dual | Gender: Masculine",
        );
    }

    #[test]
    fn decodes_a_nsm_p() {
        assert_decode(
            "A-NSM-P",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Adjective | Case: Nominative | Number: Singular | Gender: Masculine | Degree: Positive",
        );
    }

    #[test]
    fn decodes_n_bsm() {
        assert_decode(
            "N-BSM",
            "en",
            DecodeSource::BuiltinRobinson,
            "Part of speech: Noun | Case: Ablative | Number: Singular | Gender: Masculine",
        );
    }

    #[test]
    fn decodes_particle_and_negation() {
        assert_decode(
            "part",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Particle",
        );
        assert_decode(
            "neg",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Negation",
        );
    }

    #[test]
    fn decodes_extended_compact_verbs() {
        assert_decode(
            "verb.polel.perf.p3.m.sg",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Verb | Stem: Polel | Aspect: Perfect | Person: 3rd | Gender: Masculine | Number: Singular",
        );
        assert_decode(
            "verb.qal.ptcpp.m.sg",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Verb | Stem: Qal | Aspect: Passive participle | Gender: Masculine | Number: Singular",
        );
        assert_decode(
            "verb.qal.wayc.p3.m.sg",
            "en",
            DecodeSource::BuiltinCompact,
            "Part of speech: Verb | Stem: Qal | Aspect: Waw consecutive | Person: 3rd | Gender: Masculine | Number: Singular",
        );
    }

    #[test]
    fn decodes_extended_bsb_codes() {
        assert_decode(
            "Verb-PAI-3S",
            "en",
            DecodeSource::BuiltinBsb,
            "Part of speech: Verb | Tense: Present | Voice: Active | Mood: Indicative | Person: 3rd | Number: Singular",
        );
        assert_decode(
            "Adj-NMD",
            "en",
            DecodeSource::BuiltinBsb,
            "Part of speech: Adjective | Case: Nominative | Gender: Masculine | Number: Dual",
        );
    }

    #[test]
    fn translates_robinson_and_compact_values() {
        assert_decode(
            "V-RAI-3S",
            "pt",
            DecodeSource::BuiltinRobinson,
            "Classe: Verbo | Tempo: Perfeito | Voz: Ativa | Modo: Indicativo | Pessoa: 3\u{00aa} | Número: Singular",
        );
        assert_decode(
            "V-RAI-3S",
            "es",
            DecodeSource::BuiltinRobinson,
            "Clase: Verbo | Tiempo: Perfecto | Voz: Activa | Modo: Indicativo | Persona: 3.\u{00aa} | Número: Singular",
        );
        assert_decode(
            "verb.polel.perf.p3.m.sg",
            "pt",
            DecodeSource::BuiltinCompact,
            "Classe: Verbo | Tema: Polel | Aspecto: Perfeito | Pessoa: 3\u{00aa} | Gênero: Masculino | Número: Singular",
        );
        assert_decode(
            "verb.polel.perf.p3.m.sg",
            "es",
            DecodeSource::BuiltinCompact,
            "Clase: Verbo | Tema: Polel | Aspecto: Perfecto | Persona: 3.\u{00aa} | Género: Masculino | Número: Singular",
        );
        assert_decode(
            "part",
            "pt",
            DecodeSource::BuiltinCompact,
            "Classe: Partícula",
        );
        assert_decode(
            "part",
            "es",
            DecodeSource::BuiltinCompact,
            "Clase: Partícula",
        );
    }

    #[test]
    fn language_pack_looks_up_en_pt_es() {
        let en = get_lang_strings(Some("en-US"));
        assert_eq!(en.lang(), SupportedLang::En);
        assert_eq!(en.applicable_to(), "Applicable to");
        assert_eq!(en.category(MorphologyKind::PartOfSpeech), "Part of speech");
        assert_eq!(
            en.compact_value(MorphologyKind::Stem, "nif"),
            Some("Niphal")
        );
        assert_eq!(
            en.robinson_value(MorphologyKind::Case, "L"),
            Some("Locative")
        );

        let pt = get_lang_strings(Some("PT-BR"));
        assert_eq!(pt.lang(), SupportedLang::Pt);
        assert_eq!(pt.category(MorphologyKind::Tense), "Tempo");
        assert_eq!(pt.compact_value(MorphologyKind::Stem, "nif"), Some("Nifal"));
        assert_eq!(
            pt.robinson_value(MorphologyKind::Mood, "D"),
            Some("Gerúndio")
        );

        let es = get_lang_strings(Some("es"));
        assert_eq!(es.category(MorphologyKind::Voice), "Voz");
        assert_eq!(
            es.compact_value(MorphologyKind::Aspect, "ptcpp"),
            Some("Participio pasivo")
        );
        assert_eq!(
            es.robinson_value(MorphologyKind::Tense, "T"),
            Some("Futuro Perfecto")
        );
        assert_eq!(get_lang_strings(Some("fr")).lang(), SupportedLang::En);
        assert_eq!(get_lang_strings(None).lang(), SupportedLang::En);
    }

    #[test]
    fn prefers_bible_morphology_tables_over_dictionary_tables() {
        let bible = Rows {
            indications: vec![
                row("subs", "", Some("en"), "Noun"),
                row("f", "subs", Some("en"), "Feminine"),
                row("sg", "subs", Some("en"), "Singular"),
                row("a", "subs", Some("en"), "Absolute"),
            ],
            topics: vec![("subs.f.sg.a".to_string(), "G5721".to_string())],
        };
        let dictionary = Rows {
            indications: vec![row("subs", "", None, "Dictionary noun")],
            topics: Vec::new(),
        };
        let result = resolve_morphology(
            &MorphSources {
                bible: Some(MorphModule {
                    tables: &bible,
                    has_indications: true,
                    has_language_column: true,
                    info_language: Some("pt"),
                    articles_language: None,
                }),
                dictionary: Some(MorphModule {
                    tables: &dictionary,
                    has_indications: true,
                    has_language_column: false,
                    info_language: Some("en"),
                    articles_language: None,
                }),
            },
            Some("subs.f.sg.a"),
            Some("en"),
        )
        .expect("bible table result");

        assert_eq!(result.source, DecodeSource::BibleTable);
        assert_eq!(result.topic_ref.as_deref(), Some("G5721"));
        assert_eq!(
            result.display_text,
            "Noun | Applicable to subs: Feminine | Applicable to subs: Singular | Applicable to subs: Absolute"
        );
        assert!(!result.display_text.contains("Dictionary"));
    }

    #[test]
    fn prefers_dictionary_language_before_ui_language_on_bible_tables() {
        let bible = Rows {
            indications: vec![
                row("subs", "", Some("en"), "Noun"),
                row("subs", "", Some("pt"), "Substantivo"),
            ],
            topics: Vec::new(),
        };
        let dictionary = Rows {
            indications: Vec::new(),
            topics: Vec::new(),
        };
        let result = resolve_morphology(
            &MorphSources {
                bible: Some(MorphModule {
                    tables: &bible,
                    has_indications: true,
                    has_language_column: true,
                    info_language: Some("pt"),
                    articles_language: None,
                }),
                dictionary: Some(MorphModule {
                    tables: &dictionary,
                    has_indications: false,
                    has_language_column: false,
                    info_language: Some(""),
                    articles_language: Some("pt"),
                }),
            },
            Some("subs"),
            Some("en"),
        )
        .expect("language-preferred bible row");

        assert_eq!(result.source, DecodeSource::BibleTable);
        assert_eq!(result.display_text, "Substantivo");
    }

    #[test]
    fn uses_dictionary_tables_when_bible_rows_do_not_match() {
        let bible = Rows {
            indications: vec![row("subs", "", Some("en"), "Noun")],
            topics: Vec::new(),
        };
        let dictionary = Rows {
            indications: vec![row("xyzcode", "", None, "Dictionary only")],
            topics: Vec::new(),
        };
        let result = resolve_morphology(
            &MorphSources {
                bible: Some(MorphModule {
                    tables: &bible,
                    has_indications: true,
                    has_language_column: true,
                    info_language: None,
                    articles_language: None,
                }),
                dictionary: Some(MorphModule {
                    tables: &dictionary,
                    has_indications: true,
                    has_language_column: false,
                    info_language: Some("en"),
                    articles_language: None,
                }),
            },
            Some("xyzcode"),
            Some("en"),
        )
        .expect("dictionary table result");

        assert_eq!(result.source, DecodeSource::DictTable);
        assert_eq!(result.display_text, "Dictionary only");
        assert_eq!(result.topic_ref, None);
    }

    #[test]
    fn falls_back_to_builtin_decoder_when_no_tables_match() {
        let result =
            resolve_morphology(&empty_sources(), Some("verb.qal.perf.p3.m.sg"), Some("en"))
                .expect("builtin result");
        assert_eq!(result.source, DecodeSource::BuiltinCompact);
        assert_eq!(
            result.display_text,
            "Part of speech: Verb | Stem: Qal | Aspect: Perfect | Person: 3rd | Gender: Masculine | Number: Singular"
        );
        assert_eq!(result.topic_ref, None);
    }

    #[test]
    fn returns_raw_code_when_no_decoder_matches() {
        let result = resolve_morphology(&empty_sources(), Some("XYZ-UNKNOWN"), Some("en"))
            .expect("unknown result");
        assert_eq!(result.source, DecodeSource::Unknown);
        assert_eq!(result.display_text, "XYZ-UNKNOWN");
        assert_eq!(result.raw_code, "XYZ-UNKNOWN");
        assert_eq!(result.topic_ref, None);
    }

    #[test]
    fn empty_morph_code_returns_none() {
        assert!(resolve_morphology(&empty_sources(), Some("  "), Some("en")).is_none());
        assert!(resolve_morphology(&empty_sources(), None, Some("en")).is_none());
    }
}
