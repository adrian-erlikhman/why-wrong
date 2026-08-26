/**
 * pack.js -- the subject-pack contract.
 * ---------------------------------------------------------------------------
 * A pack is a complete diagnostic instrument for one subject:
 *
 *   misconceptions[]  named, described, with a reteach and verification items
 *   items[]           every wrong option mapped to a misconception, or to null
 *                     for an undiagnostic slip
 *   archetypes[]      which misconceptions travel together in a real class
 *
 * Everything downstream is written against this contract and nothing else, so
 * algebra, biology and a pack a language model wrote a moment ago all run
 * through identical code.
 *
 * `validatePack` matters more than it looks. Built-in packs are hand-checked,
 * but a generated pack arrives as untrusted JSON, and a malformed one would
 * produce confident nonsense rather than an error. Every structural assumption
 * the pipeline makes is asserted here, at the boundary.
 */

/** Index of the correct option. */
export function correctIndex(item) {
  return item.opts.findIndex(o => o.c);
}

/** Option indices on `item` that diagnose misconception `mid`. */
export function distractorsFor(item, mid) {
  const out = [];
  item.opts.forEach((o, i) => { if (o.mis === mid) out.push(i); });
  return out;
}

/** Items carrying a distractor mapped to `mid`. */
export function itemsProbing(pack, mid) {
  return pack.items.filter(it => it.opts.some(o => o.mis === mid));
}

export function misById(pack) {
  return Object.fromEntries(pack.misconceptions.map(m => [m.id, m]));
}

export function misIds(pack) {
  return pack.misconceptions.map(m => m.id);
}

/** Minimum probes per misconception for inference to have anything to work with. */
export const MIN_PROBES = 3;

/**
 * Check a pack against every assumption the pipeline makes.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validatePack(pack) {
  const errors = [];
  const warnings = [];

  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['Pack is not an object.'], warnings };
  if (!Array.isArray(pack.misconceptions) || !pack.misconceptions.length) errors.push('Pack has no misconceptions.');
  if (!Array.isArray(pack.items) || !pack.items.length) errors.push('Pack has no items.');
  if (errors.length) return { ok: false, errors, warnings };

  const ids = new Set();
  pack.misconceptions.forEach((m, i) => {
    if (!m.id) errors.push(`Misconception ${i} has no id.`);
    else if (ids.has(m.id)) errors.push(`Duplicate misconception id ${m.id}.`);
    else ids.add(m.id);
    if (!m.name) errors.push(`${m.id || i} has no name.`);
    if (!m.belief) warnings.push(`${m.id} has no description of the belief.`);
    if (!m.reteach) warnings.push(`${m.id} has no reteach plan.`);
    if (!Array.isArray(m.verify) || m.verify.length < 1) warnings.push(`${m.id} has no verification items.`);
  });

  const itemIds = new Set();
  pack.items.forEach((it, i) => {
    const label = it.id || `item ${i}`;
    if (!it.id) errors.push(`Item ${i} has no id.`);
    else if (itemIds.has(it.id)) errors.push(`Duplicate item id ${it.id}.`);
    else itemIds.add(it.id);

    if (!it.stem) errors.push(`${label} has no stem.`);
    if (!Array.isArray(it.opts) || it.opts.length < 3) {
      errors.push(`${label} needs at least 3 options.`);
      return;
    }

    const correct = it.opts.filter(o => o.c);
    if (correct.length !== 1) errors.push(`${label} has ${correct.length} correct options; needs exactly 1.`);

    const texts = it.opts.map(o => String(o.t ?? '').trim());
    if (texts.some(t => !t)) errors.push(`${label} has an option with no text.`);
    if (new Set(texts).size !== texts.length) errors.push(`${label} has duplicate option text.`);

    it.opts.forEach(o => {
      if (o.c && o.mis) errors.push(`${label}: the correct option is tagged with a misconception.`);
      if (o.mis && !ids.has(o.mis)) errors.push(`${label} references unknown misconception ${o.mis}.`);
    });
  });

  // Inference needs several independent probes per misconception. With fewer,
  // leave-one-out reasoning has nothing left to reason with and diagnoses
  // become coin flips dressed up as probabilities.
  pack.misconceptions.forEach(m => {
    const n = itemsProbing(pack, m.id).length;
    if (n === 0) errors.push(`${m.id} is never probed by any item.`);
    else if (n < MIN_PROBES) warnings.push(`${m.id} is probed by only ${n} item${n === 1 ? '' : 's'}; ${MIN_PROBES} is the minimum for a stable diagnosis.`);
  });

  if (!Array.isArray(pack.archetypes) || !pack.archetypes.length) {
    warnings.push('Pack has no archetypes; a fallback grouping will be used to simulate a class.');
  } else {
    pack.archetypes.forEach(a => {
      (a.core || []).forEach(mid => {
        if (!ids.has(mid)) errors.push(`Archetype ${a.id || a.label} references unknown misconception ${mid}.`);
      });
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Archetypes for a pack that did not supply usable ones: split the
 * misconceptions into contiguous groups plus a "secure" group. Crude, but it
 * only affects the simulated class, never the analysis of it.
 */
export function fallbackArchetypes(pack, groups = 3) {
  const ids = misIds(pack);
  const per = Math.max(1, Math.ceil(ids.length / groups));
  const out = [];
  for (let g = 0; g < groups; g++) {
    const core = ids.slice(g * per, (g + 1) * per);
    if (!core.length) break;
    out.push({
      id: String.fromCharCode(65 + g),
      label: `Group ${String.fromCharCode(65 + g)}`,
      blurb: 'Shares a set of related misconceptions.',
      core,
      weight: 0.82 / groups
    });
  }
  out.push({ id: 'Z', label: 'Broadly secure', blurb: 'No stable misconception; errors are slips.', core: [], weight: 0.18 });
  return out;
}

export function archetypesFor(pack) {
  const a = pack.archetypes;
  return Array.isArray(a) && a.length ? a : fallbackArchetypes(pack);
}
