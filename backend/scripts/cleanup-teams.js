const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting Team and UserTeam cleanup...');
  
  // Delete UserTeam assignments
  const userTeamDeleteCount = await prisma.userTeam.deleteMany({});
  console.log(`Deleted ${userTeamDeleteCount.count} UserTeam assignments.`);
  
  // Delete Teams
  const teamDeleteCount = await prisma.team.deleteMany({});
  console.log(`Deleted ${teamDeleteCount.count} Teams.`);
  
  console.log('Cleanup finished successfully.');
}

main()
  .catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
