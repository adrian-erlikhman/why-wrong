/**
 * infer.js -- per-student misconception inference.
 * ---------------------------------------------------------------------------
 * Stage 2 of the pipeline, and the reason this is not just a spreadsheet.
 *
 * A misconception is *latent*: you never observe it, you observe answers that
 * it makes more likely. And a single item is a weak signal -- a student who
 * holds a misconception still answers correctly sometimes, and a student who
 * does not hold it still slips onto that option occasionally. So we do not read
 * a diagnosis off one wrong answer. We accumulate evidence across every item
 * that probes the misconception, as a log-odds update:
 *
 *     logit P(holds m | responses) = logit P(m) + SUM_i log [ P(r_i | m) / P(r_i | not m) ]
 *
 * This is naive Bayes over item responses -- "naive" because it treats items as
 * conditionally independent given the misconception, which is the standard
 * simplifying assumption in this family of models (and the same one that makes
 * Bayesian knowledge tracing tractable).
 *
 * The likelihood parameters below are the model. They are deliberately exported
 * and surfaced in the UI rather than buried, because they are assumptions, not
 * facts, and a reader should be able to see and challenge them.
 */

import { correctIndex, distractorsFor, misIds as packMisIds } from './pack.js';

export const PARAMS = {
  prior: 0.25,          // P(a given student holds a given misconception) before evidence
  express: 0.76,        // P(choose a diagnostic distractor | holds the misconception)
  recoverCorrect: 0.55, // of the times it does not fire, how often the answer is nonetheless correct
  baseCorrect: 0.62,    // P(correct | does not hold the misconception)
  decisionThreshold: 0.5
};

function logit(p) { return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Likelihood of one observed response under both hypotheses.
 * @returns {{withMis: number, withoutMis: number}}
 */
function likelihoods(item, mid, choice) {
  const nOpt = item.opts.length;
  const ci = correctIndex(item);
  const D = distractorsFor(item, mid);
  const d = D.length;
  const nOtherWrong = nOpt - 1 - d;

  const { express, recoverCorrect, baseCorrect } = PARAMS;

  let withMis;
  if (D.includes(choice)) {
    withMis = express / d;
  } else if (choice === ci) {
    withMis = (1 - express) * recoverCorrect;
  } else {
    withMis = nOtherWrong > 0 ? ((1 - express) * (1 - recoverCorrect)) / nOtherWrong : 1e-6;
  }

  let withoutMis;
  const wrongMass = 1 - baseCorrect;
  if (choice === ci) {
    withoutMis = baseCorrect;
  } else {
    withoutMis = wrongMass / (nOpt - 1);
  }

  return { withMis: Math.max(withMis, 1e-9), withoutMis: Math.max(withoutMis, 1e-9) };
}

/**
 * Posterior probability that each student holds each misconception.
 * @returns {{posterior: number[][], misIds: string[], evidence: object[][]}}
 *   posterior[s][m] in [0,1]; evidence[s][m] lists the per-item contributions,
 *   which is what lets the UI justify a diagnosis item by item.
 */
export function inferMisconceptions(pack, responses) {
  const misIds = packMisIds(pack);
  const ITEMS = pack.items;

  // Precompute which items probe which misconception.
  const probing = {};
  misIds.forEach(mid => {
    probing[mid] = ITEMS.map((it, i) => ({ it, i }))
      .filter(({ it }) => it.opts.some(o => o.mis === mid));
  });

  const posterior = [];
  const evidence = [];

  responses.forEach(row => {
    const pRow = [];
    const eRow = [];

    misIds.forEach(mid => {
      let lo = logit(PARAMS.prior);
      const contributions = [];

      probing[mid].forEach(({ it, i }) => {
        const choice = row[i];

        // An unanswered question is not a wrong answer. It carries no evidence
        // in either direction, so it contributes nothing to the log-odds --
        // rather than being scored against the student, which would invent a
        // diagnosis out of a blank cell. It is still listed, because a teacher
        // reading the audit trail should see that the question went unanswered.
        if (choice == null || choice < 0) {
          contributions.push({
            itemId: it.id,
            choice: -1,
            chose: null,
            omitted: true,
            isDiagnostic: false,
            isCorrect: false,
            logOdds: 0
          });
          return;
        }

        const { withMis, withoutMis } = likelihoods(it, mid, choice);
        const delta = Math.log(withMis / withoutMis);
        lo += delta;
        contributions.push({
          itemId: it.id,
          choice,
          chose: it.opts[choice].t,
          omitted: false,
          isDiagnostic: distractorsFor(it, mid).includes(choice),
          isCorrect: choice === correctIndex(it),
          logOdds: delta
        });
      });

      pRow.push(sigmoid(lo));
      eRow.push(contributions);
    });

    posterior.push(pRow);
    evidence.push(eRow);
  });

  // Retain the raw log-odds alongside the probabilities. Item analysis needs
  // them to ask a leave-one-out question (see `posteriorWithout`), which is not
  // recoverable from the squashed posterior alone.
  const logits = posterior.map(row => row.map(p => logit(Math.min(Math.max(p, 1e-9), 1 - 1e-9))));

  return { posterior, misIds, evidence, logits };
}

/**
 * Posterior for (student, misconception) with one item's evidence removed.
 *
 * Used to ask whether an item agrees with everything else on the test without
 * the item being allowed to vote on its own validity. Because the model is a
 * sum of independent log-odds contributions, removing an item is subtraction
 * rather than a refit.
 */
export function posteriorWithout(inference, s, mIndex, itemId) {
  const contrib = inference.evidence[s][mIndex].find(c => c.itemId === itemId);
  const adjusted = inference.logits[s][mIndex] - (contrib ? contrib.logOdds : 0);
  return sigmoid(adjusted);
}

/** Thresholded diagnosis: the set of misconceptions attributed to each student. */
export function diagnose(posterior, misIds, threshold = PARAMS.decisionThreshold) {
  return posterior.map(row => {
    const held = new Set();
    row.forEach((p, k) => { if (p >= threshold) held.add(misIds[k]); });
    return held;
  });
}

/** Class-level prevalence: expected number of students holding each misconception. */
export function prevalence(posterior, misIds) {
  return misIds.map((mid, k) => ({
    id: mid,
    expected: posterior.reduce((sum, row) => sum + row[k], 0),
    confident: posterior.reduce((n, row) => n + (row[k] >= PARAMS.decisionThreshold ? 1 : 0), 0)
  })).sort((a, b) => b.expected - a.expected);
}
