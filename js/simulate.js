/**
 * simulate.js -- synthetic class generator with recoverable ground truth.
 * ---------------------------------------------------------------------------
 * This is the honest answer to "where does the data come from".
 *
 * We do not hand-write a plausible-looking answer sheet. We build a generative
 * model of a class: each student is assigned a latent profile (a set of
 * misconceptions they actually hold, plus an ability parameter), and their
 * answers are then *generated from that profile*. The planted profile is kept
 * and never shown to the inference layer.
 *
 * That gives the whole system something a hackathon project almost never has:
 * a ground truth to be scored against. The analysis pipeline has to recover
 * what was planted, and validate.js reports how much of it came back.
 *
 * Response model, per student s and item i:
 *   1. Find the options on item i whose mapped misconception s actually holds.
 *   2. If any exist, s expresses one of them with probability P_EXPRESS.
 *      A misconception is a stable rule, so it fires most of the time -- but
 *      not always, which is exactly why single items cannot diagnose.
 *   3. Otherwise s answers correctly with probability sigmoid(ability),
 *      and otherwise slips to a random wrong option.
 *
 * Subject-agnostic: everything below reads the pack passed in.
 */

import { correctIndex, misIds, archetypesFor } from './pack.js';
import { makeRng, normal } from './rng.js';

const P_HOLD_CORE = 0.82;   // probability a student holds a misconception from their own archetype
const P_LEAK = 0.05;        // probability of picking up an unrelated misconception
const P_EXPRESS = 0.76;     // probability a held misconception fires on a given probing item
const P_SLIP = 0.09;        // baseline careless-error rate for otherwise-correct work

export const SIM_PARAMS = { P_HOLD_CORE, P_LEAK, P_EXPRESS, P_SLIP };

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

const FIRST = ['Amara','Ben','Chen','Dara','Eli','Farah','Gus','Hana','Ivan','Jo','Kwame','Lena',
  'Milo','Nadia','Omar','Priya','Quinn','Rosa','Sam','Tomas','Uma','Vik','Wren','Xiu','Yara','Zane',
  'Ada','Bo','Cleo','Dev','Esme','Finn'];
const LAST = ['A.','B.','C.','D.','E.','F.','G.','H.','I.','J.','K.','L.','M.','N.','O.','P.',
  'Q.','R.','S.','T.','U.','V.','W.','X.','Y.','Z.','Aa.','Bb.','Cc.','Dd.','Ee.','Ff.'];

/**
 * Generate a class for a pack.
 * @returns {{students, responses, truth, pack, meta}}
 *   responses[s][i] = index of the option student s chose on item i.
 *   truth[s] = { held: Set<string>, archetype: string, ability: number }
 */
export function generateClass(pack, { seed = 7, size = 28 } = {}) {
  const rng = makeRng(seed);
  const all = misIds(pack);
  const archetypes = archetypesFor(pack);
  const items = pack.items;

  // --- assign archetypes proportionally, then shuffle so row order carries no
  //     information (the matrix must look like noise before clustering) -------
  const assignment = [];
  const totalWeight = archetypes.reduce((s, a) => s + (a.weight || 0), 0) || 1;
  archetypes.forEach(a => {
    const n = Math.round(((a.weight || 0) / totalWeight) * size);
    for (let k = 0; k < n; k++) assignment.push(a.id);
  });
  const filler = archetypes[archetypes.length - 1].id;
  while (assignment.length < size) assignment.push(filler);
  assignment.length = size;
  for (let i = assignment.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [assignment[i], assignment[j]] = [assignment[j], assignment[i]];
  }

  const students = [];
  const truth = [];
  const responses = [];

  for (let s = 0; s < size; s++) {
    const arch = archetypes.find(a => a.id === assignment[s]) || archetypes[archetypes.length - 1];
    const ability = normal(rng, 0, 1);

    // --- plant the latent profile ------------------------------------------
    const core = arch.core || [];
    const held = new Set();
    core.forEach(m => { if (rng() < P_HOLD_CORE) held.add(m); });
    all.forEach(m => {
      if (!core.includes(m) && rng() < P_LEAK) held.add(m);
    });

    // --- generate the answer sheet from the profile ------------------------
    const row = [];
    items.forEach(item => {
      const ci = correctIndex(item);

      if (item._weak === 'trivial') {
        // Everyone can do it, so it separates nobody.
        row.push(rng() < 0.97 ? ci : Math.floor(rng() * item.opts.length));
        return;
      }
      if (item._weak === 'ambiguous') {
        // Wording defeats ability: responses are near-uniform regardless of how
        // strong the student is. This is what a zero-discrimination item looks
        // like in real item analysis.
        row.push(Math.floor(rng() * item.opts.length));
        return;
      }

      const firing = [];
      item.opts.forEach((o, oi) => { if (o.mis && held.has(o.mis)) firing.push(oi); });

      if (firing.length && rng() < P_EXPRESS) {
        row.push(firing[Math.floor(rng() * firing.length)]);
        return;
      }

      const pCorrect = sigmoid(1.15 * ability + 1.85) * (1 - P_SLIP);
      if (rng() < pCorrect) {
        row.push(ci);
      } else {
        const wrong = item.opts.map((_, oi) => oi).filter(oi => oi !== ci);
        row.push(wrong[Math.floor(rng() * wrong.length)]);
      }
    });

    students.push({
      id: `S${String(s + 1).padStart(2, '0')}`,
      name: `${FIRST[s % FIRST.length]} ${LAST[Math.floor(s / FIRST.length) % LAST.length]}`
    });
    truth.push({ held, archetype: arch.id, ability });
    responses.push(row);
  }

  return {
    students,
    responses,
    truth,
    pack,
    meta: { seed, size, nItems: items.length, packId: pack.id }
  };
}

/** Score matrix: 1 if student s answered item i correctly. */
export function scoreMatrix(pack, responses) {
  const ci = pack.items.map(correctIndex);
  return responses.map(row => row.map((choice, i) => (choice === ci[i] ? 1 : 0)));
}

/** Total raw score per student. */
export function totalScores(pack, responses) {
  return scoreMatrix(pack, responses).map(r => r.reduce((a, b) => a + b, 0));
}
