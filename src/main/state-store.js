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

let cachedState = null;

function mergeState(nextState) {
  return {
    ...getDefaultState(),
    ...(nextState || {}),
    settings: {
      ...getDefaultState().settings,
      ...((nextState && nextState.settings) || {}),
    },
  };
}

async function saveState(nextState) {
  ensureDir();

  const state = mergeState(nextState);
  cachedState = state;

  await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function saveStateSync() {
  if (!cachedState) return;
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(cachedState, null, 2), 'utf8');
}

module.exports = { loadState, saveState, saveStateSync, STATE_FILE };
