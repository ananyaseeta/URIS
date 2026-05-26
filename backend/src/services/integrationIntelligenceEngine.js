'use strict';

/**
 * integrationIntelligenceEngine.js
 *
 * Enterprise Integration Intelligence Layer (Phase 1: Google Docs fully implemented).
 * - Uses existing persistence fields only (no new tables).
 * - Other integrations are supported via extensible "neutral" analyzers until their
 *   signal sources exist in DB/webhooks.
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp100 = (x) => Math.max(0, Math.min(100, x));

function daysBetween(nowMs, dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((nowMs - d.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizeScore(value, min, max) {
  if (min === max) return 0;
  const t = (value - min) / (max - min);
  return clamp100(t * 100);
}

/**
 * Core formulas (normalize to 0..100)
 */
function computeDocumentActivityScore({ editFrequencyPerWeek, updateConsistencyScore01, recentActivityMultiplier01 }) {
  // DocumentActivity = edit frequency × update consistency × recent activity multiplier
  // Normalize:
  // - editFrequencyPerWeek is mapped with a soft cap (0..10 edits/week => 0..100)
  // - updateConsistencyScore01 is already 0..1
  // - recentActivityMultiplier01 is 0..1
  const editFreqScore = normalizeScore(editFrequencyPerWeek, 0, 10); // 0..100
  const consistencyScore = clamp100(updateConsistencyScore01 * 100);
  const recentMultiplierScore = clamp100(recentActivityMultiplier01 * 100);

  const raw = editFreqScore * (consistencyScore / 100) * (recentMultiplierScore / 100);
  return clamp100(raw);
}

function computeCalendarLoadScore(/* neutral placeholder */) {
  // CalendarLoad = meeting density + exam periods + conflict density
  // Until calendar signal sources exist in DB, return neutral baseline.
  return 50;
}

function computeCollaborationScore(/* neutral placeholder */) {
  // CollaborationScore = shared activity frequency + contribution consistency + communication responsiveness
  return 50;
}

function computeDeliveryReliabilityScore(/* neutral placeholder */) {
  // DeliveryReliability = deliverables on-time ÷ expected deliverables
  return 50;
}

function computeIntegrationIntelligenceScore({
  documentActivityScore,
  collaborationScore,
  deliveryReliabilityScore,
  calendarLoadScore,
  communicationResponsivenessScore,
}) {
  // IntegrationIntelligence = weighted blend, normalized 0..100
  // Weighting (enterprise pragmatic):
  // - documentActivity: 35% (fully implemented)
  // - collaboration: 25% (neutral until signals)
  // - deliveryReliability: 15% (neutral until signals)
  // - calendarLoad adjustments: 15% (neutral until signals)
  // - communication responsiveness: 10% (neutral until signals)
  const weights = {
    documentActivity: 0.35,
    collaboration: 0.25,
    deliveryReliability: 0.15,
    calendarLoad: 0.15,
    communicationResponsiveness: 0.10,
  };

  // calendarLoadScore is a "load factor" where higher = worse. Convert to an availability adjustment.
  // availabilityAdjustment = 100 - loadFactor
  const calendarAvailabilityAdjustment = clamp100(100 - calendarLoadScore);

  const weighted =
    documentActivityScore * weights.documentActivity +
    collaborationScore * weights.collaboration +
    deliveryReliabilityScore * weights.deliveryReliability +
    calendarAvailabilityAdjustment * weights.calendarLoad +
    communicationResponsivenessScore * weights.communicationResponsiveness;

  return clamp100(weighted);
}

