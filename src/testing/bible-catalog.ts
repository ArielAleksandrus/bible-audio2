import { BibleCatalogEntry } from '../app/data/bible-catalog';

/**
 * Tests only: the five licensed versions the app offered until OTB, shaped
 * like the catalog.json on the CDN until then. A list with one version per
 * language, independent of what BUNDLED_CATALOG ships today.
 */
export const FIVE_LICENSED: BibleCatalogEntry[] = [
  { lang: 'pt', version: 'ara', flag: '🇧🇷', label: 'Português - ARA' },
  { lang: 'en', version: 'niv', flag: '🇺🇸', label: 'English - NIV' },
  { lang: 'es', version: 'nvi', flag: '🇪🇸', label: 'Español - NVI' },
  { lang: 'zh', version: 'cnvs', flag: '🇨🇳', label: 'Chinese - CNVS (简体)' },
  { lang: 'ja', version: 'jcb', flag: '🇯🇵', label: '日本語 - JCB' },
];
