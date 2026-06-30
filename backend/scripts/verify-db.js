'use strict';
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const total = await p.user.count();
  console.log('Total users in DB:', total);
  
  const users = await p.user.findMany({
    select: { email: true, role: true, status: true },
    orderBy: { role: 'asc' },
  });
  
  console.log('\nAll users:');
  users.forEach(u => console.log(' ', u.status, '|', u.role.padEnd(30), '|', u.email));
  
  const activeCount = users.filter(u => u.status === 'active').length;
  const archivedCount = users.filter(u => u.status === 'archived').length;
  const alumniCount = users.filter(u => u.status === 'alumni').length;
  
  console.log(`\nActive: ${activeCount}, Archived: ${archivedCount}, Alumni: ${alumniCount}`);
  console.log('\nAdmin users:');
  users.filter(u => u.role === 'CORE_ADMIN').forEach(u => console.log(' ', u.email));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
