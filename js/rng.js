/**
 * rng.js -- small seeded PRNG.
 *
 * Everything downstream (class generation, k-means initialisation) is seeded so
 * that a given seed always produces the same class and the same analysis. That
 * matters for two reasons: the demo is reproducible, and the recovery metrics
 * reported in the validation panel can be re-derived by anyone who runs the
 * same seed.
 */

/** mulberry32: fast, adequate for simulation, deterministic across engines. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function normal(rng, mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
