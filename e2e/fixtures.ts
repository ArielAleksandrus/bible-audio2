import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, Page, BrowserContext } from '@playwright/test';

/** The CDN the app loads Bible JSONs and chapter MP3s from (bible.service.ts). */
export const CDN = 'https://pub-7db5ca77d7e14ca79a36013b9fc40870.r2.dev';

const MP3 = readFileSync(join(__dirname, 'fixtures', 'chapter.mp3'));

// Real chapter counts so reading plans (which reference e.g. Psalm 139) work.
const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14,
  3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3,
  5, 1, 1, 1, 22,
];
const NAMES: Record<number, [string, string]> = {
  0: ['Gênesis', 'gn'], 1: ['Êxodo', 'ex'], 18: ['Salmos', 'sl'], 42: ['João', 'jo'], 39: ['Mateus', 'mt'],
};

/** A tiny but structurally complete Bible (one short verse per chapter). */
export function fixtureBible(language = 'pt', version = 'ara') {
  return {
    version,
    language,
    books: CHAPTERS.map((n, i) => {
      const [name, abbrev] = NAMES[i] ?? [`Livro ${i + 1}`, `l${i + 1}`];
      return { name, abbrev, chapters: Array.from({ length: n }, (_, c) => [`${name} ${c + 1}:1 texto de teste.`]) };
    }),
  };
}

/** Requests the fake CDN served, so tests can assert what was fetched. */
export interface CdnLog { audio: string[]; json: string[] }

/**
 * Every test runs fully offline: the app's own files come from the local
 * server, the CDN is answered from fixtures, anything else (analytics,
 * Firebase, fonts…) is aborted.
 */
export async function offline(context: BrowserContext, log: CdnLog) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.origin === CDN && url.pathname.startsWith('/jsons/')) {
      log.json.push(url.pathname);
      const [, language, version] = /\/jsons\/([a-z]+)-([a-z]+)\.json$/.exec(url.pathname) ?? [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixtureBible(language, version)) });
    }
    if (url.origin === CDN && url.pathname.startsWith('/audios/')) {
      log.audio.push(decodeURIComponent(url.pathname));
      return route.fulfill({
        contentType: 'audio/mpeg', body: MP3,
        headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' },
      });
    }
    return route.abort('blockedbyclient');
  });
}

export const test = base.extend<{ cdn: CdnLog }>({
  // `auto`: installed for every test, even ones that don't ask for the log,
  // so nothing can ever reach the real network.
  cdn: [async ({ context }, use) => {
    const log: CdnLog = { audio: [], json: [] };
    await offline(context, log);
    await use(log);
  }, { auto: true }],
});

export { expect };

/** First run: pick Portuguese in the language dialog and wait for the book grid. */
export async function chooseLanguage(page: Page) {
  await page.goto('/');
  await page.getByText('Português - ARA').click();
  await expect(page.locator('.book-item').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * The mini player at the bottom of every tab. "Playing" is read from the OS
 * media session the app drives (what the lock screen shows), not from the
 * button icon alone.
 */
export function player(page: Page) {
  const root = page.locator('app-audio-player .audio-player');
  return {
    root,
    title: root.locator('.title'),
    pause: root.getByRole('button', { name: 'Pausar' }),
    play: root.getByRole('button', { name: 'Tocar' }),
    next: root.getByRole('button', { name: 'Próximo' }),
    playbackState: () => page.evaluate(() => navigator.mediaSession.playbackState),
    lockScreenTitle: () => page.evaluate(() => navigator.mediaSession.metadata?.title ?? null),
  };
}
