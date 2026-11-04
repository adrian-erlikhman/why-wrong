/**
 * Stress benchmark.
 * Run: node test/benchmark.mjs [seeds]
 *
 * pipeline.test.mjs checks the analysis on the class the simulator makes by
 * default, which behaves exactly the way the analysis assumes. A real class
 * will not. This runs the same pipeline on classes that break one assumption
 * at a time, and reports what a teacher would feel:
 *
 *   F1            diagnoses right, against diagnoses planted
 *   weak-FP       false diagnoses per student in the weakest quarter of the
 *                 class: the students most at risk of being labelled with a
 *                 belief they do not hold, because they guess
 *   ECE           calibration: when the tool says 80%, is it right 80% of the
 *                 time? (expected calibration error, 10 bins; lower is better)
 *   ARI, k ok     group recovery, and how often the number of groups is right
 *   false flags   sound questions flagged for rewriting, per class
 *   planted       planted defective questions caught
 */

import { BUILT_IN } from '../js/packs/index.js';
import { generateClass } from '../js/simulate.js';
import { inferMisconceptions, diagnose, posteriorForReporting } from '../js/infer.js';
import { clusterStudents } from '../js/cluster.js';
import { analyseItems, problemItems } from '../js/itemstats.js';
import { scoreDiagnosis, scoreClustering } from '../js/validate.js';

const SEEDS = Number(process.argv[2]) || 40;

export const SCENARIOS = [
  { name: 'default', size: 28, model: {} },
  { name: 'fires less (0.55)', size: 28, model: { express: 0.55 } },
  { name: 'fires more (0.92)', size: 28, model: { express: 0.92 } },
  { name: 'tempting options', size: 28, model: { pull: 0.6 } },
  { name: 'weaker class', size: 28, model: { abilityShift: -1 } },
  { name: 'stronger class', size: 28, model: { abilityShift: 1 } },
  { name: 'rarer beliefs', size: 28, model: { holdCore: 0.55, leak: 0.02 } },
  { name: '15% blanks', size: 28, model: { omit: 0.15 } },
  { name: 'small class (14)', size: 14, model: {} },
  { name: 'large class (90)', size: 90, model: {} }
];

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

function ece(pairs) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  pairs.forEach(([p, y]) => {
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++; b.p += p; b.y += y;
  });
  const n = pairs.length;
  return bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0);
}

export function runScenario(pack, sc, seeds = SEEDS) {
  const out = { f1: [], p: [], r: [], weakFp: [], ari: [], kOk: 0, falseFlags: [], planted: 0, plantedN: 0, pairs: [] };
  const plantedIds = pack.items.filter(i => i._weak).map(i => i.id);
  const nArch = new Set((pack.archetypes || []).map(a => a.id)).size;

  for (let seed = 1; seed <= seeds; seed++) {
    const c = generateClass(pack, { seed, size: sc.size, model: sc.model });
    const inf = inferMisconceptions(pack, c.responses);
    const report = posteriorForReporting(inf);
    const dx = diagnose(report, inf.misIds);
    const d = scoreDiagnosis(dx, c.truth, inf.misIds);
    out.f1.push(d.f1); out.p.push(d.precision); out.r.push(d.recall);

    const byAbility = c.truth.map((t, s) => [t.ability, s]).sort((a, b) => a[0] - b[0]);
    const weak = byAbility.slice(0, Math.max(1, Math.floor(byAbility.length / 4))).map(x => x[1]);
    out.weakFp.push(mean(weak.map(s => [...dx[s]].filter(m => !c.truth[s].held.has(m)).length)));

    inf.posterior.forEach((row, s) => row.forEach((p, k) =>
      out.pairs.push([p, c.truth[s].held.has(inf.misIds[k]) ? 1 : 0])));

    const cl = clusterStudents(report, { seed: 42 });
    const cq = scoreClustering(cl.labels, c.truth);
    out.ari.push(cq.ari);
    if (cl.k === nArch - 1) out.kOk++;   // the secure archetype is not a group

    const flagged = problemItems(analyseItems(pack, c.responses, inf)).map(x => x.id);
    out.falseFlags.push(flagged.filter(id => !plantedIds.includes(id)).length);
    plantedIds.forEach(id => { out.plantedN++; if (flagged.includes(id)) out.planted++; });
  }

  return {
    f1: mean(out.f1), precision: mean(out.p), recall: mean(out.r),
    weakFp: mean(out.weakFp), ece: ece(out.pairs), ari: mean(out.ari),
    kOk: out.kOk / seeds, falseFlags: mean(out.falseFlags),
    planted: out.plantedN ? out.planted / out.plantedN : null
  };
}

