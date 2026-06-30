'use strict';

/**
 * Integration tests — Assignment endpoints
 *
 * Covers:
 *   POST /assign/shortlist   — returns ranked intern list
 *   POST /assign/assign-task — assigns task to intern, blocks low capacity
 *
 * Uses real DB records created in beforeAll and cleaned up in afterAll.
 */

const request = require('supertest');
const app     = require('../../app');
const { PrismaClient } = require('@prisma/client');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');

const prisma = new PrismaClient();
const RUN    = Date.now();

let adminToken;
let adminUserId;
let internUserId;
let internId;
let taskId;
let placeholderUserId;
let placeholderInternId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Password123', 10);

  const admin = await prisma.user.create({
    data: { email: `assign-admin-${RUN}@test.local`, password: hash, name: 'Assign Admin', role: 'CORE_ADMIN', status: 'active' },
  });
  adminUserId = admin.id;
  adminToken  = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const internUser = await prisma.user.create({
    data: { email: `assign-intern-${RUN}@test.local`, password: hash, name: 'Assign Intern', role: 'TECHNICAL_INTERN', status: 'active' },
  });
  internUserId = internUser.id;

  const intern = await prisma.intern.create({ data: { userId: internUserId } });
  internId = intern.id;

  // Create placeholder intern to assign the task to initially
  const placeholderUser = await prisma.user.create({
    data: { email: `assign-placeholder-${RUN}@test.local`, password: hash, name: 'Placeholder User', role: 'TECHNICAL_INTERN', status: 'active' },
  });
  placeholderUserId = placeholderUser.id;

  const placeholderIntern = await prisma.intern.create({ data: { userId: placeholderUserId } });
  placeholderInternId = placeholderIntern.id;

  // Give the intern a capacity score above the threshold (default 40)
  await prisma.scoreHistory.create({
    data: { internId, score: 75, type: 'capacity' },
  });

  // Create a task to assign
  const task = await prisma.task.create({
    data: {
      planeTaskId:   `assign-task-${RUN}`,
      internId:      placeholderInternId,
      title:         'Assignment test task',
      complexity:    2,
      status:        'active',
      skills:        ['Backend'],
      lastUpdatedAt: new Date(),
    },
  });
  taskId = task.id;
});

afterAll(async () => {
  await prisma.alert.deleteMany({ where: { internId: { in: [internId, placeholderInternId] } } });
  await prisma.scoreHistory.deleteMany({ where: { internId: { in: [internId, placeholderInternId] } } });
  await prisma.task.deleteMany({ where: { internId: { in: [internId, placeholderInternId] } } });
  await prisma.intern.deleteMany({ where: { id: { in: [internId, placeholderInternId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, internUserId, placeholderUserId] } } });
  await prisma.$disconnect();
});

// ── Shortlist ─────────────────────────────────────────────────────────────────

describe('POST /assign/shortlist', () => {
  test('returns a ranked shortlist for a task with required skills', async () => {
    const res = await request(app)
      .post('/assign/shortlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ task: { requiredSkills: ['Backend'], complexity: 2, topN: 5 } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('returns 400 when task.requiredSkills is missing', async () => {
    const res = await request(app)
      .post('/assign/shortlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ task: {} });

    expect(res.status).toBe(400);
  });

  test('returns 401 without token', async () => {
    const res = await request(app)
      .post('/assign/shortlist')
      .send({ task: { requiredSkills: ['Backend'] } });
    expect(res.status).toBe(401);
  });
});

// ── Assign task ───────────────────────────────────────────────────────────────

describe('POST /assign/assign-task', () => {
  test('assigns a task to an intern with sufficient capacity', async () => {
    const res = await request(app)
      .post('/assign/assign-task')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internId, taskId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify task is now assigned to the intern
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task.internId).toBe(internId);
  });

  test('creates a task_assigned alert for the intern', async () => {
    await new Promise(r => setTimeout(r, 100));
    const alert = await prisma.alert.findFirst({
      where: { internId, type: 'task_assigned', taskId },
    });
    expect(alert).not.toBeNull();
  });

  test('returns 400 when intern has no capacity score', async () => {
    // Create a new intern with no score history
    const hash = await bcrypt.hash('Password123', 10);
    const noScoreUser = await prisma.user.create({
      data: { email: `no-score-${RUN}@test.local`, password: hash, name: 'No Score', role: 'TECHNICAL_INTERN', status: 'active' },
    });
    const noScoreIntern = await prisma.intern.create({ data: { userId: noScoreUser.id } });

    const anotherTask = await prisma.task.create({
      data: {
        planeTaskId:   `no-score-task-${RUN}`,
        internId:      placeholderInternId,
        title:         'No score task',
        complexity:    1,
        status:        'active',
        skills:        [],
        lastUpdatedAt: new Date(),
      },
    });

    const res = await request(app)
      .post('/assign/assign-task')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internId: noScoreIntern.id, taskId: anotherTask.id });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/availability/i);

    // Cleanup
    await prisma.task.delete({ where: { id: anotherTask.id } });
    await prisma.intern.delete({ where: { id: noScoreIntern.id } });
    await prisma.user.delete({ where: { id: noScoreUser.id } });
  });

  test('returns 400 for invalid internId UUID', async () => {
    const res = await request(app)
      .post('/assign/assign-task')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internId: 'not-a-uuid', taskId });
    expect(res.status).toBe(400);
  });
});
