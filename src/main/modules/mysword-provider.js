/**
 * MySword (.mybible) module reader.
 * Reads SQLite3 .mybible files and provides a handle for the converter.
 */
const Database = require('better-sqlite3');

/**
 * Load a .mybible file, detect type (Bible vs Dictionary), return handle.
 * @param {string} filePath
 * @returns {{ type: string, db: Database, details: object, ... } | null}
 */
function load(filePath) {
  let db;
  try {
    db = new Database(filePath, { readonly: true });
  } catch (_) {
    return null;
  }

  let tables;
  try {
    tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
  } catch (_) {
    db.close();
    return null;
  }
  const tablesLower = tables.map((t) => t.toLowerCase());

  const detailsTable = tables.find((t) => t.toLowerCase() === 'details');
  const details = detailsTable ? readDetails(db, detailsTable) : {};

  const isBible = tablesLower.includes('bible');
  const hasDictionary = tablesLower.includes('dictionary');

  if (isBible) {
    const bibleTable = tables.find((t) => t.toLowerCase() === 'bible');
    const scriptureCol = detectScriptureColumn(db, bibleTable);
    const hasStrongs = detectStrongs(db, bibleTable, scriptureCol);

    return {
      type: 'bible',
      db,
      filePath,
      details,
      bibleTable,
      scriptureCol,
      hasStrongs,
    };
  }

  if (hasDictionary) {
    const dictTableName = tables.find((t) => t.toLowerCase() === 'dictionary');
    const columns = db.prepare(`PRAGMA table_info("${dictTableName}")`).all();
    const colNames = columns.map((c) => c.name.toLowerCase());
    const hasLexeme = colNames.includes('lexeme');
    const hasRelativeOrder = colNames.includes('relativeorder');
    const isStrong = Boolean(details.strong);

    return {
      type: 'dictionary',
      db,
      filePath,
      details,
      dictTableName,
      hasLexeme,
      hasRelativeOrder,
      isStrong,
    };
  }

  db.close();
  return null;
}

function readDetails(db, tableName) {
  const row = db.prepare(`SELECT * FROM "${tableName}" LIMIT 1`).get();
  if (!row) return {};

  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

function detectScriptureColumn(db, bibleTable) {
  const columns = db.prepare(`PRAGMA table_info("${bibleTable}")`).all();
  const col = columns.find((c) => c.name.toLowerCase() === 'scripture');
  return col ? col.name : 'Scripture';
}

function detectStrongs(db, bibleTable, scriptureCol) {
  const sample = db
    .prepare(
      `SELECT "${scriptureCol}" as text FROM "${bibleTable}" WHERE "${scriptureCol}" IS NOT NULL LIMIT 200`
    )
    .all();
  return sample.some((r) => /<W[HG]\d/i.test(r.text || ''));
}

function close(handle) {
  if (handle && handle.db) {
    try {
      handle.db.close();
    } catch (_) {}
  }
}

module.exports = { load, close };
