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
import { PARAMS } from './infer.js';
import { mathHtml } from './notation.js';

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

/**
 * Stored option index printed at each position: order[k] is letter k's option.
 * An item marked keepOrder is a teacher's own question, already on paper in
 * her order, so its letters are the stored order and nothing is shuffled.
 */
export function paperOrder(item) {
  let order = orderCache.get(item);
  if (!order) {
    const stored = item.opts.map((_, i) => i);
    order = item.keepOrder ? stored : shuffled(makeRng(idSeed(item.id)), stored);
    orderCache.set(item, order);
  }
  return order;
}

/** The letter a stored option is printed under. */
export function paperLetter(item, optIndex) {
  return LETTERS[paperOrder(item).indexOf(optIndex)] ?? '?';
}

/* ------------------------------------------------------------------ export */

/**
 * A spreadsheet runs any cell that starts like a formula, and a student name
 * pasted from a form can start with anything. A leading apostrophe makes it text.
 * Plain numbers such as -3 are left alone, since they cannot do anything.
 */
function neutralise(s) {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d.,/]*$/.test(s) ? `'${s}` : s;
}

export function csvCell(v) {
  const s = neutralise(String(v ?? ''));
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
  return [['Number', 'Topic', 'Question', 'Key', 'Correct answer'], ...rows]
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

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
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
<main>
<h1>${escapeHtml(pack.name)}${withKey ? ' — answer key' : ''}</h1>
<div class="meta">${[pack.subject, pack.level, `${pack.items.length} questions`].filter(Boolean).map(escapeHtml).join(' · ')}</div>
${withKey ? '' : '<div class="name">Name: ______________________________  Class: ____________  Date: ____________</div>'}
<ol class="qs">${items}</ol>
</main>
</body></html>`;
}

/**
 * The labels, on paper, for the teacher to check before any answers are read:
 * every wrong option with the misconception it is tagged with, and a line to
 * agree or fix it. Her predictions go on the first page, written before she
 * sees a result, so the comparison afterwards is against what she expected
 * rather than what the tool said.
 */
export function reviewHtml(pack) {
  const mis = Object.fromEntries(pack.misconceptions.map(m => [m.id, m]));
  const predict = pack.misconceptions.map(m =>
    `<li><span class="box"></span><b>${escapeHtml(m.name)}</b>${m.belief ? `<div class="bel">${escapeHtml(m.belief)}</div>` : ''}</li>`).join('');

  const items = pack.items.map((it, n) => {
    const opts = paperOrder(it).map((oi, k) => {
      const o = it.opts[oi];
      const label = o.c ? '<span class="key">correct answer</span>'
        : o.mis ? `<span class="tag">${escapeHtml(mis[o.mis]?.name ?? o.mis)}</span>`
        : '<span class="tag none">no label: a careless slip</span>';
      const check = o.c ? '' : '<div class="chk"><span class="box"></span>agree &nbsp; <span class="box"></span>fix: ______________________________</div>';
      return `<li><span class="l">${LETTERS[k]}.</span> ${escapeHtml(o.t)}<div class="lab">&rarr; ${label}</div>${check}</li>`;
    }).join('');
    return `<li class="q"><div class="stem"><span class="qn">${n + 1}.</span> ${escapeHtml(it.stem)}</div><ul class="opts">${opts}</ul></li>`;
  }).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(pack.name)} — labels to check</title>
<style>
  body{font:14px/1.5 Georgia,'Times New Roman',serif;max-width:44em;margin:36px auto;padding:0 24px;color:#111}
  h1{font-size:20px;margin:0 0 2px}
  h2{font-size:16px;margin:26px 0 6px}
  .meta{font-size:12px;color:#555;margin-bottom:6px}
  p{margin:6px 0 12px}
  ol.qs,ul.pred{padding-left:0;list-style:none;margin:0}
  ul.pred li{margin-bottom:9px;page-break-inside:avoid}
  .bel{font-size:12.5px;color:#444;margin-left:26px}
  li.q{margin-bottom:20px;page-break-inside:avoid}
  .stem{margin-bottom:5px}
  .qn{font-weight:bold;margin-right:5px}
  ul.opts{list-style:none;padding-left:22px;margin:0}
  ul.opts li{margin-bottom:7px}
  .l{display:inline-block;width:1.3em;color:#666}
  .lab{margin-left:1.3em;font-size:13px}
  .tag{font-style:italic}
  .tag.none,.key{color:#666}
  .chk{margin-left:1.3em;font-size:12.5px;color:#333}
  .box{display:inline-block;width:11px;height:11px;border:1px solid #333;margin-right:6px;vertical-align:-1px}
  .lines{border-bottom:1px solid #999;height:26px}
  .brk{page-break-before:always}
  @media print{body{margin:0}.noprint{display:none}}
  .noprint{margin-bottom:20px}
  button{font:inherit;padding:6px 13px;cursor:pointer}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print</button></div>
<main>
<h1>${escapeHtml(pack.name)} — labels to check</h1>
<div class="meta">${[pack.subject, pack.level, `${pack.items.length} questions`, `${pack.misconceptions.length} misunderstandings`].filter(Boolean).map(escapeHtml).join(' · ')}</div>

<h2>1 · Before you see any results</h2>
<p>Tick the 2 or 3 misunderstandings you expect to be most common in this class. If yours isn't listed, write it below.</p>
<ul class="pred">${predict}</ul>
<p>Other: </p><div class="lines"></div>
<p>Class / period: ______________ &nbsp; Date: ______________</p>

<h2 class="brk">2 · The labels</h2>
<p>Each wrong answer is labelled with the misunderstanding that most likely leads a student to pick it. Tick <b>agree</b>, or write the fix. "A careless slip" means the answer says nothing about what the student believes.</p>
<ol class="qs">${items}</ol>
</main>
</body></html>`;
}

