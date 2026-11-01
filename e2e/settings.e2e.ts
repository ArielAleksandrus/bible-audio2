import { test, expect, chooseLanguage, player } from './fixtures';
import type { Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.locator('ion-tab-button[tab="settings"]').click();
}

function audiosRow(page: Page) {
  return page.locator('.info-row', { hasText: /Áudios baixados|Downloaded audios/ }).locator('strong');
}

/** The hold-to-confirm dialog: keep OK pressed until it fills and confirms. */
async function holdToConfirm(page: Page) {
  const hold = page.locator('ion-modal .hold-button');
  await expect(hold).toBeVisible();
  await hold.dispatchEvent('mousedown');
  await expect(page.locator('ion-modal app-confirmation-dialog')).toHaveCount(0, { timeout: 8_000 });
}

test.describe('settings', () => {
  test('a played chapter is kept on the device; clearing downloads sticks after a reload', async ({ page }) => {
    await chooseLanguage(page);
    await page.locator('.book-item', { hasText: /^\s*jo\s*$/ }).click();
    await page.locator('.chapter-item', { hasText: /^\s*1\s*$/ }).click();
    await expect(player(page).title).toHaveText('João 1');

    await openSettings(page);
    // The chapter was saved to IndexedDB as a real audio Blob.
    await expect(audiosRow(page)).not.toHaveText('0 MB');

    await page.reload();
    await openSettings(page);
    await expect(audiosRow(page)).not.toHaveText('0 MB');

    await page.getByRole('button', { name: 'Limpar Todos os Áudios Baixados' }).click();
    await holdToConfirm(page);
    await page.getByRole('button', { name: 'OK' }).click(); // "Pronto/Done" alert
    await expect(audiosRow(page)).toHaveText('0 MB');

    await page.reload();
    await openSettings(page);
    await expect(audiosRow(page)).toHaveText('0 MB');
  });

  test('changing the Bible language switches the app and survives a reload', async ({ page, cdn }) => {
    await chooseLanguage(page);
    await openSettings(page);
    await expect(page.getByText('Idioma atual')).toBeVisible();

    await page.getByRole('button', { name: 'Redefinir Idioma' }).click();
    await page.getByText('English - NIV').click();
    await expect(page.locator('.book-item').first()).toBeVisible();
    expect(cdn.json).toContain('/jsons/en-niv.json');
    await expect(page.locator('ion-tab-button[tab="settings"]')).toContainText('Settings');

    await page.reload();
    await expect(page.locator('.book-item').first()).toBeVisible();
    await expect(page.getByText('English - NIV')).toHaveCount(0); // no language prompt again
    await openSettings(page);
    await expect(page.getByText('Current language')).toBeVisible();
    await expect(page.locator('ion-tab-button[tab="home"]')).toContainText('Home');
  });
});
