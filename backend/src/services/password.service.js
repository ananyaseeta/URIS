'use strict';

/**
 * password.service.js
 * Change password, forgot password, reset password flows.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma  = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');
const notificationService = require('./notification.service');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function validatePasswordLength(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    const err = new Error('Password must be between 8 and 128 characters.');
    err.status = 422;
    throw err;
  }
}

function validatePasswordStrength(password) {
  const errors = [];

  // Check minimum length
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  // Check for at least 2 capital letters
  const capitalLetters = (password.match(/[A-Z]/g) || []).length;
  if (capitalLetters < 2) {
    errors.push('Password must contain at least 2 capital letters.');
  }

  // Check for at least 1 special character
  const specialChars = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/) || []).length;
  if (specialChars < 1) {
    errors.push('Password must contain at least 1 special character.');
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(' '));
    err.status = 422;
    throw err;
  }
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    const err = new Error('Current password is incorrect.');
    err.status = 401;
    throw err;
  }

  // Must differ from current
  const same = await bcrypt.compare(newPassword, user.password);
  if (same) {
    const err = new Error('New password must differ from the current password.');
    err.status = 422;
    throw err;
  }

  validatePasswordLength(newPassword);
  validatePasswordStrength(newPassword);

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data:  { password: hash, passwordChangedAt: new Date() },
  });

  void logAction(userId, AUDIT_ACTIONS.PASSWORD_CHANGED, AUDIT_ENTITIES.USER, userId, {});

  const emailResult = await notificationService.notifyPasswordChanged(user.email, user.name);
  return { success: true, emailSent: emailResult.success === true };
}

async function requestPasswordReset(email, role, leadEmail) {
  // Always return the same message — never reveal whether email exists
  const GENERIC_MSG = 'If an account with that email exists, a reset link has been sent.';

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { success: true, message: GENERIC_MSG };
  }

  // Generate token
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash  = await bcrypt.hash(plainToken, SALT_ROUNDS);
  const expiresAt  = new Date(Date.now() + TOKEN_EXPIRY_MS);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const baseUrl  = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${baseUrl}/reset-password?token=${plainToken}`;

  // Send email to user
  void notificationService.notifyPasswordReset(user.email, resetUrl);

  // If lead email is provided and different from user email, send copy to lead
  if (leadEmail && leadEmail.trim() !== '' && leadEmail !== email) {
    void notificationService.notifyPasswordReset(leadEmail, resetUrl);
  }

  return { success: true, message: GENERIC_MSG };
}

async function resetPassword(token, newPassword) {
  validatePasswordLength(newPassword);
  validatePasswordStrength(newPassword);

  // Find all unexpired, unused tokens
  const candidates = await prisma.passwordResetToken.findMany({
    where: {
      expiresAt: { gt: new Date() },
      usedAt:    null,
    },
    include: { user: true },
  });

  // bcrypt-compare each to find the matching one
  let matched = null;
  for (const candidate of candidates) {
    const ok = await bcrypt.compare(token, candidate.tokenHash);
    if (ok) { matched = candidate; break; }
  }

  if (!matched) {
    const err = new Error('Reset link is invalid or has expired.');
    err.status = 400;
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.user.update({
    where: { id: matched.userId },
    data:  { password: hash, passwordChangedAt: new Date() },
  });

  await prisma.passwordResetToken.update({
    where: { id: matched.id },
    data:  { usedAt: new Date() },
  });

  void logAction(matched.userId, AUDIT_ACTIONS.PASSWORD_RESET, AUDIT_ENTITIES.USER, matched.userId, {});
  void notificationService.notifyPasswordChanged(matched.user.email, matched.user.name);

  return { success: true };
}

module.exports = { changePassword, requestPasswordReset, resetPassword };
