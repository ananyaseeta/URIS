/**
 * storageState.ts
 *
 * Saves browser storage state (cookies + localStorage) by calling the
 * backend login API directly — no UI login, no rate-limiter hits.
 *
 * The JWT is injected into localStorage under the key the frontend uses
 * (uris_auth → { state: { token, user, isAuthenticated } }).
 * Playwright then reuses this state for every test in the spec file.
 *
 * Usage in a spec file:
 *
 *   test.use({ storageState: ADMIN_STATE_FILE });
 *
 *   test.beforeAll(async ({ browser }) => {
 *     await saveAdminState(browser);
 *   });
 */

import type { Browser } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ADMIN_EMAIL, INTERN_EMAIL, PASSWORD } from './auth';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const AUTH_DIR          = path.join(__dirname, '../.auth');
export const ADMIN_STATE_FILE  = path.join(AUTH_DIR, 'admin.json');
export const INTERN_STATE_FILE = path.join(AUTH_DIR, 'intern.json');

// Backend URL — matches the webServer config in playwright.config.ts
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:5000';
// Frontend origin — used as the localStorage origin key
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Pre-create the .auth directory and placeholder files so Playwright can
// reference them via test.use({ storageState }) before beforeAll runs.
fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(ADMIN_STATE_FILE)) {
  fs.writeFileSync(ADMIN_STATE_FILE,  JSON.stringify({ cookies: [], origins: [] }));
}
if (!fs.existsSync(INTERN_STATE_FILE)) {
  fs.writeFileSync(INTERN_STATE_FILE, JSON.stringify({ cookies: [], origins: [] }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the state file already contains a real session
 * (written by a previous beforeAll in the same Playwright run).
 */
function _hasValidSession(stateFile: string): boolean {
  try {
    const raw    = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as { cookies?: unknown[]; origins?: unknown[] };
    return (parsed.cookies?.length ?? 0) > 0 || (parsed.origins?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Calls the backend /auth/login endpoint directly (no browser UI),
 * then injects the JWT into a real browser context's localStorage so
 * Playwright can save it as a storageState file.
 *
 * This approach:
 *  - Never touches the login page → zero rate-limiter hits
 *  - Works regardless of how the backend was started
 *  - Is fast (~200 ms vs 3–5 s for UI login)
 */
async function saveState(
  browser: Browser,
  email: string,
  stateFile: string,
): Promise<void> {
  // ── 1. Call the login API directly ──────────────────────────────────────────
  let token: string;
  let user: Record<string, unknown>;

  // Retry up to 3 times in case the backend is still warming up
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password: PASSWORD }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Login API returned ${res.status}: ${body}`);
      }

      const json = await res.json() as {
        data: { token: string; user: Record<string, unknown> };
      };
      token = json.data.token;
      user  = json.data.user;
      break; // success
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        // Wait before retrying (backend may still be starting)
        await new Promise(r => setTimeout(r, 3_000 * attempt));
      }
    }
  }

  if (!token! || !user!) {
    throw new Error(
      `Failed to obtain auth token after 3 attempts. Last error: ${lastErr}`
    );
  }

  // ── 2. Inject the token into a real browser context ──────────────────────────
  // The frontend stores auth state in localStorage under the key "uris_auth"
  // using Zustand's persist middleware (see frontend/src/store/authStore.ts).
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Navigate to the frontend so we're on the right origin before writing localStorage
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.evaluate(
    ({ token, user }) => {
      const authState = {
        state: {
          token,
          user,
          isAuthenticated: true,
        },
        version: 0,
      };
      localStorage.setItem('uris_auth', JSON.stringify(authState));
    },
    { token: token!, user: user! },
  );

  // ── 3. Save the storage state ────────────────────────────────────────────────
  await context.storageState({ path: stateFile });
  await context.close();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveAdminState(browser: Browser): Promise<void> {
  if (_hasValidSession(ADMIN_STATE_FILE)) return;
  await saveState(browser, ADMIN_EMAIL, ADMIN_STATE_FILE);
}

export async function saveInternState(browser: Browser): Promise<void> {
  if (_hasValidSession(INTERN_STATE_FILE)) return;
  await saveState(browser, INTERN_EMAIL, INTERN_STATE_FILE);
}
