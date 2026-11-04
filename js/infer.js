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
 * Each term is the likelihood ratio of a mixture: a held misconception either
 * fires and sends the student to its distractor, or it does not and they answer
 * like anyone else. On top of that, three things a real class does: a question
 * can probe two beliefs a student holds and show only one (explaining away),
 * each student has their own accuracy, and some wrong options tempt everyone.
 * Each was kept because test/benchmark.mjs, which runs the pipeline on classes
 * built to break its assumptions, showed it helped.
 *
 * The likelihood parameters below are the model. They are deliberately exported
 * and surfaced in the UI rather than buried, because they are assumptions, not
 * facts, and a reader should be able to see and challenge them.
 */

import { correctIndex, misIds as packMisIds } from './pack.js';

export const PARAMS = {
  prior: 0.25,          // P(a given student holds a given misconception) before evidence
  express: 0.76,        // P(the misconception fires on a question that probes it)
  baseCorrect: 0.62,    // P(correct | nothing fires), before each student's own is estimated
  decisionThreshold: 0.6
};

function logit(p) { return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Probability of one observed choice, given which misconceptions the student
 * holds among those this question probes.
 *
 * If none of them is held, the student answers correctly with probability
 * `baseCorrect` and otherwise slips onto any wrong option. If some are held,
 * a misconception fires with probability `express` and sends them to one of
 * the held misconceptions' distractors; otherwise they answer as if they held
 * nothing. A student who holds two beliefs a question probes can only show one
 * of them on it, which is why the held set is passed whole rather than one
 * misconception at a time.
 */
function choiceProb(probe, heldOpts, choice, { express, baseCorrect }) {
  const base = choice === probe.ci ? baseCorrect : (1 - baseCorrect) * probe.slip[choice];
  if (!heldOpts.length) return base;
  const fires = heldOpts.includes(choice) ? express / heldOpts.length : 0;
  return fires + (1 - express) * base;
}

/**
 * Likelihood of one observed response with and without misconception `m`.
 *
 * The other misconceptions this question probes are not known either, so the
 * likelihood is averaged over whether each is held, weighted by its current
 * posterior. A question probes at most a handful, so this is exact
 * enumeration, not sampling. The effect is explaining away: a student who
 * picked the distractor of a belief they clearly hold is not counted as
 * evidence against a second belief the same question also probes.
 *
 * @returns {{withMis: number, withoutMis: number}}
 */
function likelihoods(probe, m, q, choice, params) {
  let withMis = 0, withoutMis = 0;

  for (const { held, without, withIt } of subsetsFor(probe, m)) {
    let w = 1;
    for (const [k, on] of held) w *= on ? q[k] : 1 - q[k];
    if (w < 1e-12) continue;
    withoutMis += w * choiceProb(probe, without, choice, params);
    withMis += w * choiceProb(probe, withIt, choice, params);
  }

  return { withMis: Math.max(withMis, 1e-9), withoutMis: Math.max(withoutMis, 1e-9) };
}

/**
 * Every combination of the other misconceptions a question probes, with the
 * distractors in play with and without `m`. Depends only on the question, so
 * it is built once per question and reused for every student and pass.
 */
function subsetsFor(probe, m) {
  probe.subsets = probe.subsets || {};
  if (probe.subsets[m]) return probe.subsets[m];
  const others = probe.mis.filter(k => k !== m);
  const out = [];
  for (let mask = 0; mask < (1 << others.length); mask++) {
    const on = others.filter((_, j) => mask & (1 << j));
    const pick = set => probe.optMis.map((k, oi) => (k >= 0 && set.includes(k) ? oi : -1)).filter(oi => oi >= 0);
    out.push({
      held: others.map((k, j) => [k, !!(mask & (1 << j))]),
      without: pick(on),
      withIt: pick([...on, m])
    });
  }
  return (probe.subsets[m] = out);
}

/** Coordinate-ascent passes over one student's misconceptions per round. */
const PASSES = 4;
/** Rounds of re-estimating each student's accuracy from their beliefs and back. */
const ROUNDS = 6;

/**
 * How many questions' worth of weight the class average carries in each
 * student's accuracy estimate. A student's own answers decide it once there
 * are plenty of them; with a short test it stays near the class.
 */
export const ABILITY_WEIGHT = 8;

/** How many slips' worth of weight an even spread carries in where a question's slips land. */
export const SLIP_WEIGHT = 6;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The probability of each option on `item`, for a student who holds the
 * misconceptions in `held` (ids) and otherwise answers correctly with
 * `params.baseCorrect`, slips spread evenly. The response model on its own,
 * exported so that it can be checked to sum to one.
 */
export function optionProbabilities(item, held, params = PARAMS) {
  const ci = correctIndex(item);
  const probe = { ci, slip: item.opts.map((_, oi) => (oi === ci ? 0 : 1 / (item.opts.length - 1))) };
  const heldOpts = item.opts.map((o, oi) => (o.mis && held.includes(o.mis) ? oi : -1)).filter(oi => oi >= 0);
  return item.opts.map((_, choice) => choiceProb(probe, heldOpts, choice, params));
}

/**
 * A class needs this many students before accuracy and slip spread are fitted
 * to it. With fewer there is no class to estimate from, and the fixed
 * parameters are used as they stand.
 */
export const MIN_FIT_STUDENTS = 5;

/**
 * Posterior probability that each student holds each misconception.
 * Each response row has one option index per item; -1, null, and undefined
 * represent an unanswered item.
 *
 * `fit: false` keeps the fixed PARAMS for every student instead of estimating
 * accuracy and slip spread from the class.
 *
 * @returns {{posterior: number[][], misIds: string[], evidence: object[][],
 *            logits: number[][], ability: number[], fitted: object}}
 *   posterior[s][m] in [0,1]; evidence[s][m] lists the per-item contributions,
 *   which is what lets the UI justify a diagnosis item by item. ability[s] is
 *   the student's estimated chance of a right answer when no belief fires.
 */
export function inferMisconceptions(pack, responses, { fit = true } = {}) {
  const misIds = packMisIds(pack);
  const ITEMS = pack.items;

  if (!Array.isArray(responses)) {
    throw new TypeError('Responses must be an array of answer rows.');
  }
  for (let s = 0; s < responses.length; s++) {
    const row = responses[s];
    if (!Array.isArray(row) || row.length !== ITEMS.length) {
      throw new RangeError(`Response row ${s + 1} must contain exactly ${ITEMS.length} answers.`);
    }
    row.forEach((choice, i) => {
      if (choice == null || choice === -1) return;
      if (!Number.isInteger(choice) || choice < 0 || choice >= ITEMS[i].opts.length) {
        throw new RangeError(`Response ${i + 1} for student ${s + 1} is not a valid option index or blank.`);
      }
    });
  }

  fit = fit && responses.length >= MIN_FIT_STUDENTS;
  // A Map, not an object: a misconception may be called anything, __proto__ included.
  const mIndex = new Map(misIds.map((mid, k) => [mid, k]));
  const { prior, express } = PARAMS;

  // Each question, with which misconception each of its options belongs to.
  const probes = ITEMS.map((item, i) => {
    const optMis = item.opts.map(o => (o.mis && mIndex.has(o.mis) ? mIndex.get(o.mis) : -1));
    const ci = correctIndex(item);
    // Where a slip lands: evenly over the wrong options until the class says otherwise.
    const slip = item.opts.map((_, oi) => (oi === ci ? 0 : 1 / (item.opts.length - 1)));
    return { item, i, ci, optMis, slip, mis: [...new Set(optMis.filter(k => k >= 0))] };
  });
  const probing = misIds.map((_, m) => probes.filter(p => p.mis.includes(m)));

  const Q = responses.map(() => misIds.map(() => prior));
  const LO = responses.map(() => misIds.map(() => logit(prior)));

  // A student's accuracy on the questions no belief interferes with. The
  // same wrong answer means less from a student who gets half of everything
  // wrong than from one who gets almost nothing wrong: the first lands on a
  // given distractor by chance often enough that it proves little. Starting
  // everyone at one fixed rate labels weak students with beliefs they do not
  // hold and lets strong students' real ones slip through.
  const ability = responses.map(() => PARAMS.baseCorrect);
  let classAbility = PARAMS.baseCorrect;

  // One misconception for one student, given the latest estimate of the rest.
  const update = (s, m, record) => {
    const row = responses[s];
    const q = Q[s];
    const params = { express, baseCorrect: ability[s] };
    let x = logit(prior);
    const contributions = [];
    probing[m].forEach(probe => {
      const { item, i } = probe;
      const choice = row[i];

      // An unanswered question is not a wrong answer. It carries no evidence
      // in either direction, so it contributes nothing to the log-odds --
      // rather than being scored against the student, which would invent a
      // diagnosis out of a blank cell. It is still listed, because a teacher
      // reading the audit trail should see that the question went unanswered.
      if (choice == null || choice < 0) {
        if (record) contributions.push({
          itemId: item.id, choice: -1, chose: null, omitted: true,
          isDiagnostic: false, isCorrect: false, logOdds: 0
        });
        return;
      }

      const { withMis, withoutMis } = likelihoods(probe, m, q, choice, params);
      const delta = Math.log(withMis / withoutMis);
      x += delta;
      if (record) contributions.push({
        itemId: item.id,
        choice,
        chose: item.opts[choice].t,
        omitted: false,
        isDiagnostic: probe.optMis[choice] === m,
        isCorrect: choice === probe.ci,
        logOdds: delta
      });
    });
    LO[s][m] = x;
    q[m] = sigmoid(x);
    return contributions;
  };

  // Each misconception's posterior depends on the others through the
  // questions they share, so a row is solved by passes until nothing moves.
  const solveRows = () => responses.forEach((_, s) => {
    for (let pass = 0; pass < PASSES; pass++) misIds.forEach((__, m) => update(s, m, false));
  });

  // A right answer can only come from a question where no belief fired, so
  // accuracy is right answers over the expected number of such questions.
  const fitAbility = () => {
    const right = [], clean = [];
    responses.forEach((row, s) => {
      let r = 0, n = 0;
      probes.forEach(p => {
        const choice = row[p.i];
        if (choice == null || choice < 0) return;
        const noneHeld = p.mis.reduce((a, k) => a * (1 - Q[s][k]), 1);
        n += 1 - express * (1 - noneHeld);
        if (choice === p.ci) r++;
      });
      right.push(r); clean.push(n);
    });
    const totalClean = clean.reduce((a, b) => a + b, 0);
    classAbility = totalClean ? clamp(right.reduce((a, b) => a + b, 0) / totalClean, 0.1, 0.98) : PARAMS.baseCorrect;
    responses.forEach((_, s) => {
      ability[s] = clamp((right[s] + ABILITY_WEIGHT * classAbility) / (clean[s] + ABILITY_WEIGHT), 0.1, 0.98);
    });
  };

  // Some wrong options tempt everyone, belief or no belief: the answer you get
  // by a common arithmetic slip, or the one that sounds most like the
  // textbook. Treating a slip as equally likely to land anywhere reads every
  // pick of a tempting option as a belief. So where slips land is estimated
  // per question: each wrong answer counts toward its option by the odds that
  // it was a slip rather than a belief firing, shrunk toward the paper's own
  // split between belief-linked and other wrong options (`slipLift`).
  let slipLift = 1;
  const fitSlips = () => {
    const masses = probes.map(p => {
      const mass = p.item.opts.map(() => 0);
      responses.forEach((row, s) => {
        const choice = row[p.i];
        if (choice == null || choice < 0 || choice === p.ci) return;
        const base = (1 - express) * (1 - ability[s]) * p.slip[choice];
        let fired = 0;
        p.mis.forEach(m => {
          if (p.optMis[choice] !== m) return;
          const f = express / p.optMis.filter(k => k === m).length;
          fired += Q[s][m] * f / (f + base);
        });
        mass[choice] += 1 - Math.min(1, fired);
      });
      return mass;
    });

    // One question has a handful of slips to learn from; the whole paper has
    // hundreds. Whether the options written for a belief draw more careless
    // errors than the other wrong options is a property of the paper, so it
    // is pooled across every question, and each question is shrunk toward
    // that pooled split rather than toward an even one.
    const pooled = { mapped: [0, 0], other: [0, 0] };   // [slip mass, options]
    probes.forEach((p, j) => p.item.opts.forEach((_, oi) => {
      if (oi === p.ci) return;
      const side = p.optMis[oi] >= 0 ? pooled.mapped : pooled.other;
      side[0] += masses[j][oi]; side[1] += 1;
    }));
    // Per-option slip rates, each with one option's worth of even prior so a
    // paper with few of either kind stays near even.
    const even = (pooled.mapped[0] + pooled.other[0] + 1) / (pooled.mapped[1] + pooled.other[1] + 1);
    const rate = side => (side[0] + even) / (side[1] + 1);
    const lift = slipLift = rate(pooled.mapped) / rate(pooled.other);

    probes.forEach((p, j) => {
      const mass = masses[j];
      const weight = p.item.opts.map((_, oi) => (oi === p.ci ? 0 : p.optMis[oi] >= 0 ? lift : 1));
      const wSum = weight.reduce((a, b) => a + b, 0) || 1;
      const total = mass.reduce((a, b) => a + b, 0);
      p.slip = p.item.opts.map((_, oi) => (oi === p.ci ? 0
        : (mass[oi] + SLIP_WEIGHT * weight[oi] / wSum) / (total + SLIP_WEIGHT)));
    });
  };

  for (let round = 0; round < (fit ? ROUNDS : 1); round++) {
    solveRows();
    if (fit) { fitAbility(); fitSlips(); }
  }
  if (fit) solveRows();

  const evidence = responses.map((_, s) => misIds.map((__, m) => update(s, m, true)));
  const posterior = Q.map(r => r.slice());
  // Retain the raw log-odds alongside the probabilities. Item analysis needs
  // them to ask a leave-one-out question (see `posteriorWithout`), which is not
  // recoverable from the squashed posterior alone.
  const logits = LO.map(r => r.slice());

  return {
    posterior, misIds, evidence, logits, ability,
    fitted: { prior, express, classAbility, fit, slipLift }
  };
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

/** Below this share of questions answered, a clean result says nothing. */
export const MIN_ANSWERED = 0.5;

/** Fewer answered probes than this and a misconception has not been tested. */
export const MIN_PROBES_ANSWERED = 2;

/**
 * How much evidence each student actually gave.
 *
 * Blanks carry no evidence, so a student who skipped most of the paper keeps
 * the prior on every misconception, which sits below the reporting threshold.
 * Read naively that looks exactly like a student with no misconception at all.
 * It is the opposite: nothing is known about them. So the difference is made
 * explicit here, and everything downstream can say which of the two it means.
 *
 * @returns {{answered:number, total:number, thin:boolean}[]}
 */
export function coverage(pack, responses) {
  const total = pack.items.length;
  return responses.map(row => {
    const answered = row.filter(c => c != null && c >= 0).length;
    return { answered, total, thin: answered / total < MIN_ANSWERED };
  });
}

/** Misconceptions this student gave too few answers to test. */
export function untested(inference, s) {
  return inference.misIds.filter((_, k) => !isTested(inference, s, k));
}

/** Whether a student answered enough probes to report a misconception estimate. */
export function isTested(inference, s, mIndex) {
  return inference.evidence[s][mIndex]
    .filter(contribution => !contribution.omitted).length >= MIN_PROBES_ANSWERED;
}

/**
 * How far a diagnosis can be trusted, in the terms a teacher acts on.
 *
 * Measured on the stress benchmark (both packs, ten kinds of class): a belief
 * over the line on a single telling answer is right 42% of the time, worse
 * than a coin; on two, 79%; on three or more, 97%. So a belief needs
 * MIN_TELLING answers that point to it before it is reported. One that clears
 * the line on fewer is "check": worth one more question before acting on it.
 * Above CLEAR on two or more, 95% are right.
 *
 * @returns {{p, level: 'untested'|'none'|'check'|'likely'|'clear', telling, answered, total, omitted}}
 */
export const MIN_TELLING = 2;
export const CLEAR = 0.85;

export function strength(inference, s, k) {
  const p = inference.posterior[s][k];
  const ev = inference.evidence[s][k];
  const telling = ev.filter(c => c.isDiagnostic).length;
  const answered = ev.filter(c => !c.omitted).length;
  let level;
  if (!isTested(inference, s, k)) level = 'untested';
  else if (p < PARAMS.decisionThreshold) level = 'none';
  else if (telling < MIN_TELLING) level = 'check';
  else level = p >= CLEAR ? 'clear' : 'likely';
  return { p, level, telling, answered, total: ev.length, omitted: ev.length - answered };
}

/**
 * Posterior values safe to use for grouping and diagnosis summaries.
 * Untested patterns stay at the prior instead of forming an actionable signal,
 * and a belief that rests on one telling answer is held just under the line,
 * so it cannot put a student into a reteach group on its own.
 */
export function posteriorForReporting(inference) {
  const below = PARAMS.decisionThreshold - 0.01;
  return inference.posterior.map((row, s) =>
    row.map((p, k) => {
      if (!isTested(inference, s, k)) return PARAMS.prior;
      return strength(inference, s, k).level === 'check' ? Math.min(p, below) : p;
    }));
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
