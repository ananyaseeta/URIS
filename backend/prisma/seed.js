/**
 * seed.js — Complete relational demo dataset for URIS
 *
 * Populates: User, Intern, Team, UserTeam, AvailabilitySlot,
 *            CapacityScore, CredibilityScore, Task, Alert,
 *            Review, ScoreHistory, Activity, AuditLog
 *
 * Run: node prisma/seed.js
 * All accounts use password: 123456
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcrypt');

const prisma      = new PrismaClient();
const SALT_ROUNDS = 10;
const PASSWORD    = '123456';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Integer in [min, max] inclusive */
function ri(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Float in [min, max] rounded to `dp` decimal places */
function rf(min, max, dp = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}

/** Date offset from now by `days` days (negative = past) */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000);
}

function daysAhead(days) {
  return new Date(Date.now() + days * 86_400_000);
}

/** Monday of the current week */
function thisMonday() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function capacityLabel(f) {
  if (f >= 0.75) return 'Available';
  if (f >= 0.45) return 'Partial';
  return 'Occupied';
}

// ── Static demo data ──────────────────────────────────────────────────────────

const INTERN_DEFS = [
  {
    email: 'rahul@uris.com',
    name:  'Rahul',
    capacity:    { base: 0.82, tli: 3.2, cred: 0.88, final: 0.82 },
    credScore:   { updateFreq: 0.90, deadlineAdh: 0.85, throughput: 0.88, score: 0.88 },
    tasks: [
      { title: 'Build REST API for user module',    complexity: 0.7, status: 'active',    pct: 60,  skills: ['Node.js','Express','Prisma'],          blocker: false },
      { title: 'Write unit tests for auth service', complexity: 0.5, status: 'active',    pct: 40,  skills: ['Jest','Testing'],                      blocker: false },
      { title: 'Set up CI/CD pipeline',             complexity: 0.8, status: 'completed', pct: 100, skills: ['GitHub Actions','Docker'],             blocker: false },
    ],
    alert:   { type: 'stale_task',   severity: 'warning',  msg: 'Task "Write unit tests for auth service" has not been updated in 2+ days and the deadline is approaching.' },
    reviews: [
      { quality: 4.2, timeliness: 4.0, initiative: 3.8, complexity: 0.7 },
      { quality: 4.5, timeliness: 4.3, initiative: 4.1, complexity: 0.8 },
    ],
    scoreHistory: [88, 85, 90, 87, 91],
    busyBlocks: [{ day: 'Wednesday', reason: 'Team standup', severity: 'low' }],
    maxFreeBlockHours: 5,
  },
  {
    email: 'priya@uris.com',
    name:  'Priya',
    capacity:    { base: 0.65, tli: 4.8, cred: 0.78, final: 0.65 },
    credScore:   { updateFreq: 0.75, deadlineAdh: 0.80, throughput: 0.78, score: 0.78 },
    tasks: [
      { title: 'Design database schema for analytics', complexity: 0.6, status: 'active',    pct: 75,  skills: ['PostgreSQL','Prisma','Data Modelling'], blocker: false },
      { title: 'Implement dashboard charts',           complexity: 0.65, status: 'active',   pct: 50,  skills: ['React','Recharts','TypeScript'],        blocker: true, blockerType: 'dependency' },
      { title: 'Write API integration tests',          complexity: 0.55, status: 'completed', pct: 100, skills: ['Jest','Supertest'],                    blocker: false },
    ],
    alert:   { type: 'low_capacity', severity: 'warning',  msg: 'Priya has a capacity score of 65. Consider reviewing task load before new assignments.' },
    reviews: [
      { quality: 3.8, timeliness: 3.5, initiative: 4.0, complexity: 0.6 },
      { quality: 4.0, timeliness: 3.8, initiative: 4.2, complexity: 0.65 },
    ],
    scoreHistory: [78, 74, 80, 76, 79],
    busyBlocks: [
      { day: 'Monday',    reason: 'Exam prep', severity: 'high' },
      { day: 'Tuesday',   reason: 'Exam prep', severity: 'high' },
    ],
    maxFreeBlockHours: 4,
  },
  {
    email: 'arjun@uris.com',
    name:  'Arjun',
    capacity:    { base: 0.91, tli: 2.1, cred: 0.94, final: 0.91 },
    credScore:   { updateFreq: 0.95, deadlineAdh: 0.93, throughput: 0.94, score: 0.94 },
    tasks: [
      { title: 'Integrate Plane API for task sync',   complexity: 0.75, status: 'completed', pct: 100, skills: ['API Integration','Node.js'],          blocker: false },
      { title: 'Build anomaly detection service',     complexity: 0.90, status: 'active',    pct: 45,  skills: ['Node.js','Statistics','Prisma'],       blocker: false },
      { title: 'Write API documentation',             complexity: 0.30, status: 'active',    pct: 80,  skills: ['Markdown','OpenAPI'],                  blocker: false },
    ],
    alert:   { type: 'overload', severity: 'critical', msg: 'Arjun has 2 active high-complexity tasks simultaneously. Task load index is elevated — consider deferring new assignments.' },
    reviews: [
      { quality: 4.8, timeliness: 4.7, initiative: 4.9, complexity: 0.9 },
      { quality: 4.6, timeliness: 4.8, initiative: 4.7, complexity: 0.75 },
    ],
    scoreHistory: [94, 91, 95, 93, 96],
    busyBlocks: [],
    maxFreeBlockHours: 7,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱  Starting URIS full seed...\n');

  const hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // ── 1. Admin user ──────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where:  { email: 'admin@uris.com' },
    update: { name: 'Admin' },
    create: { email: 'admin@uris.com', password: hash, name: 'Admin', role: 'CORE_ADMIN' },
  });
  console.log(`✓ Admin:  ${admin.email}`);

  // ── 1.5. Other Demo Roles ──────────────────────────────────────────────────
  const demoRoles = [
    { email: 'techlead@uris.com', name: 'Tech Lead', role: 'TECHNICAL_LEAD' },
    { email: 'opslead@uris.com', name: 'Ops Lead', role: 'OPERATIONS_LEAD' },
    { email: 'researchlead@uris.com', name: 'Research Lead', role: 'RESEARCH_LEAD' },
    { email: 'opm@uris.com', name: 'Program Manager', role: 'OPERATIONS_PROGRAM_MANAGER' },
    { email: 'opsintern@uris.com', name: 'Ops Intern', role: 'OPERATIONS_INTERN' },
    { email: 'researchintern@uris.com', name: 'Research Intern', role: 'RESEARCH_INTERN' },
    { email: 'observerlead@uris.com', name: 'Observer Lead', role: 'OBSERVER_TEAM_LEAD' },
    { email: 'collablead@uris.com', name: 'Collab Lead', role: 'COLLABORATOR_LEAD' },
    { email: 'orenda@uris.com', name: 'Orenda Member', role: 'ORENDA_MEMBER' },
    { email: 'pastemployee@uris.com', name: 'Past Employee', role: 'PAST_EMPLOYEE' },
  ];

  for (const r of demoRoles) {
    await prisma.user.upsert({
      where:  { email: r.email },
      update: { name: r.name, role: r.role },
      create: { email: r.email, password: hash, name: r.name, role: r.role },
    });
    // Create Intern record for intern roles so they don't break dashboard
    if (r.role.includes('INTERN')) {
      const user = await prisma.user.findUnique({ where: { email: r.email } });
      await prisma.intern.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }
    console.log(`✓ ${r.name}:  ${r.email} (${r.role})`);
  }

  // No default teams are created here as per dynamic team setup requirement.

  // ── 3. Interns ────────────────────────────────────────────────────────────
  const monday = thisMonday();
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  for (const def of INTERN_DEFS) {

    // User
    const user = await prisma.user.upsert({
      where:  { email: def.email },
      update: { name: def.name },
      create: { email: def.email, password: hash, name: def.name, role: 'TECHNICAL_INTERN' },
    });

    // Intern record
    const intern = await prisma.intern.upsert({
      where:  { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    // No default team assignments are performed here.

    // AvailabilitySlot — current week
    await prisma.availabilitySlot.upsert({
      where:  { internId_weekStart: { internId: intern.id, weekStart: monday } },
      update: { maxFreeBlockHours: def.maxFreeBlockHours, busyBlocks: def.busyBlocks },
      create: {
        internId:          intern.id,
        weekStart:         monday,
        weekEnd:           friday,
        maxFreeBlockHours: def.maxFreeBlockHours,
        busyBlocks:        def.busyBlocks,
      },
    });

    // CapacityScore
    await prisma.capacityScore.upsert({
      where:  { internId: intern.id },
      update: {
        baseCapacity:  def.capacity.base,
        tli:           def.capacity.tli,
        credibility:   def.capacity.cred,
        finalCapacity: def.capacity.final,
        capacityLabel: capacityLabel(def.capacity.final),
      },
      create: {
        internId:      intern.id,
        baseCapacity:  def.capacity.base,
        tli:           def.capacity.tli,
        credibility:   def.capacity.cred,
        finalCapacity: def.capacity.final,
        capacityLabel: capacityLabel(def.capacity.final),
      },
    });

    // CredibilityScore
    await prisma.credibilityScore.upsert({
      where:  { internId: intern.id },
      update: {
        updateFrequency:    def.credScore.updateFreq,
        deadlineAdherence:  def.credScore.deadlineAdh,
        throughputAccuracy: def.credScore.throughput,
        score:              def.credScore.score,
      },
      create: {
        internId:           intern.id,
        updateFrequency:    def.credScore.updateFreq,
        deadlineAdherence:  def.credScore.deadlineAdh,
        throughputAccuracy: def.credScore.throughput,
        score:              def.credScore.score,
      },
    });

    // Tasks
    for (let i = 0; i < def.tasks.length; i++) {
      const t           = def.tasks[i];
      const planeTaskId = `PLANE-${def.name.toUpperCase()}-${i + 1}`;

      await prisma.task.upsert({
        where:  { planeTaskId },
        update: {
          progressPct:   t.pct,
          status:        t.status,
          hasBlocker:    t.blocker,
          blockerType:   t.blockerType ?? null,
          lastUpdatedAt: daysAgo(t.status === 'completed' ? ri(3, 10) : ri(0, 2)),
        },
        create: {
          planeTaskId,
          internId:      intern.id,
          title:         t.title,
          complexity:    t.complexity,
          progressPct:   t.pct,
          status:        t.status,
          hasBlocker:    t.blocker,
          blockerType:   t.blockerType ?? null,
          skills:        t.skills,
          lastUpdatedAt: daysAgo(t.status === 'completed' ? ri(3, 10) : ri(0, 2)),
          deadline:      daysAhead(7 + i * 4),
        },
      });
    }

    // Alert
    const existingAlert = await prisma.alert.findFirst({
      where: { internId: intern.id, type: def.alert.type, resolved: false },
    });
    if (!existingAlert) {
      await prisma.alert.create({
        data: {
          internId: intern.id,
          type:     def.alert.type,
          severity: def.alert.severity,
          message:  def.alert.msg,
          resolved: false,
        },
      });
    }

    // Reviews — only create if none exist for this intern yet
    const existingReviews = await prisma.review.count({ where: { internId: intern.id } });
    if (existingReviews === 0) {
      for (const r of def.reviews) {
        await prisma.review.create({
          data: {
            internId:   intern.id,
            quality:    r.quality,
            timeliness: r.timeliness,
            initiative: r.initiative,
            complexity: r.complexity,
          },
        });
      }
    }

    // ScoreHistory — 5 weekly capacity entries (skip if already seeded)
    const existingCapacityHistory = await prisma.scoreHistory.count({
      where: { internId: intern.id, type: 'capacity' },
    });
    if (existingCapacityHistory === 0) {
      for (let w = 4; w >= 0; w--) {
        await prisma.scoreHistory.create({
          data: {
            internId:  intern.id,
            score:     def.scoreHistory[4 - w],
            type:      'capacity',
            createdAt: daysAgo(w * 7),
          },
        });
      }
    }

    // ScoreHistory — 3 credibility entries (skip if already seeded)
    const existingCredHistory = await prisma.scoreHistory.count({
      where: { internId: intern.id, type: 'credibility' },
    });
    if (existingCredHistory === 0) {
      for (let w = 2; w >= 0; w--) {
        await prisma.scoreHistory.create({
          data: {
            internId:  intern.id,
            score:     parseFloat((def.credScore.score * 100 + rf(-4, 4)).toFixed(1)),
            type:      'credibility',
            createdAt: daysAgo(w * 7 + 1),
          },
        });
      }
    }

    // Activity logs — only create if none exist for this user yet
    const existingActivity = await prisma.activity.count({ where: { userId: user.id } });
    if (existingActivity === 0) {
      await prisma.activity.create({
        data: { userId: user.id, type: 'LOGIN', duration: null, timestamp: daysAgo(1) },
      });
      await prisma.activity.create({
        data: { userId: user.id, type: 'TASK_WORK', duration: ri(1800, 7200), timestamp: daysAgo(1) },
      });
      await prisma.activity.create({
        data: { userId: user.id, type: 'LOGIN', duration: null, timestamp: new Date() },
      });
    }

    // AuditLog — only create if none exist for this user yet
    const existingAudit = await prisma.auditLog.count({ where: { userId: user.id } });
    if (existingAudit === 0) {
      await prisma.auditLog.create({
        data: {
          userId: user.id, action: 'REGISTER', entity: 'USER', entityId: user.id,
          metadata: { email: user.email, role: 'TECHNICAL_INTERN' }, createdAt: daysAgo(14),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: user.id, action: 'LOGIN', entity: 'USER', entityId: user.id,
          metadata: { email: user.email }, createdAt: daysAgo(1),
        },
      });
    }

    console.log(`✓ Intern: ${def.name} (${def.email}) — capacity ${Math.round(def.capacity.final * 100)}, credibility ${def.credScore.score}`);
  }

  // ── Admin audit log ────────────────────────────────────────────────────────
  const existingAdminAudit = await prisma.auditLog.count({ where: { userId: admin.id, action: 'LOGIN' } });
  if (existingAdminAudit === 0) {
    await prisma.auditLog.create({
      data: {
        userId:   admin.id,
        action:   'LOGIN',
        entity:   'USER',
        entityId: admin.id,
        metadata: { email: admin.email },
        createdAt: new Date(),
      },
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n✅  Seed complete!\n');
  console.log('Demo credentials (password: 123456 for all):');
  console.log('  admin@uris.com   → CORE_ADMIN');
  console.log('  techlead@uris.com → TECHNICAL_LEAD');
  console.log('  opslead@uris.com → OPERATIONS_LEAD');
  console.log('  ... other roles are seeded as well ...');
  console.log('  rahul@uris.com   → INTERN  (capacity 82, credibility 88)');
  console.log('  priya@uris.com   → INTERN  (capacity 65, credibility 78)');
  console.log('  arjun@uris.com   → INTERN  (capacity 91, credibility 94)\n');
}

seed()
  .catch(err => {
    console.error('\n❌  Seed failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