/**
 * One slip per student, to hand back with the paper. It is written to the
 * student, so it carries no percentages, group numbers or rankings, and it says
 * plainly that it is a guess: a sixteen-year-old should be able to read it and
 * tell the teacher it is wrong.
 */
export function slipsHtml(pack, cls, inf, cov) {
  const byId = Object.fromEntries(pack.misconceptions.map(m => [m.id, m]));

  const slips = cls.students.map((st, s) => {
    const held = inf.misIds
      .map((id, k) => ({ m: byId[id], p: inf.posterior[s][k] }))
      .filter(x => x.m && x.p >= PARAMS.decisionThreshold)
      .sort((a, b) => b.p - a.p)
      .slice(0, 2);

    let body;
    if (held.length) {
      body = `<p class="lead">Your answers point to this mix-up:</p>` + held.map(({ m }) => {
        const tryThese = (m.verify || []).map(v => `<li>${mathHtml(v)}</li>`).join('');
        return `<h3>${mathHtml(m.name)}</h3>
${m.belief ? `<p>${mathHtml(m.belief)}</p>` : ''}
${tryThese ? `<p class="try">Try these:</p><ol>${tryThese}</ol>` : ''}`;
      }).join('');
    } else if (cov[s].thin) {
      body = `<p class="lead">You left a lot of this blank, so there is not enough here to go on yet. Talk to your teacher about finishing it.</p>`;
    } else {
      body = `<p class="lead">Your mistakes do not follow one pattern, which usually means slips rather than a misunderstanding. Slow down, check your work, and keep practising.</p>`;
    }

    return `<article class="slip">
<h2>${escapeHtml(st.name)}</h2>
<div class="meta">${escapeHtml(pack.name)}</div>
${body}
<p class="foot">This is not a grade. It is a best guess from the pattern in your answers, so tell your teacher if it looks wrong.</p>
</article>`;
  }).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(pack.name)} — student slips</title>
