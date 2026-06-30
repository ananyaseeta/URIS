/**
 * RBAC role constants.
 *
 * These are the canonical role strings used everywhere in the system:
 *   - Prisma enum values (stored in the database)
 *   - JWT payload `role` field
 *   - checkRole() / requireRole() middleware arguments
 *
 * Adding a new role:
 *   1. Add it here:          ROLES.TEAM_LEAD = 'TEAM_LEAD'
 *   2. Add to Prisma schema: enum Role { INTERN ADMIN TEAM_LEAD }
 *   3. Run:                  npx prisma migrate dev
 *   4. Add to normalizeRole() map if the frontend sends a different string
 *   5. Apply requireRole() to the relevant routes
 *
 * Never use raw role strings anywhere else — always import from this file.
 */

/** @type {Object.<string, string>} */
const ROLES = Object.freeze({
  CORE_ADMIN:                 'CORE_ADMIN',
  TECHNICAL_LEAD:             'TECHNICAL_LEAD',
  OPERATIONS_LEAD:            'OPERATIONS_LEAD',
  RESEARCH_LEAD:              'RESEARCH_LEAD',
  OPERATIONS_PROGRAM_MANAGER: 'OPERATIONS_PROGRAM_MANAGER',
  TECHNICAL_INTERN:           'TECHNICAL_INTERN',
  OPERATIONS_INTERN:          'OPERATIONS_INTERN',
  RESEARCH_INTERN:            'RESEARCH_INTERN',
  OBSERVER_TEAM_LEAD:         'OBSERVER_TEAM_LEAD',
  COLLABORATOR_LEAD:          'COLLABORATOR_LEAD',
  ORENDA_MEMBER:              'ORENDA_MEMBER',
  PAST_EMPLOYEE:              'PAST_EMPLOYEE',
});

/**
 * All valid role values as a Set for O(1) membership checks.
 * @type {Set<string>}
 */
const VALID_ROLES = new Set(Object.values(ROLES));

/**
 * Maps any incoming role string (from API requests, UI, or Excel import) to a
 * valid Prisma Role enum value. Case-insensitive; normalises whitespace and
 * common separators (spaces, underscores, hyphens) before lookup.
 *
 * Returns null for unrecognised values — callers must treat null as invalid.
 *
 * Coverage includes:
 *   - All underscore_snake forms (API / JWT)
 *   - All space-separated human-readable forms (Excel import)
 *   - Hyphen variants (e.g. "technical lead - past")
 *   - Common abbreviations and legacy aliases
 *
 * Phase 3B additions (Excel import variants):
 *   'core admin'            → CORE_ADMIN
 *   'research lead'         → RESEARCH_LEAD
 *   'research lead - project' → RESEARCH_LEAD  (project scope → team, not role)
 *   'operations lead'       → OPERATIONS_LEAD
 *   'technical lead'        → TECHNICAL_LEAD
 *   'technical lead - past' → PAST_EMPLOYEE   (historical title; access revoked)
 *   'research intern'       → RESEARCH_INTERN
 *   'technical intern'      → TECHNICAL_INTERN
 *   'past intern'           → PAST_EMPLOYEE
 *   'program manager'       → OPERATIONS_PROGRAM_MANAGER (already existed)
 *
 * @param {string} role
 * @returns {string | null}
 */
function normalizeRole(role) {
  if (typeof role !== 'string') return null;

  // Collapse multiple spaces, strip leading/trailing whitespace, lowercase.
  // This makes "  Core  Admin  " behave the same as "core_admin".
  const input = role.toLowerCase().trim().replace(/\s+/g, ' ');

  const map = {
    // ── Canonical underscore forms (API / JWT) ───────────────────────────────
    'core_admin':                   ROLES.CORE_ADMIN,
    'technical_lead':               ROLES.TECHNICAL_LEAD,
    'operations_lead':              ROLES.OPERATIONS_LEAD,
    'research_lead':                ROLES.RESEARCH_LEAD,
    'operations_program_manager':   ROLES.OPERATIONS_PROGRAM_MANAGER,
    'technical_intern':             ROLES.TECHNICAL_INTERN,
    'operations_intern':            ROLES.OPERATIONS_INTERN,
    'research_intern':              ROLES.RESEARCH_INTERN,
    'observer_team_lead':           ROLES.OBSERVER_TEAM_LEAD,
    'collaborator_lead':            ROLES.COLLABORATOR_LEAD,
    'orenda_member':                ROLES.ORENDA_MEMBER,
    'past_employee':                ROLES.PAST_EMPLOYEE,

    // ── Space-separated Excel forms (Phase 3B) ───────────────────────────────
    'core admin':                   ROLES.CORE_ADMIN,
    'technical lead':               ROLES.TECHNICAL_LEAD,
    'operations lead':              ROLES.OPERATIONS_LEAD,
    'research lead':                ROLES.RESEARCH_LEAD,
    'program manager':              ROLES.OPERATIONS_PROGRAM_MANAGER,
    'operations program manager':   ROLES.OPERATIONS_PROGRAM_MANAGER,
    'technical intern':             ROLES.TECHNICAL_INTERN,
    'operations intern':            ROLES.OPERATIONS_INTERN,
    'research intern':              ROLES.RESEARCH_INTERN,
    'observer team lead':           ROLES.OBSERVER_TEAM_LEAD,
    'collaborator lead':            ROLES.COLLABORATOR_LEAD,
    'orenda member':                ROLES.ORENDA_MEMBER,
    'past employee':                ROLES.PAST_EMPLOYEE,

    // ── Hyphen/project variants (Phase 3B) ───────────────────────────────────
    // "Research Lead - Project" → project scope is handled via team assignment,
    // not a separate system role. Normalized to RESEARCH_LEAD.
    'research lead - project':      ROLES.RESEARCH_LEAD,
    'research lead-project':        ROLES.RESEARCH_LEAD,
    'research lead – project':      ROLES.RESEARCH_LEAD,   // en-dash variant
    // "Technical Lead - Past" → access revoked; stored as PAST_EMPLOYEE.
    // Historical title can be noted in UserRoleHistory.reason if needed.
    'technical lead - past':        ROLES.PAST_EMPLOYEE,
    'technical lead-past':          ROLES.PAST_EMPLOYEE,
    'technical lead – past':        ROLES.PAST_EMPLOYEE,   // en-dash variant

    // ── "Past" intern/employee variants ─────────────────────────────────────
    'past intern':                  ROLES.PAST_EMPLOYEE,
    'past_intern':                  ROLES.PAST_EMPLOYEE,

    // ── Short / legacy aliases ───────────────────────────────────────────────
    'admin':                        ROLES.CORE_ADMIN,
    'intern':                       ROLES.TECHNICAL_INTERN,
    'alumni':                       ROLES.PAST_EMPLOYEE,
    'observer':                     ROLES.OBSERVER_TEAM_LEAD,
    'collaborator':                 ROLES.COLLABORATOR_LEAD,
    'program_manager':              ROLES.OPERATIONS_PROGRAM_MANAGER,
  };

  return map[input] ?? null;
}

module.exports = { ROLES, VALID_ROLES, normalizeRole };