async function analyzeDocumentActivity({ internIds, staleDaysThreshold = 3 }) {
  // Google Docs signals come from existing Intern fields:
  // - gdocUrl
  // - gdocLastModified
  // - gdocIsStale
  // - gdocMetaRefreshedAt
  //
  // editFrequencyPerWeek: we approximate from lastModified + meta refresh cadence.
  // Since we have no per-edit history table, we use a pragmatic heuristic:
  // - If metaRefreshedAt exists, assume metadata refresh is a proxy for doc activity refresh cycles.
  // - If gdocLastModified exists, compute activity as inverse of inactivity.
  // This remains explainable and safe.

  const interns = await prisma.intern.findMany({
    where: internIds ? { id: { in: internIds } } : undefined,
    select: {
      id: true,
      gdocUrl: true,
      gdocLastModified: true,
      gdocIsStale: true,
      gdocMetaRefreshedAt: true,
      user: { select: { name: true } },
    },
  });

  const nowMs = Date.now();

  const results = interns.map((intern) => {
    const lastModifiedDays = daysBetween(nowMs, intern.gdocLastModified);

    const isConnected = !!intern.gdocUrl;
    const inactivityDays = lastModifiedDays == null ? null : lastModifiedDays;

    // update consistency: how consistently docs are updated vs stale threshold.
    // If gdocIsStale is true => low consistency.
    const updateConsistencyScore01 = intern.gdocIsStale
      ? 0.2
      : inactivityDays == null
        ? 0.4
        : clamp01(1 - inactivityDays / Math.max(1, staleDaysThreshold * 2));

    // recent activity multiplier: boost if updated within staleDaysThreshold
    const recentActivityMultiplier01 =
      inactivityDays == null
        ? 0.5
        : clamp01(1 - inactivityDays / Math.max(1, staleDaysThreshold));

    // editFrequencyPerWeek heuristic
    // Map: 0 days inactivity => ~10 edits/week; 3+ days => ~0-2.
    const editFrequencyPerWeek =
      inactivityDays == null
        ? 1
        : clamp100(normalizeScore(Math.max(0, staleDaysThreshold * 2 - inactivityDays), 0, staleDaysThreshold * 2) / 10);

    const documentActivityScore = computeDocumentActivityScore({
      editFrequencyPerWeek,
      updateConsistencyScore01,
      recentActivityMultiplier01,
    });

    const detectedPatterns = [];
    if (!isConnected) detectedPatterns.push('missing_gdoc_url');
    if (intern.gdocIsStale) detectedPatterns.push('gdoc_marked_stale');
    if (inactivityDays != null) {
      if (inactivityDays >= staleDaysThreshold * 2) detectedPatterns.push('extended_inactivity');
      else if (inactivityDays >= staleDaysThreshold) detectedPatterns.push('stale_risk');
    }

    const operationalImpact =
      documentActivityScore < 35
        ? 'High documentation staleness risk: potential delivery drift and reduced assignment credibility.'
        : documentActivityScore < 60
          ? 'Moderate documentation risk: follow-ups may be required to maintain progress visibility.'
          : 'Documentation activity appears healthy for assignment reliability.';

    const reasoning = {
      sourceIntegration: 'Google Docs',
      detectedPatterns,
      formula: {
        documentActivityScore,
        editFrequencyPerWeek,
        updateConsistencyScore01: Number(updateConsistencyScore01.toFixed(2)),
        recentActivityMultiplier01: Number(recentActivityMultiplier01.toFixed(2)),
        normalization: {
          editFreqCap: '10 edits/week (heuristic)',
          consistency: 'inverse of inactivity vs staleDaysThreshold',
        },
      },
    };

    return {
      internId: intern.id,
      internName: intern.user?.name || intern.user?.email?.split('@')[0] || intern.id,
      integration: 'google_docs',
      documentActivity: {
        lastDocumentUpdate: intern.gdocLastModified,
        editFrequencyPerWeek: Number(editFrequencyPerWeek.toFixed(2)),
        updateConsistencyScore: Number(updateConsistencyScore01.toFixed(2)),
        recentActivityMultiplier: Number(recentActivityMultiplier01.toFixed(2)),
        inactivityDurationDays: inactivityDays,
        staleDocumentationRisk: documentActivityScore < 35,
        missingProgressUpdatesRisk: documentActivityScore < 45,
        lowActivityPeriods: inactivityDays != null && inactivityDays >= staleDaysThreshold,
      },
      documentActivityScore: Math.round(documentActivityScore),
      explain: {
        reasoning,
        detectedPatterns,
        operationalImpact,
      },
    };
  });

  return results;
}

