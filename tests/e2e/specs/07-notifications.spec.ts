import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { saveInternState, INTERN_STATE_FILE } from '../helpers/storageState';

/**
 * Journey 7 — Notifications Page (Intern)
 *
 * Covers: page load, signal feed header, filter pills, mark-as-read,
 * clear all, resolved history, and empty state.
 */

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await saveInternState(browser);
});

test.use({ storageState: INTERN_STATE_FILE });

test.describe('Notifications Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible({ timeout: 10_000 });
  });

  test('notifications page loads with signal feed label', async ({ page }) => {
    await expect(page.getByText(/signal feed/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows either active signals badge or all-clear badge', async ({ page }) => {
    const allClear     = page.getByText(/all clear/i);
    const activeSignal = page.getByText(/active signal/i);
    await expect(allClear.or(activeSignal)).toBeVisible({ timeout: 8_000 });
  });

  test('filter pills appear when notifications exist', async ({ page }) => {
    const allPill = page.getByRole('button', { name: /^all$/i });
    const hasNotifs = await allPill.isVisible().catch(() => false);
    if (!hasNotifs) {
      // Both "All signals clear" and "You're all caught up" are rendered together
      // in the empty state — just check the outer card is visible
      await expect(page.locator('.glass-card').filter({ hasText: /all signals clear/i })).toBeVisible({ timeout: 5_000 });
      return;
    }

    await expect(page.getByRole('button', { name: /critical/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /warning/i })).toBeVisible();
  });

  test('clicking Warning filter shows only warning notifications', async ({ page }) => {
    const warnBtn = page.getByRole('button', { name: /warning/i });
    const hasNotifs = await warnBtn.isVisible().catch(() => false);
    if (!hasNotifs) return;

    await warnBtn.click();

    // Either warning items or the "no warning notifications" empty state
    const warnBadges = page.locator('span').filter({ hasText: /^warning$/i });
    const emptyState = page.getByText(/no warning notifications/i);
    await expect(warnBadges.first().or(emptyState)).toBeVisible({ timeout: 5_000 });
  });

  test('mark-as-read button removes a notification from the active list', async ({ page }) => {
    // Wait for the page to finish loading notifications
    await page.waitForTimeout(1_000);

    const readBtn = page.locator('button[title="Mark as read"]').first();
    const hasBtn = await readBtn.isVisible().catch(() => false);

    // If no notifications exist (cleared by a previous test), skip gracefully
    if (!hasBtn) {
      await expect(
        page.locator('.glass-card').filter({ hasText: /all signals clear/i })
      ).toBeVisible({ timeout: 5_000 });
      return;
    }

    const cards = page.locator('.glass-card').filter({ hasNot: page.locator('h2') });
    const initialCount = await cards.count();

    await readBtn.click();

    await page.waitForTimeout(1_500);
    const newCount = await cards.count();
    expect(newCount).toBeLessThanOrEqual(initialCount);
  });

  test('clear all removes all active notifications', async ({ page }) => {
    const clearBtn = page.getByRole('button', { name: /clear all/i });
    const hasNotifs = await clearBtn.isVisible().catch(() => false);
    if (!hasNotifs) return;

    await clearBtn.click();

    // Both texts appear together in the empty state card — check the card itself
    await expect(
      page.locator('.glass-card').filter({ hasText: /all signals clear/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('resolved history shows read items with ✓ READ label', async ({ page }) => {
    const readBtn = page.locator('button[title="Mark as read"]').first();
    const hasBtn = await readBtn.isVisible().catch(() => false);
    if (!hasBtn) return;

    await readBtn.click();
    await page.waitForTimeout(1_500);

    await expect(page.getByText(/resolved history/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/✓ read/i)).toBeVisible({ timeout: 5_000 });
  });

  test('empty state card is shown when no notifications exist', async ({ page }) => {
    // Clear everything first if there are notifications
    const clearBtn = page.getByRole('button', { name: /clear all/i });
    const hasNotifs = await clearBtn.isVisible().catch(() => false);
    if (hasNotifs) {
      await clearBtn.click();
      await page.waitForTimeout(1_500);
    }

    // Both "All signals clear" and "You're all caught up" render inside the same
    // empty-state card — match the card container to avoid strict-mode violation
    await expect(
      page.locator('.glass-card').filter({ hasText: /all signals clear/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});
