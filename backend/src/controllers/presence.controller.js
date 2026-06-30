'use strict';

const prisma = require('../utils/prisma');
const {
  checkIn,
  checkOut,
  declareAvailabilityWindow,
  getTodayPresence,
  getPresenceStatus,
} = require('../services/presenceService');
const { ok, validationError, notFound } = require('../utils/respond');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');

// Lazy-load realtimeEngine to avoid circular dependency at startup
function emit(data) {
  try {
    const re = require('../services/realtimeEngine');
    if (re && re.emitPresenceUpdate) re.emitPresenceUpdate(data);
  } catch { /* non-fatal */ }
}

async function handleCheckIn(req, res, next) {
  try {
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const { session, alreadyCheckedIn } = await checkIn(intern.id);

    emit({ internId: intern.id, userId: req.user.id, status: 'ONLINE', checkInAt: session.checkInAt });

    // Audit log — admin can see who checked in and when
    if (!alreadyCheckedIn) {
      void logAction(req.user.id, AUDIT_ACTIONS.CHECK_IN, AUDIT_ENTITIES.PRESENCE, intern.id, {
        internId:  intern.id,
        sessionId: session.id,
        checkInAt: session.checkInAt,
      });
    }

    return ok(
      res,
      { session, alreadyCheckedIn },
      alreadyCheckedIn ? 'Already checked in.' : 'Checked in successfully.'
    );
  } catch (err) {
    next(err);
  }
}

async function handleCheckOut(req, res, next) {
  try {
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const { session, notCheckedIn } = await checkOut(intern.id);
    if (notCheckedIn) return validationError(res, 'No active check-in session found for today.');

    emit({
      internId:        intern.id,
      userId:          req.user.id,
      status:          'OFFLINE',
      checkOutAt:      session.checkOutAt,
      durationMinutes: session.durationMinutes,
    });

    // Audit log — admin can see who checked out, when, and how long the session was
    void logAction(req.user.id, AUDIT_ACTIONS.CHECK_OUT, AUDIT_ENTITIES.PRESENCE, intern.id, {
      internId:        intern.id,
      sessionId:       session.id,
      checkOutAt:      session.checkOutAt,
      durationMinutes: session.durationMinutes,
    });

    return ok(res, { session }, 'Checked out successfully.');
  } catch (err) {
    next(err);
  }
}

async function handleDeclareWindow(req, res, next) {
  try {
    const { date, availableFrom, availableTo } = req.body;
    if (!availableFrom || !availableTo) {
      return validationError(res, 'availableFrom and availableTo are required (ISO datetime strings).');
    }

    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const win = await declareAvailabilityWindow(intern.id, { date, availableFrom, availableTo });

    emit({
      internId:      intern.id,
      userId:        req.user.id,
      status:        'AVAILABLE_SOON',
      availableFrom: win.availableFrom,
      availableTo:   win.availableTo,
    });

    // Audit log — admin can see declared availability windows
    void logAction(req.user.id, AUDIT_ACTIONS.DECLARE_WINDOW, AUDIT_ENTITIES.PRESENCE, intern.id, {
      internId:      intern.id,
      availableFrom: win.availableFrom,
      availableTo:   win.availableTo,
      date:          win.date,
    });

    return ok(res, { window: win }, 'Availability window declared.');
  } catch (err) {
    next(err);
  }
}

async function handleGetMyPresence(req, res, next) {
  try {
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const data = await getTodayPresence(intern.id);
    return ok(res, data, "Today's presence retrieved.");
  } catch (err) {
    next(err);
  }
}

async function handleGetPresenceStatus(req, res, next) {
  try {
    const { internId } = req.params;
    const intern = await prisma.intern.findUnique({ where: { id: internId } });
    if (!intern) return notFound(res, 'Intern not found');

    const status = await getPresenceStatus(internId);
    return ok(res, status, 'Presence status retrieved.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleCheckIn,
  handleCheckOut,
  handleDeclareWindow,
  handleGetMyPresence,
  handleGetPresenceStatus,
};
