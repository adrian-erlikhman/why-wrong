/**
 * importer.js -- get a real class in, and get usable paper out.
 * ---------------------------------------------------------------------------
 * Everything else in this project analyses a simulated class. That is the right
 * default (it is the only way to measure whether the method works), but a
 * teacher does not have a simulated class -- they have thirty answer sheets on
 * a desk.
 *
 * So the loop has to close in both directions: print the instrument, give it,
 * type the answers back in, get the analysis. This module does the boring,
 * load-bearing half of that.
 *
 * Parsing is deliberately forgiving. Teachers will paste from Excel, from
 * Google Sheets, from a Form export; they will use A/B/C/D, or 1/2/3/4, or the
 * answer text itself; some cells will be blank because a student skipped a
 * question. All of that is accepted, and anything genuinely unreadable is
 * reported by row and column rather than silently coerced into a number.
 *
 * Letters and numbers refer to the order options are printed in on paper,
 * which is not the order they are stored in -- see paperOrder().
 */

import { makeRng, shuffled } from './rng.js';

const LETTERS = 'ABCDEFGH';

/** Omitted answer. Distinct from wrong: it carries no evidence either way. */
export const OMITTED = -1;

/* ------------------------------------------------------------ paper order */

// Packs store the correct option first (the built-in ones do, and generate.js
// asks the model to), so printing in stored order would make the key "A" on
// every question. Each item is shuffled instead, seeded by its id: the printed
// quiz, the answer key, the example paste and the paste-back parser all agree,
// on every machine, with nothing stored. The salt only picks which shuffle; it
// was chosen because it spreads both built-in keys evenly across A-D.
const PAPER_SALT = 2026;
const orderCache = new WeakMap();

