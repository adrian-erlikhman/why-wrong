/**
 * cluster.js -- class-level structure discovery.
 * ---------------------------------------------------------------------------
 * Stage 3, and the thesis of the whole tool.
 *
 * Stage 2 gives every student a vector in misconception-space. A class of 28
 * students is then 28 points in 12 dimensions, and the question is whether
 * those points are scattered (28 unrelated problems, which is how a gradebook
 * presents them) or clumped (a small number of shared failure modes, which is
 * what you can actually act on in a lesson).
 *
 * k-means with k chosen by mean silhouette answers that question rather than
 * assuming it. If the class genuinely has no structure the silhouette stays
 * low, and the tool should say so instead of inventing groups.
 */

import { makeRng } from './rng.js';

function dist2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}
function dist(a, b) { return Math.sqrt(dist2(a, b)); }

/** k-means++ seeding: spreads initial centroids, which makes restarts converge. */
function seedPlusPlus(points, k, rng) {
  const centroids = [points[Math.floor(rng() * points.length)].slice()];
  while (centroids.length < k) {
    const d2 = points.map(p => Math.min(...centroids.map(c => dist2(p, c))));
    const total = d2.reduce((a, b) => a + b, 0);
    if (total === 0) { centroids.push(points[Math.floor(rng() * points.length)].slice()); continue; }
    let r = rng() * total;
    let idx = 0;
    while (r > d2[idx] && idx < points.length - 1) { r -= d2[idx]; idx++; }
    centroids.push(points[idx].slice());
  }
  return centroids;
}

function kmeansOnce(points, k, rng, maxIter = 100) {
  let centroids = seedPlusPlus(points, k, rng);
  let labels = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    points.forEach((p, i) => {
      let best = 0, bestD = Infinity;
      centroids.forEach((c, j) => { const d = dist2(p, c); if (d < bestD) { bestD = d; best = j; } });
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    });

    const sums = Array.from({ length: k }, () => new Array(points[0].length).fill(0));
    const counts = new Array(k).fill(0);
    points.forEach((p, i) => {
      counts[labels[i]]++;
      p.forEach((v, d) => { sums[labels[i]][d] += v; });
    });
    centroids = sums.map((s, j) => (counts[j] ? s.map(v => v / counts[j]) : points[Math.floor(rng() * points.length)].slice()));

    if (!moved && iter > 0) break;
  }

  const inertia = points.reduce((acc, p, i) => acc + dist2(p, centroids[labels[i]]), 0);
  return { labels, centroids, inertia };
}

/** Mean silhouette coefficient over all points. Undefined for k=1. */
export function silhouette(points, labels) {
  const n = points.length;
  const groups = {};
  labels.forEach((l, i) => { (groups[l] = groups[l] || []).push(i); });
  const ks = Object.keys(groups);
  if (ks.length < 2) return 0;

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = groups[labels[i]];
    const a = own.length > 1
      ? own.filter(j => j !== i).reduce((s, j) => s + dist(points[i], points[j]), 0) / (own.length - 1)
      : 0;
    let b = Infinity;
    ks.forEach(l => {
      if (Number(l) === labels[i]) return;
      const g = groups[l];
      const mean = g.reduce((s, j) => s + dist(points[i], points[j]), 0) / g.length;
      if (mean < b) b = mean;
    });
    const s = own.length > 1 ? (b - a) / Math.max(a, b) : 0;
    total += s;
  }
  return total / n;
}

/** L2-normalise a vector; returns null if it has effectively no magnitude. */
function unit(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n < 1e-9 ? null : v.map(x => x / n);
}

/**
 * Cluster students into shared failure modes.
 *
 * Two design decisions here matter more than the choice of algorithm.
 *
 * 1. Students with no confident misconception are separated out *before*
 *    clustering rather than being forced into a group. They are not a failure
 *    mode -- they are the students who are fine, and their errors are slips.
 *    Leaving them in drags centroids toward the origin and blurs every real
 *    group.
 *
 * 2. The remaining students are compared by *direction*, not magnitude: the
 *    posterior vectors are L2-normalised so that k-means is effectively
 *    operating on cosine similarity. Two students who both hold the sign
 *    misconceptions belong together whether they express them strongly or
 *    weakly. Under plain Euclidean distance a weak expresser looks like a
 *    student with no misconception at all, which is precisely wrong.
 *
 * k is chosen by mean silhouette, with a parsimony tie-break: the smallest k
 * within 2% of the best score wins. A teacher can act on three groups; ties
 * should not be broken toward fragmentation.
 *
 * @returns {{labels:number[], k:number, secureLabel:number, secure:number[],
 *            silhouette:number, scan:Array}}
 *   labels covers every student; secure students carry `secureLabel`.
 */
