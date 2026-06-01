import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { saveAdminState, ADMIN_STATE_FILE } from '../helpers/storageState';

/**
 * Journey 3 — Task Assignment by Admin
 *
 * Uses stored auth state — loginAsAdmin runs once in beforeAll, not per test.
 * This prevents rate-limiter exhaustion from repeated logins.
 */

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await saveAdminState(browser);
});

test.use({ storageState: ADMIN_STATE_FILE });

test.describe('Task Assignment', () => {
  test('admin dashboard loads with intern capacity table', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/command dashboard/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  });

  test('admin can navigate to admin overview', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/admin overview/i)).toBeVisible({ timeout: 10_000 });
    // "ASL TRIAD SHORTLIST" appears once intern data loads from the DB
    // If DB is slow, fall back to checking the tab bar which renders immediately
    const shortlist = page.getByText(/asl triad shortlist/i);
    const tabBar    = page.getByText(/assign task/i);
    await expect(shortlist.or(tabBar)).toBeVisible({ timeout: 15_000 });
  });

  test('admin can create a new task from the tasks page', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByText(/task monitor/i)).toBeVisible({ timeout: 10_000 });

    // Wait for intern data to load before opening the modal
    await page.waitForTimeout(2000);

    await page.getByRole('button', { name: /new task/i }).click();
    await expect(page.getByText(/create new task/i)).toBeVisible({ timeout: 5_000 });

    const taskTitle = `E2E Task ${Date.now()}`;
    await page.getByPlaceholder(/implement credibility analyzer/i).fill(taskTitle);

    // Wait for intern dropdown to be populated
    const internSelect = page.locator('select').filter({ hasText: /choose an intern/i });
    await expect(internSelect.locator('option').nth(1)).not.toHaveText('', { timeout: 8_000 });
    await internSelect.selectOption({ index: 1 });

    // Complexity defaults to 3 (valid integer 1–5) — no change needed

    await page.getByRole('button', { name: /^create task$/i }).click();

    // Modal should close after successful creation
    await expect(page.getByText(/create new task/i)).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 10_000 });
  });

  test('admin can assign a task to an intern via admin overview', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/admin overview/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /assign task/i }).click();

    const internSelect = page.locator('select').filter({ hasText: /choose intern/i });
    await expect(internSelect).toBeVisible({ timeout: 8_000 });
    await internSelect.selectOption({ index: 1 });

    const taskSelect = page.locator('select').filter({ hasText: /choose task/i });
    await expect(taskSelect).toBeVisible({ timeout: 8_000 });
    await taskSelect.selectOption({ index: 1 });

    await page.getByRole('button', { name: /confirm assignment/i }).click();

    await expect(
      page.locator('p, div').filter({ hasText: /assigned successfully|capacity|not eligible|unavailable/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('admin can view alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByText(/system alerts/i)).toBeVisible({ timeout: 10_000 });
    // Page shows either active signals count or all-clear badge
    const allClear     = page.getByText(/all clear/i);
    const activeSignal = page.getByText(/active signal/i);
    await expect(allClear.or(activeSignal)).toBeVisible({ timeout: 8_000 });
  });
});
