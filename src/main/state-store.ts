import fs from 'fs';
import os from 'os';
import path from 'path';

const GRAPHE_DIR = path.join(os.homedir(), '.graphe');
const STATE_FILE = path.join(GRAPHE_DIR, 'state.json');

interface StateSettings {
  theme: string | null;
  language: string;
  fontSize: number;
  strongsDicts: string[] | null;
  favoriteModules: Record<string, string[]>;
}

interface PersistedState {
  settings: StateSettings;
  paneManager: PaneManagerState | JsonObject | null;
  searchPanel: SearchPanelPersistedState | JsonObject | null;
  dictPanel: DictPanelPersistedState | JsonObject | null;
}

type PersistedStateInput = Partial<PersistedState> | AppPersistedState;

interface JsonObject {
  [key: string]: JsonValue;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureDir(): void {
  fs.mkdirSync(GRAPHE_DIR, { recursive: true });
}

function getDefaultState(): PersistedState {
  return {
    settings: {
      theme: null,
      language: 'pt',
      fontSize: 20,
      strongsDicts: null,
      favoriteModules: {},
    },
    paneManager: null,
    searchPanel: null,
    dictPanel: null,
  };
}

function parseState(raw: string): Partial<PersistedState> {
  const parsed = JSON.parse(raw) as JsonValue;
  return isJsonObject(parsed) ? (parsed as Partial<PersistedState>) : {};
}

function loadState(): PersistedState {
  ensureDir();

  if (!fs.existsSync(STATE_FILE)) {
    return getDefaultState();
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = parseState(raw);
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

let cachedState: PersistedState | null = null;

function mergeState(nextState?: PersistedStateInput | null): PersistedState {
  return {
    ...getDefaultState(),
    ...(nextState || {}),
    settings: {
      ...getDefaultState().settings,
      ...((nextState && nextState.settings) || {}),
    },
  };
}

async function saveState(nextState: PersistedStateInput): Promise<PersistedState> {
  ensureDir();

  const state = mergeState(nextState);
  cachedState = state;

  await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function saveStateSync(): void {
  if (!cachedState) return;
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(cachedState, null, 2), 'utf8');
}

export { loadState, saveState, saveStateSync, STATE_FILE };

if (typeof module !== 'undefined') module.exports = { loadState, saveState, saveStateSync, STATE_FILE };
