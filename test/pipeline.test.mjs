/**
 * Pipeline sanity + recovery test.
 * Run: node test/pipeline.test.mjs
 *
 * Validates every built-in pack against the pack contract, then runs the full
 * pipeline over many seeds per pack and reports how well the planted ground
 * truth is recovered. A pack is only as good as its recovery numbers, so the
 * same thresholds apply to all of them.
 */

import { BUILT_IN } from '../js/packs/index.js';
import { validatePack, itemsProbing, misIds, MIN_PROBES } from '../js/pack.js';
import { generateClass, totalScores } from '../js/simulate.js';
import { inferMisconceptions, diagnose } from '../js/infer.js';
import { clusterStudents, describeClusters } from '../js/cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha } from '../js/itemstats.js';
import { scoreDiagnosis, scoreClustering } from '../js/validate.js';
import { paperOrder, paperLetter, parseResponses, quizHtml } from '../js/importer.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const min = a => Math.min(...a);

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

  const dq = scoreDiagnosis(diagnose(inf.posterior, inf.misIds), cls.truth, inf.misIds);
  console.log(`  diagnosis  precision ${(dq.precision * 100).toFixed(1)}%  recall ${(dq.recall * 100).toFixed(1)}%  F1 ${(dq.f1 * 100).toFixed(1)}%`);

  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const cq = scoreClustering(cl.labels, cls.truth);
  console.log(`  clustering k=${cl.k} (silhouette ${cl.silhouette.toFixed(3)})  ARI ${cq.ari.toFixed(3)}`);

  const desc = describeClusters(inf.posterior, cl.labels, inf.misIds, cl);
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
  const perfect = parseResponses(pack, `${header}\nKey,${keyRow.join(',')}`);
  check('the printed key scores full marks',
    perfect.ok && totalScores(pack, perfect.responses)[0] === pack.items.length);

  // -------------------------------------------------------- recovery sweep
  console.log('\n-- recovery across 40 seeds --');
  const agg = { p: [], r: [], f1: [], ari: [], k: [] };
  const plantedHits = Object.fromEntries(planted.map(id => [id, 0]));

  for (let seed = 1; seed <= 40; seed++) {
    const c = generateClass(pack, { seed, size: 28 });
    const i2 = inferMisconceptions(pack, c.responses);
    const d = scoreDiagnosis(diagnose(i2.posterior, i2.misIds), c.truth, i2.misIds);
    const k = clusterStudents(i2.posterior, { seed: 42 });
    const s = scoreClustering(k.labels, c.truth);
    const flagged = new Set(problemItems(analyseItems(pack, c.responses, i2)).map(x => x.id));
    planted.forEach(id => { if (flagged.has(id)) plantedHits[id]++; });
    agg.p.push(d.precision); agg.r.push(d.recall); agg.f1.push(d.f1);
    agg.ari.push(s.ari); agg.k.push(k.k);
  }

  console.log(`  precision  mean ${(mean(agg.p) * 100).toFixed(1)}%  min ${(min(agg.p) * 100).toFixed(1)}%`);
  console.log(`  recall     mean ${(mean(agg.r) * 100).toFixed(1)}%  min ${(min(agg.r) * 100).toFixed(1)}%`);
  console.log(`  F1         mean ${(mean(agg.f1) * 100).toFixed(1)}%  min ${(min(agg.f1) * 100).toFixed(1)}%`);
  console.log(`  ARI        mean ${mean(agg.ari).toFixed(3)}  min ${min(agg.ari).toFixed(3)}`);
  console.log(`  chosen k   ${JSON.stringify(agg.k.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {}))}`);
  if (planted.length) console.log(`  planted-defect detection  ${planted.map(id => `${id} ${plantedHits[id]}/40`).join('  ')}`);

  check('mean F1 above 0.70', mean(agg.f1) > 0.70, mean(agg.f1).toFixed(3));
  check('mean ARI above 0.40', mean(agg.ari) > 0.40, mean(agg.ari).toFixed(3));
  planted.forEach(id =>
    check(`${id} caught in >=85% of seeds`, plantedHits[id] >= 34, `${plantedHits[id]}/40`));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
