// Run prisma db push programmatically to sync schema to DB
const { execSync } = require('child_process');
try {
  const result = execSync(
    'node_modules\\.prisma\\client\\..\\..\\prisma\\build\\index.js db push --accept-data-loss --skip-generate',
    { cwd: __dirname, stdio: 'pipe', encoding: 'utf8' }
  );
  console.log(result);
} catch (e) {
  console.error(e.stdout || e.message);
}
