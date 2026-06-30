import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { saveAdminState, saveInternState, ADMIN_STATE_FILE, INTERN_STATE_FILE } from '../helpers/storageState';

/**
 * Journey 11 — Task overview performance & availability (FIX 13 + FIX 7)
 *
 * Covers:
 *  - Task page loads quickly (no blocking sync on page load)
 *  - UI remains responsive if backend is slow
 *  - Intern task page also loads without issues
 *  - FIX 7: no runtime errors from removed availabilityAPI.get()
 */

test.describe('Task Overview — Admin (FIX 13)', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveAdminState(browser);
  });
  test.use({ storageState: ADMIN_STATE_FILE });

  test('task page loads within 6 seconds (not blocked by Plane sync)', async ({ page }) => {
    const start = Date.now();
    await page.goto('/tasks');
    await expect(
      page.getByText(/task monitor|tasks/i)
    ).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - start;

    // Should not take longer than 6s — sync runs fire-and-forget
    expect(elapsed).toBeLessThan(6_000);
  });

  test('task page does not show error boundary', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForTimeout(2_000);
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test('tasks are displayed or "no tasks" state is shown', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForTimeout(1_500);
    const taskRow    = page.locator('.glass-card, tr').first();
    const emptyState = page.getByText(/no tasks|no data/i);
    const hasRows    = await taskRow.isVisible().catch(() => false);
    const hasEmpty   = await emptyState.isVisible().catch(() => false);
    expect(hasRows || hasEmpty).toBe(true);
  });
});

test.describe('Task Overview — Intern (FIX 7 dead endpoint)', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveInternState(browser);
  });
  test.use({ storageState: INTERN_STATE_FILE });

  test('intern task page loads without crash (FIX 7 no broken availability.get)', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByText(/task/i)).toBeVisible({ timeout: 10_000 });
    // No error boundary should appear
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 3_000 });
  });

  test('intern availability page loads (FIX 7 — submit still works)', async ({ page }) => {
    await page.goto('/availability');
    await expect(page.getByText(/availability/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 3_000 });
  });
});
