/**
 * Pipeline sanity + recovery test.
 * Run: node test/pipeline.test.mjs
 *
 * Validates every built-in pack against the pack contract, then runs the
 * pipeline over many simulated classes to measure recovery against their
 * planted profiles. These checks cover the simulation, not real-class accuracy.
 */

import { BUILT_IN, addPack } from '../js/packs/index.js';
import { validatePack, itemsProbing, misIds, MIN_PROBES, correctIndex } from '../js/pack.js';
import { generateClass, generateRetest, totalScores } from '../js/simulate.js';
import { inferMisconceptions, posteriorWithout, diagnose, coverage, untested, isTested, posteriorForReporting, MIN_ANSWERED, PARAMS } from '../js/infer.js';
import { clusterStudents, describeClusters, separateThin, reteachGroups, adjustedRandIndex as scoreClusteringPair } from '../js/cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha } from '../js/itemstats.js';
import { scoreDiagnosis, scoreClustering } from '../js/validate.js';
import { paperOrder, paperLetter, parseResponses, quizHtml, reviewHtml, slipsHtml, csvCell, groupsCsv } from '../js/importer.js';
import { classFile, readClassFile, fingerprint, testFile } from '../js/session.js';
import { compareSittings, comparePredictions, matchStudents, mcnemarExact, normName, progressCsv } from '../js/compare.js';
import { generatePack } from '../js/generate.js';
import { rewritePlan, setKey } from '../js/llm.js';
import { escapeHtml, mathHtml } from '../js/notation.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const min = a => Math.min(...a);

check('the default diagnosis cutoff excludes weaker posterior estimates',
  PARAMS.decisionThreshold === 0.6 &&
  !diagnose([[0.59, 0.6]], ['below', 'at'])[0].has('below') &&
  diagnose([[0.59, 0.6]], ['below', 'at'])[0].has('at'));

const allDiagnosticPack = {
  misconceptions: [{ id: 'M', name: 'Test misconception' }],
  items: [{
    id: 'Q',
    opts: [
      { t: 'Correct', c: true },
      { t: 'Wrong A', mis: 'M' },
      { t: 'Wrong B', mis: 'M' },
      { t: 'Wrong C', mis: 'M' }
    ]
  }]
};
const allDiagnosticPosterior = inferMisconceptions(allDiagnosticPack, [[1]]).posterior[0][0];
const withMisLikelihood =
  (PARAMS.express + (1 - PARAMS.express) * (1 - PARAMS.recoverCorrect)) / 3;
const withoutMisLikelihood = (1 - PARAMS.baseCorrect) / 3;
const expectedAllDiagnosticPosterior =
  PARAMS.prior * withMisLikelihood /
  (PARAMS.prior * withMisLikelihood + (1 - PARAMS.prior) * withoutMisLikelihood);
check('all-diagnostic items preserve the full likelihood probability mass',
  Math.abs(allDiagnosticPosterior - expectedAllDiagnosticPosterior) < 1e-12,
  `${allDiagnosticPosterior} vs ${expectedAllDiagnosticPosterior}`);

const saturationCount = 30;
const saturationItems = Array.from({ length: saturationCount }, (_, i) => ({
  id: `Q${i}`,
  opts: [
    { t: 'Correct', c: true },
    { t: 'Diagnostic', mis: 'M' },
    { t: 'Other A' },
    { t: 'Other B' }
  ]
}));
const saturationPack = { misconceptions: allDiagnosticPack.misconceptions, items: saturationItems };
const saturationInference = inferMisconceptions(saturationPack, [saturationItems.map(() => 1)]);
const diagnosticLogOdds = Math.log(PARAMS.express / ((1 - PARAMS.baseCorrect) / 3));
const expectedSaturatedLogit =
  Math.log(PARAMS.prior / (1 - PARAMS.prior)) + saturationCount * diagnosticLogOdds;
check('raw log-odds survive posterior saturation for leave-one-out analysis',
  saturationInference.posterior[0][0] === 1 &&
  Math.abs(saturationInference.logits[0][0] - expectedSaturatedLogit) < 1e-12 &&
  Math.abs(posteriorWithout(saturationInference, 0, 0, 'Q0') - 1 / (1 + Math.exp(-(expectedSaturatedLogit - diagnosticLogOdds)))) < 1e-12);

let normalizedLikelihoods = true;
let likelihoodChecks = 0;
BUILT_IN.forEach(pack => pack.items.forEach((item, itemIndex) => {
  const mappedMisconceptions = [...new Set(item.opts.map(option => option.mis).filter(Boolean))];
  mappedMisconceptions.forEach(mid => {
    let withMisTotal = 0;
    let withoutMisTotal = 0;
    item.opts.forEach((_, choice) => {
      const row = Array(pack.items.length).fill(-1);
      row[itemIndex] = choice;
      const posterior = inferMisconceptions(pack, [row]).posterior[0][pack.misconceptions.findIndex(m => m.id === mid)];
      const oddsRatio = (posterior / (1 - posterior)) / (PARAMS.prior / (1 - PARAMS.prior));
      const withoutMis = choice === correctIndex(item)
        ? PARAMS.baseCorrect
        : (1 - PARAMS.baseCorrect) / (item.opts.length - 1);
      withMisTotal += oddsRatio * withoutMis;
      withoutMisTotal += withoutMis;
    });
    likelihoodChecks += 1;
    if (Math.abs(withMisTotal - 1) > 1e-10 || Math.abs(withoutMisTotal - 1) > 1e-10) {
      normalizedLikelihoods = false;
    }
  });
}));
check(`response likelihoods normalize for all ${likelihoodChecks} built-in item-misconception pairs`,
  normalizedLikelihoods);

const throwsAs = (fn, ErrorType) => {
  try { fn(); } catch (error) { return error instanceof ErrorType; }
  return false;
};
check('inference rejects a response row with the wrong number of answers',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, [[]]), RangeError));
check('inference rejects a response matrix that is not an array',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, null), TypeError));
check('inference rejects a response row that is not an array',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, [1]), RangeError));
check('inference rejects a missing student row',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, Array(1)), RangeError));
check('inference rejects a negative answer other than the blank sentinel',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, [[-2]]), RangeError));
check('inference rejects a non-integer answer index',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, [[0.5]]), RangeError));
check('inference rejects an answer index outside the option list',
  throwsAs(() => inferMisconceptions(allDiagnosticPack, [[4]]), RangeError));
check('inference accepts null as a blank and leaves the prior unchanged',
  inferMisconceptions(allDiagnosticPack, [[null]]).posterior[0][0] === PARAMS.prior);
check('inference accepts undefined and sparse answer cells as blanks',
  inferMisconceptions(allDiagnosticPack, [[undefined]]).posterior[0][0] === PARAMS.prior &&
  inferMisconceptions(allDiagnosticPack, [Array(1)]).posterior[0][0] === PARAMS.prior);
