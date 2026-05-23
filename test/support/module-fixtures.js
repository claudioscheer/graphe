import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';

export const TOTAL_VERSES = 31102;
export const OT_VERSES = 23145;

export function writeTheWordBibleFixture(dir, fileName = 'fixture-strong.ont') {
  const filePath = path.join(dir, fileName);
  const verses = Array(TOTAL_VERSES).fill('');
  verses[0] = '<wt>In<WH7225><WTN l="beginning"> the beginning';
  verses[1] = '2 And the earth was without form';
  fs.writeFileSync(
    filePath,
    `${verses.join('\n')}\ndescription=Fixture Bible\nshort.title=FX\nlang=en\n`
  );
  return filePath;
}

export function writeSqliteBibleFixture(dir, fileName = 'fixture.SQLite3') {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE books (book_number INTEGER, short_name TEXT, long_name TEXT);
      CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
    `);
    db.prepare('INSERT INTO info VALUES (?, ?)').run('description', 'Fixture Bible');
    db.prepare('INSERT INTO books VALUES (?, ?, ?)').run(10, 'Gen', 'Genesis');
    db.prepare('INSERT INTO verses VALUES (?, ?, ?, ?)').run(10, 1, 1, 'In<S>7225</S>');
  } finally {
    db.close();
  }
  return filePath;
}

export function writeSqliteCommentaryFixture(dir, fileName = 'fixture.commentaries.SQLite3') {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE commentaries (
        book_number INTEGER,
        chapter_number_from INTEGER,
        verse_number_from INTEGER,
        chapter_number_to INTEGER,
        verse_number_to INTEGER,
        text TEXT
      );
    `);
    db.prepare('INSERT INTO info VALUES (?, ?)').run('description', 'Fixture Commentary');
    db.prepare('INSERT INTO commentaries VALUES (?, ?, ?, ?, ?, ?)').run(
      10,
      1,
      1,
      null,
      1,
      'Commentary text'
    );
  } finally {
    db.close();
  }
  return filePath;
}

export function writeSqliteDictionaryFixture(dir, fileName = 'fixture.dictionary.SQLite3') {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE info (name TEXT, value TEXT);
      CREATE TABLE dictionary (topic TEXT, definition TEXT);
    `);
    db.prepare('INSERT INTO info VALUES (?, ?)').run('description', 'Fixture Dictionary');
    db.prepare('INSERT INTO dictionary VALUES (?, ?)').run('Alpha', 'Definition text');
  } finally {
    db.close();
  }
  return filePath;
}

function utf16Text(text) {
  return Buffer.from(text, 'utf16le');
}

export function writeTwmType2CommentaryFixture(dir, fileName = 'fixture.cmt.twm') {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE config (name TEXT, value TEXT);
      CREATE TABLE content (topic_id INTEGER, data BLOB);
      CREATE TABLE content_search (topic_id INTEGER, data BLOB);
      CREATE TABLE bible_refs (topic_id INTEGER, bi INTEGER, ci INTEGER, fvi INTEGER, tvi INTEGER);
    `);
    db.prepare('INSERT INTO config VALUES (?, ?)').run('title', 'Fixture Type 2 Commentary');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('type', '2');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('lang', 'en');
    db.prepare('INSERT INTO content VALUES (?, ?)').run(1, 'Plain commentary');
    db.prepare('INSERT INTO content_search VALUES (?, ?)').run(1, utf16Text('Plain commentary'));
    db.prepare('INSERT INTO bible_refs VALUES (?, ?, ?, ?, ?)').run(1, 1, 1, 1, 2);
  } finally {
    db.close();
  }
  return filePath;
}

export function writeTwmType3CommentaryFixture(dir, fileName = 'fixture-topic.cmt.twm') {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE config (name TEXT, value TEXT);
      CREATE TABLE topics (id INTEGER, pid INTEGER, subject TEXT, rel_order INTEGER);
      CREATE TABLE content (topic_id INTEGER, data BLOB);
      CREATE TABLE content_search (topic_id INTEGER, data BLOB);
      CREATE TABLE bible_link_search (topic_id INTEGER, data BLOB);
    `);
    db.prepare('INSERT INTO config VALUES (?, ?)').run('title', 'Fixture Type 3 Commentary');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('type', '3');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('lang', 'en');
    db.prepare('INSERT INTO topics VALUES (?, ?, ?, ?)').run(1, 0, 'Genesis', 1);
    db.prepare('INSERT INTO content VALUES (?, ?)').run(1, 'Topic commentary');
    db.prepare('INSERT INTO content_search VALUES (?, ?)').run(1, utf16Text('Topic commentary'));
    db.prepare('INSERT INTO bible_link_search VALUES (?, ?)').run(1, ',1.1.1,');
  } finally {
    db.close();
  }
  return filePath;
}

export function writeTwmDictionaryFixture(
  dir,
  fileName = 'fixture.dct.twm',
  { compressed = false } = {}
) {
  const filePath = path.join(dir, fileName);
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE config (name TEXT, value TEXT);
      CREATE TABLE topics (id INTEGER, pid INTEGER, subject TEXT, rel_order INTEGER);
      CREATE TABLE content (topic_id INTEGER, data BLOB);
      CREATE TABLE content_search (topic_id INTEGER, data BLOB);
    `);
    db.prepare('INSERT INTO config VALUES (?, ?)').run('title', 'Fixture Dictionary');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('type', '1');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('lang', 'pt');
    db.prepare('INSERT INTO config VALUES (?, ?)').run('strong.g', '1');
    if (compressed) db.prepare('INSERT INTO config VALUES (?, ?)').run('compressed', '1');
    db.prepare('INSERT INTO topics VALUES (?, ?, ?, ?)').run(1, 0, 'G3588', 1);
    db.prepare('INSERT INTO content VALUES (?, ?)').run(1, 'Dictionary content');
    const text = 'artigo definido\nfixture definition';
    const payload = compressed ? zlib.deflateSync(utf16Text(text)) : utf16Text(text);
    db.prepare('INSERT INTO content_search VALUES (?, ?)').run(1, payload);
  } finally {
    db.close();
  }
  return filePath;
}
