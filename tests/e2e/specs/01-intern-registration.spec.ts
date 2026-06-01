import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Journey 1 — Intern Registration
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Unique email per test run so re-runs don't collide
const NEW_INTERN_EMAIL = `e2e_intern_${Date.now()}@test.com`;
const NEW_INTERN_NAME  = 'E2E Test Intern';
const PASSWORD         = 'password123';

// A small placeholder image for the required profile picture field
const PLACEHOLDER_IMAGE = path.join(__dirname, '../fixtures/placeholder.jpg');

test.describe('Intern Registration', () => {
  test('new intern can register and is redirected to availability', async ({ page }) => {
    await page.goto('/register');

    // Fill name, email, password
    await page.locator('input[type="text"]').first().fill(NEW_INTERN_NAME);
    await page.locator('input[type="email"]').fill(NEW_INTERN_EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);

    // Role is a <select> — TECHNICAL_INTERN is the default, no change needed

    // Upload a profile picture (required field)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PLACEHOLDER_IMAGE);

    await page.getByRole('button', { name: /create account/i }).click();

    // New interns go through approval flow OR land on /availability
    // Accept either outcome
    await Promise.race([
      page.waitForURL(/\/availability/, { timeout: 20_000 }),
      expect(page.getByText(/access requested|pending approval/i)).toBeVisible({ timeout: 20_000 }),
    ]);
  });

  test('registered intern name appears in the sidebar', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(NEW_INTERN_EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /enter system/i }).click();

    // May land on /availability, /dashboard, or stay on /login if pending approval
    await page.waitForTimeout(3_000);
    const url = page.url();

    if (url.includes('/login')) {
      // Account is pending approval — skip sidebar check
      test.skip();
      return;
    }

    const sidebar = page.locator('aside').last();
    await expect(sidebar).toBeVisible({ timeout: 8_000 });
    await expect(sidebar).toContainText(/e2e test intern|e2e_intern/i, { timeout: 5_000 });
  });

  test('registering with an existing email shows an error', async ({ page }) => {
    await page.goto('/register');

    await page.locator('input[type="text"]').first().fill('Duplicate User');
    await page.locator('input[type="email"]').fill(NEW_INTERN_EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);

    // Upload a profile picture so the form can submit
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PLACEHOLDER_IMAGE);

    await page.getByRole('button', { name: /create account/i }).click();

    // Should stay on /register
    await expect(page).toHaveURL(/\/register/, { timeout: 8_000 });

    // Error message appears — match any error paragraph
    await expect(
      page.locator('p').filter({ hasText: /already exists|too many|failed|error/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});
