'use strict';
/**
 * Integration tests — FIX 10: Finish Internship cleanup
 *
 * Verifies that finishInternship:
 *  - Changes user role to PAST_EMPLOYEE
 *  - Sets user status to 'alumni'
 *  - Sets leftAt on all active team memberships
 *  - Past intern no longer counted in active team members
 */

const request           = require('supertest');
const bcrypt            = require('bcrypt');
const app               = require('../../app');
const { PrismaClient }  = require('@prisma/client');

const prisma = new PrismaClient();
const RUN    = Date.now();

let adminToken, adminUserId;
let internUserId, internId;
let teamId, membershipId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: { email: `finish-admin-${RUN}@test.local`, password: hash, name: 'Finish Admin', role: 'CORE_ADMIN', status: 'active' },
  });
  adminUserId = admin.id;

  const internUser = await prisma.user.create({
    data: { email: `finish-intern-${RUN}@test.local`, password: hash, name: 'Finish Intern', role: 'TECHNICAL_INTERN', status: 'active' },
  });
  internUserId = internUser.id;
  const intern = await prisma.intern.create({ data: { userId: internUserId } });
  internId = intern.id;

  // Create a team and add the intern as active member
  const team = await prisma.team.create({ data: { name: `finish-team-${RUN}` } });
  teamId = team.id;
  const membership = await prisma.userTeam.create({
    data: { userId: internUserId, teamId, role: 'member' },
  });
  membershipId = membership.id;

  const login = await request(app).post('/auth/login').send({ email: `finish-admin-${RUN}@test.local`, password: 'Password123!' });
  adminToken = login.body.data.token;
});

afterAll(async () => {
  await prisma.userTeam.deleteMany({ where: { teamId } }).catch(() => {});
  await prisma.team.delete({ where: { id: teamId } }).catch(() => {});
  await prisma.intern.delete({ where: { id: internId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, internUserId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('FIX 10 — Finish internship team cleanup', () => {
  test('finishInternship sets user to PAST_EMPLOYEE + alumni status', async () => {
    const res = await request(app)
      .post('/admin/finish-internship')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internId });

    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: internUserId } });
    expect(user.role).toBe('PAST_EMPLOYEE');
    expect(user.status).toBe('alumni');
  });

  test('finishInternship sets leftAt on all active team memberships', async () => {
    const membership = await prisma.userTeam.findUnique({ where: { id: membershipId } });
    expect(membership.leftAt).not.toBeNull();
    expect(membership.leftAt).toBeInstanceOf(Date);
  });

  test('past intern no longer has active team membership (leftAt set)', async () => {
    const activeMembers = await prisma.userTeam.findMany({
      where: { userId: internUserId, leftAt: null },
    });
    expect(activeMembers).toHaveLength(0);
  });

  test('finishInternship returns 404 for unknown internId', async () => {
    const res = await request(app)
      .post('/admin/finish-internship')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  test('finishInternship returns 401 without token', async () => {
    const res = await request(app).post('/admin/finish-internship').send({ internId });
    expect(res.status).toBe(401);
  });
});
