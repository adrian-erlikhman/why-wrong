/**
 * itemstats.js -- classical item analysis.
 * ---------------------------------------------------------------------------
 * The second surface of the tool: turn the lens back on the test itself.
 *
 * This module summarizes how questions performed in the response matrix. The
 * statistics are descriptive signals for review, not verdicts about an item.
 *
 *   Difficulty (p)        proportion answering correctly. Near 1.0 means the
 *                         item separates nobody.
 *   Discrimination (r)    corrected point-biserial: correlation between getting
 *                         this item right and the student's score on the other
 *                         items. A low value can flag an item for review, but
 *                         diagnostic items may be useful without tracking score.
 *   Dead distractor       an option almost nobody selected, which contributes
 *                         no information and effectively shortens the item.
 *
 * Rules of thumb used for flagging follow standard classroom item-analysis
 * practice: r >= 0.30 good, 0.15-0.30 marginal, < 0.15 not discriminating.
 */

import { correctIndex } from './pack.js';
import { posteriorWithout, PARAMS, MIN_PROBES_ANSWERED } from './infer.js';

const isAnswered = c => c != null && c >= 0;

function pearson(x, y) {
  if (x.length < 3) return null;

  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

function binomialUpperTail(successes, trials, probability) {
  if (successes <= 0) return 1;
  if (successes > trials || probability <= 0) return 0;
  if (probability >= 1) return 1;

  const failures = trials - successes;
  const terms = Math.min(successes, failures);
  let logChoose = 0;
  for (let i = 1; i <= terms; i++) {
    logChoose += Math.log(trials - terms + i) - Math.log(i);
  }

  const logP = Math.log(probability);
  const logQ = Math.log1p(-probability);
  let logTerm = logChoose + successes * logP + failures * logQ;
  let logTail = logTerm;
  for (let k = successes; k < trials; k++) {
    logTerm += Math.log(trials - k) - Math.log(k + 1) + logP - logQ;
    const high = Math.max(logTail, logTerm);
    logTail = high + Math.log1p(Math.exp(Math.min(logTail, logTerm) - high));
  }
  return Math.min(1, Math.exp(logTail));
}

/**
 * @returns {Array} one record per item, in item order.
 */
export function analyseItems(pack, responses, inference = null) {
  const ITEMS = pack.items;
  const nStudents = responses.length;
  const ci = ITEMS.map(correctIndex);
  const scored = responses.map(row => row.map((c, i) => (c === ci[i] ? 1 : 0)));
  const totals = scored.map(r => r.reduce((a, b) => a + b, 0));
  const answeredBy = responses.map(row => row.filter(isAnswered).length);

  return ITEMS.map((item, i) => {
    // A blank is not a wrong answer, here any more than in the inference. Each
    // statistic is taken over the students who actually answered this question,
    // and a student's rest score is their share right on the others they
    // answered, so a skipped half-paper does not read as a weak student. On a
    // paper with no blanks that share is the rest score divided by a constant,
    // which leaves the correlation exactly where it was.
    const who = responses.map((_, s) => s)
      .filter(s => isAnswered(responses[s][i]) && answeredBy[s] > 1);
    const col = who.map(s => scored[s][i]);
    const rest = who.map(s => (totals[s] - scored[s][i]) / (answeredBy[s] - 1));
    const answered = responses.filter(row => isAnswered(row[i])).length;
    const correct = responses.filter(row => row[i] === ci[i]).length;
    const p = answered ? correct / answered : 0;
    const r = pearson(col, rest);

    const counts = item.opts.map((_, oi) =>
      responses.reduce((n, row) => n + (row[i] === oi ? 1 : 0), 0)
    );
    // Blanks match no option, so they drop out of the counts naturally. Track
    // them explicitly: an item a third of the class skipped is telling you
    // something, and its option shares will not sum to 100% without this.
    const omitted = responses.reduce((n, row) => n + (row[i] == null || row[i] < 0 ? 1 : 0), 0);
    const options = item.opts.map((o, oi) => ({
      index: oi,
      text: o.t,
      correct: !!o.c,
      mis: o.mis || null,
      count: counts[oi],
      share: counts[oi] / nStudents,
      dead: answered > 0 && !o.c && counts[oi] / answered < 0.03
    }));

    // How concentrated is the item's diagnostic signal? An item can have poor
    // *global* discrimination and still be extremely useful, if its wrong
    // answers pile onto one misconception-mapped option. That is a diagnostic
    // item doing diagnostic work rather than ranking work, and flagging it as
    // "bad" would be a mistake -- so it is separated out explicitly below.
    const diagnosticShare = Math.max(0, ...options.filter(o => o.mis).map(o => o.share));
    const chance = 1 / item.opts.length;

    // Does this item agree with the rest of the test?
    //
    // Counting how many students chose a diagnostic distractor has almost no
    // statistical power at classroom sample sizes: a misconception held by a
    // quarter of 28 students is roughly 7 responses, which is not separable
    // from uniform noise by any per-item test.
    //
    // So use the other items as one source of evidence. For students who chose
    // this item's main mapped distractor, check whether the *rest of the test*
    // provides positive evidence for the same pattern. Agreement supports
    // reviewing the mapping; disagreement can flag the item or mapping for
    // review. Neither result proves that an item is valid or invalid.
    //
    // The posterior used here has this item's own contribution subtracted out,
    // so the item is not permitted to vote on its own validity.
    let modelAgreement = null;
    let agreementN = 0;
    let signalN = 0;
    let signalMis = null;

    if (inference) {
      const top = options.filter(o => o.mis && o.count > 0)
        .sort((a, b) => b.count - a.count)[0];
      if (top) {
        signalMis = top.mis;
        const mIndex = inference.misIds.indexOf(top.mis);
        const chosers = responses
          .map((row, s) => (row[i] === top.index ? s : -1))
          .filter(s => s >= 0);
        signalN = chosers.length;
        const assessable = chosers.filter(s =>
          inference.evidence[s][mIndex]?.filter(c => !c.omitted && c.itemId !== item.id).length >= MIN_PROBES_ANSWERED);
        agreementN = assessable.length;
        if (agreementN >= 3 && mIndex >= 0) {
          // The test asks whether the remaining items provide *net positive
          // evidence*, not whether they independently clear 50%. With each
          // misconception probed by only two items, removing one leaves a
          // single item behind, and a single item can never clear an absolute
          // threshold -- that is the whole premise of the inference model. The
          // right question for the evidence that survives is directional: does
          // it push the probability above the prior, or below it?
          const agreeing = assessable.filter(s =>
            posteriorWithout(inference, s, mIndex, item.id) > PARAMS.prior).length;
          modelAgreement = agreeing / agreementN;
        }
      }
    }

    // A correlation over a dozen students swings by about 0.3 on noise alone, so
    // the bars below move with class size. Above a class of 28, where the rules
    // of thumb in the header were set, they stay where they are. A hair below zero
    // is still zero, so backward takes a real gap.
    const noise = Math.max(0, 1 / Math.sqrt(Math.max(1, col.length - 1)) - 1 / Math.sqrt(27));
    const weakBar = 0.15 - noise;
    const backwardBar = -0.1 - noise;

    const flags = [];
    if (p >= 0.93) flags.push({ kind: 'no-information', text: `${Math.round(p * 100)}% answered correctly, so this question may offer little information for this class.` });
    // A low mean score alone does not establish a problem. Separate a result
    // that is unusually far below chance from one that is merely inconclusive.
    const chanceUpperTail = answered > 0 ? binomialUpperTail(correct, answered, chance) : null;
    const chanceLowerTail = answered > 0
      ? binomialUpperTail(answered - correct, answered, 1 - chance)
      : null;
    const belowChance = chanceLowerTail !== null && chanceLowerTail <= 0.05;
    if (r === null) {
      flags.push({ kind: 'insufficient-discrimination-data', text: 'Too few students or too little score variation on the other questions to estimate discrimination.' });
    }
    if (belowChance) {
      flags.push({ kind: 'below-chance', text: `Only ${Math.round(p * 100)}% answered correctly, unusually low for guessing among ${item.opts.length} choices. Check the answer key and wording.` });
    } else if (answered > 0 && r !== null && p <= chance + 0.06 && r < 0.15) {
      flags.push({ kind: 'at-chance', text: `${Math.round(p * 100)}% answered correctly, compared with ${Math.round(chance * 100)}% expected from guessing. Scores on the other questions were not strongly related to this answer.` });
    }
    if (r !== null && r < backwardBar) flags.push({ kind: 'negative-discrimination', text: `Students with higher scores on the other questions were less likely to answer this one correctly (discrimination ${r.toFixed(2)}).` });
    else if (r !== null && r < weakBar) flags.push({ kind: 'no-discrimination', text: `Scores on the other questions were not strongly related to this answer (discrimination ${r.toFixed(2)}).` });

    // An item whose wrong answers are mapped to nothing, and on which the class
    // is performing at chance, produces neither a ranking nor a diagnosis. That
    // is a different failure from poor discrimination and is worth naming
    // separately, because the remedy is different: rewrite the options so the
    // wrong ones mean something.
    // Check both exact binomial tails: neither a high nor a low result should be
    // described as chance-like when it is unlikely under random guessing.
    const indistinguishableFromGuessing = chanceUpperTail !== null &&
      chanceLowerTail > 0.05 && chanceUpperTail > 0.05;

    if (answered > 0 && diagnosticShare === 0 && indistinguishableFromGuessing && r !== null && r < 0.30) {
      flags.push({ kind: 'uninformative', text: `None of this question's wrong answers are linked to a known misunderstanding, and ${Math.round(p * 100)}% correct is close to the ${Math.round(chance * 100)}% expected from guessing. Review the item and its answer choices.` });
    }

    if (omitted / nStudents >= 0.20) flags.push({ kind: 'skipped', text: Math.round((omitted / nStudents) * 100) + '% of the class left this blank. Review the timing and wording to see whether either may have contributed.' });

    const dead = options.filter(o => o.dead);
    if (dead.length) flags.push({ kind: 'dead-distractor', text: `${dead.length} option${dead.length > 1 ? 's were' : ' was'} chosen by almost nobody (${dead.map(o => `"${o.text}"`).join(', ')}), so the question has fewer real choices than it looks.` });

    // Classify the response patterns, not the underlying quality of the item.
    //
    // The ordering here is the whole argument. Point-biserial discrimination
    // asks "did students who did well overall also get this right", which
    // presumes the test measures one underlying trait. A diagnostic instrument
    // does not necessarily: a question aimed at a particular pattern may have
    // a weak relationship with total score and still offer useful evidence.
    //
    // So mapped-answer concentration and agreement with the other items are
    // considered before the correlation verdict. These signals can help
    // prioritize review, but cannot establish that an item is valid or broken.
    const concentrated = modelAgreement !== null && modelAgreement >= 0.6;
    const lowDiscrim = r !== null && r < weakBar;

    // Severity also matters. A rarely chosen distractor may be a minor issue;
    // report it separately from patterns that warrant a closer review.
    const serious = flags.filter(f => f.kind !== 'dead-distractor');

    let quality;
    if (p >= 0.93) quality = 'weak';                       // little variation in this class
    else if (r === null) quality = 'insufficient';
    else if (concentrated && lowDiscrim) quality = 'diagnostic';
    else if (r < backwardBar) quality = 'broken';
    else if (serious.length) quality = 'weak';
    else if (flags.length) quality = 'minor';
    else quality = r >= 0.3 ? 'strong' : 'ok';

    const note = quality === 'diagnostic'
      ? `This question has a weak relationship with overall scores (${r.toFixed(2)}). Of the ${signalN} students who chose "${options.find(o => o.mis === signalMis && o.count > 0)?.text ?? ''}", ${agreementN} answered enough other questions to check for a similar pattern; ${Math.round(modelAgreement * 100)}% of those did. Review that evidence before deciding whether to keep the item.`
      : null;

    return {
      id: item.id,
      index: i,
      stem: item.stem,
      topic: item.topic,
      difficulty: p,
      discrimination: r,
      diagnosticShare,
      correct,
      answered,
      omitted,
      modelAgreement,
      agreementN,
      signalN,
      signalMis,
      options,
      flags,
      quality,
      note
    };
  });
}

/**
 * Items worth showing the teacher first, worst offenders leading.
 * Diagnostic items are deliberately excluded: they carry flags, but they are
 * not defects.
 */
const FLAG_SEVERITY = {
  'insufficient-discrimination-data': 2,
  'no-information': 3,      // offers little variation in this class
  'uninformative': 3,       // no ranking and no diagnosis
  'below-chance': 3,        // substantially worse than random guessing
  'negative-discrimination': 2,
  'at-chance': 2,
  'no-discrimination': 1,   // marginal: often just a small sample
  'skipped': 2,
  'dead-distractor': 0
};

/** Highest severity among an item's flags. */
export function severityOf(item) {
  return item.flags.reduce((m, f) => Math.max(m, FLAG_SEVERITY[f.kind] ?? 0), 0);
}

export function problemItems(stats) {
  return stats
    .filter(s => s.flags.length && ['broken', 'weak', 'insufficient'].includes(s.quality))
    .sort((a, b) => {
      const bySeverity = severityOf(b) - severityOf(a);
      if (bySeverity) return bySeverity;
      if (a.discrimination === null) return b.discrimination === null ? 0 : 1;
      if (b.discrimination === null) return -1;
      return a.discrimination - b.discrimination;
    });
}

/** Items that look weak on the usual statistics but are actually diagnostic. */
export function diagnosticItems(stats) {
  return stats.filter(s => s.quality === 'diagnostic')
    .sort((a, b) => b.diagnosticShare - a.diagnosticShare);
}

const MIN_COMPLETE_PAPERS = 5;

/**
 * Whole-instrument reliability: Cronbach's alpha over the scored matrix.
 *
 * Read with care. Alpha measures internal consistency under the assumption
 * that every item taps one common trait. This instrument is deliberately
 * multidimensional -- twelve unrelated misconceptions -- so a *low* alpha is
 * the expected result and is evidence that the items are measuring different
 * things, which is the design intent. It is not evidence the test is bad.
 * `interpretAlpha` says so rather than leaving the number to be misread.
 */
export function cronbachAlpha(pack, allResponses) {
  // Alpha needs every item for every student, so it is taken over complete
  // papers only. Too few of those and there is no honest number to give.
  const responses = allResponses.filter(row => row.every(isAnswered));
  if (responses.length < MIN_COMPLETE_PAPERS) return null;

  const ITEMS = pack.items;
  const ci = ITEMS.map(correctIndex);
  const scored = responses.map(row => row.map((c, i) => (c === ci[i] ? 1 : 0)));
  const k = ITEMS.length;
  const n = responses.length;

  const itemVar = ITEMS.map((_, i) => {
    const col = scored.map(r => r[i]);
    const m = col.reduce((a, b) => a + b, 0) / n;
    return col.reduce((s, v) => s + (v - m) ** 2, 0) / n;
  });
  const totals = scored.map(r => r.reduce((a, b) => a + b, 0));
  const mt = totals.reduce((a, b) => a + b, 0) / n;
  const totalVar = totals.reduce((s, v) => s + (v - mt) ** 2, 0) / n;

  if (totalVar === 0) return 0;
  return (k / (k - 1)) * (1 - itemVar.reduce((a, b) => a + b, 0) / totalVar);
}

/** Plain-language reading of an alpha value for a multidimensional instrument. */
export function interpretAlpha(alpha, nMisconceptions) {
  if (alpha === null) return 'Too few fully answered papers to estimate this reliably.';
  if (alpha >= 0.8) {
    return `${alpha.toFixed(2)}, which is high. The questions tend to move together; check that they still distinguish the different misunderstandings this test is designed to assess.`;
  }
  if (alpha >= 0.5) {
    return `${alpha.toFixed(2)}, which is moderate. The questions share some response patterns, while also addressing separate misunderstandings.`;
  }
  return `${alpha.toFixed(2)}, which is low. This test covers ${nMisconceptions} different misunderstandings, so a low value is not automatically a sign of poor quality. Read it alongside the item-level results.`;
}

/** Items with only cosmetic defects (a wasted option), worth a second pass. */
export function minorItems(stats) {
  return stats.filter(s => s.quality === 'minor');
}
