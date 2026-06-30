'use strict';

/**
 * cleanup-test-users.js
 * Removes remaining test/demo accounts (all @uris.com and other fake accounts)
 * that are not real employees.
 */

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// Real employee emails — these must NOT be removed
const REAL_EMAILS = new Set([
  'official@stemonef.org',
  'kajaljha@stemonef.org',
  'akshay.ravi@stemonef.org',
  'shashikushwaha@stemonef.org',
  'harini.rv.opsl@stemonef.org',
  'vishmithaarupa@gmail.com',
  'nksingh-fci-fo@stemonef.org',
  'gj-lead-p-gaia@epochs-stemonef.org',
  'subhashisdash-eios@epochs-stemonef.org',
  'tarkeshwar.sharma@steami.network',
  'ssh.ep.pg@gmail.com',
  'programmanagerrak@gmail.com',
  'anweshamohapatra11111@gmail.com',
  'ananyaseeta.stemonef@gmail.com',
  'ishaansenres@gmail.com',
  'sahilraj172303@gmail.com',
  'programmanagervs@gmail.com',
  'ppr.ep.pg@gmail.com',
  'pc.ep.pg@gmail.com',
  'np.ep.pg@gmail.com',
  'harshavardhanstem1@gmail.com',
  'lakshyaluvmimani@proton.me',
  'shruti.eios.alpha.evt.sil@gmail.com',
]);

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  URIS — Cleanup Test/Demo Users');
  console.log('═'.repeat(60) + '\n');

  // Get all users
  const allUsers = await p.user.findMany({
    select: { id: true, email: true, role: true, status: true },
  });

  // Identify test users (not in real emails list)
  const testUsers = allUsers.filter(u => !REAL_EMAILS.has(u.email));

  console.log(`Found ${testUsers.length} test/demo users to process:`);
  testUsers.forEach(u => console.log(`  - ${u.email} (${u.role}) [${u.status}]`));

  if (testUsers.length === 0) {
    console.log('  Nothing to clean up!');
    return;
  }

  let deleted = 0;
  let archived = 0;

  for (const user of testUsers) {
    try {
      // First try to archive/deactivate any linked intern tasks/alerts
      const intern = await p.intern.findUnique({ where: { userId: user.id } });
      
      if (intern) {
        // Clear tasks, alerts, scores for this intern
        await p.alert.deleteMany({ where: { internId: intern.id } });
        await p.scoreHistory.deleteMany({ where: { internId: intern.id } });
        await p.review.deleteMany({ where: { internId: intern.id } });
        await p.task.deleteMany({ where: { internId: intern.id } });
        await p.capacityScore.deleteMany({ where: { internId: intern.id } });
        await p.credibilityScore.deleteMany({ where: { internId: intern.id } });
        await p.internDigest.deleteMany({ where: { internId: intern.id } });
        await p.availabilitySlot.deleteMany({ where: { internId: intern.id } });
        await p.syncLog.deleteMany({ where: { internId: intern.id } });
        await p.intern.delete({ where: { id: intern.id } });
      }

      // Clear user relations
      await p.userTeam.deleteMany({ where: { userId: user.id } });
      await p.activity.deleteMany({ where: { userId: user.id } });
      await p.auditLog.updateMany({ where: { userId: user.id }, data: { userId: null } });
      await p.passwordResetToken.deleteMany({ where: { userId: user.id } });

      // Delete the user
      await p.user.delete({ where: { id: user.id } });
      console.log(`  ✓ Deleted: ${user.email}`);
      deleted++;
    } catch (err) {
      // Mark as archived if delete fails
      await p.user.update({
        where: { id: user.id },
        data: { status: 'archived' },
      });
      console.log(`  ⚠ Archived (could not delete): ${user.email} — ${err.message.split('\n')[0]}`);
      archived++;
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  Deleted: ${deleted} users`);
  console.log(`  Archived: ${archived} users`);
  console.log(`  Real employees kept: ${REAL_EMAILS.size}`);
  console.log('═'.repeat(60) + '\n');

  // Final count
  const finalCount = await p.user.count();
  const activeCount = await p.user.count({ where: { status: 'active' } });
  console.log(`  Total users remaining: ${finalCount} (${activeCount} active)\n`);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