const specialIdPack = {
  misconceptions: [{ id: '__proto__', name: 'Special identifier' }],
  items: [{
    id: 'Q',
    opts: [{ t: 'Correct', c: true }, { t: 'Diagnostic', mis: '__proto__' }]
  }]
};
check('inference handles misconception ids that are object prototype names',
  inferMisconceptions(specialIdPack, [[1]]).evidence[0][0][0].isDiagnostic);
const singleDiagnosticPack = {
  misconceptions: allDiagnosticPack.misconceptions,
  items: [{
    id: 'Q',
    opts: [
      { t: 'Correct', c: true },
      { t: 'Diagnostic', mis: 'M' },
      { t: 'Unmapped A' },
      { t: 'Unmapped B' }
    ]
  }]
};
const oneProbeInference = inferMisconceptions(singleDiagnosticPack, [[1]]);
check('one strong answer can raise the raw estimate but is not reportable before two probes',
  oneProbeInference.posterior[0][0] >= PARAMS.decisionThreshold &&
  !isTested(oneProbeInference, 0, 0) &&
  posteriorForReporting(oneProbeInference)[0][0] === PARAMS.prior);
const oneProbeClusters = clusterStudents(posteriorForReporting(oneProbeInference));
check('one answered probe cannot pull a student into a reteach cluster',
  oneProbeClusters.secure.includes(0) && oneProbeClusters.labels[0] === oneProbeClusters.secureLabel);
const belowThresholdClusters = clusterStudents([[0.55, PARAMS.prior], [PARAMS.prior, 0.55]]);
check('students below the reporting cutoff are not clustered as reteach cases',
  belowThresholdClusters.secure.length === 2);
check('clustering rejects a non-matrix input',
  throwsAs(() => clusterStudents(null), TypeError));
check('clustering rejects ragged probability rows',
  throwsAs(() => clusterStudents([[0.2], [0.2, 0.4]]), RangeError));
check('clustering rejects a missing student row',
  throwsAs(() => clusterStudents(Array(1)), RangeError));
check('clustering rejects non-probability values',
  throwsAs(() => clusterStudents([[1.1]]), RangeError));
check('clustering rejects an invalid confidence threshold',
  throwsAs(() => clusterStudents([[0.2]], { threshold: NaN }), RangeError));
const oneProbeSlip = slipsHtml(singleDiagnosticPack,
  { students: [{ name: 'Student' }], responses: [[1]] },
  oneProbeInference, coverage(singleDiagnosticPack, [[1]]));
check('student slips do not turn an untested misconception into a diagnosis',
  !oneProbeSlip.includes('Your answers may point to this mix-up'));
check('student slips disclose patterns that could not be checked',
  oneProbeSlip.includes('Some patterns could not be checked'));
const twoProbePack = {
  misconceptions: allDiagnosticPack.misconceptions,
  items: [1, 2].map(n => ({
    id: `Q${n}`,
    opts: [
      { t: 'Correct', c: true },
      { t: 'Diagnostic', mis: 'M' },
      { t: 'Unmapped A' },
      { t: 'Unmapped B' }
    ]
  }))
};
const twoProbeInference = inferMisconceptions(twoProbePack, [[1, 1]]);
check('two answered probes make the estimate reportable',
  isTested(twoProbeInference, 0, 0) &&
  posteriorForReporting(twoProbeInference)[0][0] === twoProbeInference.posterior[0][0] &&
  untested(twoProbeInference, 0).length === 0 &&
  diagnose(posteriorForReporting(twoProbeInference), twoProbeInference.misIds)[0].has('M'));

console.log(`\n${'='.repeat(66)}\nNotation rendering\n${'='.repeat(66)}`);
check('HTML text is escaped before it is rendered', escapeHtml('<img src="x">') === '&lt;img src=&quot;x&quot;&gt;');
check('math notation stays readable after escaping', mathHtml('x^2 < 4') === 'x<sup>2</sup> &lt; 4');