async function analyzeCalendarLoad({ internIds }) {
  // Neutral: until calendar busy/exam/conflict signals are stored.
  // Explainability still provided so UI can show "insufficient data" without lying.
  const interns = await prisma.intern.findMany({
    where: internIds ? { id: { in: internIds } } : undefined,
    select: { id: true },
  });

  return interns.map((i) => ({
    internId: i.id,
    calendarLoad: {
      busyPeriods: null,
      examPeriods: null,
      overloadWindows: null,
      meetingDensity: null,
      scheduleConflicts: null,
      neutrality: 'calendar_signals_not_available',
    },
    calendarLoadScore: 50,
    explain: {
      reasoning: {
        sourceIntegration: 'Google Calendar',
        detectedPatterns: ['insufficient_data'],
        formula: { note: 'neutral baseline until calendar signal sources exist' },
      },
      operationalImpact: 'Calendar load adjustments are neutral until calendar events/conflicts are persisted.',
    },
  }));
}

async function analyzeDriveActivity({ internIds }) {
  // Neutral until Drive activity signals exist.
  const interns = await prisma.intern.findMany({
    where: internIds ? { id: { in: internIds } } : undefined,
    select: { id: true },
  });

  return interns.map((i) => ({
    internId: i.id,
    driveActivity: {
      uploadActivity: null,
      deliverableSubmissions: null,
      collaborationFrequency: null,
      contributionPatterns: null,
      neutrality: 'drive_signals_not_available',
    },
    explain: {
      reasoning: {
        sourceIntegration: 'Google Drive Activity',
        detectedPatterns: ['insufficient_data'],
        formula: { note: 'neutral baseline until drive activity signals are persisted' },
      },
      operationalImpact: 'Drive contribution patterns are neutral until Drive webhooks/telemetry are stored.',
    },
  }));
}

async function analyzeCollaborationPatterns({ internIds }) {
  // Neutral collaboration score until Slack/Nextcloud/OpenProject collaboration signals exist.
  const interns = await prisma.intern.findMany({
    where: internIds ? { id: { in: internIds } } : undefined,
    select: { id: true },
  });

  return interns.map((i) => ({
    internId: i.id,
    collaboration: {
      sharedActivityFrequency: null,
      contributionConsistency: null,
      communicationResponsiveness: null,
      neutrality: 'collaboration_signals_not_available',
    },
    collaborationScore: 50,
    communicationResponsivenessScore: 50,
    explain: {
      reasoning: {
        sourceIntegration: 'Slack / Nextcloud / OpenProject / Plane',
        detectedPatterns: ['insufficient_data'],
        formula: { note: 'neutral baseline until collaboration signals are persisted' },
      },
      operationalImpact: 'Collaboration and responsiveness signals are neutral until webhooks/telemetry are stored.',
    },
  }));
}

async function analyzeDeliveryReliability({ internIds }) {
  // Neutral until deliverable submission on-time signals exist.
  const interns = await prisma.intern.findMany({
    where: internIds ? { id: { in: internIds } } : undefined,
    select: { id: true },
  });

  return interns.map((i) => ({
    internId: i.id,
    deliveryReliability: {
      deliverablesSubmittedOnTime: null,
      expectedDeliverables: null,
      neutrality: 'delivery_signals_not_available',
    },
    deliveryReliabilityScore: 50,
    explain: {
      reasoning: {
        sourceIntegration: 'Google Drive Activity / Nextcloud',
        detectedPatterns: ['insufficient_data'],
        formula: { note: 'neutral baseline until submission timestamps are persisted' },
      },
      operationalImpact: 'Delivery reliability is neutral until deliverable timing signals are stored.',
    },
  }));
}

