/**
 * validate-import-roles.js
 *
 * Phase 3B — Role Validation Report
 *
 * Run before importing any users from Excel.
 * Does NOT connect to the database. Does NOT modify any records.
 * Does NOT import users. Read-only validation only.
 *
 * Usage:
 *   node scripts/validate-import-roles.js
 *
 * The script validates every known Excel role variant against normalizeRole()
 * and confirms each normalized value exists in the Prisma Role enum.
 *
 * Exit code:
 *   0 — all roles valid
 *   1 — one or more roles invalid (import is NOT safe to proceed)
 */

'use strict';

const { normalizeRole, VALID_ROLES } = require('../src/constants/roles');

// ── All Excel role strings found in the import file ───────────────────────────
// Add new rows here if new variants are discovered in the spreadsheet.
// Each entry is { originalRole: string, source: string }.
const EXCEL_ROLES = [
  // Core / Admin
  { originalRole: 'Core Admin',              source: 'Excel column "Role"' },
  { originalRole: 'Admin',                   source: 'Excel column "Role"' },
  { originalRole: 'core_admin',              source: 'API / existing DB record' },

  // Leads
  { originalRole: 'Research Lead',           source: 'Excel column "Role"' },
  { originalRole: 'Research Lead - Project', source: 'Excel column "Role"' },
  { originalRole: 'Operations Lead',         source: 'Excel column "Role"' },
  { originalRole: 'Technical Lead',          source: 'Excel column "Role"' },
  { originalRole: 'Technical Lead - Past',   source: 'Excel column "Role"' },
  { originalRole: 'research_lead',           source: 'API / existing DB record' },
  { originalRole: 'technical_lead',          source: 'API / existing DB record' },
  { originalRole: 'operations_lead',         source: 'API / existing DB record' },

  // Program Manager
  { originalRole: 'Program Manager',         source: 'Excel column "Role"' },
  { originalRole: 'program_manager',         source: 'API alias' },
  { originalRole: 'operations_program_manager', source: 'API / existing DB record' },

  // Interns
  { originalRole: 'Research Intern',         source: 'Excel column "Role"' },
  { originalRole: 'Technical Intern',        source: 'Excel column "Role"' },
  { originalRole: 'Past Intern',             source: 'Excel column "Role"' },
  { originalRole: 'technical_intern',        source: 'API / existing DB record' },
  { originalRole: 'operations_intern',       source: 'API / existing DB record' },
  { originalRole: 'research_intern',         source: 'API / existing DB record' },

  // Alumni / Past
  { originalRole: 'past_employee',           source: 'API / existing DB record' },
  { originalRole: 'alumni',                  source: 'Legacy alias' },

  // Supporting roles (not in Excel, present in system)
  { originalRole: 'observer_team_lead',      source: 'System role only' },
  { originalRole: 'collaborator_lead',       source: 'System role only' },
  { originalRole: 'orenda_member',           source: 'System role only' },
];

// ── Validation ────────────────────────────────────────────────────────────────

const results = EXCEL_ROLES.map(({ originalRole, source }) => {
  const normalized = normalizeRole(originalRole);
  const inEnum     = normalized !== null && VALID_ROLES.has(normalized);

  let status;
  let note = '';

  if (normalized === null) {
    status = 'INVALID — not recognized by normalizeRole()';
  } else if (!inEnum) {
    status = 'INVALID — normalized value not in Prisma Role enum';
    note   = `normalized to "${normalized}" which is not in VALID_ROLES`;
  } else {
    status = 'VALID';
  }

  return { originalRole, source, normalized: normalized ?? '—', inEnum, status, note };
});

// ── Report output ─────────────────────────────────────────────────────────────

const LINE = '─'.repeat(90);

console.log('\n' + LINE);
console.log('  URIS Phase 3B — Role Validation Report');
console.log('  Run: ' + new Date().toISOString());
console.log(LINE);

const validCount   = results.filter(r => r.status === 'VALID').length;
const invalidCount = results.filter(r => r.status !== 'VALID').length;