for (const pack of BUILT_IN) {
  console.log(`\n${'='.repeat(66)}\n${pack.name} (${pack.subject}) — ${pack.misconceptions.length} misconceptions, ${pack.items.length} items\n${'='.repeat(66)}`);

  // ---------------------------------------------------------------- contract
  console.log('\n-- pack contract --');
  const v = validatePack(pack);
  check('pack validates', v.ok, v.errors.join('; '));
  if (v.warnings.length) console.log(`  warnings: ${v.warnings.join(' | ')}`);

  const under = pack.misconceptions.filter(m => itemsProbing(pack, m.id).length < MIN_PROBES);
  check(`every misconception probed >= ${MIN_PROBES} times`, under.length === 0,
    under.map(m => `${m.id}:${itemsProbing(pack, m.id).length}`).join(','));

  const documented = pack.misconceptions.filter(m => m.reteach?.length > 80 && m.verify?.length === 3);
  check('every misconception has a reteach + 3 verification items',
    documented.length === pack.misconceptions.length,
    `${documented.length}/${pack.misconceptions.length}`);

  // ------------------------------------------------------------ single class
  console.log('\n-- single class (seed 7) --');
  const cls = generateClass(pack, { seed: 7, size: 28 });
  check('response matrix shape',
    cls.responses.length === 28 && cls.responses[0].length === pack.items.length);
  check('all responses are valid option indices',
    cls.responses.every(row => row.every((c, i) =>
      Number.isInteger(c) && c >= 0 && c < pack.items[i].opts.length)));

  const scores = totalScores(pack, cls.responses);
  const avg = mean(scores);
  const pct = avg / pack.items.length;
  console.log(`  score range ${min(scores)}-${Math.max(...scores)} of ${pack.items.length}, mean ${avg.toFixed(1)} (${Math.round(pct * 100)}%)`);
  check('class average lands in a realistic band (45-80%)', pct > 0.45 && pct < 0.80,
    `${Math.round(pct * 100)}%`);

  const inf = inferMisconceptions(pack, cls.responses);
  check('posterior shape',
    inf.posterior.length === 28 && inf.posterior[0].length === pack.misconceptions.length);
  check('posteriors are probabilities',
    inf.posterior.every(r => r.every(p => p >= 0 && p <= 1 && Number.isFinite(p))));
  check('fully answered classes retain their posterior estimates for reporting',
    JSON.stringify(posteriorForReporting(inf)) === JSON.stringify(inf.posterior));

  const dq = scoreDiagnosis(diagnose(inf.posterior, inf.misIds), cls.truth, inf.misIds);
  console.log(`  diagnosis  precision ${(dq.precision * 100).toFixed(1)}%  recall ${(dq.recall * 100).toFixed(1)}%  F1 ${(dq.f1 * 100).toFixed(1)}%`);

  const reportPosterior = posteriorForReporting(inf);
  const cl = clusterStudents(reportPosterior, { seed: 42 });
  const cq = scoreClustering(cl.labels, cls.truth);
  console.log(`  clustering k=${cl.k} (silhouette ${cl.silhouette.toFixed(3)})  ARI ${cq.ari.toFixed(3)}`);

  const desc = describeClusters(reportPosterior, cl.labels, inf.misIds, cl);
  check('clusters partition the class', desc.reduce((n, c) => n + c.size, 0) === 28);
  desc.forEach(c => console.log(`    group ${c.index}: n=${c.size}  ${c.isSecure ? '(no stable misconception)' : c.signature.map(s => s.id).join(',')}`));

  // ------------------------------------------------------------ item analysis
  console.log('\n-- item analysis --');
  const stats = analyseItems(pack, cls.responses, inf);
  const bad = problemItems(stats);
  const diag = diagnosticItems(stats);
  console.log(`  flagged ${bad.length}: ${bad.slice(0, 6).map(b => `${b.id}(r=${b.discrimination.toFixed(2)},p=${b.difficulty.toFixed(2)})`).join(' ')}`);
  console.log(`  defended as diagnostic: ${diag.length}`);
  console.log(`  Cronbach alpha ${cronbachAlpha(pack, cls.responses).toFixed(3)}`);

  const planted = pack.items.filter(i => i._weak).map(i => i.id);
  if (planted.length) {
    const flaggedIds = new Set(bad.map(b => b.id));
    planted.forEach(id => check(`planted defective item ${id} is flagged`, flaggedIds.has(id)));
  }

  // ------------------------------------------------------- paper round trip
  // What a teacher copies off the printed paper has to read back as exactly
  // the answers that were given, and the printed key must not be one letter.
  console.log('\n-- paper round trip --');
  check('paper order is a permutation for every item', pack.items.every(it => {
    const o = paperOrder(it);
    return o.length === it.opts.length && new Set(o).size === o.length;
  }));

  const keyRow = pack.items.map(it => paperLetter(it, it.opts.findIndex(o => o.c)));
  const keyCounts = [...'ABCD'].map(l => keyRow.filter(k => k === l).length);
  console.log(`  printed key  ${[...'ABCD'].map((l, k) => `${l}:${keyCounts[k]}`).join('  ')}`);
  check('printed key spreads across the letters (none above 40%)',
    Math.max(...keyCounts) <= Math.ceil(pack.items.length * 0.4), keyCounts.join('/'));

  const keyed = [...quizHtml(pack, { withKey: true })
    .matchAll(/<span class="l">([A-H])\.<\/span>[^<]*<b>&larr; key<\/b>/g)].map(m => m[1]);
  check('printed answer key marks the same letters', keyed.join('') === keyRow.join(''));

  const header = ['Student', ...pack.items.map(i => i.id)].join(',');
  const asCsv = enc => [header, ...cls.responses.map((row, s) =>
    [cls.students[s].name, ...row.map((c, i) => enc(pack.items[i], c))].join(','))].join('\n');
  const readsBack = res => res.ok &&
    res.responses.every((row, s) => row.every((c, i) => c === cls.responses[s][i]));
  check('letters copied off the paper read back exactly',
    readsBack(parseResponses(pack, asCsv((it, c) => paperLetter(it, c)))));
  check('numbers copied off the paper read back exactly',
    readsBack(parseResponses(pack, asCsv((it, c) => String(paperOrder(it).indexOf(c) + 1)))));
  check('answer text reads back exactly',
    readsBack(parseResponses(pack, asCsv((it, c) => `"${it.opts[c].t.replace(/"/g, '""')}"`))));
  const perfect = parseResponses(pack, `${header}\nTop mark,${keyRow.join(',')}`);
  check('the printed key scores full marks',
    perfect.ok && totalScores(pack, perfect.responses)[0] === pack.items.length);

  // -------------------------------------------------------- recovery sweep
  console.log('\n-- recovery across 40 seeds --');
  const agg = { p: [], r: [], f1: [], ari: [], k: [], tp: 0, fp: 0, fn: 0 };
  const baseline = { tp: 0, fp: 0, fn: 0 };
  const plantedHits = Object.fromEntries(planted.map(id => [id, 0]));

  for (let seed = 1; seed <= 40; seed++) {
    const c = generateClass(pack, { seed, size: 28 });
    const i2 = inferMisconceptions(pack, c.responses);
    const reportPosterior = posteriorForReporting(i2);
    const d = scoreDiagnosis(diagnose(reportPosterior, i2.misIds), c.truth, i2.misIds);
    const reference = scoreDiagnosis(diagnose(reportPosterior, i2.misIds, 0.5), c.truth, i2.misIds);
    const k = clusterStudents(reportPosterior, { seed: 42 });
    const s = scoreClustering(k.labels, c.truth);
    const flagged = new Set(problemItems(analyseItems(pack, c.responses, i2)).map(x => x.id));
    planted.forEach(id => { if (flagged.has(id)) plantedHits[id]++; });
    agg.p.push(d.precision); agg.r.push(d.recall); agg.f1.push(d.f1);
    agg.ari.push(s.ari); agg.k.push(k.k);
    agg.tp += d.truePositives; agg.fp += d.falsePositives; agg.fn += d.falseNegatives;
    baseline.tp += reference.truePositives; baseline.fp += reference.falsePositives; baseline.fn += reference.falseNegatives;
  }

  console.log(`  precision  mean ${(mean(agg.p) * 100).toFixed(1)}%  min ${(min(agg.p) * 100).toFixed(1)}%`);
  console.log(`  recall     mean ${(mean(agg.r) * 100).toFixed(1)}%  min ${(min(agg.r) * 100).toFixed(1)}%`);
  console.log(`  F1         mean ${(mean(agg.f1) * 100).toFixed(1)}%  min ${(min(agg.f1) * 100).toFixed(1)}%`);
  console.log(`  decision   false calls ${agg.fp}/${baseline.fp} at 0.6/0.5; recall ${(agg.tp / (agg.tp + agg.fn) * 100).toFixed(1)}%/${(baseline.tp / (baseline.tp + baseline.fn) * 100).toFixed(1)}%`);
  console.log(`  ARI        mean ${mean(agg.ari).toFixed(3)}  min ${min(agg.ari).toFixed(3)}`);
  console.log(`  chosen k   ${JSON.stringify(agg.k.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {}))}`);
  if (planted.length) console.log(`  planted-defect detection  ${planted.map(id => `${id} ${plantedHits[id]}/40`).join('  ')}`);

  check('mean F1 above 0.70', mean(agg.f1) > 0.70, mean(agg.f1).toFixed(3));
  check('the 0.6 cutoff reduces false calls by at least 10% with at most 5% relative recall loss',
    agg.fp <= baseline.fp * 0.9 &&
    agg.tp / (agg.tp + agg.fn) >= (baseline.tp / (baseline.tp + baseline.fn)) * 0.95,
    `${agg.fp}/${baseline.fp} false calls; recall ${(agg.tp / (agg.tp + agg.fn)).toFixed(3)}/${(baseline.tp / (baseline.tp + baseline.fn)).toFixed(3)}`);
  check('mean ARI above 0.40', mean(agg.ari) > 0.40, mean(agg.ari).toFixed(3));
  planted.forEach(id =>
    check(`${id} caught in >=85% of seeds`, plantedHits[id] >= 34, `${plantedHits[id]}/40`));

  // A class of 12 should not bury a teacher in flags that are only noise.
  const flagged = size => mean(Array.from({ length: 30 }, (_, n) => {
    const c = generateClass(pack, { seed: n + 1, size });
    return problemItems(analyseItems(pack, c.responses, inferMisconceptions(pack, c.responses))).length;
  }));
  const [small, usual] = [flagged(12), flagged(28)];
  console.log(`  questions flagged  class of 12: ${small.toFixed(1)}  class of 28: ${usual.toFixed(1)}`);
  check('a small class is flagged about as often as a normal one', small <= usual * 1.6, `${small} vs ${usual}`);
}

