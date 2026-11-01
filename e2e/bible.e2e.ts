import { test, expect, chooseLanguage, player } from './fixtures';

test.describe('reading the Bible', () => {
  test('first run: choose a language, then a book and chapter, and it plays', async ({ page, cdn }) => {
    await chooseLanguage(page);
    expect(cdn.json).toEqual(['/jsons/pt-ara.json']);

    await page.locator('.book-item', { hasText: /^\s*gn\s*$/ }).click();
    await page.locator('.chapter-item', { hasText: /^\s*3\s*$/ }).click();

    const p = player(page);
    await expect(p.title).toHaveText('Gênesis 3');
    await expect(p.pause).toBeVisible();
    await expect.poll(p.playbackState).toBe('playing');
    await expect.poll(p.lockScreenTitle).toBe('Gênesis 3');
    expect(cdn.audio).toContain('/audios/pt/ARA/GEN/GEN 3.mp3');
  });

  test('pause and resume from the mini player', async ({ page }) => {
    await chooseLanguage(page);
    await page.locator('.book-item', { hasText: /^\s*sl\s*$/ }).click();
    await page.locator('.chapter-item', { hasText: /^\s*23\s*$/ }).click();
    const p = player(page);
    await expect(p.pause).toBeVisible();

    await p.pause.click();
    await expect(p.play).toBeVisible();
    await expect.poll(p.playbackState).toBe('paused');

    await p.play.click();
    await expect(p.pause).toBeVisible();
    await expect.poll(p.playbackState).toBe('playing');
  });

  test('the language and Bible survive a reload (no second download)', async ({ page, cdn }) => {
    await chooseLanguage(page);
    await page.reload();
    await expect(page.locator('.book-item').first()).toBeVisible();
    await expect(page.getByText('Português - ARA')).toHaveCount(0);
    expect(cdn.json).toEqual(['/jsons/pt-ara.json']);
  });
});
