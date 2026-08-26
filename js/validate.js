/**
 * validate.js -- does the pipeline actually recover what was planted?
 * ---------------------------------------------------------------------------
 * This is the part most analysis tools cannot do, and the reason the class is
 * simulated rather than borrowed.
 *
 * Because simulate.js plants a known latent profile in every student and then
 * generates answers from it, we can hide the profile from the pipeline, run the
 * pipeline, and score the output against the truth. Two questions:
 *
 *   1. Per-student diagnosis -- of the misconceptions a student actually holds,
 *      how many did we find, and how many did we invent? (precision / recall)
 *   2. Class structure -- do the discovered clusters correspond to the
 *      archetypes that were planted? (adjusted Rand index)
 *
 * These numbers are computed live on whatever seed is loaded. They are not
 * baked in, and a bad seed will show a bad score.
 */

import { adjustedRandIndex } from './cluster.js';

/**
 * Per-student diagnosis quality, micro-averaged over all (student, misconception)
 * pairs, plus a macro average over students.
 */
export function scoreDiagnosis(diagnosed, truth, misIds) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const perStudent = [];

  diagnosed.forEach((found, s) => {
    const held = truth[s].held;
    let stp = 0, sfp = 0, sfn = 0;
    misIds.forEach(mid => {
      const f = found.has(mid);
      const h = held.has(mid);
      if (f && h) { tp++; stp++; }
      else if (f && !h) { fp++; sfp++; }
      else if (!f && h) { fn++; sfn++; }
      else tn++;
    });
    perStudent.push({
      student: s,
      precision: stp + sfp ? stp / (stp + sfp) : null,
      recall: stp + sfn ? stp / (stp + sfn) : null,
      truePositives: stp, falsePositives: sfp, falseNegatives: sfn
    });
  });

  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision, recall, f1,
    truePositives: tp, falsePositives: fp, falseNegatives: fn, trueNegatives: tn,
    accuracy: (tp + tn) / (tp + tn + fp + fn),
    perStudent
  };
}

/** Do the discovered clusters line up with the planted archetypes? */
export function scoreClustering(labels, truth) {
  const plantedIds = [...new Set(truth.map(t => t.archetype))].sort();
  const planted = truth.map(t => plantedIds.indexOf(t.archetype));
  return {
    ari: adjustedRandIndex(labels, planted),
    plantedGroups: plantedIds.length,
    discoveredGroups: new Set(labels).size,
    planted
  };
}

/**
 * Cross-tabulate discovered clusters against planted archetypes, so the
 * validation panel can show *where* the disagreement is rather than only a
 * single number.
 */
export function confusion(labels, truth) {
  const plantedIds = [...new Set(truth.map(t => t.archetype))].sort();
  const k = Math.max(...labels) + 1;
  const table = Array.from({ length: k }, () => new Array(plantedIds.length).fill(0));
  labels.forEach((l, i) => {
    table[l][plantedIds.indexOf(truth[i].archetype)]++;
  });
  return { table, plantedIds };
}

export function fmtPct(x) {
  return `${Math.round(x * 100)}%`;
}
