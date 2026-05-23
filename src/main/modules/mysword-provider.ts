/**
 * MySword (.mybible) module reader.
 * Reads SQLite3 .mybible files and provides a handle for the converter.
 */
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';

interface TableNameRow {
  name: string;
}

interface ColumnInfoRow {
  name: string;
}

interface ScriptureSampleRow {
  text: string | null;
}

interface MySwordDetails {
  [key: string]: string | number | null;
  strong?: string | number | null;
}

interface MySwordBibleHandle {
  type: 'bible';
  db: DatabaseInstance;
  filePath: string;
  details: MySwordDetails;
  bibleTable: string;
  scriptureCol: string;
  hasStrongs: boolean;
}

interface MySwordDictionaryHandle {
  type: 'dictionary';
  db: DatabaseInstance;
  filePath: string;
  details: MySwordDetails;
  dictTableName: string;
  hasLexeme: boolean;
  hasRelativeOrder: boolean;
  isStrong: boolean;
}

type MySwordHandle = MySwordBibleHandle | MySwordDictionaryHandle;

/**
 * Load a .mybible file, detect type (Bible vs Dictionary), return handle.
 * @param {string} filePath
 * @returns {{ type: string, db: Database, details: object, ... } | null}
 */
function load(filePath: string): MySwordHandle | null {
  let db: DatabaseInstance;
  try {
    db = new Database(filePath, { readonly: true });
  } catch (_) {
    return null;
  }

  let tables: string[];
  try {
    tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as TableNameRow[])
      .map((r: TableNameRow) => r.name);
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
    const bibleTable = tables.find((t: string) => t.toLowerCase() === 'bible') || 'Bible';
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
    const dictTableName = tables.find((t: string) => t.toLowerCase() === 'dictionary') || 'Dictionary';
    const columns = db.prepare(`PRAGMA table_info("${dictTableName}")`).all() as ColumnInfoRow[];
    const colNames = columns.map((c: ColumnInfoRow) => c.name.toLowerCase());
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

function readDetails(db: DatabaseInstance, tableName: string): MySwordDetails {
  const row = db.prepare(`SELECT * FROM "${tableName}" LIMIT 1`).get() as MySwordDetails | undefined;
  if (!row) return {};

  const result: MySwordDetails = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

function detectScriptureColumn(db: DatabaseInstance, bibleTable: string): string {
  const columns = db.prepare(`PRAGMA table_info("${bibleTable}")`).all() as ColumnInfoRow[];
  const col = columns.find((c: ColumnInfoRow) => c.name.toLowerCase() === 'scripture');
  return col ? col.name : 'Scripture';
}

function detectStrongs(db: DatabaseInstance, bibleTable: string, scriptureCol: string): boolean {
  const sample = db
    .prepare(
      `SELECT "${scriptureCol}" as text FROM "${bibleTable}" WHERE "${scriptureCol}" IS NOT NULL LIMIT 200`
    )
    .all() as ScriptureSampleRow[];
  return sample.some((r: ScriptureSampleRow) => /<W[HG]\d/i.test(r.text || ''));
}

function close(handle: MySwordHandle | null): void {
  if (handle && handle.db) {
    try {
      handle.db.close();
    } catch (_) {}
  }
}

export { load, close };

if (typeof module !== 'undefined') module.exports = { load, close };
