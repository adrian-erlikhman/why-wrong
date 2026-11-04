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

const MIN_ITEM_RESPONSES = 5; // corrUpper treats fewer as too small to judge.
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
 * Upper end of a one-sided confidence interval for a correlation (Fisher's z).
 * At 28 students a correlation of 0.10 is compatible with anything from about
 * -0.2 to 0.4, so "low" is only a finding when even the top of that range is
 * low. Below that, the honest verdict is that the class is too small to tell.
 */
function corrUpper(r, n, z = 1.28) {
  if (n < 5) return 1;
  const c = Math.min(Math.max(r, -0.999), 0.999);
  return Math.tanh(Math.atanh(c) + z / Math.sqrt(n - 3));
}

/** One-sided two-proportion z: is a share among `na` students higher than among `nb`? */
function liftZ(pa, na, pb, nb) {
  if (!na || !nb) return 0;
  const pool = (pa * na + pb * nb) / (na + nb);
  const se = Math.sqrt(pool * (1 - pool) * (1 / na + 1 / nb));
  return se > 0 ? (pa - pb) / se : 0;
}

// Calibrated on the stress benchmark (test/benchmark.mjs, runAudit), where
// flat and miskeyed questions are planted next to sound ones. See the
// comments at each use.
const LOW_R = 0.15;             // below this a question is not separating students
const AUDIT = {
  liftMin: 0.15, liftZ: 1.64,   // defence of a diagnostic question
  keyLift: 0.15, keyShare: 0.4, // check the key
  skipZ: 2.5                    // skipped clearly more than the rest of the paper
};

/**
 * @returns {Array} one record per item, in item order.
 */
export function analyseItems(pack, responses, inference = null) {
  if (!Array.isArray(responses)) {
    throw new TypeError('Responses must be an array of student answer rows.');
  }
  if (responses.length === 0) {
    throw new RangeError('Item analysis requires at least one student response row.');
  }

  const ITEMS = pack.items;
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

  const nStudents = responses.length;
  const ci = ITEMS.map(correctIndex);
  const scored = responses.map(row => row.map((c, i) => (c === ci[i] ? 1 : 0)));
  const totals = scored.map(r => r.reduce((a, b) => a + b, 0));
  const answeredBy = responses.map(row => row.filter(isAnswered).length);
  const blankRate = nStudents && ITEMS.length
    ? responses.reduce((n, row) => n + row.filter(c => !isAnswered(c)).length, 0) / (nStudents * ITEMS.length)
    : 0;

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
    let agreementOthers = null;
    let agreementLift = null;
    let agreementN = 0;
    let signalN = 0;
    let signalMis = null;
    let concentrated = false;

    // Who the rest of the paper says holds `mid`, among the students who chose
    // (or did not choose) one of its answers here and answered enough of its
    // other questions to tell. The test asks whether the remaining items
    // provide *net positive evidence*, not whether they independently clear a
    // threshold: with two probes, removing one leaves a single item behind,
    // and a single item can never clear an absolute bar. So the question for
    // the evidence that survives is directional, above the prior or below it.
    const agreement = (mid, chose) => {
      const mIndex = inference.misIds.indexOf(mid);
      if (mIndex < 0) return null;
      const assessable = responses.map((_, s) => s).filter(s => isAnswered(responses[s][i]) &&
        inference.evidence[s][mIndex]?.filter(c => !c.omitted && c.itemId !== item.id).length >= MIN_PROBES_ANSWERED);
      const says = s => posteriorWithout(inference, s, mIndex, item.id) > PARAMS.prior;
      const C = assessable.filter(s => chose(responses[s][i]));
      const O = assessable.filter(s => !chose(responses[s][i]));
      const share = C.length ? C.filter(says).length / C.length : null;
      const others = O.length ? O.filter(says).length / O.length : 0;
      return { n: C.length, share, others, lift: share === null ? null : share - others, z: share === null ? 0 : liftZ(share, C.length, others, O.length) };
    };

    if (inference) {
      const top = options.filter(o => o.mis && o.count > 0)
        .sort((a, b) => b.count - a.count)[0];
      if (top) {
        signalMis = top.mis;
        const chose = c => isAnswered(c) && item.opts[c].mis === signalMis;
        signalN = responses.filter(row => chose(row[i])).length;
        const a = agreement(signalMis, chose);
        agreementN = a ? a.n : 0;
        if (a && agreementN >= 3) {
          modelAgreement = a.share;
          agreementOthers = a.others;
          agreementLift = a.lift;
          // Compared with the rest of the class, not with a fixed bar. How many
          // students show a belief elsewhere depends on how common it is, so a
          // fixed 60% defended rare beliefs' questions too seldom and common
          // ones' too often. What a working diagnostic question shows is lift:
          // on the benchmark, 0.34-0.50 for sound questions and about 0 for
          // flat or miskeyed ones.
          concentrated = a.lift >= AUDIT.liftMin && a.z >= AUDIT.liftZ;
        }
      }
    }

    // Is the key wrong? The classic check: the strongest third of the class
    // (by the rest of the paper) favour one wrong option over the key. On its
    // own that also fires on hard diagnostic questions, where strong students
    // genuinely hold the belief. What separates a miskey is that the students
    // who chose that option show no sign of its belief anywhere else: they
    // chose it because it is right. On the benchmark this names most planted
    // miskeys at about one false alarm per six classes.
    let keyCheck = null;
    if (inference && r !== null && who.length >= 9 && r < LOW_R) {
      const ranked = who.map((s, k) => [rest[k], s]).sort((a, b) => b[0] - a[0]);
      const top = ranked.slice(0, Math.max(3, Math.round(who.length / 3))).map(x => x[1]);
      const topCount = oi => top.filter(s => responses[s][i] === oi).length;
      const fav = item.opts.map((_, oi) => oi).filter(oi => oi !== ci[i])
        .sort((a, b) => topCount(b) - topCount(a))[0];
      const favN = topCount(fav);
      if (favN >= 3 && favN > topCount(ci[i]) && favN >= AUDIT.keyShare * top.length) {
        const mis = item.opts[fav].mis;
        const a = mis ? agreement(mis, c => c === fav) : null;
        if (!a || a.lift === null || a.lift < AUDIT.keyLift) keyCheck = { option: fav, topN: top.length, favN, keyN: topCount(ci[i]) };
      }
    }

    // A correlation over a dozen students swings by about 0.3 on noise alone,
    // so a verdict is given only when the whole plausible range is low: the top
    // of its 80% interval (corrUpper). Otherwise the question is too early to
    // tell, which is what the data supports. On the benchmark this halves the
    // sound questions sent for rewriting in a class of 28, and it grows
    // stricter by itself as the class shrinks. A hair below zero is still zero,
    // so backward takes a real gap.
    const rUpper = r === null ? null : corrUpper(r, col.length);
    const backward = r !== null && r < 0 && rUpper < 0.05;
    const flat = r !== null && !backward && r < LOW_R && rUpper < 0.30;
    const unclear = r !== null && !backward && !flat && r < LOW_R;

    // Judged on the percentage the teacher sees: 13 of 14 shows as 93% and is
    // treated as 93%, not as the 92.9% it is.
    const nearlyAll = answered >= MIN_ITEM_RESPONSES && Math.round(p * 100) >= 93;

    const flags = [];
    if (keyCheck) flags.push({ kind: 'miskey', text: `Your strongest students chose "${item.opts[keyCheck.option].t}" (${keyCheck.favN} of the top ${keyCheck.topN}) more often than the keyed answer (${keyCheck.keyN}), and nothing else on the paper suggests they hold the belief that option was written for. Check the answer key.` });
    if (nearlyAll) flags.push({ kind: 'no-information', text: `${Math.round(p * 100)}% answered correctly, so this question may offer little information for this class.` });
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
    if (backward) flags.push({ kind: 'negative-discrimination', text: `Students with higher scores on the other questions were less likely to answer this one correctly (discrimination ${r.toFixed(2)}), by more than chance explains.` });
    else if (flat) flags.push({ kind: 'no-discrimination', text: `Scores on the other questions were not strongly related to this answer (discrimination ${r.toFixed(2)}).` });
    else if (unclear) flags.push({ kind: 'unclear', text: `Discrimination is ${r.toFixed(2)}, but with ${col.length} students that could be chance: it could plausibly be as high as ${rUpper.toFixed(2)}. Too early to tell; look again with the next class.` });

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

    // Skipped more than the rest of the paper, not merely often: a class that
    // leaves 15% of every page blank has not found this question harder. Half
    // the class or more is worth a look whatever the rest of the paper did.
    const skipRate = omitted / (nStudents || 1);
    const skipSe = Math.sqrt(Math.max(blankRate * (1 - blankRate), 1e-6) / (nStudents || 1));
    if (skipRate >= 0.5 || (skipRate >= 0.20 && (skipRate - blankRate) / skipSe >= AUDIT.skipZ)) {
      flags.push({ kind: 'skipped', text: `${Math.round(skipRate * 100)}% of the class left this blank${blankRate < skipRate ? `, against ${Math.round(blankRate * 100)}% across the paper` : ''}. Review the timing and wording to see whether either may have contributed.` });
    }

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
    const lowDiscrim = r !== null && r < LOW_R;

    // Severity also matters. A rarely chosen distractor may be a minor issue,
    // and "too early to tell" is not a finding; report both separately from
    // patterns that warrant a closer review. A suspected miskey comes before
    // all of it: every other number about the item is computed against a key
    // that may be wrong.
    const serious = flags.filter(f => !['dead-distractor', 'unclear'].includes(f.kind));

    let quality;
    if (keyCheck) quality = 'key';
    else if (nearlyAll) quality = 'weak';                  // little variation in this class
    else if (r === null) quality = 'insufficient';
    else if (concentrated && lowDiscrim) quality = 'diagnostic';
    else if (backward) quality = 'broken';
    else if (serious.length) quality = 'weak';
    else if (unclear) quality = 'watch';
    else if (flags.length) quality = 'minor';
    else quality = r >= 0.3 ? 'strong' : 'ok';

    const misName = pack.misconceptions.find(m => m.id === signalMis)?.name ?? signalMis;
    const note = quality === 'diagnostic'
      ? `This question has a weak relationship with overall scores (${r.toFixed(2)}). Of the ${signalN} students who chose an answer written for “${misName}”, ${agreementN} answered enough other questions to check for a similar pattern; ${Math.round(modelAgreement * 100)}% of those did, against ${Math.round(agreementOthers * 100)}% of the rest of the class. It is diagnosing rather than ranking; review that evidence before deciding whether to keep the item.`
      : null;

    return {
      id: item.id,
      index: i,
      stem: item.stem,
      topic: item.topic,
      difficulty: p,
      discrimination: r,
      discriminationUpper: rUpper,
      diagnosticShare,
      correct,
      answered,
      omitted,
      modelAgreement,
      agreementOthers,
      agreementLift,
      agreementN,
      keyCheck,
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
  'miskey': 4,              // every number about the item rests on the key
  'insufficient-discrimination-data': 2,
  'no-information': 3,      // offers little variation in this class
  'uninformative': 3,       // no ranking and no diagnosis
  'below-chance': 3,        // substantially worse than random guessing
  'negative-discrimination': 2,
  'at-chance': 2,
  'no-discrimination': 1,   // marginal: often just a small sample
  'skipped': 2,
  'unclear': 0,             // too few students to say
  'dead-distractor': 0
};

/** Highest severity among an item's flags. */
export function severityOf(item) {
  return item.flags.reduce((m, f) => Math.max(m, FLAG_SEVERITY[f.kind] ?? 0), 0);
}

/**
 * The flags worth showing for an item, most serious first. "Too early to
 * tell" is the item's whole story only when nothing firmer was found; next to
 * a firmer finding it reads as a contradiction, so it is left out.
 */
export function shownFlags(item) {
  return item.flags
    .filter(f => f.kind !== 'unclear' || item.quality === 'watch')
    .slice()
    .sort((a, b) => (FLAG_SEVERITY[b.kind] ?? 0) - (FLAG_SEVERITY[a.kind] ?? 0));
}

export function problemItems(stats) {
  return stats
    .filter(s => s.flags.length && ['key', 'broken', 'weak', 'insufficient'].includes(s.quality))
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
