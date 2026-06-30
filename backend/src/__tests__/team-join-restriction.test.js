'use strict';
/**
 * Integration tests — FIX 11: Team join restricted to CORE_ADMIN
 *
 * Verifies that:
 *  - An intern cannot join a team (403)
 *  - A lead cannot join a team for another user (403)
 *  - A CORE_ADMIN can join a user to a team (200)
 */

const request           = require('supertest');
const bcrypt            = require('bcrypt');
const app               = require('../../app');
const { PrismaClient }  = require('@prisma/client');

const prisma = new PrismaClient();
const RUN    = Date.now();

let adminToken, internToken, leadToken;
let adminUserId, internUserId, leadUserId;
let teamId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: { email: `tjoin-admin-${RUN}@test.local`, password: hash, name: 'TJoin Admin', role: 'CORE_ADMIN', status: 'active' },
  });
  adminUserId = admin.id;

  const intern = await prisma.user.create({
    data: { email: `tjoin-intern-${RUN}@test.local`, password: hash, name: 'TJoin Intern', role: 'TECHNICAL_INTERN', status: 'active' },
  });
  internUserId = intern.id;

  const lead = await prisma.user.create({
    data: { email: `tjoin-lead-${RUN}@test.local`, password: hash, name: 'TJoin Lead', role: 'TECHNICAL_LEAD', status: 'active' },
  });
  leadUserId = lead.id;

  const team = await prisma.team.create({ data: { name: `tjoin-team-${RUN}` } });
  teamId = team.id;

  const [al, il, ll] = await Promise.all([
    request(app).post('/auth/login').send({ email: `tjoin-admin-${RUN}@test.local`,  password: 'Password123!' }),
    request(app).post('/auth/login').send({ email: `tjoin-intern-${RUN}@test.local`, password: 'Password123!' }),
    request(app).post('/auth/login').send({ email: `tjoin-lead-${RUN}@test.local`,   password: 'Password123!' }),
  ]);
  adminToken  = al.body.data.token;
  internToken = il.body.data.token;
  leadToken   = ll.body.data.token;
});

afterAll(async () => {
  await prisma.userTeam.deleteMany({ where: { teamId } }).catch(() => {});
  await prisma.team.delete({ where: { id: teamId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, internUserId, leadUserId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('FIX 11 — Team join restricted to CORE_ADMIN', () => {
  test('intern cannot join a team (403)', async () => {
    const res = await request(app)
      .post(`/teams/${teamId}/join`)
      .set('Authorization', `Bearer ${internToken}`)
      .send({ role: 'member' });

    expect(res.status).toBe(403);
  });

  test('lead cannot join a team (403)', async () => {
    const res = await request(app)
      .post(`/teams/${teamId}/join`)
      .set('Authorization', `Bearer ${leadToken}`)
      .send({ role: 'member' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post(`/teams/${teamId}/join`)
      .send({ role: 'member' });

    expect(res.status).toBe(401);
  });

  test('CORE_ADMIN can add a user to a team (200)', async () => {
    const res = await request(app)
      .post(`/teams/${teamId}/join`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'member' });

    // 200 success (idempotent — admin joining their own user)
    expect([200, 201]).toContain(res.status);
  });
});
