/**
 * importer.js -- get a real class in, and get usable paper out.
 * ---------------------------------------------------------------------------
 * The sample class makes it possible to measure recovery against known answers.
 * Teachers can also import a real class, then print or export the materials
 * needed to use the analysis.
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
import { isTested, strength } from './infer.js';
import { escapeHtml, mathHtml } from './notation.js';
import { correctIndex } from './pack.js';

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
 * An item marked keepOrder is a teacher's question whose printed option order
 * must stay unchanged.
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
 * A printable sheet for checking labels before reviewing class results.
 * Teachers can record predictions on the first page before seeing the
 * analysis, then compare those predictions with the results.
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
        : '<span class="tag none">not linked to a known pattern</span>';
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
<p>Tick the two or three misunderstandings you expect to be most common in this class. If yours is not listed, write it below.</p>
<ul class="pred">${predict}</ul>
<p>Other: </p><div class="lines"></div>
<p>Class / period: ______________ &nbsp; Date: ______________</p>

<h2 class="brk">2 · The labels</h2>
<p>Each labelled answer is linked to a possible misunderstanding. Tick <b>agree</b> or write a correction. An answer marked "not linked to a known pattern" does not point to a specific misunderstanding.</p>
<ol class="qs">${items}</ol>
</main>
</body></html>`;
}

/**
 * One slip per student, to hand back with the paper. It is written to the
 * student, so it omits percentages and rankings. It also says the result is an
 * estimate that students should review with their teacher.
 */
