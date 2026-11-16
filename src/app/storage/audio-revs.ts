/**
 * Which revision of its audio each downloaded chapter is (catalog `rev`),
 * kept apart from the files so it works the same on web and native.
 *
 * Only chapters above revision 1 are written down, so the map stays empty
 * until a book is republished, and small after (a few bytes per chapter).
 * Losing it (cleared site data) is safe: every chapter then reads as
 * revision 1 and the republished ones are fetched again once.
 */
const KEY = 'audioRevs';

let cache: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function save(map: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // No storage: the revision holds for this session only.
  }
}

/** Revision of the audio stored under this key; 1 when nothing is written down. */
export function storedRev(key: string): number {
  const r = load()[key];
  return typeof r === 'number' && r > 1 ? r : 1;
}

/** Note that the audio stored under this key is at this revision. */
export function setStoredRev(key: string, rev: number | undefined): void {
  const map = load();
  const r = rev ?? 1;
  if (r > 1) {
    if (map[key] === r) return;
    map[key] = r;
  } else {
    if (!(key in map)) return;
    delete map[key];
  }
  save(map);
}

export function forgetStoredRev(key: string): void {
  setStoredRev(key, 1);
}

export function clearStoredRevs(): void {
  cache = {};
  try { localStorage.removeItem(KEY); } catch { /* nothing saved */ }
}
