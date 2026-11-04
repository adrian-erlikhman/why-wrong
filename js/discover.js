/**
 * discover.js -- wrong answers the test does not label, chosen together.
 * ---------------------------------------------------------------------------
 * Every other stage reads a class through the misunderstandings the question
 * set was written to detect. A test author cannot anticipate them all. When a
 * group of students holds one the test does not label, it still leaves a
 * trace: the same students keep picking the same unlabelled wrong options
 * across several questions, more often than wrong answers scattered by chance
 * would.
 *
 * Two things a class does by itself would make that trace appear anyway, so
 * both are taken out before anything is counted:
 *
 *   - Weaker students pick more wrong answers of every kind. So a question is
 *     only compared among the students who picked one of its unlabelled
 *     options, never across right and wrong.
 *   - A student who holds a question's labelled belief picks the labelled
 *     option, which leaves the unlabelled ones to everyone else; across two
 *     questions about beliefs the same students hold, the unlabelled picks
 *     would line up for that reason alone. Conditioning on having picked an
 *     unlabelled option removes it.
 *
 * Then two unlabelled options on different questions are linked when the
 * students who picked an unlabelled option on both questions picked these two
 * together more often than their shares of those questions' unlabelled
 * answers predict (a binomial tail). Linked options form candidate patterns,
 * each counted by the students who picked at least two of its options.
 *
 * Searching every pair would find something in any class, so the search
 * itself is tested: each question's unlabelled answers are reshuffled among
 * the students who gave them (which keeps every student's number of wrong
 * answers and every option's popularity), the whole search is rerun, and a
 * pattern is reported only if it beats the largest pattern found in 95% of
 * those reshuffles. In the stress benchmark this kept false finds in ordinary
 * classes at the rate that implies.
 */

import { correctIndex } from './pack.js';
import { makeRng } from './rng.js';

/** Link threshold for a pair of options; the reshuffles, not this, set the error rate. */
export const LINK_P = 0.05;
/** Fewest students picking both options of a pair for it to count. */
export const MIN_TOGETHER = 3;
/** How many reshuffles the search is tested against. */
export const RESHUFFLES = 100;

const LOG_FACT = [0];
function logFact(n) {
  for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  return LOG_FACT[n];
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialTail(k, n, p) {
  if (k <= 0) return 1;
  if (k > n || p <= 0) return 0;
  if (p >= 1) return 1;
  let t = 0;
  for (let x = k; x <= n; x++) {
    t += Math.exp(logFact(n) - logFact(x) - logFact(n - x) + x * Math.log(p) + (n - x) * Math.log(1 - p));
  }
  return Math.min(1, t);
}

/** The unlabelled wrong options of each question. */
function unlabelledOptions(pack) {
  return pack.items.map(item => {
    const ci = correctIndex(item);
    return item.opts.map((o, oi) => (oi !== ci && !o.mis ? oi : -1)).filter(oi => oi >= 0);
  });
}

/** One pass of the search: every candidate pattern with its count. */
function search(pack, responses, unl) {
  const U = [];
  unl.forEach((opts, i) => opts.forEach(oi => U.push({ i, oi })));
  const picked = unl.map((opts, i) => responses.map(r => opts.includes(r[i])));
  const chose = U.map(u => responses.map(r => r[u.i] === u.oi));
  const share = U.map((u, x) => {
    const n = picked[u.i].filter(Boolean).length;
    return n ? chose[x].filter(Boolean).length / n : 0;
  });

  const links = U.map(() => []);
  for (let a = 0; a < U.length; a++) {
    for (let b = a + 1; b < U.length; b++) {
      if (U[a].i === U[b].i) continue;
      let n = 0, k = 0;
      for (let s = 0; s < responses.length; s++) {
        if (!picked[U[a].i][s] || !picked[U[b].i][s]) continue;
        n++;
        if (chose[a][s] && chose[b][s]) k++;
      }
      if (k < MIN_TOGETHER) continue;
      if (binomialTail(k, n, share[a] * share[b]) < LINK_P) { links[a].push(b); links[b].push(a); }
    }
  }

  const seen = new Set(), patterns = [];
  U.forEach((_, a) => {
    if (seen.has(a) || !links[a].length) return;
    const stack = [a], members = [];
    seen.add(a);
    while (stack.length) {
      const x = stack.pop();
      members.push(x);
      links[x].forEach(y => { if (!seen.has(y)) { seen.add(y); stack.push(y); } });
    }
    const students = responses.map((_, s) => s).filter(s => members.filter(x => chose[x][s]).length >= 2);
    patterns.push({
      options: members.map(x => U[x]).sort((p, q) => p.i - q.i || p.oi - q.oi),
      students,
      count: students.length
    });
  });
  return patterns.sort((p, q) => q.count - p.count);
}

/** Each question's unlabelled answers, reshuffled among the students who gave them. */
function reshuffle(responses, unl, rng) {
  const out = responses.map(r => r.slice());
  unl.forEach((opts, i) => {
    const who = out.map((r, s) => (opts.includes(r[i]) ? s : -1)).filter(s => s >= 0);
    const vals = who.map(s => out[s][i]);
    for (let j = vals.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [vals[j], vals[k]] = [vals[k], vals[j]];
    }
    who.forEach((s, j) => { out[s][i] = vals[j]; });
  });
  return out;
}

/**
 * Patterns of unlabelled wrong answers chosen together beyond chance.
 *
 * @returns {{patterns: Array<{options: {i:number, oi:number}[], students: number[],
 *            count: number, beats: number}>, reshuffles: number, cut: number}}
 *   `beats` is how many of the reshuffled classes this pattern's count
 *   exceeded the largest pattern of; a pattern is listed only above 95%.
 */
export function unlabelledPatterns(pack, responses, { reshuffles = RESHUFFLES, seed = 2026 } = {}) {
  // The reshuffles draw by row, so the same class pasted in another order
  // could land either side of the cut. Rows are put in an order that depends
  // only on the answers, and student numbers are mapped back at the end.
  const key = row => row.map(c => (c == null || c < 0 ? '-' : String(c))).join(',');
  const order = responses.map((_, s) => s).sort((a, b) => {
    const ka = key(responses[a]), kb = key(responses[b]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const rows = order.map(s => responses[s]);

  const unl = unlabelledOptions(pack);
  const found = search(pack, rows, unl);
  if (!found.length) return { patterns: [], reshuffles, cut: 0 };

  const rng = makeRng(seed);
  const nullMax = [];
  for (let r = 0; r < reshuffles; r++) {
    nullMax.push(search(pack, reshuffle(rows, unl, rng), unl)[0]?.count ?? 0);
  }
  nullMax.sort((a, b) => a - b);
  const cut = nullMax[Math.floor(0.95 * reshuffles)] ?? 0;
  const patterns = found
    .filter(p => p.count > cut)
    .map(p => ({
      ...p,
      students: p.students.map(s => order[s]).sort((a, b) => a - b),
      beats: nullMax.filter(m => p.count > m).length
    }));
  return { patterns, reshuffles, cut };
}
