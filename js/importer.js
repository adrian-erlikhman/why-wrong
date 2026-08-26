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
 */

const LETTERS = 'ABCDEFGH';

/** Omitted answer. Distinct from wrong: it carries no evidence either way. */
export const OMITTED = -1;

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
    return [it.id, it.topic || '', it.stem, LETTERS[ci], it.opts[ci].t];
  });
  return [['Item', 'Topic', 'Question', 'Key', 'Correct answer'], ...rows]
    .map(r => r.map(csvCell).join(',')).join('\n');
}

/** A printable paper version of the instrument. */
export function quizHtml(pack, { withKey = false } = {}) {
  const items = pack.items.map((it, n) => {
    const opts = it.opts.map((o, oi) => {
      const mark = withKey && o.c ? ' <b>&larr; key</b>' : '';
      return `<li><span class="l">${LETTERS[oi]}.</span> ${escapeHtml(o.t)}${mark}</li>`;
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

/**
 * Turn one cell into an option index for `item`.
 * Accepts a letter, a 1-based number, or the option text itself.
 * @returns {number|null} index, OMITTED for blank, or null if unreadable.
 */
function readCell(raw, item) {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || v === '.') return OMITTED;

  const n = item.opts.length;

  if (v.length === 1) {
    const li = LETTERS.indexOf(v.toUpperCase());
    if (li >= 0 && li < n) return li;
  }

  if (/^\d+$/.test(v)) {
    const num = parseInt(v, 10);
    if (num >= 1 && num <= n) return num - 1;
    if (num === 0 && n > 0) return 0;
  }

  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  const exact = item.opts.findIndex(o => norm(o.t) === norm(v));
  if (exact >= 0) return exact;

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
      const idx = readCell(cell, it);
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
    errors, warnings, students, responses, omitted,
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
