const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const { moduleId, modulePath, indexDbPath, modelId } = workerData;

let cancelRequested = false;
if (parentPort) {
  parentPort.on('message', (message) => {
    if (message && message.type === 'cancel') {
      cancelRequested = true;
    }
  });
}

function cleanVerseText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<n>[\s\S]*?<\/n>/gi, '')
    .replace(/<pb\s*\/?>/gi, ' ')
    .replace(/<S>[\s\S]*?<\/S>/gi, ' ')
    .replace(/<f>[\s\S]*?<\/f>/gi, ' ')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBufferFromFloat32(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

async function getExtractor() {
  const { pipeline, env } = require('@huggingface/transformers');
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  return pipeline('feature-extraction', modelId);
}

async function embedTexts(extractor, texts) {
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const dims = output.dims;
  const size = dims[dims.length - 1];
  const data = output.data;

  if (dims.length === 1) {
    return [new Float32Array(data)];
  }

  const vectors = [];
  for (let i = 0; i < dims[0]; i++) {
    const start = i * size;
    const end = start + size;
    vectors.push(new Float32Array(data.slice(start, end)));
  }
  return vectors;
}

async function run() {
  const sourceDb = new Database(modulePath, { readonly: true });
  const indexDb = new Database(indexDbPath);

  try {
    indexDb.pragma('journal_mode = WAL');
    indexDb.exec(`
      CREATE TABLE IF NOT EXISTS semantic_index_meta (
        module_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        model_revision TEXT,
        verse_count INTEGER NOT NULL DEFAULT 0,
        dim INTEGER,
        built_at TEXT,
        status TEXT NOT NULL DEFAULT 'missing',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS semantic_verses (
        module_id TEXT NOT NULL,
        book_number INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        clean_text TEXT NOT NULL,
        embedding_blob BLOB NOT NULL,
        norm REAL NOT NULL,
        PRIMARY KEY (module_id, book_number, chapter, verse)
      );
    `);

    indexDb
      .prepare(
        'INSERT INTO semantic_index_meta (module_id, model_id, status, error) VALUES (?, ?, ?, NULL) ON CONFLICT(module_id) DO UPDATE SET model_id = excluded.model_id, status = excluded.status, error = NULL'
      )
      .run(moduleId, modelId, 'building');

    const verses = sourceDb
      .prepare(
        'SELECT book_number AS bookNumber, chapter, verse, text FROM verses ORDER BY book_number, chapter, verse'
      )
      .all();

    const total = verses.length;
    parentPort.postMessage({ type: 'progress', phase: 'loading', done: 0, total });

    indexDb.prepare('DELETE FROM semantic_verses WHERE module_id = ?').run(moduleId);

    const insertRow = indexDb.prepare(`
      INSERT INTO semantic_verses (
        module_id, book_number, chapter, verse, clean_text, embedding_blob, norm
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertMeta = indexDb.prepare(`
      INSERT INTO semantic_index_meta (module_id, model_id, verse_count, dim, built_at, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET
        model_id = excluded.model_id,
        verse_count = excluded.verse_count,
        dim = excluded.dim,
        built_at = excluded.built_at,
        status = excluded.status,
        error = excluded.error
    `);

    const extractor = await getExtractor();
    const batchSize = 32;
    let dim = 0;

    for (let i = 0; i < verses.length; i += batchSize) {
      if (cancelRequested) {
        throw new Error('Build cancelled');
      }

      const batch = verses.slice(i, i + batchSize);
      const cleaned = batch.map((row) => cleanVerseText(row.text));
      const vectors = await embedTexts(extractor, cleaned);

      if (!dim && vectors[0] && vectors[0].length) {
        dim = vectors[0].length;
      }

      const tx = indexDb.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const vec = vectors[j];
          if (!vec || !vec.length) continue;
          insertRow.run(
            moduleId,
            row.bookNumber,
            row.chapter,
            row.verse,
            cleaned[j],
            toBufferFromFloat32(vec),
            1.0
          );
        }
      });

      tx();

      const done = Math.min(total, i + batch.length);
      parentPort.postMessage({ type: 'progress', phase: 'embedding', done, total });
    }

    const builtAt = new Date().toISOString();
    upsertMeta.run(moduleId, modelId, total, dim, builtAt, 'ready', null);
    parentPort.postMessage({ type: 'done', done: total, total, phase: 'done' });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const cancelled = message === 'Build cancelled';

    indexDb
      .prepare('UPDATE semantic_index_meta SET status = ?, error = ? WHERE module_id = ?')
      .run(cancelled ? 'missing' : 'error', message, moduleId);

    if (cancelled) {
      indexDb.prepare('DELETE FROM semantic_verses WHERE module_id = ?').run(moduleId);
      parentPort.postMessage({ type: 'cancelled' });
    } else {
      parentPort.postMessage({ type: 'error', error: message });
    }
  } finally {
    try {
      sourceDb.close();
    } catch (_) {}
    try {
      indexDb.close();
    } catch (_) {}
  }
}

run().catch((err) => {
  parentPort.postMessage({
    type: 'error',
    error: err && err.message ? err.message : String(err),
  });
});