async function computeIntegrationIntelligence({ internIds, staleDaysThreshold = 3 }) {
  const [doc, calendar, drive, collab, delivery] = await Promise.all([
    analyzeDocumentActivity({ internIds, staleDaysThreshold }),
    analyzeCalendarLoad({ internIds }),
    analyzeDriveActivity({ internIds }),
    analyzeCollaborationPatterns({ internIds }),
    analyzeDeliveryReliability({ internIds }),
  ]);

  const byIntern = {};
  for (const r of doc) byIntern[r.internId] = { internId: r.internId, internName: r.internName, explain: { sources: [] } };
  for (const r of calendar) byIntern[r.internId] = byIntern[r.internId] || { internId: r.internId, internName: r.internId, explain: { sources: [] } };
  for (const r of drive) byIntern[r.internId] = byIntern[r.internId] || { internId: r.internId, internName: r.internId, explain: { sources: [] } };
  for (const r of collab) byIntern[r.internId] = byIntern[r.internId] || { internId: r.internId, internName: r.internId, explain: { sources: [] } };
  for (const r of delivery) byIntern[r.internId] = byIntern[r.internId] || { internId: r.internId, internName: r.internId, explain: { sources: [] } };

  // Merge pieces
  for (const d of doc) {
    byIntern[d.internId].documentActivityScore = d.documentActivityScore;
    byIntern[d.internId].documentActivity = d.documentActivity;
    byIntern[d.internId].explain.sources.push(d.explain);
  }
  for (const c of calendar) {
    byIntern[c.internId].calendarLoadScore = c.calendarLoadScore;
    byIntern[c.internId].calendarLoad = c.calendarLoad;
    byIntern[c.internId].explain.sources.push(c.explain);
  }
  for (const s of collab) {
    byIntern[s.internId].collaborationScore = s.collaborationScore;
    byIntern[s.internId].communicationResponsivenessScore = s.communicationResponsivenessScore;
    byIntern[s.internId].collaboration = s.collaboration;
    byIntern[s.internId].explain.sources.push(s.explain);
  }
  for (const s of delivery) {
    byIntern[s.internId].deliveryReliabilityScore = s.deliveryReliabilityScore;
    byIntern[s.internId].deliveryReliability = s.deliveryReliability;
    byIntern[s.internId].explain.sources.push(s.explain);
  }

  const integrations = Object.values(byIntern).map((row) => {
    const integrationIntelligenceScore = computeIntegrationIntelligenceScore({
      documentActivityScore: row.documentActivityScore ?? 0,
      collaborationScore: row.collaborationScore ?? 50,
      deliveryReliabilityScore: row.deliveryReliabilityScore ?? 50,
      calendarLoadScore: row.calendarLoadScore ?? 50,
      communicationResponsivenessScore: row.communicationResponsivenessScore ?? 50,
    });

    // Detect risk categories based on implemented document activity for now.
    const detectOperationalRisk = (score) => {
      if (row.documentActivityScore < 35) return { category: 'delivery_risk', severity: 'high' };
      if (row.documentActivityScore < 45) return { category: 'collaboration_risk', severity: 'warning' };
      return { category: null, severity: 'info' };
    };

    const risk = detectOperationalRisk(integrationIntelligenceScore);

    return {
      internId: row.internId,
      integrationIntelligenceScore: Math.round(integrationIntelligenceScore),
      documentActivityScore: row.documentActivityScore ?? 0,
      collaborationScore: row.collaborationScore ?? 50,
      deliveryReliabilityScore: row.deliveryReliabilityScore ?? 50,
      calendarLoadScore: row.calendarLoadScore ?? 50,
      communicationResponsivenessScore: row.communicationResponsivenessScore ?? 50,
      explain: {
        integrationIntelligence: {
          sourceIntegration: 'multi',
          detectedPatterns: [
            row.documentActivity?.staleDocumentationRisk ? 'stale_documentation_risk' : null,
            row.documentActivity?.missingProgressUpdatesRisk ? 'missing_progress_updates' : null,
          ].filter(Boolean),
          operationalImpact:
            risk.category === 'delivery_risk'
              ? 'Operational delivery risk: documentation is stale; assignment credibility may degrade.'
              : risk.category === 'collaboration_risk'
                ? 'Collaboration risk: documentation updates are below expected cadence.'
                : 'Operational signals are within expected cadence.',
          overloadReasoning: {
            // calendar load not implemented yet
            calendarLoadScore: row.calendarLoadScore ?? 50,
            note: 'calendar signals neutral until implemented',
          },
          collaborationReasoning: {
            communicationResponsivenessScore: row.communicationResponsivenessScore ?? 50,
            note: 'communication signals neutral until implemented',
          },
          formula: {
            documentActivityScore: row.documentActivityScore ?? 0,
            collaborationScore: row.collaborationScore ?? 50,
            deliveryReliabilityScore: row.deliveryReliabilityScore ?? 50,
            calendarLoadScore: row.calendarLoadScore ?? 50,
            communicationResponsivenessScore: row.communicationResponsivenessScore ?? 50,
            integrationIntelligenceScore: Math.round(integrationIntelligenceScore),
          },
        },
        sources: row.explain?.sources ?? [],
      },
      risk,
    };
  });

  return integrations;
}

