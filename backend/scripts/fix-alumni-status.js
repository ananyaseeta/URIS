'use strict';
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Fix: PAST_EMPLOYEE users should have status='alumni', not 'active'
  const result = await p.user.updateMany({
    where: { role: 'PAST_EMPLOYEE', status: { not: 'alumni' } },
    data: { status: 'alumni' },
  });
  console.log(`Updated ${result.count} PAST_EMPLOYEE users → status=alumni`);

  // Verify
  const alumni = await p.user.findMany({
    where: { role: 'PAST_EMPLOYEE' },
    select: { email: true, role: true, status: true },
  });
  alumni.forEach(u => console.log(`  ${u.email} | ${u.role} | ${u.status}`));
}

main().catch(console.error).finally(() => p.$disconnect());
