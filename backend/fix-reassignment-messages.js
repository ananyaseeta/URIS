/**
 * One-time migration: update existing reassignment alert messages
 * that contain raw intern UUIDs to use human-readable names.
 *
 * Run: node fix-reassignment-messages.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function getInternName(internId) {
  try {
    const intern = await p.intern.findUnique({
      where: { id: internId },
      include: { user: { select: { name: true, email: true } } },
    });
    return intern?.user?.name
      || intern?.user?.email?.split('@')[0]
      || null;
  } catch {
    return null;
  }
}

async function main() {
  // Get all alerts whose messages still contain a UUID
  const alerts = await p.alert.findMany({
    where: { type: 'reassignment' },
  });

  console.log(`Found ${alerts.length} reassignment alerts`);

  let updated = 0;
  for (const alert of alerts) {
    if (!UUID_RE.test(alert.message)) {
      // Already has a name or no UUID — skip
      continue;
    }

    const name = await getInternName(alert.internId);
    if (!name) {
      console.log(`  Skipping ${alert.id} — intern not found for id ${alert.internId}`);
      continue;
    }

    // Extract capacity score from the old message
    const scoreMatch = alert.message.match(/capacity score of (\d+)/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

    const newMessage = `${name} has a final capacity score of ${score}. Consider reassigning active tasks.`;

    await p.alert.update({
      where: { id: alert.id },
      data: { message: newMessage },
    });

    console.log(`  ✓ ${alert.id.slice(0, 8)}... → "${newMessage}"`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated}/${alerts.length} reassignment alerts.`);
}

main().catch(console.error).finally(() => p.$disconnect());
