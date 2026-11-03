/**
 * compare.js: did the reteach work?
 * ---------------------------------------------------------------------------
 * The whole tool promises a loop: find the misunderstanding, reteach it, check
 * it. This closes the last step. The class sits the paper again, the two
 * sittings are inferred independently, and each student is compared with
 * themselves.
 *
 * The honest difficulty is noise. Diagnoses near the threshold flip between
 * sittings with no teaching at all, so "the count went from 9 to 7" means
 * nothing on its own. What carries information is the asymmetry: how many
 * students lost a misconception against how many gained it. Random flipping
 * goes both ways, teaching goes one way, and McNemar's exact test asks whether
 * the split is more lopsided than chance. It is the standard test for paired
 * before-and-after counts, and at class sizes the exact form is the right one.
 *
 * Nothing here can tell a teacher why students moved. Sitting the same paper
 * twice teaches the paper, so a good result is evidence, not proof.
 */

import { misIds } from './pack.js';
import { inferMisconceptions, PARAMS, MIN_PROBES_ANSWERED } from './infer.js';
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
  const onlyBefore = before.filter(st => !b.has(normName(st.name))).map(st => st.name);
  const onlyAfter = after.filter(st => !a.has(normName(st.name))).map(st => st.name);
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
  improved: 'Clear improvement',
  worse: 'Got worse',
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

  const testedIn = (inf, s, k) =>
    inf.evidence[s][k].filter(c => !c.omitted).length >= MIN_PROBES_ANSWERED;

  const misconceptions = ids.map((id, k) => {
    const out = { id, cleared: [], stuck: [], emerged: [], untested: [] };
    match.pairs.forEach(({ before: b, after: a }) => {
      const name = before.students[b].name;
      if (!testedIn(infB, b, k) || !testedIn(infA, a, k)) { out.untested.push(name); return; }
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

  // The class-wide call counts students, not misconceptions. One student's
  // misconceptions are not independent of each other, so pooling them would
  // overstate the evidence. Students are independent, and each one either ended
  // up holding fewer than before, more, or the same number.
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

/**
 * What happened to each reteach group: did the lesson aimed at this group's main
 * misunderstanding reach the students it was for? Clearing counts across the
 * whole class hide that, since one group can clear it while another does not.
 */
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
 * Set what a teacher expected against what the answers showed.
 *
 * The label sheet asks for her predictions before she sees a result, because a
 * tool that only ever agrees with hindsight has not been tested. The honest
 * comparison is rank against rank: of the k things she expected, how many are in
 * the class's top k? Anything else is reported by name, since a surprise is
 * either the tool being wrong or the class telling her something, and both are
 * worth a look.
 *
 * @param expected  misconception ids she ticked
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
  const head = ['Misunderstanding', 'Before', 'After', 'Reading', 'Cleared', 'Still holding', 'New', 'Not tested'];
  const rows = cmp.misconceptions.map(m => [
    `${m.id} ${misIndex[m.id]?.name ?? ''}`.trim(), m.before, m.after, READING[m.reading],
    m.cleared.join('; '), m.stuck.join('; '), m.emerged.join('; '), m.untested.join('; ')
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}
