const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const result = await p.alert.updateMany({
    where: {
      type: { in: ['integration_inactivity', 'integration_delivery_risk', 'integration_collaboration_risk'] },
      resolved: false,
    },
    data: { resolved: true },
  });
  console.log('Resolved:', result.count, 'integration alerts');
}

main().catch(console.error).finally(() => p.$disconnect());