console.log(`\n  Total roles checked : ${results.length}`);
console.log(`  Valid               : ${validCount}`);
console.log(`  Invalid             : ${invalidCount}`);
console.log('');

// Column widths
const W1 = 32; // original role
const W2 = 34; // normalized role
const W3 = 8;  // in enum

const pad = (s, w) => String(s ?? '').padEnd(w);

console.log(
  '  ' + pad('ORIGINAL ROLE', W1) +
  pad('NORMALIZED (ENUM)', W2) +
  pad('IN ENUM', W3) +
  'STATUS'
);
console.log('  ' + '─'.repeat(W1 + W2 + W3 + 20));

for (const r of results) {
  const marker = r.status === 'VALID' ? '✓' : '✗';
  console.log(
    `  ${marker} ` +
    pad(r.originalRole, W1 - 2) +
    pad(r.normalized, W2) +
    pad(r.inEnum ? 'YES' : 'NO', W3) +
    r.status +
    (r.note ? ` (${r.note})` : '')
  );
}

// ── Special-case notes ────────────────────────────────────────────────────────

console.log('\n' + LINE);
console.log('  MAPPING NOTES');
console.log(LINE);
console.log('');
console.log('  "Research Lead - Project" → RESEARCH_LEAD');
console.log('    Project scope is handled via team assignment, not a separate system role.');
console.log('    Import as RESEARCH_LEAD; assign to the correct research project team.');
console.log('');
console.log('  "Technical Lead - Past" → PAST_EMPLOYEE');
console.log('    Access is fully revoked. Historical title can be stored in');
console.log('    UserRoleHistory.reason if traceability is needed.');
console.log('');
console.log('  "Past Intern" → PAST_EMPLOYEE');
console.log('    Treated identically to Past Employee — all intern routes are locked.');
console.log('');
console.log('  "Admin" → CORE_ADMIN');
console.log('    Mapped to highest privilege tier. Verify each person requires');
console.log('    full CORE_ADMIN access (role change, IP block, audit logs).');
console.log('    If only lead-level access is needed, use TECHNICAL_LEAD /');
console.log('    OPERATIONS_LEAD / RESEARCH_LEAD instead.');
console.log('');

// ── Enum coverage check ───────────────────────────────────────────────────────

console.log(LINE);
console.log('  PRISMA ROLE ENUM COVERAGE');
console.log(LINE);
console.log('');

const coveredEnumValues = new Set(results.filter(r => r.inEnum).map(r => r.normalized));
for (const enumVal of [...VALID_ROLES].sort()) {
  const covered = coveredEnumValues.has(enumVal);
  console.log(`  ${covered ? '✓' : '○'} ${enumVal}${!covered ? '  ← not present in Excel data (system-only role)' : ''}`);
}

// ── Final readiness verdict ───────────────────────────────────────────────────

console.log('\n' + LINE);
console.log('  IMPORT READINESS VERDICT');
console.log(LINE);
console.log('');

if (invalidCount === 0) {
  console.log('  ✓ ALL ROLES VALID');
  console.log('  normalizeRole() handles every Excel role variant.');
  console.log('  All normalized values exist in the Prisma Role enum.');
  console.log('  No schema migration is required.');
  console.log('  Role mapping is ready for the import script.');
  console.log('');
  console.log('  REMAINING PRE-IMPORT STEPS:');
  console.log('  1. Confirm "Admin" users require full CORE_ADMIN access (see note above).');
  console.log('  2. Create Team records (Phase 3C) before assigning UserTeam rows.');
  console.log('  3. Confirm OBSERVER_TEAM_LEAD / COLLABORATOR_LEAD / ORENDA_MEMBER');
  console.log('     users, if any, are present in the Excel file under a known alias.');
  console.log('');
  console.log('  READY FOR IMPORT: YES (pending steps 1–3 above)');
} else {
  console.log('  ✗ IMPORT NOT SAFE — ' + invalidCount + ' invalid role(s) found.');
  console.log('  Fix all rows marked INVALID above before proceeding.');
  console.log('');
  console.log('  READY FOR IMPORT: NO');
}

console.log('\n' + LINE + '\n');

process.exit(invalidCount === 0 ? 0 : 1);
