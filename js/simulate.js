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
 * The simulation provides ground truth for testing: the analysis pipeline can
 * be compared with the profiles used to generate its responses. This measures
 * performance against the simulation, not against real classroom data.
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
const P_SLIP = 0.09;        // baseline chance of an unlinked wrong answer

export const SIM_PARAMS = { P_HOLD_CORE, P_LEAK, P_EXPRESS, P_SLIP };

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

const FIRST = ['Amara','Ben','Chen','Dara','Eli','Farah','Gus','Hana','Ivan','Jo','Kwame','Lena',
  'Milo','Nadia','Omar','Priya','Quinn','Rosa','Sam','Tomas','Uma','Vik','Wren','Xiu','Yara','Zane',
  'Ada','Bo','Cleo','Dev','Esme','Finn'];
const LAST = ['A.','B.','C.','D.','E.','F.','G.','H.','I.','J.','K.','L.','M.','N.','O.','P.',
  'Q.','R.','S.','T.','U.','V.','W.','X.','Y.','Z.','Aa.','Bb.','Cc.','Dd.','Ee.','Ff.'];

/**
 * One student's answers, generated from their hidden profile.
 *
 * `model` holds the stress knobs (see generateClass); `rng2` is a second
 * stream they draw from, so that with every knob at its default the main
 * stream, and so the class, is exactly what it always was.
 */
function answerSheet(items, held, ability, rng, model = {}, rng2 = rng) {
  const { express = P_EXPRESS, slip = P_SLIP, pull = 0, omit = 0 } = model;
  const row = [];
  items.forEach(item => {
    const ci = correctIndex(item);

    if (omit > 0 && rng2() < omit) { row.push(-1); rng(); rng(); return; }

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
    if (item._weak === 'miskeyed') {
      // The key on file is wrong: students who know the material choose the
      // option that is actually right (`_truth`), which the key marks wrong.
      const pRight = sigmoid(1.15 * ability + 1.85) * (1 - slip);
      const others = item.opts.map((_, oi) => oi).filter(oi => oi !== item._truth);
      row.push(rng() < pRight ? item._truth : others[Math.floor(rng() * others.length)]);
      return;
    }
    if (item._weak === 'flat') {
      // Answerable from a cue in the wording, or not at all: strong and weak
      // students get it right equally often.
      const wrong = item.opts.map((_, oi) => oi).filter(oi => oi !== ci);
      row.push(rng() < 0.6 ? ci : wrong[Math.floor(rng() * wrong.length)]);
      return;
    }

    const firing = [];
    item.opts.forEach((o, oi) => { if (o.mis && held.has(o.mis)) firing.push(oi); });

    if (firing.length && rng() < express) {
      row.push(firing[Math.floor(rng() * firing.length)]);
      return;
    }

    const pCorrect = sigmoid(1.15 * ability + 1.85) * (1 - slip);
    if (rng() < pCorrect) {
      row.push(ci);
    } else {
      const wrong = item.opts.map((_, oi) => oi).filter(oi => oi !== ci);
      // A tempting wrong option draws careless errors too, whether or not
      // the student holds the belief it was written for.
      const tempting = wrong.filter(oi => item.opts[oi].mis);
      if (pull > 0 && tempting.length && rng2() < pull) {
        row.push(tempting[Math.floor(rng2() * tempting.length)]);
        rng();
      } else {
        row.push(wrong[Math.floor(rng() * wrong.length)]);
      }
    }
  });
  return row;
}

/**
 * Generate a class for a pack.
 *
 * `model` overrides the response model, for stress-testing the analysis on a
 * class that does not behave the way the analysis assumes: distractors that
 * fire less reliably (`express`), wrong options that tempt students who hold
 * nothing (`pull`), a weaker or stronger class (`abilityShift`), rarer or
 * commoner beliefs (`holdCore`, `leak`), blanks (`omit`). Left empty, the
 * class is exactly the default one for its seed.
 *
 * @returns {{students, responses, truth, pack, meta}}
 *   responses[s][i] = index of the option student s chose on item i.
 *   truth[s] = { held: Set<string>, archetype: string, ability: number }
 */
export function generateClass(pack, { seed = 7, size = 28, model = {} } = {}) {
  const { holdCore = P_HOLD_CORE, leak = P_LEAK, abilityShift = 0 } = model;
  const rng = makeRng(seed);
  const rng2 = makeRng(seed * 7919 + 13);
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
    const ability = normal(rng, 0, 1) + abilityShift;

    // --- plant the latent profile ------------------------------------------
    const core = arch.core || [];
    const held = new Set();
    core.forEach(m => { if (rng() < holdCore) held.add(m); });
    all.forEach(m => {
      if (!core.includes(m) && rng() < leak) held.add(m);
    });

    const row = answerSheet(items, held, ability, rng, model, rng2);

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

/**
 * The same class sitting the same paper again after a reteach.
 *
 * Each held misconception is cleared with probability `cleared`, then a new
 * answer sheet is generated from what is left. Set `cleared` to 0 and nothing
 * changes except the noise, which is how a comparison is tested for inventing
 * progress that did not happen.
 */
export function generateRetest(cls, { seed = 1, cleared = 0.7 } = {}) {
  const rng = makeRng(seed);
  const truth = cls.truth.map(t => ({
    ...t,
    held: new Set([...t.held].filter(() => rng() >= cleared))
  }));
  const responses = truth.map(t => answerSheet(cls.pack.items, t.held, t.ability, rng));
  return { students: cls.students, responses, truth };
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
