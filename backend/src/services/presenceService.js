'use strict';

/**
 * presenceService.js — Virtual Presence & Availability Tracking
 *
 * Features:
 *   - Check in / check out (VirtualPresence records)
 *   - Declare daily availability windows (AvailabilityWindow records)
 *   - Compute current status: ONLINE | OFFLINE | AVAILABLE_SOON | IN_SESSION
 *   - Presence intelligence for analytics
 *   - Small capacity modifier (±5 pts) based on consistency
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function timeFromDate(d) {
  const dt = new Date(d);
  return { h: dt.getHours(), m: dt.getMinutes() };
}

function buildTodayTime(d) {
  const today = todayStart();
  // TIME values are stored as 1970-01-01THH:MM:00Z — read UTC hours/minutes
  // to get the exact time the intern declared without local offset conversion.
  const dt = new Date(d);
  const h = dt.getUTCHours();
  const m = dt.getUTCMinutes();
  today.setHours(h, m, 0, 0);
  return today;
}

// ── Status computation ────────────────────────────────────────────────────────

/**
 * Compute current presence status for an intern.
 *
 * ONLINE          — checked in today with no checkout
 * IN_SESSION      — currently inside declared availability window
 * AVAILABLE_SOON  — availability window begins within next 60 minutes
 * OFFLINE         — none of the above
 */
