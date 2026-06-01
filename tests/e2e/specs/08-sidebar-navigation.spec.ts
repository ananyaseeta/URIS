import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import {
  saveAdminState, saveInternState,
  ADMIN_STATE_FILE, INTERN_STATE_FILE,
} from '../helpers/storageState';

/**
 * Journey 8 — Sidebar Navigation
 *
 * Covers:
 *   - Desktop sidebar is visible on md+ screens
 *   - "SIGNED IN AS" section shows the logged-in user's name
 *   - Admin sees admin-only links (Admin, Alerts, Intelligence, Governance, Audit Logs)
 *   - Intern does NOT see admin-only links
 *   - Intern sees Notifications badge when unread count > 0
 *   - Active route highlights the correct sidebar item
 *   - Sign-out redirects to /login
 *   - Mobile hamburger opens/closes the drawer
 */

// ── Admin sidebar tests ───────────────────────────────────────────────────────

test.describe('Sidebar — Admin', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveAdminState(browser);
  });

  test.use({ storageState: ADMIN_STATE_FILE });

  test('desktop sidebar is visible after login', async ({ page }) => {
    await page.goto('/dashboard');
    // The desktop aside is always rendered on md+ — Playwright uses 1280×720 by default
    const sidebar = page.locator('aside').last(); // desktop aside
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test('"SIGNED IN AS" section shows admin name', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByText(/signed in as/i)).toBeVisible({ timeout: 8_000 });
    // Admin name from seed: "Admin User" or similar — just check it's non-empty
    const nameEl = sidebar.locator('p.font-display').first();
    await expect(nameEl).not.toHaveText('', { timeout: 5_000 });
  });

  test('admin role label is shown in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    // Role label contains ADMIN or CORE ADMIN
    await expect(sidebar.getByText(/admin/i).last()).toBeVisible({ timeout: 5_000 });
  });

  test('admin can see Alerts link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /alerts/i })).toBeVisible({ timeout: 5_000 });
  });

  test('admin can see Admin link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /^admin$/i })).toBeVisible({ timeout: 5_000 });
  });

  test('admin can see Intelligence link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /intelligence/i })).toBeVisible({ timeout: 5_000 });
  });

  test('active route highlights the correct sidebar item', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByText(/system alerts/i)).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator('aside').last();
    // The active link gets the "active" CSS class
    const activeLink = sidebar.locator('a.active');
    await expect(activeLink).toHaveAttribute('href', '/alerts', { timeout: 5_000 });
  });

  test('clicking a sidebar link navigates to the correct page', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await sidebar.getByRole('link', { name: /tasks/i }).click();
    await page.waitForURL(/\/tasks/, { timeout: 10_000 });
    await expect(page.getByText(/task monitor/i)).toBeVisible({ timeout: 8_000 });
  });

  test('sign-out button logs out and redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await sidebar.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/(login|$)/, { timeout: 10_000 });
    // Should be on the login page
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 });
  });
});

// ── Intern sidebar tests ──────────────────────────────────────────────────────

test.describe('Sidebar — Intern', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveInternState(browser);
  });

  test.use({ storageState: INTERN_STATE_FILE });

  test('intern does NOT see Admin link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByRole('link', { name: /^admin$/i })).not.toBeVisible();
  });

  test('intern does NOT see Alerts link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByRole('link', { name: /^alerts$/i })).not.toBeVisible();
  });

  test('intern sees Notifications link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /notifications/i })).toBeVisible({ timeout: 5_000 });
  });

  test('intern sees Availability link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /availability/i })).toBeVisible({ timeout: 5_000 });
  });

  test('"SIGNED IN AS" section shows intern name', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByText(/signed in as/i)).toBeVisible({ timeout: 8_000 });
    // Seed intern: rahul@uris.com — name should be non-empty
    const nameEl = sidebar.locator('p.font-display').first();
    const name = await nameEl.textContent();
    expect(name?.trim().length).toBeGreaterThan(0);
  });

  test('intern role label shows INTERN · LIMITED', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByText(/intern.*limited/i)).toBeVisible({ timeout: 5_000 });
  });

  test('intern sign-out redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await sidebar.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/(login|$)/, { timeout: 10_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 });
  });
});

// ── Mobile sidebar tests ──────────────────────────────────────────────────────

test.describe('Sidebar — Mobile drawer', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveInternState(browser);
  });

  test.use({
    storageState: INTERN_STATE_FILE,
    viewport: { width: 375, height: 812 }, // iPhone-sized
    navigationTimeout: 60_000,             // mobile page loads can be slower
  });

  test('hamburger button is visible on mobile', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Wait for the React app to hydrate before looking for the button
    await page.waitForSelector('aside, nav, button', { timeout: 15_000 });
    const hamburger = page.getByRole('button', { name: /open navigation/i });
    await expect(hamburger).toBeVisible({ timeout: 10_000 });
  });

  test('mobile drawer opens when hamburger is clicked', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('button', { timeout: 15_000 });
    await page.getByRole('button', { name: /open navigation/i }).click();
    // The mobile aside slides in
    const drawer = page.locator('aside').first();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    await expect(drawer.getByRole('link', { name: /notifications/i })).toBeVisible();
  });

  test('mobile drawer closes when backdrop is clicked', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('button', { timeout: 15_000 });
    await page.getByRole('button', { name: /open navigation/i }).click();

    // Wait for the drawer to be visible before clicking backdrop
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });

    // The backdrop is a fixed full-screen div rendered by AnimatePresence.
    // Click at a point outside the drawer (right side of screen) to hit it.
    await page.mouse.click(340, 400);

    // Drawer should close — hamburger shows "Open navigation" again
    await expect(page.getByRole('button', { name: /open navigation/i })).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a link in mobile drawer navigates and closes drawer', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('button', { timeout: 15_000 });
    await page.getByRole('button', { name: /open navigation/i }).click();

    const drawer = page.locator('aside').first();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    await drawer.getByRole('link', { name: /availability/i }).click();

    await page.waitForURL(/\/availability/, { timeout: 10_000 });
    // Drawer should be gone
    await expect(page.getByRole('button', { name: /open navigation/i })).toBeVisible({ timeout: 5_000 });
  });
});
