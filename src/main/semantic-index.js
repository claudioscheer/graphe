const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const INDEX_DIR = path.join(os.homedir(), '.graphe', 'index');
const INDEX_DB_PATH = path.join(INDEX_DIR, 'semantic.sqlite3');
const WORKER_PATH = path.join(__dirname, 'semantic-index-worker.js');

let indexDb = null;
let extractorPromise = null;
let nextJobId = 1;
const jobs = new Map();
const moduleCache = new Map();

function init() {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  indexDb = new Database(INDEX_DB_PATH);
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

    CREATE INDEX IF NOT EXISTS idx_semantic_verses_module
      ON semantic_verses(module_id);
  `);
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = require('@huggingface/transformers');
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      return pipeline('feature-extraction', MODEL_ID);
    })();
  }
  return extractorPromise;
}

function fromBufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

function dot(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

async function embedTexts(texts) {
  const extractor = await getExtractor();
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

function getSourceVerseCount(modulePath) {
  const sourceDb = new Database(modulePath, { readonly: true });
  try {
    const row = sourceDb.prepare('SELECT COUNT(*) AS count FROM verses').get();
    return row ? row.count : 0;
  } finally {
    sourceDb.close();
  }
}

function ensureMetaRow(moduleId) {
  indexDb
    .prepare(`
      INSERT INTO semantic_index_meta (module_id, model_id, status)
      VALUES (?, ?, 'missing')
      ON CONFLICT(module_id) DO NOTHING
    `)
    .run(moduleId, MODEL_ID);
}

function getStatus(moduleId, modulePath) {
  if (moduleId) {
    ensureMetaRow(moduleId);
    const row = indexDb
      .prepare('SELECT module_id AS moduleId, model_id AS modelId, verse_count AS verseCount, built_at AS builtAt, status, error FROM semantic_index_meta WHERE module_id = ?')
      .get(moduleId);

    if (!row) {
      return {
        moduleId,
        modelId: MODEL_ID,
        verseCount: 0,
        builtAt: null,
        status: 'missing',
        error: null,
      };
    }

    if (modulePath && row.status === 'ready') {
      try {
        const sourceCount = getSourceVerseCount(modulePath);
        if (sourceCount !== row.verseCount) {
          indexDb
            .prepare('UPDATE semantic_index_meta SET status = ?, error = ? WHERE module_id = ?')
            .run('stale', 'Module changed; rebuild required.', moduleId);
          row.status = 'stale';
          row.error = 'Module changed; rebuild required.';
        }
      } catch (_) {}
    }

    return row;
  }

  return indexDb
    .prepare('SELECT module_id AS moduleId, model_id AS modelId, verse_count AS verseCount, built_at AS builtAt, status, error FROM semantic_index_meta ORDER BY module_id')
    .all();
}

function getProgress(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    jobId,
    moduleId: job.moduleId,
    phase: job.phase,
    done: job.done,
    total: job.total,
    status: job.status,
    error: job.error || null,
  };
}

function cancelBuild(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { cancelled: false };
  if (job.worker && job.status === 'running') {
    job.worker.postMessage({ type: 'cancel' });
  }
  return { cancelled: true };
}

function createJob(moduleId) {
  const jobId = String(nextJobId++);
  jobs.set(jobId, {
    moduleId,
    phase: 'queued',
    done: 0,
    total: 0,
    status: 'queued',
    error: null,
    worker: null,
  });
  return jobId;
}

function startBuild(moduleId, modulePath) {
  const running = Array.from(jobs.entries()).find(([, j]) => j.moduleId === moduleId && j.status === 'running');
  if (running) {
    return { jobId: running[0] };
  }

  indexDb
    .prepare('INSERT INTO semantic_index_meta (module_id, model_id, status, error) VALUES (?, ?, ?, NULL) ON CONFLICT(module_id) DO UPDATE SET model_id = excluded.model_id, status = excluded.status, error = NULL')
    .run(moduleId, MODEL_ID, 'building');

  const jobId = createJob(moduleId);
  const job = jobs.get(jobId);
  job.status = 'running';
  job.phase = 'starting';

  const worker = new Worker(WORKER_PATH, {
    workerData: {
      moduleId,
      modulePath,
      indexDbPath: INDEX_DB_PATH,
      modelId: MODEL_ID,
    },
  });

  job.worker = worker;

  worker.on('message', (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'progress') {
      job.phase = message.phase || 'embedding';
      job.done = Number.isFinite(message.done) ? message.done : job.done;
      job.total = Number.isFinite(message.total) ? message.total : job.total;
      return;
    }

    if (message.type === 'done') {
      job.phase = 'done';
      job.status = 'done';
      job.done = Number.isFinite(message.done) ? message.done : job.done;
      job.total = Number.isFinite(message.total) ? message.total : job.total;
      moduleCache.delete(moduleId);
      return;
    }

    if (message.type === 'cancelled') {
      job.phase = 'cancelled';
      job.status = 'cancelled';
      moduleCache.delete(moduleId);
      return;
    }

    if (message.type === 'error') {
      job.phase = 'error';
      job.status = 'error';
      job.error = message.error || 'Unknown worker error';
    }
  });

  worker.on('error', (err) => {
    job.phase = 'error';
    job.status = 'error';
    job.error = err && err.message ? err.message : String(err);
  });

  worker.on('exit', (code) => {
    job.worker = null;
    if (code !== 0 && job.status === 'running') {
      job.phase = 'error';
      job.status = 'error';
      job.error = `Worker exited with code ${code}`;
      indexDb
        .prepare('UPDATE semantic_index_meta SET status = ?, error = ? WHERE module_id = ?')
        .run('error', job.error, moduleId);
    }
  });

  return { jobId };
}

function loadModuleCache(moduleId) {
  const rows = indexDb
    .prepare('SELECT book_number AS bookNumber, chapter, verse, clean_text AS cleanText, embedding_blob AS embeddingBlob FROM semantic_verses WHERE module_id = ?')
    .all(moduleId);

  const cached = rows.map((row) => ({
    bookNumber: row.bookNumber,
    chapter: row.chapter,
    verse: row.verse,
    cleanText: row.cleanText,
    vector: fromBufferToFloat32(row.embeddingBlob),
  }));

  moduleCache.set(moduleId, cached);
  return cached;
}

async function search(moduleId, query, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 300;
  const status = getStatus(moduleId, opts.modulePath);
  if (!status || status.status !== 'ready') {
    return { ready: false, reason: status ? status.status : 'missing', results: [] };
  }

  const trimmed = String(query || '').trim();
  if (!trimmed) return { ready: true, results: [] };

  const [queryVec] = await embedTexts([trimmed]);
  if (!queryVec || queryVec.length === 0) return { ready: true, results: [] };

  const cached = moduleCache.get(moduleId) || loadModuleCache(moduleId);
  if (cached.length === 0) return { ready: true, results: [] };

  const scored = [];
  for (const row of cached) {
    const similarity = dot(queryVec, row.vector);
    scored.push({
      bookNumber: row.bookNumber,
      chapter: row.chapter,
      verse: row.verse,
      text: row.cleanText,
      semanticScore: (similarity + 1) / 2,
    });
  }

  scored.sort((a, b) => b.semanticScore - a.semanticScore);
  return { ready: true, results: scored.slice(0, limit) };
}

module.exports = {
  MODEL_ID,
  INDEX_DB_PATH,
  init,
  getStatus,
  getProgress,
  cancelBuild,
  startBuild,
  search,
};
