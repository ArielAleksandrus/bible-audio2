export interface Track {
  // for bibles, we'll use ${version}-${bookAbbrev}-${chapter}
  id: string;          // e.g. "ara-jr-1"
  book: string;        // e.g. "Jeremias"
  chapter: number;     // 1 to 52
  title: string;       // "Jeremias 1"
  fileName: string;    // "Jeremias/Jeremias 1.mp3"  ← key for IndexedDB
  url: string;         // full https://nlabs.live:3003/...
  status: 'pending'|'downloading'|'done'|'error';
}
