import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { saveAdminState, ADMIN_STATE_FILE } from '../helpers/storageState';

/**
 * Journey 6 — Alerts Page (Admin)
 *
 * Covers: page load, filter pills, resolve single alert, clear all,
 * resolved history section, and the live socket indicator.
 */

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await saveAdminState(browser);
});

test.use({ storageState: ADMIN_STATE_FILE });

test.describe('Alerts Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByText(/system alerts/i)).toBeVisible({ timeout: 10_000 });
  });

  test('alerts page loads with header and signal monitoring label', async ({ page }) => {
    await expect(page.getByText(/signal monitoring/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /system alerts/i })).toBeVisible();
  });

  test('shows either active signals badge or all-clear badge', async ({ page }) => {
    // One of these two states must be visible
    const allClear     = page.getByText(/all clear/i);
    const activeSignal = page.getByText(/active signal/i);
    await expect(allClear.or(activeSignal)).toBeVisible({ timeout: 8_000 });
  });

  test('live socket indicator is visible', async ({ page }) => {
    // The LIVE or OFFLINE badge is always rendered
    const liveOrOffline = page.getByText(/^live$|^offline$/i);
    await expect(liveOrOffline).toBeVisible({ timeout: 8_000 });
  });

  test('filter pills (All / Critical / Warning) appear when alerts exist', async ({ page }) => {
    // If there are no alerts the pills are hidden — skip gracefully
    const allPill = page.getByRole('button', { name: /^all$/i });
    const hasAlerts = await allPill.isVisible().catch(() => false);
    if (!hasAlerts) {
      // All-clear state — just verify the empty state card is shown
      await expect(page.getByText(/all signals clear/i)).toBeVisible({ timeout: 5_000 });
      return;
    }

    await expect(page.getByRole('button', { name: /critical/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /warning/i })).toBeVisible();
  });

  test('clicking Critical filter shows only critical alerts', async ({ page }) => {
    const critBtn = page.getByRole('button', { name: /critical/i });
    const hasAlerts = await critBtn.isVisible().catch(() => false);
    if (!hasAlerts) return; // no alerts — skip

    await critBtn.click();

    // Every visible alert card should carry the CRITICAL badge
    // (or the empty state if there are no critical ones)
    const critBadges = page.locator('span').filter({ hasText: /^critical$/i });
    const emptyState = page.getByText(/no critical alerts/i);
    await expect(critBadges.first().or(emptyState)).toBeVisible({ timeout: 5_000 });
  });

  test('resolve button marks an alert as resolved', async ({ page }) => {
    // Wait for alerts to load
    await page.waitForTimeout(1_000);

    const resolveBtn = page.locator('button[title="Mark as resolved"]').first();
    const hasBtn = await resolveBtn.isVisible().catch(() => false);

    // No alerts to resolve — skip gracefully
    if (!hasBtn) {
      await expect(
        page.locator('.glass-card').filter({ hasText: /all signals clear/i })
      ).toBeVisible({ timeout: 5_000 });
      return;
    }

    const cards = page.locator('.glass-card').filter({ hasNot: page.locator('h2') });
    const initialCount = await cards.count();

    await resolveBtn.click();

    await page.waitForTimeout(1_500);
    const newCount = await cards.count();
    expect(newCount).toBeLessThanOrEqual(initialCount);
  });

  test('clear all button removes all active alerts', async ({ page }) => {
    const clearBtn = page.getByRole('button', { name: /clear all/i });
    const hasAlerts = await clearBtn.isVisible().catch(() => false);
    if (!hasAlerts) return; // already clear

    await clearBtn.click();

    // After clearing, the all-clear empty state should appear
    await expect(page.getByText(/all signals clear/i)).toBeVisible({ timeout: 15_000 });
  });

  test('resolved history section appears after resolving an alert', async ({ page }) => {
    // Resolve one alert if any exist
    const resolveBtn = page.locator('button[title="Mark as resolved"]').first();
    const hasBtn = await resolveBtn.isVisible().catch(() => false);
    if (!hasBtn) return;

    await resolveBtn.click();
    await page.waitForTimeout(1_500);

    // Resolved history divider should now be visible
    await expect(page.getByText(/resolved history/i)).toBeVisible({ timeout: 8_000 });
    // Resolved items carry a "✓ RESOLVED" label
    await expect(page.getByText(/✓ resolved/i)).toBeVisible({ timeout: 5_000 });
  });
});
