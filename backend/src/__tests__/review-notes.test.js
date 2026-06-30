'use strict';
/**
 * Integration tests — FIX 9: Review notes persistence
 *
 * Verifies that:
 *  - reviewNotes are stored in the Review record
 *  - GET /review/mine returns notes for the intern
 *  - GET /review/task/:taskId returns notes for admin/lead
 */

const request           = require('supertest');
const bcrypt            = require('bcrypt');
const app               = require('../../app');
const { PrismaClient }  = require('@prisma/client');

const prisma = new PrismaClient();
const RUN    = Date.now();

let adminToken, internToken;
let adminUserId, internUserId, internId, taskId, reviewId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);

  // Admin
  const admin = await prisma.user.create({
    data: { email: `rev-admin-${RUN}@test.local`, password: hash, name: 'Rev Admin', role: 'CORE_ADMIN', status: 'active' },
  });
  adminUserId = admin.id;

  // Intern user + intern record
  const internUser = await prisma.user.create({
    data: { email: `rev-intern-${RUN}@test.local`, password: hash, name: 'Rev Intern', role: 'TECHNICAL_INTERN', status: 'active' },
  });
  internUserId = internUser.id;
  const intern = await prisma.intern.create({ data: { userId: internUserId } });
  internId = intern.id;

  // Completed task
  const task = await prisma.task.create({
    data: {
      planeTaskId:   `rev-task-${RUN}`,
      internId,
      title:         'Review Notes Test Task',
      complexity:    2,
      status:        'completed',
      progressPct:   100,
      lastUpdatedAt: new Date(),
    },
  });
  taskId = task.id;

  // Get tokens
  const adminLogin = await request(app).post('/auth/login').send({ email: `rev-admin-${RUN}@test.local`, password: 'Password123!' });
  adminToken = adminLogin.body.data.token;

  const internLogin = await request(app).post('/auth/login').send({ email: `rev-intern-${RUN}@test.local`, password: 'Password123!' });
  internToken = internLogin.body.data.token;
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.review.deleteMany({ where: { internId } }).catch(() => {});
  await prisma.alert.deleteMany({ where: { internId } }).catch(() => {});
  await prisma.task.deleteMany({ where: { id: taskId } }).catch(() => {});
  await prisma.intern.deleteMany({ where: { id: internId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, internUserId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('FIX 9 — Review notes persistence', () => {
  test('admin can submit review with notes and they are stored', async () => {
    const res = await request(app)
      .post('/review/submit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        taskId,
        internId,
        qualityScore:      4,
        timelinessScore:   3,
        independenceScore: 4,
        reviewNotes:       'Great work on the algorithm implementation.',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    reviewId = res.body.data.id;

    // Verify directly in DB
    const stored = await prisma.review.findUnique({ where: { id: reviewId } });
    expect(stored.notes).toBe('Great work on the algorithm implementation.');
  });

  test('GET /review/mine returns notes for the intern', async () => {
    const res = await request(app)
      .get('/review/mine')
      .set('Authorization', `Bearer ${internToken}`);

    expect(res.status).toBe(200);
    const review = res.body.data.find((r) => r.taskId === taskId);
    expect(review).toBeDefined();
    expect(review.notes).toBe('Great work on the algorithm implementation.');
  });

  test('GET /review/task/:taskId returns notes for admin (FIX 9)', async () => {
    const res = await request(app)
      .get(`/review/task/${taskId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('notes', 'Great work on the algorithm implementation.');
  });

  test('review notification includes task title (FIX 8)', async () => {
    const alert = await prisma.alert.findFirst({
      where: { internId, type: 'review_submitted', taskId },
    });
    expect(alert).not.toBeNull();
    expect(alert.message).toContain('Review Notes Test Task');
    expect(alert.message).toMatch(/your work on "Review Notes Test Task"/i);
  });

  test('review without notes stores null', async () => {
    // Create a second task for this
    const task2 = await prisma.task.create({
      data: {
        planeTaskId:   `rev-task2-${RUN}`,
        internId,
        title:         'Second Task',
        complexity:    1,
        status:        'completed',
        progressPct:   100,
        lastUpdatedAt: new Date(),
      },
    });

    const res = await request(app)
      .post('/review/submit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        taskId:            task2.id,
        internId,
        qualityScore:      3,
        timelinessScore:   3,
        independenceScore: 3,
      });

    expect(res.status).toBe(201);
    const stored = await prisma.review.findUnique({ where: { id: res.body.data.id } });
    expect(stored.notes).toBeNull();

    await prisma.review.delete({ where: { id: res.body.data.id } }).catch(() => {});
    await prisma.task.delete({ where: { id: task2.id } }).catch(() => {});
  });
});
