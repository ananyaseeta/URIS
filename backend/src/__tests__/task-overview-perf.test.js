'use strict';
/**
 * Integration tests — FIX 13: Task overview performance
 *
 * Verifies that GET /tasks/overview:
 *  - Returns a response quickly (does NOT block on Plane sync)
 *  - Returns the correct shape
 *  - Responds even when called multiple times rapidly (throttle works)
 */

const request           = require('supertest');
const bcrypt            = require('bcrypt');
const app               = require('../../app');
const { PrismaClient }  = require('@prisma/client');

const prisma = new PrismaClient();
const RUN    = Date.now();
let adminToken, adminUserId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);
  const admin = await prisma.user.create({
    data: { email: `tperf-admin-${RUN}@test.local`, password: hash, name: 'TPerf Admin', role: 'CORE_ADMIN', status: 'active' },
  });
  adminUserId = admin.id;
  const login = await request(app).post('/auth/login').send({ email: `tperf-admin-${RUN}@test.local`, password: 'Password123!' });
  adminToken = login.body.data.token;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('FIX 13 — Task overview does not block on sync', () => {
  test('GET /tasks/overview responds within 5 seconds (not blocked by sync)', async () => {
    const start = Date.now();
    const res = await request(app)
      .get('/tasks/overview')
      .set('Authorization', `Bearer ${adminToken}`)
      .timeout(8_000); // allow up to 8s but expect < 5s

    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(5_000); // response must not wait for Plane sync
  });

  test('response is an array (correct shape)', async () => {
    const res = await request(app)
      .get('/tasks/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('second rapid call is also fast (throttle does not break response)', async () => {
    const start = Date.now();
    // Call twice in quick succession — second should use throttle (skip sync)
    await request(app).get('/tasks/overview').set('Authorization', `Bearer ${adminToken}`);
    const res2 = await request(app).get('/tasks/overview').set('Authorization', `Bearer ${adminToken}`);
    const elapsed = Date.now() - start;

    expect(res2.status).toBe(200);
    expect(elapsed).toBeLessThan(8_000);
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/tasks/overview');
    expect(res.status).toBe(401);
  });

  test('returns 403 for intern role', async () => {
    const hash = await bcrypt.hash('Password123!', 10);
    const iUser = await prisma.user.create({
      data: { email: `tperf-intern-${RUN}@test.local`, password: hash, name: 'TPerf Intern', role: 'TECHNICAL_INTERN', status: 'active' },
    });
    const iLogin = await request(app).post('/auth/login').send({ email: `tperf-intern-${RUN}@test.local`, password: 'Password123!' });
    const iToken = iLogin.body.data.token;

    const res = await request(app).get('/tasks/overview').set('Authorization', `Bearer ${iToken}`);
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: iUser.id } }).catch(() => {});
  });
});
