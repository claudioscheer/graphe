//! Topic-to-book map and content_search blob decoding for TheWord .twm modules.

use super::super::{value_to_string, ConvertError};
use super::table_names;
use graphe_domain::books::tw_book_to_graphe;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::sync::OnceLock;

pub(super) fn build_topic_book_map(
    conn: &Connection,
) -> Result<BTreeMap<u16, Vec<i64>>, ConvertError> {
    let mut roots = query_topics(
        conn,
        "SELECT id, subject FROM topics WHERE pid = 0 AND id IN (SELECT topic_id FROM content_search) ORDER BY rel_order",
    )?;
    if roots.is_empty() {
        let all = query_topics(
            conn,
            "SELECT id, subject FROM topics WHERE pid = 0 ORDER BY rel_order",
        )?;
        for topic in all {
            if !collect_descendant_content_ids(conn, topic.0)?.is_empty() {
                roots.push(topic);
            }
        }
    }
    let has_links = table_names(conn)?
        .iter()
        .any(|name| name == "bible_link_search");
    let mut book_map: BTreeMap<u16, Vec<i64>> = BTreeMap::new();
    for (pos, (id, _)) in roots.iter().enumerate() {
        let mut graphe = if has_links {
            detect_book_from_bible_links(conn, *id)?
        } else {
            None
        };
        if graphe.is_none() {
            graphe = tw_book_to_graphe((pos as i64) + 1);
        }
        let Some(book) = graphe else {
            continue;
        };
        let mut topic_ids = Vec::new();
        if topic_has_content(conn, *id)? {
            topic_ids.push(*id);
        }
        topic_ids.extend(collect_descendant_content_ids(conn, *id)?);
        if topic_ids.is_empty() {
            continue;
        }
        book_map.entry(book).or_default().extend(topic_ids);
    }
    Ok(book_map)
}

fn query_topics(conn: &Connection, sql: &str) -> Result<Vec<(i64, String)>, ConvertError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(ConvertError::from)
}

fn collect_descendant_content_ids(
    conn: &Connection,
    parent_id: i64,
) -> Result<Vec<i64>, ConvertError> {
    let children = {
        let mut stmt = conn.prepare("SELECT id FROM topics WHERE pid = ?1 ORDER BY rel_order")?;
        let rows = stmt.query_map([parent_id], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut ids = Vec::new();
    for child in children {
        if topic_has_content(conn, child)? {
            ids.push(child);
        }
        ids.extend(collect_descendant_content_ids(conn, child)?);
    }
    Ok(ids)
}

fn topic_has_content(conn: &Connection, topic_id: i64) -> Result<bool, ConvertError> {
    let mut stmt = conn.prepare("SELECT 1 FROM content_search WHERE topic_id = ?1 LIMIT 1")?;
    let mut rows = stmt.query([topic_id])?;
    Ok(rows.next()?.is_some())
}

fn detect_book_from_bible_links(
    conn: &Connection,
    topic_id: i64,
) -> Result<Option<u16>, ConvertError> {
    let value: Option<rusqlite::types::Value> = conn
        .query_row(
            "SELECT data FROM bible_link_search WHERE topic_id = ?1",
            [topic_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(value) = value else {
        return Ok(None);
    };
    if matches!(value, rusqlite::types::Value::Null) {
        return Ok(None);
    }
    let text = value_to_string(value);
    if text.is_empty() {
        return Ok(None);
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r",([0-9]+)\.[0-9]+\.[0-9]+,").unwrap());
    let mut counts: HashMap<i64, usize> = HashMap::new();
    let mut order = Vec::new();
    for caps in re.captures_iter(&text) {
        let Ok(book) = caps[1].parse::<i64>() else {
            continue;
        };
        let entry = counts.entry(book).or_insert(0);
        if *entry == 0 {
            order.push(book);
        }
        *entry += 1;
    }
    let mut best: Option<(i64, usize)> = None;
    for book in order {
        let count = counts[&book];
        if best.map(|(_, max)| count > max).unwrap_or(true) {
            best = Some((book, count));
        }
    }
    Ok(best.and_then(|(book, _)| tw_book_to_graphe(book)))
}

pub(super) fn decode_content_search_blob(raw: &[u8], compressed_hint: bool) -> String {
    let decoded = if compressed_hint || is_likely_zlib(raw) {
        inflate_zlib(raw)
    } else {
        None
    };
    let payload = decoded.as_deref().unwrap_or(raw);
    if is_likely_utf16le(payload) {
        return decode_utf16le(payload);
    }
    let text = String::from_utf8_lossy(payload);
    if text.contains('\u{fffd}') {
        payload.iter().map(|byte| char::from(*byte)).collect()
    } else {
        text.into_owned()
    }
}

fn is_likely_zlib(buf: &[u8]) -> bool {
    if buf.len() < 2 || buf[0] != 0x78 {
        return false;
    }
    let cmf = buf[0] as u16;
    let flg = buf[1] as u16;
    (cmf & 0x0f) == 8 && ((cmf << 8) + flg) % 31 == 0
}

fn inflate_zlib(data: &[u8]) -> Option<Vec<u8>> {
    let mut decoder = flate2::read::ZlibDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).ok()?;
    Some(out)
}

fn is_likely_utf16le(buf: &[u8]) -> bool {
    if buf.len() < 2 {
        return false;
    }
    if buf[0] == 0xFF && buf[1] == 0xFE {
        return true;
    }
    let pairs = (buf.len() / 2).min(20);
    if pairs == 0 {
        return false;
    }
    let mut null_high = 0usize;
    for i in 0..pairs {
        if buf[i * 2 + 1] == 0 {
            null_high += 1;
        }
    }
    null_high * 2 >= pairs
}

fn decode_utf16le(buf: &[u8]) -> String {
    let mut units = Vec::with_capacity(buf.len() / 2);
    let mut i = 0;
    while i + 1 < buf.len() {
        units.push(u16::from_le_bytes([buf[i], buf[i + 1]]));
        i += 2;
    }
    String::from_utf16_lossy(&units)
        .trim_start_matches('\u{feff}')
        .to_string()
}

pub(super) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
