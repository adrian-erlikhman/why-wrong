/**
 * Pipeline sanity + recovery test.
 * Run: node test/pipeline.test.mjs
 *
 * Validates every built-in pack against the pack contract, then runs the full
 * pipeline over many seeds per pack and reports how well the planted ground
 * truth is recovered. A pack is only as good as its recovery numbers, so the
 * same thresholds apply to all of them.
 */

import { BUILT_IN, addPack } from '../js/packs/index.js';
import { validatePack, itemsProbing, misIds, MIN_PROBES } from '../js/pack.js';
import { generateClass, generateRetest, totalScores } from '../js/simulate.js';
import { inferMisconceptions, diagnose, coverage, untested, MIN_ANSWERED } from '../js/infer.js';
import { clusterStudents, describeClusters, separateThin, reteachGroups } from '../js/cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha } from '../js/itemstats.js';
import { scoreDiagnosis, scoreClustering } from '../js/validate.js';
import { paperOrder, paperLetter, parseResponses, quizHtml, reviewHtml } from '../js/importer.js';
import { classFile, readClassFile, fingerprint } from '../js/session.js';
import { compareSittings, matchStudents, mcnemarExact, normName, progressCsv } from '../js/compare.js';

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
  const perfect = parseResponses(pack, `${header}\nTop mark,${keyRow.join(',')}`);
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
// or every answer she pastes is read as a different option.
{
  console.log(`\n${'='.repeat(66)}\nA teacher's own test (keepOrder)\n${'='.repeat(66)}`);
  const own = structuredClone(BUILT_IN[1]);
  own.id = 'teacher-test';
  own.keepOrder = true;
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
  check('her letters read back as the options she printed', back.ok &&
    back.responses.every((row, s) => row.every((ch, i) => ch === c.responses[s][i])));

  // Her file carries names and tags only: no reteach plans, no archetypes, a
  // true/false question, and wrong options left unlabelled as slips.
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
  const sheet = reviewHtml(bare);
  check('the review sheet lists every misconception and question',
    bare.misconceptions.every(m => sheet.includes(m.name)) && bare.items.every(it => sheet.includes(it.stem)));
  check('the review sheet marks unlabelled options as slips', (sheet.match(/careless slip<\/span>/g) || []).length === 4);
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

  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const raw = describeClusters(inf.posterior, cl.labels, inf.misIds, cl);
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
  rejects('an option that is not an object', p => { p.items[0].opts[1] = 'hi'; });
  rejects('a blank stem', p => { p.items[0].stem = '   '; });
  rejects('more options than letters', p => { for (let i = 0; i < 6; i++) p.items[0].opts.push({ t: `extra ${i}` }); });
  check('text that is not a test at all is refused', !validatePack([]).ok && !validatePack('x').ok && !validatePack(null).ok);
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
  check('with no name column, the email is used', same(n) && n.students[2].name === 'kid2@school.org');

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

  check('names match across case, spacing and accents', normName('  José   O. ') === normName('jose o'));
  const m = matchStudents(
    [{ name: 'Ada L.' }, { name: 'Ben O' }, { name: 'Sam' }, { name: 'Sam' }, { name: 'Gone' }],
    [{ name: 'ada l' }, { name: 'BEN O.' }, { name: 'Sam' }, { name: 'New Kid' }]);
  check('students pair up by name', m.pairs.length === 2);
  check('a shared name is left out rather than guessed', m.ambiguous.includes('Sam'));
  check('students in only one sitting are reported', m.onlyBefore.includes('Gone') && m.onlyAfter.includes('New Kid'));

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

  const csv = progressCsv(compareSittings(pack, c, r), Object.fromEntries(pack.misconceptions.map(x => [x.id, x])));
  check('the spreadsheet has a row per misunderstanding', csv.split('\n').length === pack.misconceptions.length + 1);

  const saved = readClassFile(classFile({ pack, students: c.students, responses: c.responses, retest: r, builtIn: true }),
    id => BUILT_IN.find(p => p.id === id));
  check('a saved class keeps its retest', saved.ok && JSON.stringify(saved.retest.responses) === JSON.stringify(r.responses));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
