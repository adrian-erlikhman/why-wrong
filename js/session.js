/**
 * session.js -- keep a real class.
 * ---------------------------------------------------------------------------
 * Everything here runs in the tab, which is the right privacy default and a bad
 * storage default: a reload loses thirty hand-typed answer sheets, and the paper
 * they came from may not survive the week either.
 *
 * So a class can be saved as a file on the teacher's own computer and opened
 * again later. Browser storage was the other option and it was rejected: school
 * computers are shared, and student names should not stay behind in a browser
 * for the next person. A file is something she can see, move and delete.
 *
 * Answers are stored as option indices, which only mean something against the
 * exact test they were entered on. If a pack changes after a class was saved,
 * those indices would be read as different options without any error, so every
 * file carries a fingerprint of its test and a mismatch is refused.
 */

import { validatePack } from './pack.js';

export const CLASS_FORMAT = 'why-wrong-class';
export const CLASS_VERSION = 1;

/** Stable hash of what the answers depend on: question ids and option text. */
export function fingerprint(pack) {
  let h = 2166136261;                       // FNV-1a
  const add = s => {
    for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  };
  pack.items.forEach(it => { add(it.id); it.opts.forEach(o => add(`|${o.t}|${o.c ? 1 : 0}`)); });
  return (h >>> 0).toString(16);
}

/**
 * Serialise a class. A built-in test is stored by id, because it ships with the
 * page. Any other test only exists in this tab, so it travels inside the file.
 */
export function classFile({ pack, students, responses, retest = null, predictions = [], builtIn = false, savedAt = new Date() }) {
  return JSON.stringify({
    format: CLASS_FORMAT,
    version: CLASS_VERSION,
    savedAt: savedAt.toISOString(),
    packId: pack.id,
    packName: pack.name,
    fingerprint: fingerprint(pack),
    pack: builtIn ? null : pack,
    students: students.map(s => ({ id: s.id, name: s.name })),
    responses,
    retest: retest ? {
      students: retest.students.map(s => ({ id: s.id, name: s.name })),
      responses: retest.responses
    } : null,
    predictions
  }, null, 1);
}

function checkSheet(pack, sheet, label) {
  const errors = [];
  const { students, responses } = sheet ?? {};
  if (!Array.isArray(students) || !Array.isArray(responses) || !students.length) {
    return [`${label} has no students.`];
  }
  if (students.length !== responses.length) errors.push(`${label} has ${students.length} students but ${responses.length} answer rows.`);
  if (students.some(s => typeof s?.name !== 'string' || !s.name.trim())) errors.push(`${label} has a student with no name.`);

  const fits = (c, i) => Number.isInteger(c) && c >= -1 && c < pack.items[i].opts.length;
  responses.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== pack.items.length) {
      errors.push(`${label}, row ${r + 1}: expected ${pack.items.length} answers.`);
    } else if (!row.every(fits)) {
      errors.push(`${label}, row ${r + 1}: an answer does not match any option.`);
    }
  });
  return errors;
}

/**
 * Read a saved class. The file is untrusted: it may be hand-edited or be some
 * other JSON entirely, and a malformed one would produce confident nonsense.
 *
 * @param {(id:string)=>object|undefined} findPack looks up a loaded test by id
 * @returns {{ok, errors, pack, students, responses, retest, embedded}}
 */
export function readClassFile(text, findPack) {
  const fail = (...errors) => ({ ok: false, errors, pack: null, students: [], responses: [], retest: null });

  let file;
  try { file = JSON.parse(text); } catch { return fail('This file is not readable.'); }
  if (file?.format !== CLASS_FORMAT) return fail('This is not a saved Why Wrong class.');
  if (file.version > CLASS_VERSION) return fail('This class was saved by a newer version of Why Wrong.');

  const embedded = !!file.pack;
  const pack = embedded ? file.pack : findPack(file.packId);
  if (!pack) return fail(`This class was taken on “${file.packName ?? file.packId}”, which is not loaded here.`);

  if (embedded) {
    const report = validatePack(pack);
    if (!report.ok) return fail(`The test inside this file can't be used: ${report.errors[0]}`);
  }
  if (fingerprint(pack) !== file.fingerprint) {
    return fail(`“${pack.name}” has changed since this class was saved, so its answers can no longer be read safely.`);
  }

  const errors = [
    ...checkSheet(pack, file, 'The class'),
    ...(file.retest ? checkSheet(pack, file.retest, 'The retest') : [])
  ];
  if (errors.length) return fail(...errors.slice(0, 3));

  // Predictions are optional, and an id the test does not know is simply dropped.
  const known = new Set(pack.misconceptions.map(m => m.id));
  const predictions = (Array.isArray(file.predictions) ? file.predictions : []).filter(id => known.has(id));

  return { ok: true, errors: [], pack, embedded, students: file.students, responses: file.responses, retest: file.retest ?? null, predictions, savedAt: file.savedAt ?? null };
}
