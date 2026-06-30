/**
 * Import actual employee data from the provided spreadsheet
 * Removes test/fake data and imports real users
 * All passwords set to '123456' (users must change on first login)
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// Actual employee data from the spreadsheet
const actualUsers = [
  { name: 'Vikas', phone: '7607768385', email: 'official@stemonef.org', role: 'CORE_ADMIN', department: 'Core' },
  { name: 'Kajal Jha', phone: '9987889324', email: 'kajaljha@stemonef.org', role: 'CORE_ADMIN', department: 'Core' },
  { name: 'Akshay Ravi', phone: '7303184448', email: 'akshay.ravi@stemonef.org', role: 'RESEARCH_LEAD', department: 'Silvapure' },
  { name: 'Shashi', phone: '7061803944', email: 'shashikushwaha@stemonef.org', role: 'TECHNICAL_INTERN', department: 'Steami' },
  { name: 'Harini', phone: '9345582521', email: 'harini.rv.opsl@stemonef.org', role: 'OPERATIONS_LEAD', department: 'Operations' },
  { name: 'Vishmitha.V.A', phone: '8072285183', email: 'vishmithaarupa@gmail.com', role: 'RESEARCH_INTERN', department: 'Founder\'s office' },
  { name: 'Nithin', phone: '9790827049', email: 'nksingh-fci-fo@stemonef.org', role: 'CORE_ADMIN', department: 'Core' },
  { name: 'Gautam', phone: '8368001595', email: 'gj-lead-p-gaia@epochs-stemonef.org', role: 'RESEARCH_LEAD', department: 'Silvapure' },
  { name: 'Subhashis Dash', phone: '9337248252', email: 'subhashisdash-eios@epochs-stemonef.org', role: 'RESEARCH_LEAD', department: 'Past' },
  { name: 'Tarkeshwar Sharma', phone: '8839515792', email: 'tarkeshwar.sharma@steami.network', role: 'TECHNICAL_LEAD', department: 'Past' },
  { name: 'Shriyanshu Singh', phone: '9576661823', email: 'ssh.ep.pg@gmail.com', role: 'RESEARCH_INTERN', department: 'INVOS' },
  { name: 'Rakshna.R', phone: '6384717220', email: 'programmanagerrak@gmail.com', role: 'OPERATIONS_PROGRAM_MANAGER', department: 'Operations' },
  { name: 'ANWESHA', phone: '7981719866', email: 'anweshamohapatra11111@gmail.com', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'SEETA ANANYA', phone: '7386603111', email: 'ananyaseeta.stemonef@gmail.com', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'Ishaan Sen', phone: '7222949347', email: 'ishaansenres@gmail.com', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'Sahil Raj', phone: '9267965491', email: 'sahilraj172303@gmail.com', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'Vaibhav Singh', phone: '8925381502', email: 'programmanagervs@gmail.com', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'Priyadarshini Palanirajan', phone: '9342839614', email: 'ppr.ep.pg@gmail.com', role: 'RESEARCH_INTERN', department: 'INVOS' },
  { name: 'Purba Chowdhury', phone: '9674206240', email: 'pc.ep.pg@gmail.com', role: 'PAST_EMPLOYEE', department: 'Silvapure' },
  { name: 'Niharika Pandey', phone: '8100397809', email: 'np.ep.pg@gmail.com', role: 'RESEARCH_INTERN', department: 'Silvapure' },
  { name: 'BOPPANA HARSHA VARDHAN RAO', phone: '9711547112', email: 'harshavardhanstem1@gmail.com', role: 'RESEARCH_INTERN', department: 'HumanON' },
  { name: 'Lakshya Luv Mimani', phone: '7076245448', email: 'lakshyaluvmimani@proton.me', role: 'TECHNICAL_INTERN', department: 'Technical' },
  { name: 'Shruthi Kumari', phone: '9507130924', email: 'shruti.eios.alpha.evt.sil@gmail.com', role: 'PAST_EMPLOYEE', department: 'Past' },
];

// Test/fake emails to remove
const testEmails = [
  'admin@uris.com',
  'rahul@uris.com',
  'arjun@uris.com',
  'test@example.com',
  'fakeintern@test.com',
  'fakelead@test.com',
];

const DEFAULT_PASSWORD = '123456';

async function importUsers() {
  try {
    console.log('\n📊 URIS User Import Script\n');
    console.log('='.repeat(60));

    // Step 1: Delete test data
    console.log('\n1️⃣  Removing test/fake data...');
    let deletedCount = 0;
    for (const testEmail of testEmails) {
      const result = await prisma.user.deleteMany({
        where: { email: testEmail },
      });
      if (result.count > 0) {
        console.log(`   ✓ Deleted ${result.count} user(s) with email: ${testEmail}`);
        deletedCount += result.count;
      }
    }
    console.log(`\n✅ Removed ${deletedCount} test/fake users`);

    // Step 2: Hash the default password
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    console.log('\n2️⃣  Hashing password (bcrypt, 10 rounds)...');
    console.log('   ✓ Password hashed');

    // Step 3: Upsert actual users
    console.log('\n3️⃣  Importing actual employee data...');
    let createdCount = 0;
    let updatedCount = 0;

    for (const user of actualUsers) {
      const result = await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          role: user.role,
          password: hashedPassword,
          status: 'active',
          mustChangePassword: true, // User MUST change password on first login
        },
        create: {
          email: user.email,
          name: user.name,
          role: user.role,
          password: hashedPassword,
          status: 'active',
          mustChangePassword: true, // User MUST change password on first login
        },
      });

      if (result) {
        console.log(`   ✓ ${user.email} (${user.role})`);
        // Can't easily detect create vs update, so we'll count at the end
      }
    }

    // Step 4: Get final counts
    console.log('\n4️⃣  Verifying import...');
    const finalCount = await prisma.user.count();
    console.log(`   ✓ Total users in database: ${finalCount}`);

    // Step 5: Display imported users
    console.log('\n5️⃣  Imported users summary:');
    const users = await prisma.user.findMany({
      select: { email: { email: true, name: true, role: true, status: true } },
      orderBy: { name: 'asc' },
    });

    const roleStats = {};
    users.forEach(u => {
      roleStats[u.role] = (roleStats[u.role] || 0) + 1;
    });

    Object.entries(roleStats).forEach(([role, count]) => {
      console.log(`   • ${role}: ${count} users`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ IMPORT COMPLETE!\n');
    console.log('📝 Important Notes:');
    console.log(`   • All passwords set to: "${DEFAULT_PASSWORD}"`);
    console.log('   • Users MUST change password on first login');
    console.log('   • Test data has been removed');
    console.log(`   • ${actualUsers.length} actual employees imported`);
    console.log('\n💡 Next steps:');
    console.log('   1. Visit http://localhost:5173/login');
    console.log(`   2. Login with any email and password "${DEFAULT_PASSWORD}"`);
    console.log('   3. Change your password when prompted');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importUsers();