export function slipsHtml(pack, cls, inf, cov, only = null) {
  const byId = Object.fromEntries(pack.misconceptions.map(m => [m.id, m]));
  const wanted = only ?? cls.students.map((_, s) => s);

  const slips = wanted.map(s => {
    const st = cls.students[s];
    const hasUntested = inf.misIds.some((_, k) => !isTested(inf, s, k));
    // Only what is reported to the teacher goes to the student: a belief that
    // rests on a single answer is a question for the teacher to ask first.
    const held = inf.misIds
      .map((id, k) => ({ m: byId[id], p: inf.posterior[s][k], level: strength(inf, s, k).level }))
      .filter(x => x.m && (x.level === 'clear' || x.level === 'likely'))
      .sort((a, b) => b.p - a.p)
      .slice(0, 2);

    let body;
    if (held.length) {
      body = `<p class="lead">Your answers may point to ${held.length === 1 ? 'this mix-up' : 'these mix-ups'}:</p>` + held.map(({ m }) => {
        const tryThese = (m.verify || []).map(v => `<li>${mathHtml(v)}</li>`).join('');
        // Use the student-facing wording on slips, not the teacher-facing belief.
        return `<h3>${mathHtml(m.name)}</h3>
${m.student ? `<p>${mathHtml(m.student)}</p>` : ''}
${tryThese ? `<p class="try">Try these:</p><ol>${tryThese}</ol>` : ''}`;
      }).join('');
    } else if (cov[s].thin) {
      body = `<p class="lead">You left a lot of this blank, so there is not enough here to go on yet. Talk to your teacher about finishing it.</p>`;
    } else if (cls.responses[s].every((c, i) => c < 0 || c === correctIndex(pack.items[i]))) {
      body = `<p class="lead">Every question you answered was correct. This test did not flag a pattern, but it does not measure everything. Ask your teacher if anything still feels unclear.</p>`;
    } else {
      body = `<p class="lead">Your answers did not show a clear, repeated pattern. This test cannot tell why those answers were wrong; review them with your teacher before deciding what to practise next.</p>`;
    }

    return `<article class="slip">
<h2>${escapeHtml(st.name)}</h2>
<div class="meta">${escapeHtml(pack.name)}</div>
${body}
${hasUntested && !cov[s].thin ? '<p class="note">Some patterns could not be checked because too few of their questions were answered.</p>' : ''}
<p class="foot">This is not a grade. It is an estimate based on your answer pattern. Review it with your teacher, especially if it does not seem right.</p>
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

/**
 * The open calls on one page, for the teacher: every student with a belief
 * worth one more question, or placed almost as close to another group, with
 * the question that would settle it and room to note the answer. A few
 * minutes at the start of the next lesson, instead of rereading thirty papers.
 */
export function followUpHtml(pack, cls, inf, groups) {
  const byId = Object.fromEntries(pack.misconceptions.map(m => [m.id, m]));
  const real = groups.filter(g => !g.isSecure && !g.isThin);
  const label = g => `Group ${groups.indexOf(g) + 1}`;
  const ask = m => (m?.verify?.[0] ? mathHtml(m.verify[0]) : '<i>Ask them to talk you through one of these questions.</i>');

  const rows = [];
  cls.students.forEach((st, s) => {
    inf.misIds.forEach((id, k) => {
      const lv = strength(inf, s, k);
      if (lv.level !== 'check') return;
      rows.push({ s, what: `Might hold “${mathHtml(byId[id]?.name ?? id)}” (${lv.telling} answer${lv.telling === 1 ? '' : 's'} point${lv.telling === 1 ? 's' : ''} to it)`, ask: ask(byId[id]) });
    });
    const home = real.find(g => g.members.includes(s));
    const b = home?.between?.find(x => x.s === s);
    const other = b && real.find(g => g.index === b.alt);
    if (other) {
      const lead = byId[other.signature[0]?.id];
      rows.push({ s, what: `In ${label(home)}, almost as close to ${label(other)}: a wrong answer here points to ${label(other)}`, ask: ask(lead) });
    }
  });

  const body = rows.length
    ? `<table><thead><tr><th>Student</th><th>What is still open</th><th>Ask</th><th>Their answer</th></tr></thead><tbody>${
      rows.map((r, j) => `<tr><td>${j && rows[j - 1].s === r.s ? '' : escapeHtml(cls.students[r.s].name)}</td><td>${r.what}</td><td>${r.ask}</td><td class="ans"></td></tr>`).join('')
    }</tbody></table>`
    : '<p>Nothing is open: no student has a belief worth one more question, and no one sits between two groups.</p>';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(pack.name)} — follow-up questions</title>
<style>
  body{font:13.5px/1.45 Georgia,'Times New Roman',serif;max-width:60em;margin:32px auto;padding:0 24px;color:#111}
  h1{font-size:20px;margin:0 0 4px}
  .meta{font-size:12px;color:#555;margin-bottom:14px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f2f2f2;font-size:12.5px}
  td.ans{width:22%}
  td:first-child{white-space:nowrap}
  tr{page-break-inside:avoid;break-inside:avoid}
  @media print{body{margin:0}.noprint{display:none}}
  .noprint{margin-bottom:16px}
  button{font:inherit;padding:6px 13px;cursor:pointer}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print</button></div>
<main>
<h1>${escapeHtml(pack.name)} — follow-up questions</h1>
<div class="meta">${rows.length} open call${rows.length === 1 ? '' : 's'} for ${new Set(rows.map(r => r.s)).size} student${new Set(rows.map(r => r.s)).size === 1 ? '' : 's'}. One question each settles most of them; note the answer and look again at that student's result.</div>
${body}
</main>
</body></html>`;
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
  const normalized = text.replace(/\r\n?/g, '\n');
  const rows = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '"') {
      if (quoted && normalized[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (normalized[i] === '\n' && !quoted) {
      const row = normalized.slice(start, i);
      if (row.trim()) rows.push(row);
      start = i + 1;
    }
  }
  const last = normalized.slice(start);
  if (last.trim()) rows.push(last);
  return quoted ? null : rows;
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
  rows.slice(0, 5).forEach(row => {
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') {
        if (quoted && row[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && Object.hasOwn(counts, row[i])) {
        counts[row[i]]++;
      }
    }
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
const SUMMARY_ROW = /^(class\s+)?(average|avg|mean|median|total|totals|max(imum)?|min(imum)?|count|(%|percent(age)?)\s*correct)$/i;

const textKey = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const withoutNumber = s => String(s).replace(/^\s*(q(uestion)?\s*)?\d+\s*[.):-]?\s*/i, '');

/** Case and spacing should not split one student into two. */
export function normName(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Forms, Docs and Word retype what a teacher writes: "-" becomes a minus sign
 * or a dash, quotes curl, x^2 becomes x². An answer is matched to its option
 * after both are folded the same way, so "−8" is still "-8". No two options of
 * a built-in question fold to the same text.
 */
const typed = s => String(s).normalize('NFKC')
  .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
  .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
  .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
export const foldAnswer = s => typed(s).toLowerCase()
  .replace(/\u00F7/g, '/').replace(/\u221A/g, 'sqrt').replace(/\^/g, '').replace(/\s+/g, '');

const isBlank = v => !v || v === '-' || v === '.';
/** "A", "a)", "(B)", "C.", "Option D" and "A. x+3" all name a letter. */
const LETTERED = /^(?:(?:option|choice|answer)\s+)?\(?([a-h])(?:[).:]+(?:\s.*)?)?$/i;
const asLetter = (v, n) => {
  const m = LETTERED.exec(v);
  const li = m ? LETTERS.indexOf(m[1].toUpperCase()) : -1;
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
  const v = typed(raw ?? '').trim();
  if (isBlank(v)) return OMITTED;

  const n = item.opts.length;
  const order = paperOrder(item);
  const norm = foldAnswer;

  // "A. x+3" says what was chosen twice. The words are the safer of the two,
  // since a form of the teacher's own may letter its options differently.
  const words = v.replace(/^\(?[a-h][).:]+\s+/i, '');
  if (words !== v) {
    const i = item.opts.findIndex(o => norm(o.t) === norm(words));
    if (i >= 0) return i;
  }

  // On a true/false question, T and F are the natural thing to type.
  if (/^[tf]$/i.test(v)) {
    const want = v.toLowerCase() === 't' ? 'true' : 'false';
    const i = item.opts.findIndex(o => norm(o.t) === want);
    if (i >= 0) return i;
  }

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

  if (rows === null) {
    return {
      ok: false,
      errors: ['A quoted cell is not closed. Check for a missing or extra double quote, then paste again.'],
      warnings,
      students: [],
      responses: []
    };
  }

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
    const idMatches = header
      .map((h, i) => h.trim().toLowerCase() === it.id.toLowerCase() ? i : -1)
      .filter(i => i >= 0);
    if (idMatches.length > 1) {
      errors.push(`The header repeats question ${it.id}. Keep only one column for each question.`);
    }
    let at = idMatches[0] ?? -1;
    if (at < 0) {
      const stem = textKey(it.stem);
      const textMatches = header
        .map((h, i) => !META_COL.test(h.trim()) &&
          (textKey(h) === stem || textKey(withoutNumber(h)) === stem) ? i : -1)
        .filter(i => i >= 0);
      if (textMatches.length > 1) {
        errors.push(`The header repeats the text for question ${it.id}. Keep only one column for each question.`);
      }
      at = textMatches[0] ?? -1;
      if (at >= 0) byText++;
    }
    if (at >= 0) idIndex[it.id] = at;
  });

  const named = Object.keys(idIndex).length;
  // A teacher often gives one unit of a test, not all of it. A header that
  // names some of its questions, by id or by text, is that, as long as no
  // other loaded test's questions are named more often. A test with exactly
  // these question ids is a copy of this one (a pattern named on a built-in
  // test makes one), which a header cannot tell apart, so the selected one wins.
  const ids = pack.items.map(it => it.id).join('\n');
  const otherBest = Math.max(0, ...otherPacks.filter(o => o.id !== pack.id && o.items.map(it => it.id).join('\n') !== ids).map(o => {
    const heads = new Set(header.map(h => h.trim().toLowerCase()));
    return o.items.filter(it => heads.has(it.id.toLowerCase())).length;
  }));
  const partial = named < pack.items.length && named >= MIN_PART && named > otherBest;
  const matchedById = partial || named >= Math.ceil(pack.items.length * 0.8);

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
    if (missing.length && !partial) {
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
      errors.push(`This test has ${pack.items.length} questions, but what you pasted has ${Math.max(0, available)} answer column${available === 1 ? '' : 's'}. Add the missing columns, or name each question in the top row (${pack.items[0].id}, ${pack.items[1]?.id ?? ''} and so on).`);
    } else if (available > pack.items.length) {
      warnings.push(`Ignoring ${available - pack.items.length} extra column${available - pack.items.length === 1 ? '' : 's'} beyond question ${pack.items.length}.`);
    }
    warnings.push('No question ids found in the header, so columns were read in order.');
  }

  if (errors.length) return { ok: false, errors, warnings, students: [], responses: [] };

  // "Last, First" typed into a comma-separated sheet splits the name in two and
  // pushes every answer one column right. One cell too many in a named row is
  // exactly that, so put the name back together.
  const splitNameWidth = dataStart === 0 ? pack.items.length + 2 : header.length + 1;
  const rowsIn = table.slice(dataStart).map(row => {
    if (delim === ',' && nameCol === 0 && row.length === splitNameWidth) {
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
  const summaries = [];

  for (let r = 0; r < rowsIn.length; r++) {
    const row = rowsIn[r];
    if (!row.some(c => c.trim())) continue;

    // A Forms export that collected emails has no name column, and a whole school
    // address is too long for a map row, a name list or the top of a student's slip.
    const given = nameCol >= 0 ? (row[nameCol] ?? '').trim() : '';
    const name = (nameCol === emailCol ? given.replace(/@.*$/, '') : given) || `Student ${responses.length + 1}`;
    if (KEY_ROW.test(name)) { keyRow = true; continue; }     // the answers, not a student
    const out = [];
    const [badBefore, omittedBefore] = [bad.length, omitted];

    pack.items.forEach((it, i) => {
      const cell = row[cols[i]];
      const idx = readCell(cell, it, coding);
      if (idx === null) {
        bad.push(`row ${r + dataStart + 1} (${name}), ${it.id}: “${String(cell).slice(0, 14)}”`);
        out.push(OMITTED);
      } else {
        // A question with no column was not given, which is not a blank.
        if (idx === OMITTED && cols[i] !== undefined) omitted++;
        out.push(idx);
      }
    });

    // A gradebook often ends in an Average row. Max may be a student, though, so
    // only a row without real answers counts as one of these.
    if (SUMMARY_ROW.test(name) && out.filter(v => v >= 0).length < out.length / 2) {
      bad.length = badBefore;
      omitted = omittedBefore;
      summaries.push(name);
      continue;
    }

    students.push({ id: `S${String(responses.length + 1).padStart(2, '0')}`, name });
    responses.push(out);
  }

  if (keyRow) warnings.push('Left out the row called Key, since it is the answers rather than a student.');
  if (summaries.length) warnings.push(`Left out ${summaries.join(', ')}, since ${summaries.length === 1 ? 'that row looks' : 'those rows look'} like a total rather than a student.`);

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
  // Reading on would show a class with nothing in it, as if they had all left it blank.
  if (bad.length && responses.every(row => row.every(v => v === OMITTED))) {
    errors.push(`None of these answers could be read, for example ${bad[0]}. Use the letters printed on the paper, option numbers, or the answer text.`);
  }
  if (responses.length && responses.length < 5) {
    warnings.push(`Only ${responses.length} student${responses.length === 1 ? '' : 's'}. Grouping needs roughly 12 or more to say anything meaningful; individual diagnoses will still work.`);
  }
  if (bad.length) {
    warnings.push(`${bad.length} cell${bad.length === 1 ? ' could not be read and was' : 's could not be read and were'} treated as unanswered — ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '…' : ''}`);
  }
  if (omitted) {
    warnings.push(`${omitted} blank answer${omitted === 1 ? '' : 's'} treated as unanswered. These carry no evidence either way rather than counting against the student.`);
  }

  // Only some of the questions were given: the class is read against a copy of
  // the test cut down to them, so nothing is counted as left blank that was
  // never asked, and only the misunderstandings those questions test are tracked.
  if (partial) {
    const asked = pack.items.map((it, i) => (idIndex[it.id] !== undefined ? i : -1)).filter(i => i >= 0);
    const part = partOfPack(pack, asked);
    const dropped = pack.misconceptions.length - part.misconceptions.length;
    warnings.unshift(`Only ${asked.length} of the ${pack.items.length} questions are in the paste, so the class is read against just those ${asked.length}` +
      (dropped ? `. ${dropped} misunderstanding${dropped === 1 ? ' is' : 's are'} not tested by them and ${dropped === 1 ? 'is' : 'are'} left out.` : '.'));
    return {
      ok: errors.length === 0,
      errors, warnings, students, responses: responses.map(row => asked.map(i => row[i])), omitted, coding,
      matchedBy: byText ? 'question text' : 'question id',
      pack: part, asked
    };
  }

  return {
    ok: errors.length === 0,
    errors, warnings, students, responses, omitted, coding,
    matchedBy: matchedById ? (byText ? 'question text' : 'question id') : 'column order'
  };
}

/** Fewest of a test's questions a header must name to be read as part of it. */
export const MIN_PART = 3;

/**
 * A copy of `pack` with only the questions at `asked`, for a class that was
 * given part of it. Question ids, option text and printed letters are kept;
 * misunderstandings none of those questions test are left out, and so are
 * they from the simulated profiles. It is a test of its own, so a saved class
 * carries it inside the file.
 */
export function partOfPack(pack, asked) {
  const items = asked.map(i => pack.items[i]);
  const tested = new Set(items.flatMap(it => it.opts.map(o => o.mis).filter(Boolean)));
  const ids = items.map(it => it.id).join(',');
  let h = 2166136261;
  for (const ch of ids) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return {
    ...structuredClone(pack),
    id: `${pack.id}~${(h >>> 0).toString(36)}`,
    name: `${pack.name}: ${items.length} of ${pack.items.length} questions`,
    partOf: pack.id,
    items: structuredClone(items),
    misconceptions: structuredClone(pack.misconceptions.filter(m => tested.has(m.id))),
    archetypes: (pack.archetypes || []).map(a => ({ ...a, core: (a.core || []).filter(m => tested.has(m)) }))
  };
}

/**
 * The reteach plan as a spreadsheet, one row per group. With `dx` (the beliefs
 * reported for each student), each group also lists the students outside it
 * who show its main pattern and belong in the lesson too.
 */
export function groupsCsv(pack, cls, groups, misIndex, dx = null, found = []) {
  const head = ['Group', 'Students', 'Size', 'Misunderstandings', 'Reteach', 'Check 1', 'Check 2', 'Check 3', 'Also bring in', 'Check where they fit'];
  const rows = groups.flatMap((g, n) => {
    const names = g.members.map(m => cls.students[m].name).join('; ');
    if (g.isThin) {
      return [['Not enough answers', names, g.size, '—', 'At least half the paper is blank. Collect more answers or check in with these students before drawing conclusions.', '', '', '', '', '']];
    }
    if (g.isSecure) {
      const nameOf = list => list.map(m => cls.students[m].name).join('; ');
      const support = g.support || [];
      const rest = g.onTrack || g.members;
      return [
        ...(support.length ? [['Getting most wrong', nameOf(support), support.length, '—', 'No clear pattern, but right on fewer than 60% of the questions their errors do not explain. Work through a few problems with them and see where it breaks down.', '', '', '', '', '']] : []),
        ...(rest.length ? [['No clear pattern', nameOf(rest), rest.length, '—', 'The answers did not show a clear pattern on this test. Review the evidence before deciding what support would help.', '', '', '', '', '']] : [])
      ];
    }
    const top = misIndex[g.signature[0]?.id];
    const lead = g.signature[0]?.id;
    const outside = dx && lead
      ? dx.map((held, s) => (held.has(lead) && !g.members.includes(s) ? cls.students[s].name : null)).filter(Boolean)
      : [];
    return [[
      `Group ${n + 1}`,
      names,
      g.size,
      g.signature.map(s => `${s.id} ${misIndex[s.id]?.name ?? ''}`).join('; '),
      g.aiPlan?.plan || top?.reteach || '',
      ...[...(g.aiPlan?.verify || top?.verify || []), '', '', ''].slice(0, 3),
      outside.join('; '),
      // Members almost as close to another group, with that group's number.
      (g.between || []).map(b => {
        const n2 = groups.findIndex(x => x.index === b.alt && !x.isSecure && !x.isThin);
        return n2 < 0 ? null : `${cls.students[b.s].name} (or Group ${n2 + 1})`;
      }).filter(Boolean).join('; ')
    ]];
  });
  // Wrong answers the question set has no label for, picked together (js/discover.js).
  const unlabelled = found.map(f => [
    'Not in the question set',
    f.students.map(m => cls.students[m].name).join('; '),
    f.count,
    f.options.map(({ i, oi }) => `${pack.items[i].id} ${paperLetter(pack.items[i], oi)} "${pack.items[i].opts[oi].t}"`).join('; '),
    'These wrong answers were picked together more often than in 95 of 100 shuffled copies of the class, and the question set links them to no misunderstanding. Ask the students how they got them.',
    '', '', '', '', ''
  ]);
  return [head, ...rows, ...unlabelled].map(r => r.map(csvCell).join(',')).join('\n');
}
