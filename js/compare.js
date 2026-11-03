/**
 * Compare two sittings of the same test. Results are estimates, not proof that
 * a reteach caused a change: students may remember the questions from the
 * first sitting.
 */

import { misIds } from './pack.js';
import { inferMisconceptions, isTested, PARAMS } from './infer.js';
import { csvCell, normName } from './importer.js';

export { normName };

/**
 * Pair students across two sittings by name. Two students sharing a name cannot
 * be told apart, so they are left unpaired rather than guessed at.
 */
export function matchStudents(before, after) {
  const index = students => {
    const seen = new Map();
    students.forEach((st, i) => {
      const k = normName(st.name);
      if (!k) return;
      seen.set(k, [...(seen.get(k) || []), i]);
    });
    return seen;
  };
  const a = index(before), b = index(after);

  const pairs = [];
  const ambiguous = [];
  for (const [k, is] of a) {
    const js = b.get(k);
    if (!js) continue;
    if (is.length === 1 && js.length === 1) pairs.push({ before: is[0], after: js[0] });
    else ambiguous.push(before[is[0]].name);
  }
  before.forEach((st, i) => {
    if (!normName(st.name)) ambiguous.push(`Unnamed student (first sitting row ${i + 1})`);
  });
  after.forEach((st, i) => {
    if (!normName(st.name)) ambiguous.push(`Unnamed student (retest row ${i + 1})`);
  });
  const onlyBefore = before.filter(st => {
    const key = normName(st.name);
    return key && !b.has(key);
  }).map(st => st.name);
  const onlyAfter = after.filter(st => {
    const key = normName(st.name);
    return key && !a.has(key);
  }).map(st => st.name);
  return { pairs, onlyBefore, onlyAfter, ambiguous };
}

/** Two-sided exact McNemar p-value for `up` changes one way and `down` the other. */
export function mcnemarExact(up, down) {
  const n = up + down;
  if (n === 0) return 1;
  const k = Math.min(up, down);
  let term = Math.pow(0.5, n);      // C(n,0) / 2^n
  let tail = term;
  for (let i = 1; i <= k; i++) {
    term *= (n - i + 1) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

const ALPHA = 0.05;

/** Plain words for each reading, shared by the page and the spreadsheet. */
export const READING = {
  improved: 'Fewer indicated after',
  worse: 'More indicated after',
  unclear: 'Could be chance',
  none: 'No change'
};

/** What the split can honestly support. */
function readingOf(cleared, emerged) {
  const p = mcnemarExact(cleared, emerged);
  if (cleared + emerged === 0) return { p, reading: 'none' };
  if (p < ALPHA) return { p, reading: cleared > emerged ? 'improved' : 'worse' };
  return { p, reading: 'unclear' };
}

/**
 * Compare two sittings of the same test.
 * @param before {{students, responses}}
 * @param after  {{students, responses}}
 * @param groups the reteach groups from the first sitting, if there are any
 */
export function compareSittings(pack, before, after, groups = []) {
  const match = matchStudents(before.students, after.students);
  const infB = inferMisconceptions(pack, before.responses);
  const infA = inferMisconceptions(pack, after.responses);
  const ids = misIds(pack);
  const { decisionThreshold: T } = PARAMS;

  const misconceptions = ids.map((id, k) => {
    const out = { id, cleared: [], stuck: [], emerged: [], untested: [] };
    match.pairs.forEach(({ before: b, after: a }) => {
      const name = before.students[b].name;
      if (!isTested(infB, b, k) || !isTested(infA, a, k)) { out.untested.push(name); return; }
      const was = infB.posterior[b][k] >= T;
      const is = infA.posterior[a][k] >= T;
      if (was && !is) out.cleared.push(name);
      else if (was && is) out.stuck.push(name);
      else if (!was && is) out.emerged.push(name);
    });
    return {
      ...out,
      before: out.cleared.length + out.stuck.length,
      after: out.stuck.length + out.emerged.length,
      ...readingOf(out.cleared.length, out.emerged.length)
    };
  });

  // Compare each student's net change so one student with several diagnoses
  // does not count as several independent observations.
  const names = list => new Set(list);
  const sets = misconceptions.map(m => ({ cleared: names(m.cleared), emerged: names(m.emerged) }));
  const net = match.pairs.map(({ before: b }) => {
    const name = before.students[b].name;
    return sets.reduce((n, s) => n + (s.emerged.has(name) ? 1 : 0) - (s.cleared.has(name) ? 1 : 0), 0);
  });
  const fewer = net.filter(n => n < 0).length;
  const more = net.filter(n => n > 0).length;

  const sum = f => misconceptions.reduce((n, m) => n + f(m), 0);
  return {
    match,
    groups: groupOutcomes(groups, misconceptions, before.students, match),
    misconceptions: misconceptions.slice().sort((x, y) => y.before - x.before || y.after - x.after),
    totals: {
      students: match.pairs.length,
      before: sum(m => m.before),
      after: sum(m => m.after),
      cleared: sum(m => m.cleared.length),
      stuck: sum(m => m.stuck.length),
      emerged: sum(m => m.emerged.length),
      fewer, more,
      ...readingOf(fewer, more)
    }
  };
}

/** Summarize changes for each group from the first sitting. */
function groupOutcomes(groups, misconceptions, students, match) {
  const retested = new Set(match.pairs.map(p => p.before));
  return groups.map(g => {
    const main = g.signature[0]?.id;
    const m = misconceptions.find(x => x.id === main);
    const names = new Set(g.members.filter(s => retested.has(s)).map(s => students[s].name));
    const within = list => (m ? m[list] : []).filter(n => names.has(n));
    return {
      index: g.index,
      main,
      size: g.size,
      cleared: within('cleared'),
      stuck: within('stuck'),
      untested: within('untested'),
      absent: g.members.filter(s => !retested.has(s)).map(s => students[s].name)
    };
  });
}

/**
 * Compare predictions recorded before the results with the most common
 * patterns in the class. Unexpected results should be reviewed, not treated as
 * proof that either the prediction or the analysis is wrong.
 *
 * @param expected  misconception ids selected before seeing results
 * @param rows      prevalence() output, most widespread first
 * @param size      students in the class
 */
export function comparePredictions(expected, rows, size) {
  const want = new Set(expected);
  const k = want.size;
  const common = Math.max(2, Math.ceil(size * 0.1));
  const top = rows.slice(0, k);
  return {
    k,
    agree: top.filter(r => want.has(r.id)).map(r => r.id),
    surprises: rows.filter(r => !want.has(r.id) && r.confident >= common)
      .map(r => ({ id: r.id, students: r.confident })),
    absent: rows.filter(r => want.has(r.id) && r.confident < common)
      .map(r => ({ id: r.id, students: r.confident }))
  };
}

/** The comparison as a spreadsheet, one row per misunderstanding. */
export function progressCsv(cmp, misIndex) {
  const head = ['Misunderstanding', 'Before', 'After', 'Reading', 'No longer indicated', 'Indicated both times', 'Newly indicated', 'Not tested'];
  const rows = cmp.misconceptions.map(m => [
    `${m.id} ${misIndex[m.id]?.name ?? ''}`.trim(), m.before, m.after, READING[m.reading],
    m.cleared.join('; '), m.stuck.join('; '), m.emerged.join('; '), m.untested.join('; ')
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}