async function getPresenceStatus(internId) {
  const now  = new Date();
  const start = todayStart();

  // Active session = checked in today, no checkout yet
  const activeSession = await prisma.virtualPresence.findFirst({
    where: { internId, checkInAt: { gte: start }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
  }).catch(() => null);

  if (activeSession) {
    return { status: 'ONLINE', checkInAt: activeSession.checkInAt, sessionId: activeSession.id };
  }

  // Today's availability window
  const win = await prisma.availabilityWindow.findUnique({
    where: { internId_date: { internId, date: start } },
  }).catch(() => null);

  if (win) {
    const fromToday = buildTodayTime(win.availableFrom);
    const toToday   = buildTodayTime(win.availableTo);
    const minsUntil = (fromToday.getTime() - now.getTime()) / 60000;

    if (now >= fromToday && now <= toToday) {
      return { status: 'IN_SESSION', availableFrom: fromToday, availableTo: toToday };
    }
    if (minsUntil > 0 && minsUntil <= 60) {
      return { status: 'AVAILABLE_SOON', availableFrom: fromToday, minutesUntil: Math.round(minsUntil) };
    }
  }

  return { status: 'OFFLINE' };
}

// ── Check in / out ────────────────────────────────────────────────────────────

/**
 * Check in an intern. Idempotent — returns existing open session if present.
 */
async function checkIn(internId) {
  const start = todayStart();

  const existing = await prisma.virtualPresence.findFirst({
    where: { internId, checkInAt: { gte: start }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
  }).catch(() => null);

  if (existing) return { session: existing, alreadyCheckedIn: true };

  const session = await prisma.virtualPresence.create({ data: { internId } });
  return { session, alreadyCheckedIn: false };
}

/**
 * Check out an intern. Closes the open session and computes durationMinutes.
 */
async function checkOut(internId) {
  const start = todayStart();

  const session = await prisma.virtualPresence.findFirst({
    where: { internId, checkInAt: { gte: start }, checkOutAt: null },
    orderBy: { checkInAt: 'desc' },
  }).catch(() => null);

  if (!session) return { session: null, notCheckedIn: true };

  const checkOutAt        = new Date();
  const durationMinutes   = Math.max(1, Math.round((checkOutAt.getTime() - new Date(session.checkInAt).getTime()) / 60000));

  const updated = await prisma.virtualPresence.update({
    where: { id: session.id },
    data: { checkOutAt, durationMinutes },
  });

  return { session: updated, notCheckedIn: false };
}

// ── Availability window ───────────────────────────────────────────────────────

/**
 * Declare (or update) today's availability window for an intern.
 * availableFrom / availableTo: "HH:MM" time strings OR full ISO datetime strings.
 * Stores the time as-is — no UTC conversion.
 */
async function declareAvailabilityWindow(internId, { date, availableFrom, availableTo }) {
  const dateObj = date ? new Date(date) : new Date();
  dateObj.setHours(0, 0, 0, 0);

  // Build a DateTime using the date component and the supplied time,
  // treating the time as local (offset 0) to avoid timezone shifts.
  // If the caller sends "18:00" we parse it as "1970-01-01T18:00:00Z" so
  // Prisma stores 18:00 in the TIME column with no offset applied.
  function parseTime(t) {
    if (!t) return new Date('1970-01-01T00:00:00Z');
    // Already a full ISO string — extract just HH:MM
    const match = String(t).match(/(\d{2}:\d{2})/);
    const hhmm = match ? match[1] : '00:00';
    return new Date(`1970-01-01T${hhmm}:00Z`);
  }

  const win = await prisma.availabilityWindow.upsert({
    where: { internId_date: { internId, date: dateObj } },
    update: {
      availableFrom: parseTime(availableFrom),
      availableTo:   parseTime(availableTo),
    },
    create: {
      internId,
      date:          dateObj,
      availableFrom: parseTime(availableFrom),
      availableTo:   parseTime(availableTo),
    },
  });

  return win;
}

// ── Today's presence summary ──────────────────────────────────────────────────

async function getTodayPresence(internId) {
  const start = todayStart();

  const [sessions, win, statusResult] = await Promise.all([
    prisma.virtualPresence.findMany({
      where:   { internId, checkInAt: { gte: start } },
      orderBy: { checkInAt: 'asc' },
    }).catch(() => []),
    prisma.availabilityWindow.findUnique({
      where: { internId_date: { internId, date: start } },
    }).catch(() => null),
    getPresenceStatus(internId),
  ]);

  const totalDurationToday = sessions.reduce((sum, s) => {
    if (s.durationMinutes) return sum + s.durationMinutes;
    // Active session — running duration
    if (!s.checkOutAt) return sum + Math.max(0, Math.round((Date.now() - new Date(s.checkInAt).getTime()) / 60000));
    return sum;
  }, 0);

  return {
    internId,
    status:            statusResult.status,
    statusDetail:      statusResult,
    sessions,
    totalDurationToday,
    window:            win || null,
  };
}

// ── Bulk presence for admin overview ─────────────────────────────────────────

async function getAllInternPresence() {
  const start = todayStart();
  const now   = new Date();

  const [activeSessions, todayWindows] = await Promise.all([
    prisma.virtualPresence.findMany({
      where:  { checkInAt: { gte: start }, checkOutAt: null },
      select: { internId: true, checkInAt: true, id: true },
    }).catch(() => []),
    prisma.availabilityWindow.findMany({
      where:  { date: start },
      select: { internId: true, availableFrom: true, availableTo: true },
    }).catch(() => []),
  ]);

  const activeSet  = new Set(activeSessions.map(s => s.internId));
  const checkInMap = new Map(activeSessions.map(s => [s.internId, s.checkInAt]));

  // Determine IN_SESSION from window
  const inSessionSet = new Set();
  for (const w of todayWindows) {
    const from = buildTodayTime(w.availableFrom);
    const to   = buildTodayTime(w.availableTo);
    if (now >= from && now <= to) inSessionSet.add(w.internId);
  }

  const windowMap = new Map(todayWindows.map(w => [w.internId, w]));

  return { activeSet, inSessionSet, windowMap, checkInMap };
}

// ── Presence intelligence (analytics) ────────────────────────────────────────

async function getPresenceIntelligence(days = 14) {
  const since = new Date(Date.now() - days * 86400000);

  const [allSessions, allWindows, interns] = await Promise.all([
    prisma.virtualPresence.findMany({
      where:  { checkInAt: { gte: since } },
      select: { internId: true, checkInAt: true, checkOutAt: true, durationMinutes: true },
    }).catch(() => []),
    prisma.availabilityWindow.findMany({
      where:  { date: { gte: since } },
      select: { internId: true, date: true },
    }).catch(() => []),
    prisma.intern.findMany({
      select: { id: true, user: { select: { name: true } } },
    }).catch(() => []),
  ]);

  const internMap = new Map(interns.map(i => [i.id, i.user?.name || i.id]));

  const byIntern = {};
  for (const s of allSessions) {
    if (!byIntern[s.internId]) byIntern[s.internId] = { sessions: [], windowDays: new Set() };
    byIntern[s.internId].sessions.push(s);
  }
  for (const w of allWindows) {
    if (!byIntern[w.internId]) byIntern[w.internId] = { sessions: [], windowDays: new Set() };
    byIntern[w.internId].windowDays.add(new Date(w.date).toISOString().slice(0, 10));
  }

  const rows = Object.entries(byIntern).map(([internId, data]) => {
    const sessions    = data.sessions;
    const windowDays  = data.windowDays;

    const checkInDays  = new Set(sessions.map(s => new Date(s.checkInAt).toISOString().slice(0, 10))).size;
    const sessionDays  = new Set(sessions.map(s => new Date(s.checkInAt).toISOString().slice(0, 10)));
    const completedSessions = sessions.filter(s => s.durationMinutes);
    const totalDuration = completedSessions.reduce((s, sess) => s + sess.durationMinutes, 0);
    const avgDuration   = completedSessions.length > 0 ? Math.round(totalDuration / completedSessions.length) : 0;
    const missedWindows = [...windowDays].filter(d => !sessionDays.has(d)).length;
    const consistencyRate = days > 0 ? Math.round((checkInDays / days) * 100) : 0;

    return {
      internId,
      name:                      internMap.get(internId) || internId,
      checkInDays,
      totalDurationMinutes:      totalDuration,
      avgSessionDurationMinutes: avgDuration,
      declaredWindows:           windowDays.size,
      missedWindows,
      consistencyRate,
    };
  });

  rows.sort((a, b) => b.consistencyRate - a.consistencyRate);

  return {
    rows,
    summary: {
      totalInterns:       rows.length,
      avgConsistency:     rows.length ? Math.round(rows.reduce((s, r) => s + r.consistencyRate, 0) / rows.length) : 0,
      totalMissedWindows: rows.reduce((s, r) => s + r.missedWindows, 0),
    },
    windowDays: days,
  };
}

// ── Presence modifier for capacity scoring ────────────────────────────────────

/**
 * Returns a small ±5 capacity modifier based on presence consistency.
 * +5: checked in on ≥70% of days in the last 7 days
 * −5: declared ≥3 availability windows but never checked in on those days
 */
async function getPresenceModifier(internId) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [sessions, windows] = await Promise.all([
      prisma.virtualPresence.findMany({
        where:  { internId, checkInAt: { gte: sevenDaysAgo } },
        select: { checkInAt: true, durationMinutes: true },
      }).catch(() => []),
      prisma.availabilityWindow.findMany({
        where:  { internId, date: { gte: sevenDaysAgo } },
        select: { date: true },
      }).catch(() => []),
    ]);

    const checkInDays  = new Set(sessions.map(s => new Date(s.checkInAt).toISOString().slice(0, 10))).size;
    const windowDays   = new Set(windows.map(w => new Date(w.date).toISOString().slice(0, 10)));
    const sessionDays  = new Set(sessions.map(s => new Date(s.checkInAt).toISOString().slice(0, 10)));
    const missedWindows = [...windowDays].filter(d => !sessionDays.has(d)).length;
    const consistencyRate = checkInDays / 7;

    let modifier = 0;
    if (consistencyRate >= 0.7) modifier += 5;
    if (missedWindows >= 3)     modifier -= 5;

    return { modifier, consistencyRate: Math.round(consistencyRate * 100), missedWindows };
  } catch {
    return { modifier: 0, consistencyRate: 0, missedWindows: 0 };
  }
}

module.exports = {
  getPresenceStatus,
  checkIn,
  checkOut,
  declareAvailabilityWindow,
  getTodayPresence,
  getAllInternPresence,
  getPresenceIntelligence,
  getPresenceModifier,
};