function idSeed(id) {
  let h = 2166136261 ^ PAPER_SALT;          // FNV-1a
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Stored option index printed at each position: order[k] is letter k's option. */
export function paperOrder(item) {
  let order = orderCache.get(item);
  if (!order) {
    order = shuffled(makeRng(idSeed(item.id)), item.opts.map((_, i) => i));
    orderCache.set(item, order);
  }
  return order;
}

/** The letter a stored option is printed under. */
export function paperLetter(item, optIndex) {
  return LETTERS[paperOrder(item).indexOf(optIndex)] ?? '?';
}

/* ------------------------------------------------------------------ export */

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Blank answer sheet: one row per student, one column per question. */
export function templateCsv(pack, names = []) {
  const head = ['Student', ...pack.items.map(i => i.id)];
  const rows = (names.length ? names : Array.from({ length: 28 }, (_, i) => `Student ${i + 1}`))
    .map(n => [n, ...pack.items.map(() => '')]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}

/** Answer key, for marking by hand. */
export function answerKeyCsv(pack) {
  const rows = pack.items.map(it => {
    const ci = it.opts.findIndex(o => o.c);
    return [it.id, it.topic || '', it.stem, paperLetter(it, ci), it.opts[ci].t];
  });
  return [['Item', 'Topic', 'Question', 'Key', 'Correct answer'], ...rows]
    .map(r => r.map(csvCell).join(',')).join('\n');
}

/** A printable paper version of the instrument. */
export function quizHtml(pack, { withKey = false } = {}) {
  const items = pack.items.map((it, n) => {
    const opts = paperOrder(it).map((oi, k) => {
      const o = it.opts[oi];
      const mark = withKey && o.c ? ' <b>&larr; key</b>' : '';
      return `<li><span class="l">${LETTERS[k]}.</span> ${escapeHtml(o.t)}${mark}</li>`;
    }).join('');
    return `<li class="q"><div class="stem"><span class="qn">${n + 1}.</span> ${escapeHtml(it.stem)}</div><ul class="opts">${opts}</ul></li>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escapeHtml(pack.name)}${withKey ? ' — answer key' : ''}</title>
<style>
  body{font:14px/1.5 Georgia,'Times New Roman',serif;max-width:44em;margin:36px auto;padding:0 24px;color:#111}
  h1{font-size:20px;margin:0 0 2px}
  .meta{font-size:12px;color:#555;margin-bottom:6px}
  .name{margin:16px 0 22px;font-size:13px;color:#333}
  ol.qs{padding-left:0;list-style:none;margin:0}
  li.q{margin-bottom:17px;page-break-inside:avoid}
  .stem{margin-bottom:5px}
  .qn{font-weight:bold;margin-right:5px}
  ul.opts{list-style:none;padding-left:22px;margin:0;columns:2;column-gap:26px}
  ul.opts li{margin-bottom:2px}
  .l{display:inline-block;width:1.3em;color:#666}
  @media print{body{margin:0}.noprint{display:none}}
  .noprint{margin-bottom:20px}
  button{font:inherit;padding:6px 13px;cursor:pointer}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print</button></div>
<h1>${escapeHtml(pack.name)}${withKey ? ' — answer key' : ''}</h1>
<div class="meta">${escapeHtml(pack.subject)}${pack.level ? ' · ' + escapeHtml(pack.level) : ''} · ${pack.items.length} questions</div>
${withKey ? '' : '<div class="name">Name: ______________________________  Class: ____________  Date: ____________</div>'}
<ol class="qs">${items}</ol>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Trigger a download of `text` without leaving the page. */
export function download(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a generated document in a new tab, ready to print. */
export function openPrintable(html) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

/* ------------------------------------------------------------------ import */

function splitRows(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').filter(r => r.trim().length);
}

/** Split one CSV/TSV row, honouring quotes. */
function splitCells(row, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (q) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function detectDelim(rows) {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  rows.slice(0, 5).forEach(r => {
    counts[','] += (r.match(/,/g) || []).length;
    counts['\t'] += (r.match(/\t/g) || []).length;
    counts[';'] += (r.match(/;/g) || []).length;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const isBlank = v => !v || v === '-' || v === '.';
const asLetter = (v, n) => {
  const li = v.length === 1 ? LETTERS.indexOf(v.toUpperCase()) : -1;
  return li >= 0 && li < n ? li : null;
};
const asNumber = (v, n) => {
  if (!/^\d+$/.test(v)) return null;
  const num = parseInt(v, 10);
  if (num >= 1 && num <= n) return num - 1;
  return num === 0 && n > 0 ? 0 : null;
};

/**
 * How a sheet codes its answers: 'letters', 'numbers' or 'text'. A cell like
 * "2" is ambiguous on its own -- option 2, or the answer "2"? -- and a Forms
 * export of an algebra quiz is full of them. So the sheet is judged as a whole,
 * by what most of its filled cells look like, and ambiguous cells are read that
 * way. Whatever is unambiguous still reads in any coding.
 */
function detectCoding(pack, rows, cols) {
  let letters = 0, numbers = 0, other = 0;
  rows.forEach(row => pack.items.forEach((it, i) => {
    const v = String(row[cols[i]] ?? '').trim();
    if (isBlank(v)) return;
    if (asLetter(v, it.opts.length) !== null) letters++;
    else if (asNumber(v, it.opts.length) !== null) numbers++;
    else other++;
  }));
  if (other > letters && other > numbers) return 'text';
  return numbers > letters ? 'numbers' : 'letters';
}

/**
 * Turn one cell into an option index for `item`. Accepts a letter or a 1-based
 * number (both as printed on paper), or the option text itself; `coding` says
 * which reading wins when more than one fits.
 * @returns {number|null} index, OMITTED for blank, or null if unreadable.
 */
function readCell(raw, item, coding = 'letters') {
  const v = String(raw ?? '').trim();
  if (isBlank(v)) return OMITTED;

  const n = item.opts.length;
  const order = paperOrder(item);
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');

  const readings = {
    letters: () => { const k = asLetter(v, n); return k === null ? null : order[k]; },
    numbers: () => { const k = asNumber(v, n); return k === null ? null : order[k]; },
    text: () => { const i = item.opts.findIndex(o => norm(o.t) === norm(v)); return i >= 0 ? i : null; }
  };
  const tries = {
    letters: ['letters', 'numbers', 'text'],
    numbers: ['numbers', 'text', 'letters'],
    text: ['text', 'letters', 'numbers']
  }[coding];
  for (const t of tries) {
    const idx = readings[t]();
    if (idx !== null) return idx;
  }
  return null;
}

/**
 * Parse pasted responses against a pack.
 *
 * @returns {{ok, students, responses, errors, warnings, omitted, matchedBy}}
 */
export function parseResponses(pack, text) {
  const errors = [];
  const warnings = [];
  const rows = splitRows(text || '');

  if (rows.length < 2) {
    return { ok: false, errors: ['Paste at least a header row and one student row.'], warnings: [], students: [], responses: [] };
  }

  const delim = detectDelim(rows);
  const table = rows.map(r => splitCells(r, delim));
  const header = table[0];

  // Does the header name our items? If so, map columns by id and tolerate
  // reordering or extra columns. Otherwise fall back to positional order.
  const idIndex = {};
  pack.items.forEach(it => {
    const at = header.findIndex(h => h.trim().toLowerCase() === it.id.toLowerCase());
    if (at >= 0) idIndex[it.id] = at;
  });

  const matchedById = Object.keys(idIndex).length >= Math.ceil(pack.items.length * 0.8);
  let nameCol = 0;
  let cols;

  if (matchedById) {
    const missing = pack.items.filter(it => idIndex[it.id] === undefined);
    if (missing.length) {
      errors.push(`These questions are missing from the header: ${missing.slice(0, 6).map(m => m.id).join(', ')}${missing.length > 6 ? `, +${missing.length - 6} more` : ''}.`);
    }
    cols = pack.items.map(it => idIndex[it.id]);
    const named = header.findIndex(h => /^(student|name|pupil)$/i.test(h.trim()));
    nameCol = named >= 0 ? named : -1;
  } else {
    // Positional: assume the first column is a name if it is not readable as an
    // answer, then one column per item in pack order.
    const probe = table[1] || [];
    const firstLooksLikeAnswer = readCell(probe[0], pack.items[0]) !== null && String(probe[0] ?? '').trim() !== '';
    nameCol = firstLooksLikeAnswer ? -1 : 0;
    const start = nameCol === 0 ? 1 : 0;
    cols = pack.items.map((_, i) => start + i);

    const available = (probe.length || 0) - start;
    if (available < pack.items.length) {
      errors.push(`This instrument has ${pack.items.length} questions but the pasted data has ${Math.max(0, available)} answer column${available === 1 ? '' : 's'}. Add the missing columns, or use a header row naming each question id.`);
    } else if (available > pack.items.length) {
      warnings.push(`Ignoring ${available - pack.items.length} extra column${available - pack.items.length === 1 ? '' : 's'} beyond question ${pack.items.length}.`);
    }
    warnings.push('No question ids found in the header, so columns were read in order.');
  }

  if (errors.length) return { ok: false, errors, warnings, students: [], responses: [] };

  const coding = detectCoding(pack, table.slice(1), cols);
  const students = [];
  const responses = [];
  let omitted = 0;
  const bad = [];

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row.some(c => c.trim())) continue;

    const name = nameCol >= 0 && row[nameCol]?.trim() ? row[nameCol].trim() : `Student ${responses.length + 1}`;
    const out = [];

    pack.items.forEach((it, i) => {
      const cell = row[cols[i]];
      const idx = readCell(cell, it, coding);
      if (idx === null) {
        bad.push(`row ${r + 1} (${name}), ${it.id}: “${String(cell).slice(0, 14)}”`);
        out.push(OMITTED);
      } else {
        if (idx === OMITTED) omitted++;
        out.push(idx);
      }
    });

    students.push({ id: `S${String(responses.length + 1).padStart(2, '0')}`, name });
    responses.push(out);
  }

  if (!responses.length) errors.push('No student rows found.');
  if (responses.length && responses.length < 5) {
    warnings.push(`Only ${responses.length} student${responses.length === 1 ? '' : 's'}. Grouping needs roughly 12 or more to say anything meaningful; individual diagnoses will still work.`);
  }
  if (bad.length) {
    warnings.push(`${bad.length} cell${bad.length === 1 ? ' could not be read and was' : 's could not be read and were'} treated as unanswered — ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '…' : ''}`);
  }
  if (omitted) {
    warnings.push(`${omitted} blank answer${omitted === 1 ? '' : 's'} treated as unanswered. These carry no evidence either way rather than counting against the student.`);
  }

  return {
    ok: errors.length === 0,
    errors, warnings, students, responses, omitted, coding,
    matchedBy: matchedById ? 'question id' : 'column order'
  };
}

/** The reteach plan as a spreadsheet, one row per group. */
export function groupsCsv(pack, cls, groups, misIndex) {
  const head = ['Group', 'Students', 'Size', 'Misconceptions', 'Reteach', 'Check 1', 'Check 2', 'Check 3'];
  const rows = groups.map((g, n) => {
    const names = g.members.map(m => cls.students[m].name).join('; ');
    if (g.isSecure) {
      return [`Secure`, names, g.size, '—', 'No reteach needed. Practice and attention rather than a lesson.', '', '', ''];
    }
    const top = misIndex[g.signature[0]?.id];
    return [
      `Group ${n + 1}`,
      names,
      g.size,
      g.signature.map(s => `${s.id} ${misIndex[s.id]?.name ?? ''}`).join('; '),
      g.aiPlan?.plan || top?.reteach || '',
      ...(g.aiPlan?.verify || top?.verify || ['', '', '']).slice(0, 3)
    ];
  });
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}