// --------------------------------------------------- a teacher's own test
// A test that is already on paper keeps its order: her "A" has to be our "A",
// or every pasted answer is read as a different option.
{
  console.log(`\n${'='.repeat(66)}\nA teacher's own test (keepOrder)\n${'='.repeat(66)}`);
  const own = structuredClone(BUILT_IN[1]);
  own.id = 'teacher-test';
  own.keepOrder = true;
  const reopened = JSON.parse(testFile(BUILT_IN[0]));
  check('a saved built test keeps the letters already printed',
    reopened.keepOrder === false && reopened.items.every((it, i) => paperOrder(it).join() === paperOrder(BUILT_IN[0].items[i]).join()));
  own.items.forEach(it => { it.id = `T-${it.id}`; });
  addPack(own);
  check('every item prints in stored order', own.items.every(it =>
    paperOrder(it).every((oi, k) => oi === k)));
  check('the key letter is the stored position', own.items.every(it =>
    paperLetter(it, it.opts.findIndex(o => o.c)) === 'ABCDEFGH'[it.opts.findIndex(o => o.c)]));
  const c = generateClass(own, { seed: 3, size: 28 });
  const csv = [['Student', ...own.items.map(i => i.id)].join(','),
    ...c.responses.map((row, s) => [`S${String(s + 1).padStart(2, '0')}`,
      ...row.map(ch => (ch >= 0 ? 'ABCDEFGH'[ch] : ''))].join(','))].join('\n');
  const back = parseResponses(own, csv);
  check('printed option letters read back correctly', back.ok &&
    back.responses.every((row, s) => row.every((ch, i) => ch === c.responses[s][i])));

  // The imported test uses a compact pack: no reteach plans or archetypes,
  // one true/false question, and some options with no mapped pattern.
  const bare = {
    id: 'bare-test', name: 'Bare test', keepOrder: true,
    misconceptions: [{ id: 'X1', name: 'Motion needs a force' }, { id: 'X2', name: 'No motion means no force' }],
    items: [
      ...[1, 2, 3, 4].map(n => ({ id: `B${n}`, stem: `Question ${n}`, opts: [
        { t: `right ${n}`, c: true }, { t: `x1 ${n}`, mis: 'X1' }, { t: `x2 ${n}`, mis: 'X2' }, { t: `slip ${n}` }] })),
      { id: 'B5', stem: 'True or false?', opts: [{ t: 'True', mis: 'X2' }, { t: 'False', c: true }] }
    ]
  };
  check('a bare file with a true/false question validates', validatePack(bare).ok, validatePack(bare).errors.join('; '));
  addPack(bare);
  const bc = generateClass(bare, { seed: 5, size: 26 });
  const bi = inferMisconceptions(bare, bc.responses);
  check('inference on it gives real probabilities', bi.posterior.flat().every(p => p >= 0 && p <= 1));
  check('a test with no subject prints no "undefined"',
    !quizHtml(bare).includes('undefined') && !reviewHtml(bare).includes('undefined'));
  const typed = parseResponses(bare, `Student,B1,B2,B3,B4,B5\nAda,A,A,A,A,T\nBen,A,A,A,A,f`);
  check('T and F read on a true/false question', typed.ok &&
    bare.items[4].opts[typed.responses[0][4]].t === 'True' && bare.items[4].opts[typed.responses[1][4]].t === 'False');
  const sheet = reviewHtml(bare);
  check('the review sheet lists every misconception and question',
    bare.misconceptions.every(m => sheet.includes(m.name)) && bare.items.every(it => sheet.includes(it.stem)));
  check('the review sheet marks unmapped options as unlinked', (sheet.match(/not linked to a known pattern<\/span>/g) || []).length === 4);
}

// ---------------------------------------------------------- blank answers
// A blank is no evidence. A student who left the paper blank has to come out
// as unknown, never as fine.
{
  console.log(`\n${'='.repeat(66)}\nBlank answers\n${'='.repeat(66)}`);
  const pack = BUILT_IN[0];
  const c = generateClass(pack, { seed: 7, size: 28 });
  const half = Math.floor(pack.items.length * MIN_ANSWERED);
  c.responses[0] = c.responses[0].map(() => -1);                         // nothing
  c.responses[1] = c.responses[1].map((v, i) => (i < 6 ? v : -1));       // six answers
  c.responses[2] = c.responses[2].map((v, i) => (i < half ? v : -1));    // exactly half

  const inf = inferMisconceptions(pack, c.responses);
  const cov = coverage(pack, c.responses);
  check('coverage counts answered questions', cov[1].answered === 6 && cov[0].answered === 0);
  check('under half answered is thin, exactly half is not', cov[1].thin && !cov[2].thin);

  const reportPosterior = posteriorForReporting(inf);
  const cl = clusterStudents(reportPosterior, { seed: 42 });
  const raw = describeClusters(reportPosterior, cl.labels, inf.misIds, cl);
  const g = separateThin(raw, cov);
  const thin = g.find(x => x.isThin);
  const secure = g.find(x => x.isSecure);
  check('a blank paper is not counted as needing no reteach', !secure?.members.includes(0) && thin?.members.includes(0));
  check('the groups still partition the class', g.reduce((n, x) => n + x.size, 0) === 28);
  check('the unknown group is not a reteach group', !reteachGroups(g).some(x => x.isThin));
  check('a blank paper leaves every misconception untested', untested(inf, 0).length === pack.misconceptions.length);
  check('a full paper leaves nothing untested', untested(inf, 5).length === 0);

  const none = separateThin(raw, coverage(pack, c.responses.map(r => r.map(() => 0))));
  check('with no blanks the groups come back unchanged', none === raw);

  // Item statistics are taken over the students who answered.
  const clean = generateClass(pack, { seed: 21, size: 40 });
  const ci = pack.items.map(it => it.opts.findIndex(o => o.c));
  const cleanStats = analyseItems(pack, clean.responses, inferMisconceptions(pack, clean.responses));
  check('with no blanks, difficulty is the plain share correct',
    cleanStats.every((st, i) => Math.abs(st.difficulty - clean.responses.filter(r => r[i] === ci[i]).length / 40) < 1e-12));
  const col = clean.responses.map(r => (r[0] === ci[0] ? 1 : 0));
  const rest = clean.responses.map((r, s) => r.reduce((n, v, i) => n + (v === ci[i] ? 1 : 0), 0) - col[s]);
  const corr = (x, y) => {
    const m = a => a.reduce((p, q) => p + q, 0) / a.length;
    const [mx, my] = [m(x), m(y)];
    const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
    const dx = x.map(v => v - mx), dy = y.map(v => v - my);
    return dot(dx, dy) / Math.sqrt(dot(dx, dx) * dot(dy, dy));
  };
  check('with no blanks, discrimination is the usual corrected correlation',
    Math.abs(cleanStats[0].discrimination - corr(col, rest)) < 1e-9);

  const skipped = clean.responses.map((r, s) => r.map((v, i) => (i === 0 && s % 2 === 0 ? -1 : v)));
  const hit = skipped.filter(r => r[0] === ci[0]).length;
  const firstStat = analyseItems(pack, skipped)[0];
  check('blanks leave difficulty out of the denominator', Math.abs(firstStat.difficulty - hit / 20) < 1e-12 && firstStat.answered === 20);
  check('a question left blank by half the class is flagged', firstStat.flags.some(f => f.kind === 'skipped'));
  check('alpha uses complete papers only', cronbachAlpha(pack, clean.responses.map(r => r.map((v, i) => (i ? v : -1)))) === null);
}