export function clusterStudents(posterior, {
  kMin = 2, kMax = 6, restarts = 12, seed = 42, threshold = 0.5
} = {}) {
  const rng = makeRng(seed);

  const secure = [];
  const active = [];
  posterior.forEach((row, i) => {
    const u = unit(row);
    if (!u || Math.max(...row) < threshold) secure.push(i);
    else active.push({ i, v: u });
  });

  const labels = new Array(posterior.length).fill(-1);

  // Degenerate case: too few students carry a confident misconception to talk
  // about class-level structure at all.
  if (active.length < 4) {
    active.forEach(({ i }) => { labels[i] = 0; });
    const secureLabel = active.length ? 1 : 0;
    secure.forEach(i => { labels[i] = secureLabel; });
    return { labels, k: active.length ? 1 : 0, secureLabel, secure, silhouette: 0, scan: [], degenerate: true };
  }

  const points = active.map(a => a.v);
  const scan = [];
  const maxK = Math.min(kMax, points.length - 1);

  for (let k = kMin; k <= maxK; k++) {
    let bestRun = null;
    for (let r = 0; r < restarts; r++) {
      const run = kmeansOnce(points, k, rng);
      if (!bestRun || run.inertia < bestRun.inertia) bestRun = run;
    }
    scan.push({ k, silhouette: silhouette(points, bestRun.labels), inertia: bestRun.inertia, run: bestRun });
  }

  const bestSil = Math.max(...scan.map(s => s.silhouette));
  const chosen = scan.find(s => s.silhouette >= bestSil * 0.98) || scan[0];

  chosen.run.labels.forEach((l, idx) => { labels[active[idx].i] = l; });
  const secureLabel = chosen.k;
  secure.forEach(i => { labels[i] = secureLabel; });

  return {
    labels,
    k: chosen.k,
    secureLabel,
    secure,
    silhouette: chosen.silhouette,
    scan: scan.map(({ k, silhouette, inertia }) => ({ k, silhouette, inertia }))
  };
}

/**
 * Describe each cluster: size, members, and the misconceptions that define it
 * (highest mean posterior within the cluster, relative to the rest of class).
 */
export function describeClusters(posterior, labels, misIds, { k, secureLabel }) {
  const clusters = [];

  const build = (c, isSecure) => {
    const members = labels.map((l, i) => (l === c ? i : -1)).filter(i => i >= 0);
    if (!members.length) return null;

    const outIdx = labels.map((_, i) => i).filter(i => labels[i] !== c);
    const profile = misIds.map((mid, m) => {
      const inMean = members.reduce((s, i) => s + posterior[i][m], 0) / members.length;
      const outMean = outIdx.length
        ? outIdx.reduce((s, i) => s + posterior[i][m], 0) / outIdx.length
        : 0;
      return { id: mid, inMean, outMean, lift: inMean - outMean };
    });

    const signature = profile
      .filter(p => p.inMean >= 0.5)
      .sort((a, b) => b.lift - a.lift);

    return {
      index: c,
      members,
      size: members.length,
      profile,
      signature: isSecure ? [] : (signature.length ? signature : profile.slice().sort((a, b) => b.inMean - a.inMean).slice(0, 1)),
      isSecure: !!isSecure
    };
  };

  for (let c = 0; c < k; c++) {
    const cl = build(c, false);
    if (cl) clusters.push(cl);
  }
  clusters.sort((a, b) => b.size - a.size);

  const sec = build(secureLabel, true);
  if (sec) clusters.push(sec);   // always last: it is not a failure mode

  return clusters;
}

/**
 * Adjusted Rand Index between two labelings -- used to score how well the
 * discovered clusters match the archetypes that were actually planted.
 * 1.0 is perfect agreement; 0.0 is chance.
 */
export function adjustedRandIndex(labelsA, labelsB) {
  const n = labelsA.length;
  const aVals = [...new Set(labelsA)];
  const bVals = [...new Set(labelsB)];
  const table = aVals.map(av => bVals.map(bv =>
    labelsA.reduce((c, l, i) => c + (l === av && labelsB[i] === bv ? 1 : 0), 0)
  ));

  const choose2 = x => (x * (x - 1)) / 2;
  const sumIJ = table.reduce((s, row) => s + row.reduce((r, v) => r + choose2(v), 0), 0);
  const aSums = table.map(row => row.reduce((a, b) => a + b, 0));
  const bSums = bVals.map((_, j) => table.reduce((s, row) => s + row[j], 0));
  const sumA = aSums.reduce((s, v) => s + choose2(v), 0);
  const sumB = bSums.reduce((s, v) => s + choose2(v), 0);
  const total = choose2(n);

  const expected = (sumA * sumB) / total;
  const max = (sumA + sumB) / 2;
  return max - expected === 0 ? 0 : (sumIJ - expected) / (max - expected);
}
