/**
 * clear-seeded-alerts.js
 *
 * One-time migration: removes all stale_task alerts whose message text
 * contains "Please update your progress" — these were created by the seed
 * script with intern-addressed language and are now showing up incorrectly
 * in the admin feed.
 *
 * Also removes any seeded alerts created for the three demo intern accounts
 * (rahul@uris.com, priya@uris.com, arjun@uris.com) that were inserted
 * by the seed script with hardcoded messages.
 *
 * Run once: node clear-seeded-alerts.js
 */

'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('Clearing seeded/demo alerts...\n');

  // 1. Remove stale_task alerts with old intern-addressed message format
  //    ("Please update your progress" was the seeded phrasing)
  const staleResult = await prisma.alert.deleteMany({
    where: {
      type:    'stale_task',
      message: { contains: 'Please update your progress' },
    },
  });
  console.log(`✓ Deleted ${staleResult.count} stale_task alerts with old message format`);

  // 2. Remove any alert whose message matches the exact seeded text patterns
  const seededMessages = [
    'Task "Write unit tests for auth service" has not been updated in 2+ days and the deadline is approaching.',
    'Task "Build REST API for user module" has not been updated in 2+ days and the deadline is approaching.',
    'Task "Design database schema for analytics" has not been updated in 2+ days and the deadline is approaching.',
    'Task "Build anomaly detection service" has not been updated in 2+ days and the deadline is approaching.',
  ];

  for (const msg of seededMessages) {
    const r = await prisma.alert.deleteMany({ where: { message: msg } });
    if (r.count > 0) console.log(`✓ Deleted ${r.count} alert: "${msg.slice(0, 60)}..."`);
  }

  // 3. Remove all alerts linked to the three seed intern accounts
  //    (identified by their well-known email addresses)
  const seedEmails = ['rahul@uris.com', 'priya@uris.com', 'arjun@uris.com'];
  for (const email of seedEmails) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { intern: { select: { id: true } } },
    });
    if (user?.intern?.id) {
      const r = await prisma.alert.deleteMany({
        where: { internId: user.intern.id },
      });
      if (r.count > 0) console.log(`✓ Deleted ${r.count} seeded alerts for ${email}`);
    }
  }

  console.log('\n✅ Done. All seeded alerts removed.');
}

run()
  .catch(err => { console.error('Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