// -------------------------------------------------------------- row order
// The order of rows on a sheet is an accident. It must not change who is grouped
// with whom.
{
  console.log(`\n${'='.repeat(66)}\nRow order\n${'='.repeat(66)}`);
  for (const pack of BUILT_IN) {
    let same = 0, total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const c = generateClass(pack, { seed, size: 28 });
      const base = clusterStudents(inferMisconceptions(pack, c.responses).posterior, { seed: 42 });
      for (let t = 1; t <= 3; t++) {
        const order = c.responses.map((_, i) => i).sort((a, b) => Math.sin(a * 12.9 + t * seed) - Math.sin(b * 12.9 + t * seed));
        const moved = clusterStudents(inferMisconceptions(pack, order.map(i => c.responses[i])).posterior, { seed: 42 });
        const back = [];
        order.forEach((orig, pos) => { back[orig] = moved.labels[pos]; });
        total++;
        if (scoreClusteringPair(base.labels, back) > 0.999) same++;
      }
    }
    check(`${pack.id}: reordering the sheet leaves the groups the same (${same}/${total})`, same === total);
  }
}

// -------------------------------------------------------------- student slips
// Slips are read by students, so what they leave out matters as much as what
// they say.
{
  console.log(`\n${'='.repeat(66)}\nStudent slips\n${'='.repeat(66)}`);
  const pack = BUILT_IN[0];
  const c = generateClass(pack, { seed: 9, size: 28 });
  c.responses[0] = c.responses[0].map(() => -1);
  c.students[1].name = '<b>Bo</b> & Co';
  const inf = inferMisconceptions(pack, c.responses);
  const html = slipsHtml(pack, c, inf, coverage(pack, c.responses));
  const two = slipsHtml(pack, c, inf, coverage(pack, c.responses), [3, 5]);
  check('slips can be printed for some of the class', (two.match(/class="slip"/g) || []).length === 2 &&
    two.includes(c.students[3].name) && !two.includes(`<h2>${c.students[0].name}</h2>`));
  const slips = html.split('<article class="slip">').slice(1);
  check('every student gets one slip', slips.length === 28);
  check('every slip says it is not a grade', slips.every(s => s.includes('not a grade')));
  check('a slip carries no percentages', !slips.some(s => /\d+%/.test(s)));
  check('a blank paper gets a slip about finishing it', slips[0].includes('left a lot of this blank'));
  const allRight = { ...c, responses: c.responses.map(() => pack.items.map(correctIndex)) };
  const rightSlips = slipsHtml(pack, allRight, inferMisconceptions(pack, allRight.responses), coverage(pack, allRight.responses));
  const noLines = { ...pack, misconceptions: pack.misconceptions.map(({ student, ...m }) => m) };
  check('a test with no student lines keeps teacher wording off the slip',
    !pack.misconceptions.some(m => slipsHtml(noLines, c, inf, coverage(pack, c.responses)).includes(m.belief.split(',')[0])));
  check('a perfect paper is not told it has nothing left to learn',
    rightSlips.includes('This test did not flag a pattern') && !rightSlips.includes('nothing to fix'));
  const heldBy = inf.posterior.findIndex((row, s) => s > 1 && row.some(p => p >= 0.5));
  const top = inf.misIds[inf.posterior[heldBy].indexOf(Math.max(...inf.posterior[heldBy]))];
  check('a slip names the pattern most strongly indicated',
    slips[heldBy].includes(pack.misconceptions.find(m => m.id === top).name));
  check('names are escaped', slips[1].includes('&lt;b&gt;Bo&lt;/b&gt; &amp; Co'));

  const all = BUILT_IN.flatMap(p => p.misconceptions);
  check('every built-in misunderstanding has a line for students', all.every(m => /^(You may|When )/.test(m.student ?? '')));
  check('those lines stay short', all.every(m => m.student.length <= 190), String(Math.max(...all.map(m => m.student.length))));
  const heldOn = pack.misconceptions.find(m => m.id === top);
  check('a slip uses the student line, not the teacher one',
    slips[heldBy].includes(heldOn.student.split(',')[0]) && !slips[heldBy].includes(heldOn.belief.split(',')[0]));
}

// ---------------------------------------------------------- broken test files
// A test file comes from outside. Every hole has to come back as a sentence,
// never as a crash, and never as a test that looks fine and reads back wrong.
{
  console.log(`\n${'='.repeat(66)}\nBroken test files\n${'='.repeat(66)}`);
  const rejects = (name, edit) => {
    const p = structuredClone(BUILT_IN[0]);
    edit(p);
    let r;
    try { r = validatePack(p); } catch (e) { check(`${name}: reported, not thrown`, false, e.message); return; }
    check(`${name}: refused with a reason`, !r.ok && r.errors.length > 0);
  };
  rejects('missing options', p => { delete p.items[0].opts; });
  rejects('an empty question entry', p => { p.items[0] = null; });
  rejects('an empty misconception entry', p => { p.misconceptions[0] = null; });
  rejects('an empty archetype entry', p => { p.archetypes[0] = null; });
  rejects('an archetype misconception list that is not an array', p => { p.archetypes[0].core = 'M01'; });
  rejects('an archetype without an id', p => { delete p.archetypes[0].id; });
  rejects('duplicate archetype ids', p => { p.archetypes[1].id = p.archetypes[0].id; });
  rejects('a non-numeric archetype weight', p => { p.archetypes[0].weight = '0.5'; });
  rejects('a negative archetype weight', p => { p.archetypes[0].weight = -0.5; });
  rejects('archetype weights with no positive total', p => { p.archetypes.forEach(a => { a.weight = 0; }); });
  rejects('an option that is not an object', p => { p.items[0].opts[1] = 'hi'; });
  rejects('a blank stem', p => { p.items[0].stem = '   '; });
  rejects('more options than letters', p => { for (let i = 0; i < 6; i++) p.items[0].opts.push({ t: `extra ${i}` }); });
  check('text that is not a test at all is refused', !validatePack([]).ok && !validatePack('x').ok && !validatePack(null).ok);
}

