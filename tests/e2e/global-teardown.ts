/**
 * global-teardown.ts
 *
 * Runs once after all Playwright tests complete.
 * Clears the Neon keep-alive interval started by global-setup.
 */

import fs from 'fs';
import { KEEPALIVE_STATE_FILE } from './global-setup.js';

export default async function globalTeardown(): Promise<void> {
  // Clear the interval stored on global by global-setup
  const interval = (global as Record<string, unknown>).__neonKeepaliveInterval;
  if (interval) {
    clearInterval(interval as ReturnType<typeof setInterval>);
    console.log('[global-teardown] Neon keep-alive stopped.');
  }

  // Clean up state file
  try { fs.rmSync(KEEPALIVE_STATE_FILE, { force: true }); } catch { /* ignore */ }
}
