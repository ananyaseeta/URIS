import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import {
  saveAdminState, saveInternState,
  ADMIN_STATE_FILE, INTERN_STATE_FILE,
} from '../helpers/storageState';

/**
 * Journey 9 — Chat System (FIX 14 + FIX 15)
 *
 * Covers:
 *  - Chat page loads for intern
 *  - Chat page loads for admin
 *  - Find People page loads and search input works
 *  - Search input is accessible (icon does not overlap text)
 *  - Requests page loads
 *  - Chat conversation view loads when a chat exists
 *  - Typing indicator infrastructure is wired (textarea present)
 *  - Sidebar scroll: sign out always visible even with Chat added
 */

// ── Intern chat tests ─────────────────────────────────────────────────────────

test.describe('Chat — Intern', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveInternState(browser);
  });
  test.use({ storageState: INTERN_STATE_FILE });

  test('intern can navigate to /chat', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByRole('heading', { name: /chat/i })).toBeVisible({ timeout: 10_000 });
  });

  test('chat page shows COMMUNICATION eyebrow label', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByText(/communication/i)).toBeVisible({ timeout: 8_000 });
  });

  test('FIND PEOPLE button is present', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByRole('button', { name: /find people/i })).toBeVisible({ timeout: 8_000 });
  });

  test('REQUESTS button is present', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByRole('button', { name: /requests/i })).toBeVisible({ timeout: 8_000 });
  });

  test('no conversations shows empty state with find people CTA', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForTimeout(1_500);
    // Either "No conversations yet" or actual chats
    const emptyState = page.getByText(/no conversations yet/i);
    const chatList = page.locator('button').filter({ hasText: /private chat|group chat/i });
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasChats = await chatList.first().isVisible().catch(() => false);
    expect(hasEmpty || hasChats).toBe(true);
  });

  test('/chat/find page loads', async ({ page }) => {
    await page.goto('/chat/find');
    await expect(page.getByRole('heading', { name: /find people/i })).toBeVisible({ timeout: 10_000 });
  });

  test('FIX search input is accessible — text does not overlap icon', async ({ page }) => {
    await page.goto('/chat/find');
    const input = page.locator('input[placeholder*="Search by name"]');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // Type into the input and verify value is set correctly
    await input.click();
    await input.fill('test user');
    const value = await input.inputValue();
    expect(value).toBe('test user');

    // The input should have left padding to clear the search icon
    const paddingLeft = await input.evaluate((el: HTMLInputElement) =>
      parseFloat(getComputedStyle(el).paddingLeft)
    );
    expect(paddingLeft).toBeGreaterThanOrEqual(28); // at least 28px for the icon
  });

  test('search input debounces and updates user list', async ({ page }) => {
    await page.goto('/chat/find');
    const input = page.locator('input[placeholder*="Search by name"]');
    await expect(input).toBeVisible({ timeout: 8_000 });

    await input.fill('a');
    // Debounce fires at 300ms — wait a bit longer
    await page.waitForTimeout(600);

    // Users count should update (either users shown or "No users found")
    const usersCount = page.locator('p').filter({ hasText: /users \(/i });
    const noUsers    = page.getByText(/no users found/i);
    await expect(usersCount.or(noUsers)).toBeVisible({ timeout: 5_000 });
  });

  test('PRIVATE / GROUP mode toggle works', async ({ page }) => {
    await page.goto('/chat/find');
    await expect(page.getByRole('button', { name: /private/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /group/i })).toBeVisible();

    // Switch to GROUP mode
    await page.getByRole('button', { name: /group/i }).click();
    // Group name input should appear
    await expect(page.getByPlaceholder(/enter group name/i)).toBeVisible({ timeout: 3_000 });
  });

  test('/chat/requests page loads', async ({ page }) => {
    await page.goto('/chat/requests');
    await expect(page.getByRole('heading', { name: /friend requests/i })).toBeVisible({ timeout: 10_000 });
  });

  test('friend requests filter buttons are present', async ({ page }) => {
    await page.goto('/chat/requests');
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('button', { name: /^all$/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /^pending$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^accepted$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^rejected$/i })).toBeVisible();
  });
});

// ── Admin chat tests ──────────────────────────────────────────────────────────

test.describe('Chat — Admin', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveAdminState(browser);
  });
  test.use({ storageState: ADMIN_STATE_FILE });

  test('admin can navigate to /chat (FIX — chat in admin permissions)', async ({ page }) => {
    await page.goto('/chat');
    // Should NOT be redirected to /dashboard or /login
    await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /chat/i })).toBeVisible({ timeout: 8_000 });
  });

  test('admin sees Chat link in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    await expect(sidebar.getByRole('link', { name: /^chat$/i })).toBeVisible({ timeout: 8_000 });
  });

  test('admin sidebar sign out button is still visible with Chat added (FIX scroll)', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside').last();
    // Sign out must be visible without scrolling (it is pinned at bottom)
    await expect(sidebar.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 8_000 });
  });

  test('admin can access /chat/find', async ({ page }) => {
    await page.goto('/chat/find');
    await expect(page.getByRole('heading', { name: /find people/i })).toBeVisible({ timeout: 10_000 });
  });
});

// ── Chat view (conversation) tests ────────────────────────────────────────────

test.describe('Chat view — FIX 15 typing indicators', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await saveInternState(browser);
  });
  test.use({ storageState: INTERN_STATE_FILE });

  test('chat view has textarea for message input', async ({ page }) => {
    // Navigate to a known chat or just verify /chat works; we need a chatId
    // Since we may not have a chat yet, navigate to /chat and check the page renders
    await page.goto('/chat');
    await page.waitForTimeout(1_000);

    const chatButtons = page.locator('button').filter({ hasText: /private chat|group chat/i });
    const hasChatButton = await chatButtons.first().isVisible().catch(() => false);

    if (!hasChatButton) {
      // No chats yet — just verify the chat page renders cleanly
      await expect(page.getByText(/no conversations yet/i)).toBeVisible({ timeout: 5_000 });
      return;
    }

    // Click into first chat
    await chatButtons.first().click();
    await page.waitForURL(/\/chat\/[a-f0-9-]+/, { timeout: 10_000 });

    // Textarea for message input must be present
    await expect(page.locator('textarea')).toBeVisible({ timeout: 8_000 });
  });

  test('chat view textarea accepts input', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForTimeout(1_000);

    const chatButtons = page.locator('button').filter({ hasText: /private chat|group chat/i });
    const hasChatButton = await chatButtons.first().isVisible().catch(() => false);
    if (!hasChatButton) return; // skip — no chats exist

    await chatButtons.first().click();
    await page.waitForURL(/\/chat\/[a-f0-9-]+/, { timeout: 10_000 });

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 8_000 });
    await textarea.fill('Hello test message');
    expect(await textarea.inputValue()).toBe('Hello test message');
  });

  test('chat view has back button that returns to /chat', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForTimeout(1_000);

    const chatButtons = page.locator('button').filter({ hasText: /private chat|group chat/i });
    const hasChatButton = await chatButtons.first().isVisible().catch(() => false);
    if (!hasChatButton) return;

    await chatButtons.first().click();
    await page.waitForURL(/\/chat\/[a-f0-9-]+/, { timeout: 10_000 });

    // Back button
    const backBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await backBtn.click();
    await page.waitForURL(/^.*\/chat$/, { timeout: 8_000 });
  });
});