/**
 * The question audit against two more kinds of defect, planted in a copy of
 * the pack: a flat question (strong and weak students get it right equally
 * often) and a miskeyed one (the key on file is wrong). Reports how often
 * each planted defect is flagged, how often a miskey is named as one, and how
 * many sound questions are flagged by mistake.
 */
export function runAudit(pack, sc, seeds = SEEDS) {
  const copy = structuredClone(pack);
  const sound = copy.items.filter(it => !it._weak);
  const flat = sound[4], miskeyed = sound[10];
  flat._weak = 'flat';
  miskeyed._weak = 'miskeyed';
  miskeyed._truth = miskeyed.opts.findIndex(o => !o.c);
  const planted = copy.items.filter(it => it._weak).map(it => it.id);

  const hits = Object.fromEntries(planted.map(id => [id, 0]));
  let named = 0;
  const falseFlags = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const c = generateClass(copy, { seed, size: sc.size, model: sc.model });
    const inf = inferMisconceptions(copy, c.responses);
    const stats = analyseItems(copy, c.responses, inf);
    const flagged = problemItems(stats).map(x => x.id);
    planted.forEach(id => { if (flagged.includes(id)) hits[id]++; });
    if (stats.find(x => x.id === miskeyed.id).flags.some(f => f.kind === 'miskey')) named++;
    falseFlags.push(flagged.filter(id => !planted.includes(id)).length);
  }
  return {
    planted: Object.fromEntries(planted.map(id => [id === flat.id ? `${id}(flat)` : id === miskeyed.id ? `${id}(miskey)` : id, hits[id] / seeds])),
    miskeyNamed: named / seeds,
    falseFlags: mean(falseFlags)
  };
}

const fmt = (x, d = 3) => (x == null ? '  -  ' : x.toFixed(d));

// Print the table only when run directly, not when imported.
if (/benchmark\.mjs$/.test(process.argv[1] || '')) {
  const all = {};
  for (const pack of BUILT_IN) {
    console.log(`\n${pack.name} — ${SEEDS} seeds per row`);
    console.log('scenario              F1     prec   recall weak-FP  ECE    ARI    k ok   false-flags planted');
    for (const sc of SCENARIOS) {
      const r = runScenario(pack, sc);
      all[`${pack.id}/${sc.name}`] = r;
      console.log(
        `${sc.name.padEnd(20)}  ${fmt(r.f1)}  ${fmt(r.precision)}  ${fmt(r.recall)}  ${fmt(r.weakFp, 2).padStart(5)}   ` +
        `${fmt(r.ece)}  ${fmt(r.ari)}  ${fmt(r.kOk, 2)}   ${fmt(r.falseFlags, 2).padStart(5)}       ${fmt(r.planted, 2)}`);
    }
  }
  const rows = Object.values(all);
  console.log(`\nacross every row: F1 ${fmt(mean(rows.map(r => r.f1)))}  weak-FP ${fmt(mean(rows.map(r => r.weakFp)), 2)}  ` +
    `ECE ${fmt(mean(rows.map(r => r.ece)))}  ARI ${fmt(mean(rows.map(r => r.ari)))}  false flags ${fmt(mean(rows.map(r => r.falseFlags)), 2)}`);
}
