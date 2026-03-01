const fs = require('fs');
const os = require('os');
const path = require('path');

const GRAPHE_DIR = path.join(os.homedir(), '.graphe');
const STATE_FILE = path.join(GRAPHE_DIR, 'state.json');

function ensureDir() {
  fs.mkdirSync(GRAPHE_DIR, { recursive: true });
}

function getDefaultState() {
  return {
    settings: {
      theme: null,
      language: 'pt',
      fontSize: 20,
      strongsDicts: null,
      semanticSearchEnabled: false,
      semanticModelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      semanticResultCount: 5,
    },
    paneManager: null,
    searchPanel: null,
    dictPanel: null,
  };
}

function loadState() {
  ensureDir();

  if (!fs.existsSync(STATE_FILE)) {
    return getDefaultState();
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...getDefaultState(),
      ...parsed,
      settings: {
        ...getDefaultState().settings,
        ...(parsed.settings || {}),
      },
    };
  } catch (err) {
    console.error('Failed to load app state:', err.message);
    return getDefaultState();
  }
}

function saveState(nextState) {
  ensureDir();

  const state = {
    ...getDefaultState(),
    ...(nextState || {}),
    settings: {
      ...getDefaultState().settings,
      ...((nextState && nextState.settings) || {}),
    },
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

module.exports = { loadState, saveState, STATE_FILE };