async function detectOperationalRisk({ integrationIntelligenceRows, now = new Date() }) {
  // Translates computed scores into Alert records.
  // Uses existing Alert model; idempotency is done by alert type + internId + active window.
  // No new tables are created.

  const prismaAlert = prisma.alert;

  const thresholdInactivityDays = parseInt(process.env.GDOC_STALE_DAYS) || 3;
  const createdAlerts = [];

  for (const row of integrationIntelligenceRows) {
    const patterns = [];

    // Document inactivity patterns
    const inactivityDays = row?.documentActivity?.inactivityDurationDays;
    const isStale = row?.documentActivity?.staleDocumentationRisk;

    if (inactivityDays != null && inactivityDays >= thresholdInactivityDays) patterns.push('gdoc_inactivity');
    if (isStale) patterns.push('gdoc_stale');

    // Determine alerts based on implemented document activity score.
    if (row.documentActivityScore < 35) {
      const type = 'integration_inactivity';
      const severity = 'high';

      // idempotency: do not create duplicates in last 6 hours per intern/type
      const recentSince = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const existing = await prismaAlert.findFirst({
        where: {
          internId: row.internId,
          type,
          resolved: false,
          createdAt: { gte: recentSince },
        },
      });

      if (!existing) {
        const message = `INTEGRATION RISK: Google Docs inactivity detected for ${row.internName ?? row.internId}. DocumentActivityScore=${row.documentActivityScore}. ${inactivityDays != null ? `InactivityDays=${inactivityDays}.` : 'No Google Doc connected.'}`;
        await prismaAlert.create({
          data: {
            internId: row.internId,
            type,
            severity,
            message,
          },
        });
        createdAlerts.push({ internId: row.internId, type, severity });
      }
    }

    if (row.documentActivityScore < 45 && row.documentActivityScore >= 35) {
      const type = 'integration_delivery_risk';
      const severity = 'warning';

      const recentSince = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const existing = await prismaAlert.findFirst({
        where: {
          internId: row.internId,
          type,
          resolved: false,
          createdAt: { gte: recentSince },
        },
      });

      if (!existing) {
        const message = `DELIVERY RISK (Docs): Missing/low progress updates inferred from Google Docs cadence for ${row.internName ?? row.internId}. DocumentActivityScore=${row.documentActivityScore}.`;
        await prismaAlert.create({
          data: {
            internId: row.internId,
            type,
            severity,
            message,
          },
        });
        createdAlerts.push({ internId: row.internId, type, severity });
      }
    }

    // Collaboration risk alert stub (still driven by docs cadence for now).
    if (row.documentActivityScore < 45) {
      const type = 'integration_collaboration_risk';
      const severity = 'warning';

      const recentSince = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const existing = await prismaAlert.findFirst({
        where: {
          internId: row.internId,
          type,
          resolved: false,
          createdAt: { gte: recentSince },
        },
      });

      if (!existing) {
        await prismaAlert.create({
          data: {
            internId: row.internId,
            type,
            severity,
            message: `COLLAB RISK: Collaboration/visibility risk inferred from Google Docs updates for ${row.internName ?? row.internId}. Patterns=${patterns.join(',') || 'none'}. DocumentActivityScore=${row.documentActivityScore}.`,
          },
        });
        createdAlerts.push({ internId: row.internId, type, severity });
      }
    }
  }

  return createdAlerts;
}

async function integrationIntelligenceRefresh({ internIds, staleDaysThreshold = 3 }) {
  const integrationIntelligenceRows = await computeIntegrationIntelligence({ internIds, staleDaysThreshold });
  const createdAlerts = await detectOperationalRisk({ integrationIntelligenceRows, now: new Date() });
  return { integrationIntelligenceRows, createdAlerts };
}

module.exports = {
  analyzeDocumentActivity: (args) => analyzeDocumentActivity(args),
  analyzeCalendarLoad: (args) => analyzeCalendarLoad(args),
  analyzeDriveActivity: (args) => analyzeDriveActivity(args),
  analyzeCollaborationPatterns: (args) => analyzeCollaborationPatterns(args),
  computeIntegrationIntelligence: (args) => computeIntegrationIntelligence(args),
  detectOperationalRisk: (args) => detectOperationalRisk(args),
  integrationIntelligenceRefresh,
};

