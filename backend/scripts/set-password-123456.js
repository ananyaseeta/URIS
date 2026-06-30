'use strict';

/**
 * set-password-123456.js
 * 
 * Sets all 23 imported employees' passwords to '123456'
 * and clears any test/fake users.
 * 
 * Usage: node scripts/set-password-123456.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const REAL_EMAILS = [
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
];

// Test/fake accounts to remove
const FAKE_EMAILS = [
  'admin@uris.com',
  'rahul@uris.com',
  'arjun@uris.com',
  'test@example.com',
  'fakeintern@test.com',
  'fakelead@test.com',
  'admin@test.com',
  'user@test.com',
];

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  URIS — Set Passwords to 123456');
  console.log('  Run: ' + new Date().toISOString());
  console.log('═'.repeat(60) + '\n');

  // Step 1: Disable fake/test users (mark inactive instead of delete to avoid FK constraint issues)
  console.log('Step 1: Disabling fake/test users...');
  let removedCount = 0;
  for (const email of FAKE_EMAILS) {
    try {
      // Try to delete — works if no related records exist
      const result = await prisma.user.deleteMany({ where: { email } });
      if (result.count > 0) {
        console.log(`  ✓ Deleted: ${email}`);
        removedCount += result.count;
      }
    } catch (err) {
      // Has related records — mark as archived/inactive instead
      const result = await prisma.user.updateMany({
        where: { email },
        data: { status: 'archived' },
      });
      if (result.count > 0) {
        console.log(`  ⚠ Archived (has relations): ${email}`);
        removedCount += result.count;
      }
    }
  }
  console.log(`  → ${removedCount} fake users removed/archived\n`);

  // Step 2: Hash new password
  console.log('Step 2: Hashing new password (123456)...');
  const hashedPassword = await bcrypt.hash('123456', 10);
  console.log('  ✓ Password hashed\n');

  // Step 3: Update passwords for all real employees
  console.log('Step 3: Setting passwords for all 23 employees...');
  
  const result = await prisma.user.updateMany({
    where: {
      email: { in: REAL_EMAILS },
    },
    data: {
      password: hashedPassword,
      mustChangePassword: true,  // Force password change on first login
      status: 'active',           // Ensure all are active
    },
  });

  console.log(`  ✓ Updated ${result.count} users\n`);

  // Step 4: Verify all users exist and check status
  console.log('Step 4: Verifying all users...');
  const users = await prisma.user.findMany({
    where: { email: { in: REAL_EMAILS } },
    select: { name: true, email: true, role: true, status: true, mustChangePassword: true },
    orderBy: { name: 'asc' },
  });

  const roleCount = {};
  for (const u of users) {
    roleCount[u.role] = (roleCount[u.role] || 0) + 1;
    console.log(`  ✓ ${u.name} (${u.email}) — ${u.role} — ${u.status}`);
  }

  // Step 5: Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Total users updated: ${result.count}`);
  console.log(`  Fake users removed:  ${removedCount}`);
  console.log('\n  Role distribution:');
  for (const [role, count] of Object.entries(roleCount)) {
    console.log(`    • ${role}: ${count}`);
  }
  
  const missingEmails = REAL_EMAILS.filter(e => !users.find(u => u.email === e));
  if (missingEmails.length > 0) {
    console.log('\n  ⚠️  Missing users (not in database):');
    missingEmails.forEach(e => console.log(`    ✗ ${e}`));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ DONE!');
  console.log('\n  Login credentials:');
  console.log('    Password: 123456');
  console.log('    Users must change password on first login');
  console.log('\n  Admin login:');
  console.log('    Email: official@stemonef.org');
  console.log('    Email: kajaljha@stemonef.org');
  console.log('    Email: nksingh-fci-fo@stemonef.org');
  console.log('    Password: 123456');
  console.log('═'.repeat(60) + '\n');
}

main()
  .catch(err => {
    console.error('\n❌ Script failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