<style>
  body{font:14px/1.5 Georgia,'Times New Roman',serif;max-width:44em;margin:36px auto;padding:0 24px;color:#111}
  h1{font-size:20px;margin:0 0 16px}
  .slip{border:1px dashed #888;padding:16px 20px;margin-bottom:20px;page-break-inside:avoid;break-inside:avoid}
  h2{font-size:18px;margin:0}
  h3{font-size:15px;margin:12px 0 2px}
  p{margin:4px 0}
  ol{margin:4px 0 0;padding-left:22px}
  .meta{font-size:12px;color:#555;margin-bottom:8px}
  .lead{margin-top:8px}
  .try{font-weight:bold;margin-top:8px}
  .foot{font-size:12px;color:#555;margin-top:12px}
  @media print{body{margin:0}.noprint{display:none}}
  .noprint{margin-bottom:20px}
  button{font:inherit;padding:6px 13px;cursor:pointer}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print</button></div>
<main>
<h1 class="noprint">${escapeHtml(pack.name)} — student slips</h1>
${slips}
</main>
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

/* What a spreadsheet puts around the answers. A Google Forms export leads with
   a timestamp and an email, and a quiz adds score and feedback columns. None of
   these are answers, and reading them as answers shifts every column after. */
const META_COL = /^(time\s*stamp|date|e-?mail(\s+address)?|user\s*name|score|total(\s+score)?|points|grade|class|period|section)$|\[(score|feedback)\]$/i;
const EMAIL_COL = /^e-?mail(\s+address)?$|^user\s*name$/i;
const NAME_COL = /^(student|student\s+name|name|full\s+name|your\s+name|pupil|learner)$/i;
const KEY_ROW = /^(answer\s*)?key$/i;

const textKey = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const withoutNumber = s => String(s).replace(/^\s*(q(uestion)?\s*)?\d+\s*[.):-]?\s*/i, '');

/** Case and spacing should not split one student into two. */
export function normName(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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

/** Does this row read as a student's answers rather than as column titles? */
function looksLikeAnswers(pack, row) {
  const cells = row.slice(-pack.items.length);
  if (cells.length < pack.items.length) return false;
  const readable = cells.filter((c, i) => c.trim() && readCell(c, pack.items[i]) !== null).length;
  return readable >= cells.length * 0.8;
}

/**
 * Parse pasted responses against a pack.
 *
 * @returns {{ok, students, responses, errors, warnings, omitted, matchedBy}}
 */
export function parseResponses(pack, text, otherPacks = []) {
  const errors = [];
  const warnings = [];
  const rows = splitRows(String(text || '').replace(/^\uFEFF/, ''));   // Excel's BOM

  if (rows.length < 2) {
    return { ok: false, errors: ['Paste at least a header row and one student row.'], warnings: [], students: [], responses: [] };
  }

  const delim = detectDelim(rows);
  const table = rows.map(r => splitCells(r, delim));
  const header = table[0];

  // Does the header name our items? A blank sheet from Materials uses their ids
  // and a Forms export repeats the question text. Either way, map the columns
  // and tolerate reordering or extras. Otherwise fall back to positional order.
  const idIndex = {};
  let byText = 0;
  pack.items.forEach(it => {
    let at = header.findIndex(h => h.trim().toLowerCase() === it.id.toLowerCase());
    if (at < 0) {
      const stem = textKey(it.stem);
      at = header.findIndex(h => !META_COL.test(h.trim()) &&
        (textKey(h) === stem || textKey(withoutNumber(h)) === stem));
      if (at >= 0) byText++;
    }
    if (at >= 0) idIndex[it.id] = at;
  });

  const matchedById = Object.keys(idIndex).length >= Math.ceil(pack.items.length * 0.8);

  // A header naming another loaded test's questions is the wrong subject, not a
  // sheet to read by position. Saying which one saves a confusing error at best
  // and, on two tests of the same length, every answer being misread at worst.
  if (!matchedById) {
    const heads = new Set(header.map(h => h.trim().toLowerCase()));
    const other = otherPacks.find(o => o.id !== pack.id &&
      o.items.filter(it => heads.has(it.id.toLowerCase())).length >= Math.ceil(o.items.length * 0.8));
    if (other) {
      return { ok: false, errors: [`These answers are for “${other.name}”, but “${pack.name}” is selected. Switch the subject first.`], warnings: [], students: [], responses: [] };
    }
  }

  const emailCol = header.findIndex(h => EMAIL_COL.test(h.trim()));
  let nameCol = 0;
  let dataStart = 1;
  let cols;

  if (matchedById) {
    const missing = pack.items.filter(it => idIndex[it.id] === undefined);
    if (missing.length) {
      errors.push(`These questions are missing from the header: ${missing.slice(0, 6).map(m => m.id).join(', ')}${missing.length > 6 ? `, +${missing.length - 6} more` : ''}.`);
    }
    cols = pack.items.map(it => idIndex[it.id]);
    const named = header.findIndex(h => NAME_COL.test(h.trim()));
    const spare = header.findIndex((h, i) => !cols.includes(i) && !META_COL.test(h.trim()));
    nameCol = named >= 0 ? named : emailCol >= 0 ? emailCol : spare;
  } else {
    // Positional: assume the first free column is a name if it is not readable
    // as an answer, then one column per item in pack order. Columns the header
    // says are something else are stepped over.
    const skip = new Set(header.map((h, i) => (META_COL.test(h.trim()) ? i : -1)).filter(i => i >= 0));
    const named = header.findIndex(h => NAME_COL.test(h.trim()));

    // No labels at all, and the first row reads as answers: there is no header
    // row, and treating one student as a header would silently lose them.
    if (!skip.size && named < 0 && looksLikeAnswers(pack, table[0])) {
      dataStart = 0;
      warnings.push('No header row found, so the first row was read as a student.');
    }

    const probe = table[dataStart] || [];
    const first = probe.findIndex((_, i) => !skip.has(i));
    if (named >= 0) nameCol = named;
    else if (emailCol >= 0) nameCol = emailCol;
    else {
      const firstLooksLikeAnswer = readCell(probe[first], pack.items[0]) !== null && String(probe[first] ?? '').trim() !== '';
      nameCol = firstLooksLikeAnswer ? -1 : first;
    }
    const free = probe.map((_, i) => i).filter(i => i !== nameCol && !skip.has(i));
    cols = pack.items.map((_, i) => free[i]);

    const available = free.length;
    if (available < pack.items.length) {
      errors.push(`This test has ${pack.items.length} questions but the pasted data has ${Math.max(0, available)} answer column${available === 1 ? '' : 's'}. Add the missing columns, or use a header row naming each question id.`);
    } else if (available > pack.items.length) {
      warnings.push(`Ignoring ${available - pack.items.length} extra column${available - pack.items.length === 1 ? '' : 's'} beyond question ${pack.items.length}.`);
    }
    warnings.push('No question ids found in the header, so columns were read in order.');
  }

  if (errors.length) return { ok: false, errors, warnings, students: [], responses: [] };

  // "Last, First" typed into a comma-separated sheet splits the name in two and
  // pushes every answer one column right. One cell too many in a named row is
  // exactly that, so put the name back together.
  const rowsIn = table.slice(dataStart).map(row => {
    if (delim === ',' && nameCol === 0 && row.length === header.length + 1) {
      return [`${row[0]}, ${row[1]}`, ...row.slice(2)];
    }
    return row;
  });

  const coding = detectCoding(pack, rowsIn, cols);
  const students = [];
  const responses = [];
  let omitted = 0;
  const bad = [];

  let keyRow = false;

  for (let r = 0; r < rowsIn.length; r++) {
    const row = rowsIn[r];
    if (!row.some(c => c.trim())) continue;

    const name = nameCol >= 0 && row[nameCol]?.trim() ? row[nameCol].trim() : `Student ${responses.length + 1}`;
    if (KEY_ROW.test(name)) { keyRow = true; continue; }     // the answers, not a student
    const out = [];

    pack.items.forEach((it, i) => {
      const cell = row[cols[i]];
      const idx = readCell(cell, it, coding);
      if (idx === null) {
        bad.push(`row ${r + dataStart + 1} (${name}), ${it.id}: “${String(cell).slice(0, 14)}”`);
        out.push(OMITTED);
      } else {
        if (idx === OMITTED) omitted++;
        out.push(idx);
      }
    });

    students.push({ id: `S${String(responses.length + 1).padStart(2, '0')}`, name });
    responses.push(out);
  }

  if (keyRow) warnings.push('Left out the row called Key, since it is the answers rather than a student.');

  const seen = new Map();
  students.forEach(s => {
    const k = normName(s.name);
    seen.set(k, [...(seen.get(k) || []), s.name]);
  });
  const twice = [...seen.values()].filter(v => v.length > 1).map(v => v[0]);
  if (twice.length) {
    warnings.push(`${twice.slice(0, 4).join(', ')}${twice.length > 4 ? ` and ${twice.length - 4} more` : ''} ${twice.length === 1 ? 'appears' : 'appear'} more than once. Check for a pasted-twice row, and give two students with one name different labels so a retest can tell them apart.`);
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
    matchedBy: matchedById ? (byText ? 'question text' : 'question id') : 'column order'
  };
}

/** The reteach plan as a spreadsheet, one row per group. */
export function groupsCsv(pack, cls, groups, misIndex) {
  const head = ['Group', 'Students', 'Size', 'Misunderstandings', 'Reteach', 'Check 1', 'Check 2', 'Check 3'];
  const rows = groups.map((g, n) => {
    const names = g.members.map(m => cls.students[m].name).join('; ');
    if (g.isThin) {
      return ['Not enough answers', names, g.size, '—', 'Left at least half the paper blank. Get the rest of their answers before deciding anything.', '', '', ''];
    }
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
