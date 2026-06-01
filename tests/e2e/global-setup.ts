/**
 * global-setup.ts
 *
 * Runs once before all Playwright tests.
 *
 * Problem: Neon free tier suspends after 5 min of inactivity.
 * The test suite takes ~7 min, so the DB goes to sleep mid-run.
 *
 * Solution:
 * 1. Wake the DB before tests start
 * 2. Keep it awake by pinging every 3 min via a shared state file
 *    that global-teardown reads to stop the interval
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const BACKEND_URL  = process.env.BACKEND_URL ?? 'http://localhost:5000';
const MAX_ATTEMPTS = 20;
const RETRY_MS     = 3_000;
const KEEPALIVE_MS = 3 * 60 * 1000; // every 3 min — well under Neon's 5 min threshold

// Store the interval ID so teardown can clear it
export const KEEPALIVE_STATE_FILE = path.join(__dirname, '.keepalive-active');

async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: 'keepalive@neon.test', password: 'keepalive' }),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForBackend(): Promise<void> {
  console.log('\n[global-setup] Waiting for backend + DB to be ready...');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
      // /health/ready checks both Express AND the database connection
      const res = await fetch(`${BACKEND_URL}/health/ready`);
      if (res.ok) { console.log(`[global-setup] Backend + DB ready (attempt ${i})`); return; }
      const body = await res.text().catch(() => '');
      console.log(`[global-setup] Not ready yet (HTTP ${res.status}): ${body.slice(0, 80)}`);
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, RETRY_MS));
  }
  throw new Error('[global-setup] Backend did not start in time');
}

async function wakeDatabase(): Promise<void> {
  console.log('[global-setup] Waking Neon database...');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    if (await ping()) {
      console.log(`[global-setup] Database awake (attempt ${i})`);
      await new Promise(r => setTimeout(r, 1_500)); // let connection pool settle
      return;
    }
    console.log(`[global-setup] DB still cold-starting... (${i}/${MAX_ATTEMPTS})`);
    await new Promise(r => setTimeout(r, RETRY_MS));
  }
  console.warn('[global-setup] WARNING: DB may still be waking. Tests could be flaky.');
}

export default async function globalSetup(): Promise<void> {
  await waitForBackend();
  await wakeDatabase();

  // Start keep-alive interval — runs in this same Node process
  // Playwright keeps global-setup's module alive until globalTeardown runs
  let pingCount = 0;
  const interval = setInterval(async () => {
    pingCount++;
    const ok = await ping();
    console.log(`[neon-keepalive] ping #${pingCount} → ${ok ? 'DB awake' : 'DB may be sleeping!'}`);
  }, KEEPALIVE_MS);

  // Write interval ID to a temp file so teardown can signal us to stop
  // (We store the interval ref in a global so teardown can clear it)
  (global as Record<string, unknown>).__neonKeepaliveInterval = interval;
  fs.writeFileSync(KEEPALIVE_STATE_FILE, 'active');

  console.log(`[global-setup] Keep-alive running every ${KEEPALIVE_MS / 60000} min. Starting tests.\n`);
}