// -------------------------------------------------------------- spreadsheets out
// A name typed into a form ends up in a file a teacher opens in a spreadsheet.
{
  console.log(`\n${'='.repeat(66)}\nExports\n${'='.repeat(66)}`);
  ['=HYPERLINK("http://x","y")', '+1+1', '-1+cmd', '@SUM(A1)', '\tx'].forEach(v =>
    check(`a cell starting like a formula is made text: ${JSON.stringify(v).slice(0, 18)}`, /^"?'/.test(csvCell(v))));
  check('a plain number stays a number', csvCell('-3') === '-3' && csvCell('+4.5') === '+4.5' && csvCell('1/2') === '1/2');
  check('quotes and commas still escape', csvCell('a,b') === '"a,b"' && csvCell('say "hi"').includes('""hi""'));
  const pack = BUILT_IN[0];
  const c = generateClass(pack, { seed: 3, size: 28 });
  c.students[0].name = '=1+1';
  const inf = inferMisconceptions(pack, c.responses);
  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const csv = groupsCsv(pack, c, describeClusters(inf.posterior, cl.labels, inf.misIds, cl), Object.fromEntries(pack.misconceptions.map(m => [m.id, m])));
  check('a group that starts with that name is safe', !csv.split('\n').some(row => row.split(',')[1] === '=1+1'));
}

// -------------------------------------------------------- messy spreadsheets
// What real sheets look like, as opposed to the template.
{
  console.log(`\n${'='.repeat(66)}\nMessy spreadsheets\n${'='.repeat(66)}`);
  const pack = BUILT_IN[1];
  const c = generateClass(pack, { seed: 6, size: 14 });
  const letters = c.responses.map(row => row.map((v, i) => paperLetter(pack.items[i], v)));
  const texts = c.responses.map(row => row.map((v, i) => pack.items[i].opts[v].t));
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const same = res => res.ok && res.responses.length === 14 &&
    res.responses.every((row, s) => row.every((v, i) => v === c.responses[s][i]));
  const ids = pack.items.map(i => i.id);

  const forms = [
    ['Timestamp', 'Email Address', 'Score', 'Name', ...pack.items.map(i => q(i.stem))].join(','),
    ...c.students.map((st, s) => [q('2026/11/03 9:01:00 AM'), `kid${s}@school.org`, '12 / 24', q(st.name), ...texts[s].map(q)].join(','))
  ].join('\n');
  const f = parseResponses(pack, forms);
  check('a Google Forms export reads back exactly', same(f), f.errors.join('; '));
  check('it is matched by the question text', f.matchedBy === 'question text');
  check('its names come from the Name column', f.students[3]?.name === c.students[3].name);

  const numbered = [
    ['Timestamp', 'Name', ...pack.items.map((it, i) => q(`${i + 1}. ${it.stem}`)), 'Feedback [Score]'].join(','),
    ...c.students.map((st, s) => ['x', q(st.name), ...texts[s].map(q), '1'].join(','))
  ].join('\n');
  check('numbered question headers still match', same(parseResponses(pack, numbered)));

  const noName = [
    ['Timestamp', 'Email Address', ...ids].join(','),
    ...letters.map((row, s) => [`t${s}`, `kid${s}@school.org`, ...row].join(','))
  ].join('\n');
  const n = parseResponses(pack, noName);
  check('with no name column, the email before the @ is used', same(n) && n.students[2].name === 'kid2');

  const untitled = ['Timestamp', 'Name', ...ids.map((_, i) => `Column ${i + 1}`)].join(',');
  const u = parseResponses(pack, [untitled, ...letters.map((row, s) => [`t${s}`, q(c.students[s].name), ...row].join(','))].join('\n'));
  check('labelled columns are stepped over when reading by position', same(u));

  const headless = letters.map((row, s) => [q(c.students[s].name), ...row].join(',')).join('\n');
  const h = parseResponses(pack, headless);
  check('with no header row, the first student is kept', same(h) && h.warnings.some(w => /header row/.test(w)));

  const plain = [['Student', ...ids].join(','), ...letters.map((row, s) => [q(c.students[s].name), ...row].join(','))].join('\n');
  check('an Excel BOM is ignored', same(parseResponses(pack, `\uFEFF${plain}`)));

  const keyed = parseResponses(pack, `${plain}\nAnswer Key,${pack.items.map(it => paperLetter(it, it.opts.findIndex(o => o.c))).join(',')}`);
  check('a row called Key is not a student', same(keyed) && keyed.warnings.some(w => /row called Key/.test(w)));

  const commas = parseResponses(pack, [['Student', ...ids].join(','), ...letters.map((row, s) => [`Last${s}, First`, ...row].join(','))].join('\n'));
  check('an unquoted "Last, First" stays one name', commas.ok && commas.students[2].name === 'Last2, First' &&
    commas.responses.every((row, s) => row.every((v, i) => v === c.responses[s][i])));

  const wrong = parseResponses(BUILT_IN[0], plain, BUILT_IN);
  check('answers for another test name that test', !wrong.ok && wrong.errors[0].includes(pack.name));

  const both = parseResponses(pack, [['Email Address', 'Name', ...ids].join(','),
    ...letters.map((row, s) => [`kid.${s}@students.example.org`, `Kid ${s}`, ...row].join(','))].join('\n'));
  check('a name column beats an email column', both.ok && both.students[3].name === 'Kid 3');

  const dressed = letters.map(row => row.map((l, i) => ['${l}.', '(${l})', '${l})', 'Option ${l}'][i % 4].replace('${l}', l)));
  check('letters with punctuation read the same', same(parseResponses(pack, [['Student', ...ids].join(','), ...dressed.map((row, s) => [q(c.students[s].name), ...row].join(','))].join('\n'))));

  const labelled = parseResponses(pack, [['Student', ...ids].join(','),
    ...letters.map((row, s) => [q(c.students[s].name), ...row.map((l, i) => {
      const chosen = c.responses[s][i];
      return chosen < 0 ? '' : q(`H) ${pack.items[i].opts[chosen].t}`);
    })].join(','))].join('\n'));
  check('the words beat the letter when a form labels its answers', same(labelled));

  const totals = parseResponses(pack, `${plain}\nClass average,${letters[0].map(() => '55%').join(',')}\nTotal,${letters[0].map(() => '').join(',')}`);
  check('a totals row is not a student', same(totals) && totals.warnings.some(w => /Class average, Total/.test(w)));
  const max = parseResponses(pack, `${plain}\nMax,${letters[0].join(',')}`);
  check('a student called Max is still a student', max.students.at(-1).name === 'Max');

  const nonsense = parseResponses(pack, [['Student', ...ids].join(','), ...letters.map((row, s) => [`Kid ${s}`, ...row.map(() => 'Z')].join(','))].join('\n'));
  check('a paste with no readable answer is refused', !nonsense.ok && /could be read/.test(nonsense.errors[0]));

  const twice = parseResponses(pack, `${plain}\n${q(c.students[0].name.toUpperCase())},${letters[1].join(',')}`);
  check('a repeated name is flagged at paste', twice.ok && twice.warnings.some(w => /more than once/.test(w)));
}

// -------------------------------------------------------------- saved class
// A saved class has to come back exactly, and a file that no longer lines up
// with its test has to be refused rather than misread.
{
  console.log(`\n${'='.repeat(66)}\nSaved class\n${'='.repeat(66)}`);
  const pack = BUILT_IN[0];
  const find = id => BUILT_IN.find(p => p.id === id);
  const c = generateClass(pack, { seed: 11, size: 28 });
  c.responses[3][4] = -1;

  const text = classFile({ pack, students: c.students, responses: c.responses, builtIn: true });
  const back = readClassFile(text, find);
  check('a saved class reads back exactly', back.ok &&
    JSON.stringify(back.responses) === JSON.stringify(c.responses) &&
    back.students.every((s, i) => s.name === c.students[i].name));
  check('a blank survives the round trip', back.responses[3][4] === -1);
  check('a built-in test is stored by id, not copied', JSON.parse(text).pack === null);
  check('a saved class says when', !Number.isNaN(new Date(back.savedAt).getTime()));

  const own = structuredClone(BUILT_IN[1]);
  own.id = 'her-test';
  const ownClass = generateClass(own, { seed: 2, size: 14 });
  const ownBack = readClassFile(classFile({ pack: own, students: ownClass.students, responses: ownClass.responses }), () => undefined);
  check('a test from this tab travels inside the file', ownBack.ok && ownBack.embedded && ownBack.pack.id === 'her-test');

  const edit = fn => { const f = JSON.parse(text); fn(f); return JSON.stringify(f); };
  check('other JSON is refused', !readClassFile('{"hello":1}', find).ok);
  check('text that is not JSON is refused', !readClassFile('Student,Q01', find).ok);
  check('a missing test is refused', !readClassFile(text, () => undefined).ok);
  check('an answer past the last option is refused',
    !readClassFile(edit(f => { f.responses[0][0] = 99; }), find).ok);
  check('a short row is refused', !readClassFile(edit(f => { f.responses[0].pop(); }), find).ok);
  check('a nameless student is refused', !readClassFile(edit(f => { f.students[0].name = ' '; }), find).ok);

  const changed = structuredClone(pack);
  changed.items[0].opts.reverse();
  check('reordering a test changes its fingerprint', fingerprint(changed) !== fingerprint(pack));
  check('a class saved on an older version of a test is refused',
    !readClassFile(text, id => (id === pack.id ? changed : undefined)).ok);
}

// ---------------------------------------------------------- after the reteach
// The comparison has to stay quiet when nothing changed, and speak up when
// something did. The class's real change is known here, so both can be scored.
{
  console.log(`\n${'='.repeat(66)}\nAfter the reteach\n${'='.repeat(66)}`);
  check('exact McNemar matches a hand count', Math.abs(mcnemarExact(8, 0) - 2 / 256) < 1e-12 && mcnemarExact(0, 0) === 1);
  check('exact McNemar is symmetric', mcnemarExact(9, 2) === mcnemarExact(2, 9));
  const directMcNemar = (up, down) => {
    const n = up + down;
    let term = 2 ** -n;
    let tail = term;
    for (let i = 1; i <= Math.min(up, down); i++) {
      term *= (n - i + 1) / i;
      tail += term;
    }
    return Math.min(1, 2 * tail);
  };
  check('exact McNemar matches direct binomial sums for small counts',
    Array.from({ length: 21 }, (_, up) =>
      Array.from({ length: 21 }, (_, down) =>
        Math.abs(mcnemarExact(up, down) - directMcNemar(up, down)) < 1e-12)
      ).flat().every(Boolean));
  check('exact McNemar remains normalized when large binomial terms underflow',
    mcnemarExact(550, 550) === 1 && mcnemarExact(551, 550) === 1);
  check('exact McNemar handles large directional evidence without NaN',
    Number.isFinite(mcnemarExact(1100, 0)) && mcnemarExact(1100, 0) >= 0);
  check('exact McNemar rejects non-integer counts',
    throwsAs(() => mcnemarExact(1.5, 0), TypeError));
  check('exact McNemar rejects negative counts',
    throwsAs(() => mcnemarExact(-1, 2), RangeError));

  check('names match across case, spacing and accents', normName('  José   O. ') === normName('jose o'));
  const m = matchStudents(
    [{ name: 'Ada L.' }, { name: 'Ben O' }, { name: 'Sam' }, { name: 'Sam' }, { name: 'Gone' }],
    [{ name: 'ada l' }, { name: 'BEN O.' }, { name: 'Sam' }, { name: 'New Kid' }]);
  check('students pair up by name', m.pairs.length === 2);
  check('a shared name is left out rather than guessed', m.ambiguous.includes('Sam'));
  check('students in only one sitting are reported', m.onlyBefore.includes('Gone') && m.onlyAfter.includes('New Kid'));
  const unnamed = matchStudents(
    [{ name: '' }, { name: '   ' }, { name: 'Taylor' }],
    [{ name: '' }, { name: 'taylor' }]);
  check('blank names never pair across sittings', unnamed.pairs.length === 1 && unnamed.pairs[0].before === 2 && unnamed.pairs[0].after === 1);
  check('blank names are reported as ambiguous rows',
    unnamed.ambiguous.includes('Unnamed student (first sitting row 1)') &&
    unnamed.ambiguous.includes('Unnamed student (first sitting row 2)') &&
    unnamed.ambiguous.includes('Unnamed student (retest row 1)'));
  check('blank names are not also mislabeled as sitting-only students',
    unnamed.onlyBefore.join() === '' && unnamed.onlyAfter.join() === '');

  for (const pack of BUILT_IN) {
    const tally = { still: 0, moved: 0, trueBefore: 0, trueAfter: 0, repBefore: 0, repAfter: 0 };
    const classes = 40;
    for (let seed = 1; seed <= classes; seed++) {
      const c = generateClass(pack, { seed, size: 28 });
      const none = compareSittings(pack, c, generateRetest(c, { seed: seed + 500, cleared: 0 }));
      if (none.totals.reading === 'improved' || none.totals.reading === 'worse') tally.still++;

      const r = generateRetest(c, { seed: seed + 900, cleared: 0.7 });
      const cmp = compareSittings(pack, c, r);
      if (cmp.totals.reading === 'improved') tally.moved++;
      const held = rows => rows.reduce((n, t) => n + t.held.size, 0);
      tally.trueBefore += held(c.truth); tally.trueAfter += held(r.truth);
      tally.repBefore += cmp.totals.before; tally.repAfter += cmp.totals.after;
    }
    const truth = 1 - tally.trueAfter / tally.trueBefore;
    const seen = 1 - tally.repAfter / tally.repBefore;
    console.log(`  ${pack.id}: nothing taught, class called changed ${tally.still}/${classes}; 70% cleared, called improved ${tally.moved}/${classes}; real drop ${(truth * 100).toFixed(0)}%, reported ${(seen * 100).toFixed(0)}%`);
    check(`${pack.id}: no false progress when nothing was taught (at most 2 of ${classes})`, tally.still <= 2, String(tally.still));
    check(`${pack.id}: real progress is called in at least 90% of classes`, tally.moved >= classes * 0.9, String(tally.moved));
    check(`${pack.id}: the reported drop is within 15 points of the real one`, Math.abs(truth - seen) <= 0.15);
  }

  const pack = BUILT_IN[0];
  const c = generateClass(pack, { seed: 4, size: 28 });
  const r = generateRetest(c, { seed: 8, cleared: 0.7 });

  const inf = inferMisconceptions(pack, c.responses);
  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const groups = reteachGroups(describeClusters(inf.posterior, cl.labels, inf.misIds, cl));
  const partial = { students: r.students.slice(2), responses: r.responses.slice(2) };
  const byGroup = compareSittings(pack, c, partial, groups);
  check('every reteach group gets an outcome', byGroup.groups.length === groups.length);
  check('a group only counts its own members', byGroup.groups.every((g, i) => {
    const mine = new Set(groups[i].members.map(s => c.students[s].name));
    return [...g.cleared, ...g.stuck].every(n => mine.has(n));
  }));
  check('group outcomes add up to no more than the group', byGroup.groups.every(g =>
    g.cleared.length + g.stuck.length + g.untested.length + g.absent.length <= g.size));
  check('students missing from the retest are named', byGroup.groups.flatMap(g => g.absent).length ===
    groups.flatMap(g => g.members).filter(s => s < 2).length);

  const gone = { students: r.students, responses: r.responses.map(row => row.map(() => -1)) };
  const blank = compareSittings(pack, c, gone);
  check('a blank retest clears nothing', blank.totals.cleared === 0 && blank.totals.reading === 'none');
  check('a blank retest is reported as not tested', blank.misconceptions.some(x => x.untested.length));

  const rows = [
    { id: 'A', confident: 9 }, { id: 'B', confident: 7 }, { id: 'C', confident: 5 },
    { id: 'D', confident: 1 }, { id: 'E', confident: 0 }
  ];
  const guess = comparePredictions(['A', 'C', 'E'], rows, 28);
  check('predictions are scored rank against rank', guess.k === 3 && guess.agree.join() === 'A,C');
  check('an unpredicted common pattern is reported as a surprise', guess.surprises.map(x => x.id).join() === 'B');
  check('an expected one that barely appears is named', guess.absent.map(x => x.id).join() === 'E');
  check('a rare unpredicted pattern is not reported as a surprise', !guess.surprises.some(x => x.id === 'D'));

  const kept = readClassFile(classFile({ pack, students: c.students, responses: c.responses, predictions: ['M01', 'NOPE'], builtIn: true }),
    id => BUILT_IN.find(x => x.id === id));
  check('predictions are saved, and unknown ids dropped', kept.ok && kept.predictions.join() === 'M01');

  const csv = progressCsv(compareSittings(pack, c, r), Object.fromEntries(pack.misconceptions.map(x => [x.id, x])));
  check('the spreadsheet has a row per misunderstanding', csv.split('\n').length === pack.misconceptions.length + 1);

  const saved = readClassFile(classFile({ pack, students: c.students, responses: c.responses, retest: r, builtIn: true }),
    id => BUILT_IN.find(p => p.id === id));
  check('a saved class keeps its retest', saved.ok && JSON.stringify(saved.retest.responses) === JSON.stringify(r.responses));
}

// ------------------------------------------------------------ the model layer
// The model is stubbed: what is under test is what happens around it, above all
// that bad replies are repaired or refused and never reach a teacher as a test.
{
  console.log(`\n${'='.repeat(66)}\nThe model layer (stubbed)\n${'='.repeat(66)}`);
  const good = () => {
    const p = structuredClone(BUILT_IN[0]);
    const body = {
      name: 'Stub', subject: 'Maths', misconceptions: p.misconceptions, archetypes: p.archetypes,
      items: p.items.map(({ _weak, ...it }) => ({ ...it, ...(it.id === p.items[0].id ? { weak: 'trivial' } : {}) }))
    };
    return JSON.stringify(body);
  };
  const say = (text, stop_reason = 'end_turn') => ({ ok: true, status: 200, json: async () => ({ content: [{ text }], stop_reason }) });
  const script = replies => {
    const asked = [];
    globalThis.fetch = async (_, init) => {
      asked.push(JSON.parse(init.body));
      return replies.length > 1 ? replies.shift() : replies[0];
    };
    return asked;
  };
  const failsWith = async (replies) => {
    script(replies);
    try { await generatePack('k', 'topic'); return null; } catch (e) { return e.message; }
  };

  let asked = script([say(good())]);
  let run = await generatePack('k', 'topic');
  check('a good reply is taken on the first try', run.attempts === 1 && asked.length === 1);

  asked = script([say('Sorry, here you go: not json'), say(good())]);
  run = await generatePack('k', 'topic');
  check('a reply with no JSON is repaired, not fatal', run.attempts === 2);
  check('the repair names the problem', asked[1].messages.at(-1).content.includes('no JSON'));

  asked = script([say('{"items": [', 'max_tokens'), say(good())]);
  run = await generatePack('k', 'topic');
  check('a reply cut off at the token limit is repaired', run.attempts === 2 && asked[1].messages.at(-1).content.includes('ran out of room'));

  script([say('{"name": "x", "items": [null]}'), say(good())]);
  run = await generatePack('k', 'topic');
  check('a reply with an empty item is repaired, not thrown', run.attempts === 2);

  const broken = JSON.parse(good());
  broken.items[0].opts.forEach(o => { delete o.c; });
  asked = script([say(JSON.stringify(broken)), say(good())]);
  run = await generatePack('k', 'topic');
  check('a structural fault is fed back by name', asked[1].messages.at(-1).content.includes('correct options'));

  const msg = await failsWith([say('nope')]);
  check('a model that never recovers is refused in plain words', msg && msg.includes('could not be built') && !/JSON\.parse|undefined/.test(msg));

  const failed = await failsWith([{ ok: false, status: 401, json: async () => ({}) }]);
  check('a bad key is explained', failed && failed.includes('API key'));

  setKey('k');
  asked = script([say('{"headline":"Root cause","plan":"Do this.","verify":["a","b","c"]}')]);
  await rewritePlan({ size: 4, misDetails: [{ id: 'X1', name: 'Motion needs a force' }] }, 20, 'Physics');
  const prompt = asked[0].messages[0].content;
  check('a rewrite names the real subject', prompt.includes('a teacher of Physics') && !prompt.includes('mathematics'));
  check('a missing plan is left out of the prompt', !prompt.includes('undefined'));

  script([say('{"plan": ')]);
  const bad = await rewritePlan({ size: 4, misDetails: [{ id: 'X1', name: 'y' }] }, 20).catch(e => e.message);
  check('an unusable rewrite gives a readable error', bad === 'Model did not return usable JSON.');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
