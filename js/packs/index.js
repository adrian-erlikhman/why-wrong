/**
 * packs/index.js -- registry of built-in subject packs.
 *
 * Built-in packs exist so the tool works with no key, no network and no
 * account, and so there is something to demonstrate against. Anything beyond
 * them is generated at runtime (see js/generate.js) and joins this list for the
 * session.
 */

import algebra1 from './algebra1.js';
import biology from './biology.js';

export const BUILT_IN = [algebra1, biology];

/** Session registry: built-in packs plus any generated during this visit. */
const registry = new Map(BUILT_IN.map(p => [p.id, p]));

export function allPacks() {
  return [...registry.values()];
}

export function getPack(id) {
  return registry.get(id) || BUILT_IN[0];
}

export function addPack(pack) {
  registry.set(pack.id, pack);
  return pack;
}

export function defaultPack() {
  return BUILT_IN[0];
}
