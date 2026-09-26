/**
 * In-memory Storage for test environments where `localStorage` is missing.
 *
 * Node >= 25 defines an inert experimental `localStorage` accessor on the
 * global (it only works when started with `--localstorage-file`). Vitest's
 * jsdom environment does not copy jsdom's `Storage` over keys that already
 * exist on the global, so renderer tests see `localStorage === undefined`
 * even with jsdom active. Install a Map-backed Storage whenever the current
 * global does not already provide a working one.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function isWorkingStorage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Storage).getItem === 'function' &&
    typeof (value as Storage).setItem === 'function' &&
    typeof (value as Storage).removeItem === 'function' &&
    typeof (value as Storage).clear === 'function'
  );
}

// Inspect the property descriptor instead of reading the accessor, so Node's
// "localStorage is not available" ExperimentalWarning is not emitted.
const globalDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
if (!globalDesc || globalDesc.get || !isWorkingStorage(globalDesc.value)) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined' && !isWorkingStorage(window.localStorage)) {
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}
