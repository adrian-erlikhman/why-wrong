/**
 * Pipeline sanity + recovery test.
 * Run: node test/pipeline.test.mjs
 *
 * Checks the item bank is structurally sound, then runs the full pipeline over
 * many seeds and reports how well the planted ground truth is recovered.
 */

import { ITEMS, MISCONCEPTIONS, itemsProbing, correctIndex } from '../js/curriculum.js';
import { generateClass, totalScores } from '../js/simulate.js';
import { inferMisconceptions, diagnose } from '../js/infer.js';
import { clusterStudents, describeClusters } from '../js/cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha } from '../js/itemstats.js';
import { scoreDiagnosis, scoreClustering } from '../js/validate.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

console.log('\n=== 1. Item bank structure ===');
check('12 misconceptions defined', MISCONCEPTIONS.length === 12, `got ${MISCONCEPTIONS.length}`);
check('36 items defined', ITEMS.length === 36, `got ${ITEMS.length}`);

let structural = [];
for (const it of ITEMS) {
  if (it.opts.filter(o => o.c).length !== 1) structural.push(`${it.id}: correct-option count`);
  if (new Set(it.opts.map(o => o.t)).size !== it.opts.length) structural.push(`${it.id}: duplicate option text`);
  for (const o of it.opts) {
    if (o.mis && !MISCONCEPTIONS.some(m => m.id === o.mis)) structural.push(`${it.id}: unknown misconception ${o.mis}`);
    if (o.c && o.mis) structural.push(`${it.id}: correct option is tagged as a misconception`);
  }
}
check('every item well-formed', structural.length === 0, structural.join('; '));

const underProbed = MISCONCEPTIONS.filter(m => itemsProbing(m.id).length < 3);
check('every misconception probed by >=3 items', underProbed.length === 0,
  underProbed.map(m => m.id).join(','));

const misWithReteach = MISCONCEPTIONS.filter(m => m.reteach && m.reteach.length > 80 && m.verify?.length === 3);
check('every misconception has reteach + 3 verification items', misWithReteach.length === 12,
  `got ${misWithReteach.length}`);

console.log('\n=== 2. Single-class pipeline (seed 7) ===');
const cls = generateClass({ seed: 7, size: 28 });
check('28 students generated', cls.students.length === 28);
check('response matrix shape', cls.responses.length === 28 && cls.responses[0].length === ITEMS.length);
check('all responses are valid option indices',
  cls.responses.every((row, s) => row.every((c, i) => Number.isInteger(c) && c >= 0 && c < ITEMS[i].opts.length)));

const scores = totalScores(cls.responses);
const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
console.log(`  score range ${Math.min(...scores)}-${Math.max(...scores)} of ${ITEMS.length}, mean ${meanScore.toFixed(1)}`);
check('score spread is realistic (not all-correct or all-wrong)',
  meanScore > 18 && meanScore < 28 && Math.max(...scores) < ITEMS.length);

const { posterior, misIds } = inferMisconceptions(cls.responses);
check('posterior shape', posterior.length === 28 && posterior[0].length === 12);
check('posteriors are probabilities',
  posterior.every(r => r.every(p => p >= 0 && p <= 1 && Number.isFinite(p))));

const diagnosed = diagnose(posterior, misIds);
const dq = scoreDiagnosis(diagnosed, cls.truth, misIds);
console.log(`  diagnosis  precision ${(dq.precision * 100).toFixed(1)}%  recall ${(dq.recall * 100).toFixed(1)}%  F1 ${(dq.f1 * 100).toFixed(1)}%`);

const cl = clusterStudents(posterior, { seed: 42 });
const cq = scoreClustering(cl.labels, cls.truth);
console.log(`  clustering k=${cl.k} (silhouette ${cl.silhouette.toFixed(3)})  ARI vs planted archetypes ${cq.ari.toFixed(3)}`);
console.log(`  silhouette scan: ${cl.scan.map(s => `k=${s.k}:${s.silhouette.toFixed(2)}`).join('  ')}`);

const desc = describeClusters(posterior, cl.labels, misIds, cl);
check('clusters partition the class', desc.reduce((n, c) => n + c.size, 0) === 28);
desc.forEach(c => {
  console.log(`    cluster ${c.index}: n=${c.size}  ${c.isSecure ? '(no stable misconception)' : 'signature ' + c.signature.map(s => s.id).join(',')}`);
});

console.log('\n=== 3. Item analysis finds the planted bad questions ===');
const inference = inferMisconceptions(cls.responses);
const stats = analyseItems(cls.responses, inference);
const bad = problemItems(stats);
console.log(`  flagged ${bad.length} item(s): ${bad.map(b => `${b.id}(r=${b.discrimination.toFixed(2)},p=${b.difficulty.toFixed(2)})`).join(' ')}`);
const flaggedIds = new Set(bad.map(b => b.id));
check('Q35 (trivial, planted) is flagged', flaggedIds.has('Q35'));
check('Q24 (ambiguous, planted) is flagged', flaggedIds.has('Q36'));
const goodItemsFlagged = bad.filter(b => !['Q35', 'Q36'].includes(b.id));
console.log(`  additional items flagged: ${goodItemsFlagged.map(b => b.id).join(',') || 'none'}`);
console.log(`  Cronbach alpha = ${cronbachAlpha(cls.responses).toFixed(3)}`);

console.log('\n=== 4. Recovery across 40 seeds ===');
const agg = { p: [], r: [], f1: [], ari: [], k: [], q35: 0, q36: 0 };
for (let seed = 1; seed <= 40; seed++) {
  const c = generateClass({ seed, size: 28 });
  const inf = inferMisconceptions(c.responses);
  const dg = diagnose(inf.posterior, inf.misIds);
  const d = scoreDiagnosis(dg, c.truth, inf.misIds);
  const k = clusterStudents(inf.posterior, { seed: 42 });
  const s = scoreClustering(k.labels, c.truth);
  const st = new Set(problemItems(analyseItems(c.responses, inf)).map(x => x.id));
  agg.p.push(d.precision); agg.r.push(d.recall); agg.f1.push(d.f1);
  agg.ari.push(s.ari); agg.k.push(k.k);
  if (st.has('Q35')) agg.q35++;
  if (st.has('Q36')) agg.q36++;
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const min = a => Math.min(...a);
console.log(`  precision  mean ${(mean(agg.p) * 100).toFixed(1)}%  min ${(min(agg.p) * 100).toFixed(1)}%`);
console.log(`  recall     mean ${(mean(agg.r) * 100).toFixed(1)}%  min ${(min(agg.r) * 100).toFixed(1)}%`);
console.log(`  F1         mean ${(mean(agg.f1) * 100).toFixed(1)}%  min ${(min(agg.f1) * 100).toFixed(1)}%`);
console.log(`  ARI        mean ${mean(agg.ari).toFixed(3)}  min ${min(agg.ari).toFixed(3)}`);
console.log(`  chosen k   ${JSON.stringify(agg.k.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {}))}`);
console.log(`  bad-item detection  Q35 ${agg.q35}/40   Q36 ${agg.q36}/40`);

check('mean F1 above 0.70', mean(agg.f1) > 0.70, `got ${mean(agg.f1).toFixed(3)}`);
check('mean ARI above 0.40', mean(agg.ari) > 0.40, `got ${mean(agg.ari).toFixed(3)}`);
check('bad items caught in >=90% of seeds', agg.q35 >= 36 && agg.q36 >= 36, `Q35 ${agg.q35} Q36 ${agg.q36}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
