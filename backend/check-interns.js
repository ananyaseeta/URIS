const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const interns = await p.intern.findMany({ include: { user: true } });
  console.log('Intern records:', interns.length);
  interns.forEach(i => {
    console.log(`  - ${i.user?.name} (${i.user?.email}) | capacity: ${i.capacityScore} | credibility: ${i.credibilityScore}`);
  });

  const users = await p.user.findMany({ select: { name: true, email: true, role: true, status: true } });
  console.log('\nAll users:', users.length);
  users.forEach(u => console.log(`  - ${u.name} (${u.email}) | role: ${u.role} | status: ${u.status}`));
}

main().catch(console.error).finally(() => p.$disconnect());
