import { test, expect, chooseLanguage, player } from './fixtures';
import type { Page } from '@playwright/test';

const PLAN = 'Primeiros Passos na Bíblia'; // first-steps.json: day 1 = Gênesis 1, Salmos 23

async function openPlansTab(page: Page) {
  await page.locator('ion-tab-button[tab="plans"]').click();
  await expect(page.locator('h3.section-title', { hasText: 'Planos Disponíveis' })).toBeVisible();
}

function card(page: Page, title: string) {
  return page.locator('ion-card.plan-item', { has: page.locator('ion-card-title', { hasText: title }) });
}

test.describe('reading plans', () => {
  test('starting a plan plays day 1 and moves on to the next chapter by itself', async ({ page, cdn }) => {
    await chooseLanguage(page);
    await openPlansTab(page);

    await card(page, PLAN).getByRole('button', { name: 'Começar Plano' }).click();

    await expect(page.locator('.current-plan-section h2')).toContainText(PLAN);
    const p = player(page);
    await expect(p.title).toHaveText('Gênesis 1');
    await expect.poll(p.playbackState).toBe('playing');

    // The fixture chapter is 4 s long; the next one must start without a tap.
    await expect(p.title).toHaveText('Salmos 23', { timeout: 15_000 });
    await expect.poll(p.playbackState).toBe('playing');
    await expect.poll(p.lockScreenTitle).toBe('Salmos 23');
    expect(cdn.audio).toEqual(expect.arrayContaining([
      '/audios/pt/ARA/GEN/GEN 1.mp3',
      '/audios/pt/ARA/PSA/PSA 23.mp3',
    ]));
  });

  test('a started plan and its progress survive a reload', async ({ page }) => {
    await chooseLanguage(page);
    await openPlansTab(page);
    await card(page, PLAN).getByRole('button', { name: 'Começar Plano' }).click();
    const p = player(page);
    // Let Gênesis 1 finish so it is recorded as read.
    await expect(p.title).toHaveText('Salmos 23', { timeout: 15_000 });
    await p.pause.click();

    await page.reload();
    await openPlansTab(page);
    const started = page.locator('.section', { has: page.locator('h3.section-title', { hasText: 'Planos Iniciados' }) });
    await expect(started.locator('ion-card-title', { hasText: PLAN })).toBeVisible();
    // No longer offered as a plan to start.
    await expect(card(page, PLAN).getByRole('button', { name: 'Começar Plano' })).toHaveCount(0);

    // Resuming continues at the first unread chapter of day 1.
    await card(page, PLAN).getByRole('button', { name: 'Retomar' }).click();
    await expect(p.title).toHaveText('Salmos 23');
    await expect.poll(p.playbackState).toBe('playing');
  });

  test('deleting a started plan puts it back among the available ones', async ({ page }) => {
    await chooseLanguage(page);
    await openPlansTab(page);
    await card(page, PLAN).getByRole('button', { name: 'Começar Plano' }).click();
    await expect(page.locator('.current-plan-section')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();

    await card(page, PLAN).getByRole('button', { name: 'Excluir' }).click();
    // Hold-to-confirm dialog (ConfirmationDialog): keep the OK ring pressed
    // until it fills (5 s) — it confirms on its own, before any release.
    const hold = page.locator('ion-modal .hold-button');
    await expect(hold).toBeVisible();
    await hold.dispatchEvent('mousedown');
    await expect(page.locator('ion-modal')).toHaveCount(0, { timeout: 8_000 });

    await expect(page.locator('h3.section-title', { hasText: 'Planos Iniciados' })).toHaveCount(0);
    await expect(card(page, PLAN).getByRole('button', { name: 'Começar Plano' })).toBeVisible();
  });
});
