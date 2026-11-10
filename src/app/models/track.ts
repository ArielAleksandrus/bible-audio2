export interface Track {
  // for bibles: ${version}-${bookAbbrev}-${chapter}, or
  // ${version}-${narrator}-${bookAbbrev}-${chapter} when the version has a choice of narrators
  id: string;          // e.g. "ara-jr-1"
  book: string;        // e.g. "Jeremias"
  chapter: number;     // 1 to 52
  title: string;       // "Jeremias 1"
  // Older storage key this same audio may already be saved under ('' = none).
  fileName: string;
  url: string;         // full CDN URL
  status: 'pending'|'downloading'|'done'|'error';

  // Where the chapter comes from, so the same chapter can be rebuilt for
  // another narrator without going back to the page that created it.
  lang?: string;       // catalog language, e.g. "pt"
  version?: string;    // e.g. "ara"
  bookIdx?: number;    // 0-65
  abbrev?: string;     // the Bible JSON's own book abbreviation, e.g. "Gn"
  narrator?: string;   // set only when the version has two or more narrators
}
