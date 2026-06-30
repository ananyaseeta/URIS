const jwt   = require('jsonwebtoken');
const { ROLES, VALID_ROLES } = require('../constants/roles');
const { authError, forbidden } = require('../utils/respond');

/**
 * verifyToken
 *
 * Extracts and verifies the Bearer JWT from the Authorization header.
 * Attaches { id, email, role } to req.user on success.
 *
 * Returns 401 for missing, malformed, expired, or invalid tokens.
 * Never exposes the raw JWT error to the client.
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return authError(res, 'Access denied. No token provided.');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Session invalidation: if password was changed after token was issued, reject
    // We do a lightweight DB check only when passwordChangedAt might be set
    const prisma = require('../utils/prisma');
    const user = await prisma.user.findUnique({
      where:  { id: decoded.id },
      select: { id: true, email: true, role: true, passwordChangedAt: true },
    });

    if (!user) {
      return authError(res, 'Invalid or expired token.');
    }

    if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return authError(res, 'Session expired. Please log in again.');
    }

    req.user = {
      id:         decoded.id,
      email:      decoded.email,
      role:       decoded.role,
      isDelegate: false, // will be populated below
    };

    // Check delegation — if this user has been granted CORE_ADMIN powers
    // by the actual CORE_ADMIN, attach isDelegate: true so downstream
    // middleware and business rules can treat them as effective CORE_ADMIN.
    if (decoded.role !== 'CORE_ADMIN') {
      try {
        const { isDelegate } = require('../services/delegationService');
        req.user.isDelegate = await isDelegate(decoded.id);
        if (req.user.isDelegate) {
          // Set effectiveRole so requireRole and requirePermission use it
          req.user.effectiveRole = 'CORE_ADMIN';
        }
      } catch { /* non-fatal — delegation check failure doesn't block auth */ }
    }

    next();
  } catch {
    return authError(res, 'Invalid or expired token.');
  }
}

/**
 * requireRole(...roles)
 *
 * Middleware factory that enforces one or more allowed roles.
 * Must be used after verifyToken.
 *
 * Accepts any number of role arguments from the ROLES constant.
 * Returns 403 if the authenticated user's role is not in the allowed list.
 *
 * Scalability: adding a new role only requires updating ROLES in
 * constants/roles.js — no changes needed here.
 *
 * @param {...string} roles - One or more values from ROLES constant
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // Single role
 * router.post('/create-task', verifyToken, requireRole(ROLES.CORE_ADMIN), createTask)
 *
 * // Multiple roles (any of these may access the route)
 * router.get('/report', verifyToken, requireRole(ROLES.CORE_ADMIN, ROLES.TECHNICAL_LEAD), getReport)
 */
function requireRole(...roles) {
  // Validate at startup — catch typos before any request is made
  for (const role of roles) {
    if (!VALID_ROLES.has(role)) {
      throw new Error(
        `requireRole: "${role}" is not a valid role. ` +
        `Valid roles: ${[...VALID_ROLES].join(', ')}`
      );
    }
  }

  const allowed = new Set(roles);

  return (req, res, next) => {
    // Use effectiveRole (set by delegation) if available, else use JWT role
    const roleToCheck = req.user?.effectiveRole || req.user?.role;

    if (!req.user || !allowed.has(roleToCheck)) {
      const { logAction } = require('../utils/auditLogger');
      
      if (req.user) {
        void logAction(
          req.user.id, 
          'UNAUTHORIZED_ACCESS', 
          'SYSTEM', 
          null, 
          {
            attemptedRole: roleToCheck,
            requiredRoles: roles,
            path: req.originalUrl,
            method: req.method
          }
        );
      }
      return forbidden(res, 'Access denied. Insufficient permissions.');
    }
    next();
  };
}

/**
 * checkRole (legacy alias)
 *
 * @deprecated Use requireRole() instead.
 * Kept for backward compatibility — all existing routes continue to work.
 *
 * @param {string} role
 * @returns {import('express').RequestHandler}
 */
function checkRole(role) {
  return requireRole(role);
}

module.exports = { verifyToken, requireRole, checkRole };
