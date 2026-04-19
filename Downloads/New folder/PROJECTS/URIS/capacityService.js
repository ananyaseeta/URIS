// src/services/capacityService.js
// ─────────────────────────────────────────────────────────────────────────────
// Final Capacity Score — Person B's integration layer.
//
// Formula:
//   finalCapacity = (baseCapacity × 0.5) + (credibility × 0.3) − tliPenalty
//   tliPenalty    = min(tli / MAX_TLI, 1.0) × 0.2   (max 20% reduction)
//   Result clamped to 0–1, then scaled to 0–100 for the API.
//
// Depends on:
//   - Person A's GET /performance/get endpoint (provides baseCapacity)
//   - getTLIForIntern()         from taskService.js
//   - computeCredibilityScore() from credibilityService.js
// ─────────────────────────────────────────────────────────────────────────────

const axios  = require('axios');
const prisma = require('../utils/prisma');
const { getTLIForIntern, getTLIBand } = require('./taskService');
const { computeCredibilityScore }      = require('./credibilityService');

const PERSON_A_API_URL = process.env.PERSON_A_API_URL;  // e.g. http://localhost:5000
const MAX_TLI          = 9;   // 3 tasks × complexity 3 = theoretical max

// ─────────────────────────────────────────────────────────────────────────────
// getBaseCapacityFromPersonA(internId)
// Calls Person A's API. Falls back to 0.5 (neutral) if unreachable,
// so Person B's engine keeps running even if Person A is down.
// ─────────────────────────────────────────────────────────────────────────────
async function getBaseCapacityFromPersonA(internId) {
  try {
    const response = await axios.get(
      `${PERSON_A_API_URL}/performance/get`,
      { params: { internId }, timeout: 5000 }
    );
    // Person A returns { success, data: { baseCapacity, performanceIndex, ... } }
    return response.data?.data?.baseCapacity ?? 0.5;
  } catch (err) {
    console.error('[capacityService] Could not reach Person A API — using neutral 0.5:', err.message);
    return 0.5; // neutral fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getCapacityLabel(finalCapacity)
// Human-readable label for the dashboard — consistent with Person A's
// capacityLabel convention from capacityEngine.js.
// ─────────────────────────────────────────────────────────────────────────────
function getCapacityLabel(finalCapacity) {
  if (finalCapacity >= 0.7) return 'High availability and low workload';
  if (finalCapacity >= 0.4) return 'Moderate availability';
  return 'High workload or low availability';
}

// ─────────────────────────────────────────────────────────────────────────────
// computeFinalCapacity(internId)
// Main exported function. Assembles all signals and writes the result to DB.
// ─────────────────────────────────────────────────────────────────────────────
async function computeFinalCapacity(internId) {
  try {
    // Step 1 — get base capacity from Person A
    const baseCapacity = await getBaseCapacityFromPersonA(internId);

    // Step 2 — get TLI from your own task engine
    const tli          = await getTLIForIntern(internId);

    // Step 3 — compute credibility (also saves to DB)
    const credResult   = await computeCredibilityScore(internId, baseCapacity);
    const credibility  = credResult.score;

    // Step 4 — compute final capacity
    const tliNormalised = Math.min(tli / MAX_TLI, 1.0);
    const tliPenalty    = tliNormalised * 0.2;

    const finalCapacity = Math.max(0, Math.min(1,
      (baseCapacity * 0.5) +
      (credibility  * 0.3) -
      tliPenalty
    ));

    const rounded      = parseFloat(finalCapacity.toFixed(3));
    const capacityLabel = getCapacityLabel(rounded);

    // Step 5 — persist to CapacityScore table
    await prisma.capacityScore.upsert({
      where:  { internId },
      update: { baseCapacity, tli, credibility, finalCapacity: rounded, capacityLabel, updatedAt: new Date() },
      create: { internId, baseCapacity, tli, credibility, finalCapacity: rounded, capacityLabel }
    });

    // Step 6 — return the full breakdown (matches shared data contract)
    return {
      intern_id:        internId,
      base_capacity:    baseCapacity,
      task_load_index:  parseFloat(tli.toFixed(3)),
      tli_band:         getTLIBand(tli),
      credibility_score: credibility,
      credibility_flag: credResult.flag,
      final_capacity:   rounded,
      final_capacity_100: Math.round(rounded * 100),
      capacity_label:   capacityLabel
    };
  } catch (err) {
    console.error('[capacityService] computeFinalCapacity error:', err.message);
    throw err;
  }
}

module.exports = { computeFinalCapacity };
