/**
 * app.js -- orchestration and rendering.
 *
 * Pipeline order, stated once because it matters:
 *   pack -> class (simulated or imported) -> infer -> cluster -> item analysis
 * Item analysis takes the inference result because it asks a leave-one-out
 * question of it. Validation takes the planted truth, which nothing upstream of
 * it is permitted to see, and which an imported class simply does not have.
 *
 * Nothing here knows what subject is loaded.
 */

import { allPacks, getPack, addPack, defaultPack } from './packs/index.js';
import { correctIndex, misById } from './pack.js';
import { generateClass, totalScores } from './simulate.js';
import { inferMisconceptions, diagnose, prevalence, PARAMS } from './infer.js';
import { clusterStudents, describeClusters } from './cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha, interpretAlpha, severityOf } from './itemstats.js';
import { scoreDiagnosis, scoreClustering, confusion, fmtPct } from './validate.js';
import { setKey, rewritePlan } from './llm.js';
import { generatePack } from './generate.js';
import { infoButton, wireExplainers } from './explain.js';
import { openStudent, openQuestion, closeDrawer } from './drawer.js';
import {
  templateCsv, answerKeyCsv, quizHtml, download, openPrintable,
  parseResponses, groupsCsv, OMITTED
} from './importer.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const ROW_H = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row'), 10) || 19;

let colourOf = {};
function assignColours(pack) {
  colourOf = {};
  pack.misconceptions.forEach((m, i) => { colourOf[m.id] = `var(--m${(i % 12) + 1})`; });
}

const state = {
  pack: null, cls: null, inf: null, cl: null, groups: null, stats: null,
  sorted: false, rows: [], apiKey: null,
  imported: null,     // { students, responses } when the class is the teacher's own
  filterMis: null,    // highlight one misconception across the matrix
  itemFilter: 'problem'
};

const ctx = () => ({
  pack: state.pack, cls: state.cls, inf: state.inf, cl: state.cl,
  groups: state.groups, stats: state.stats, colourOf
});

/* ======================================================================== */
/*  Run                                                                     */
/* ======================================================================== */

function run() {
  const pack = state.pack;
  assignColours(pack);

  let cls;
  if (state.imported) {
    cls = {
      students: state.imported.students,
      responses: state.imported.responses,
      truth: null,                 // an imported class has no ground truth
      pack,
      meta: { seed: null, size: state.imported.students.length, nItems: pack.items.length, packId: pack.id, imported: true }
    };
  } else {
    const seed = Math.max(1, parseInt($('#seed').value, 10) || 7);
    const size = Math.min(120, Math.max(12, parseInt($('#size').value, 10) || 28));
    cls = generateClass(pack, { seed, size });
  }

  const inf = inferMisconceptions(pack, cls.responses);
  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const groups = describeClusters(inf.posterior, cl.labels, inf.misIds, cl);
  const stats = analyseItems(pack, cls.responses, inf);

  Object.assign(state, { cls, inf, cl, groups, stats, sorted: false, filterMis: null });

  renderPackLine();
  renderSummary();
  renderMatrix();
  renderGroups();
  renderStudents();
  renderItems();
  renderValidation();
  renderMethod();
  wireExplainers();

  $('#reorder').textContent = 'Sort into groups';
  $('#clear-filter').hidden = true;
}

function renderPackLine() {
  const { pack, cls } = state;
  const line = $('#pack-line');
  line.textContent =
    `${pack.name} · ${pack.subject}${pack.level ? ' · ' + pack.level : ''} — ` +
    `${pack.misconceptions.length} misunderstandings tracked · ${pack.items.length} questions · ` +
    (cls.meta.imported ? `${cls.students.length} students imported` : `sample class, variant ${cls.meta.seed}`);
  if (pack.source === 'generated') line.appendChild(el('span', 'gen-flag', 'built this session'));
}

/* ======================================================================== */
/*  Summary                                                                 */
/* ======================================================================== */

function renderSummary() {
  const { pack, cls, inf, groups, stats } = state;
  const host = $('#summary');
  host.innerHTML = '';

  const real = groups.filter(g => !g.isSecure);
  const secure = groups.find(g => g.isSecure);
  const biggest = real[0];
  const prev = prevalence(inf.posterior, inf.misIds)[0];
  const bad = problemItems(stats);
  const scores = totalScores(pack, cls.responses);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const byId = misById(pack);

  const cards = [
    { v: String(cls.students.length), k: 'students' },
    { v: String(real.length), k: `reteach group${real.length === 1 ? '' : 's'}`, cls: 'ok', go: 'groups' },
    { v: biggest ? String(biggest.size) : '—',
      k: biggest ? `in the biggest group` : 'no groups found', go: 'groups' },
    // The short labels are often notation ("x^a . x^b to x^(ab)"), which reads
    // badly inside a sentence. The name goes in the note below the strip instead.
    { v: prev ? String(Math.round(prev.expected)) : '—',
      k: 'share the top misunderstanding', go: 'matrix' },
    { v: `${Math.round((avg / pack.items.length) * 100)}%`, k: 'class average' },
    { v: String(bad.length), k: `question${bad.length === 1 ? '' : 's'} to review`,
      cls: bad.length ? 'warn' : 'ok', go: 'items' },
    { v: secure ? String(secure.size) : '0', k: 'need no reteach', go: 'groups' }
  ];

  cards.forEach(c => {
    const n = el(c.go ? 'button' : 'div', `sum${c.go ? ' sum-go' : ''}`);
    n.appendChild(el('div', `sum-v${c.cls ? ' ' + c.cls : ''}`, c.v));
    const k = el('div', 'sum-k', c.k);
    k.title = c.k;
    n.appendChild(k);
    if (c.go) n.addEventListener('click', () => showView(c.go));
    host.appendChild(n);
  });

  const topName = prev ? (byId[prev.id]?.name ?? prev.id) : null;
  $('#strip-note').textContent = real.length
    ? `Start with the biggest group. ${topName ? `The single most widespread problem is “${topName}”.` : ''}`
    : 'No shared pattern in this class — the mistakes are scattered, which usually means practice rather than reteaching.';
}

/* ======================================================================== */
/*  Matrix                                                                  */
/* ======================================================================== */

function renderMatrix() {
  const host = $('#matrix');
  host.innerHTML = '';
  host.classList.remove('sorted');

  const { pack, cls } = state;
  const scores = totalScores(pack, cls.responses);
  const ci = pack.items.map(correctIndex);
  state.rows = [];

  cls.responses.forEach((row, s) => {
    const r = el('div', 'm-row');
    r.dataset.student = String(s);

    const name = el('button', 'm-name', cls.students[s].name);
    name.title = `${cls.students[s].name} — click for the full evidence trail`;
    name.addEventListener('click', e => { e.stopPropagation(); openStudent(ctx(), s); });
    r.appendChild(name);

    row.forEach((choice, i) => {
      const item = pack.items[i];
      const c = el('button', 'm-cell');
      c.dataset.item = String(i);

      let what;
      if (choice === OMITTED || choice == null) {
        c.classList.add('omit');
        what = 'not answered';
      } else if (choice === ci[i]) {
        what = 'correct';
      } else {
        const mis = item.opts[choice].mis;
        if (mis) { c.style.background = colourOf[mis]; c.dataset.mis = mis; what = mis; }
        else { c.classList.add('slip'); what = 'wrong, no pattern'; }
      }

      c.title = `${cls.students[s].name} · ${item.id}\n${choice >= 0 ? `chose “${item.opts[choice].t}”` : 'left blank'} (${what})`;
      c.addEventListener('click', e => { e.stopPropagation(); openQuestion(ctx(), i); });
      r.appendChild(c);
    });

    r.appendChild(el('span', 'm-score', `${scores[s]}/${pack.items.length}`));
    host.appendChild(r);
    state.rows.push(r);
  });

  host.style.height = `${cls.responses.length * ROW_H() + 6}px`;
  layout(cls.responses.map((_, i) => i));
  renderLegend();
  setMatrixNote(false);
}

function setMatrixNote(sorted) {
  const real = state.groups.filter(g => !g.isSecure).length;
  $('#matrix-note').textContent = sorted
    ? `Same data, rows reordered so students who are wrong in the same way sit together. ${state.cls.students.length} students, ${real} group${real === 1 ? '' : 's'} — the vertical stripes are the questions where a whole group made the same mistake for the same reason.`
    : 'Rows are in register order, which is to say arbitrary. The pattern is already in this picture; it is just not visible yet.';
}

function layout(order) {
  const h = ROW_H();
  order.forEach((student, pos) => {
    state.rows[student].style.transform = `translateY(${pos * h}px)`;
  });
}

function sortRows() {
  const host = $('#matrix');
  const order = [];
  const bands = [];

  state.groups.forEach(g => {
    bands.push({ g, start: order.length, count: g.members.length });
    g.members.forEach(m => order.push(m));
  });

  layout(order);
  host.classList.add('sorted');
  host.querySelectorAll('.band, .band-tag').forEach(n => n.remove());

  const h = ROW_H();
  bands.forEach(b => {
    const colour = b.g.isSecure ? 'var(--accent-hi)' : (colourOf[b.g.signature[0]?.id] || 'var(--accent)');

    const bar = el('div', 'band');
    bar.style.top = `${b.start * h + 2}px`;
    bar.style.height = `${b.count * h - 5}px`;
    bar.style.background = colour;
    host.appendChild(bar);

    const tag = el('div', 'band-tag', b.g.isSecure ? 'no reteach' : (b.g.signature[0]?.id ?? ''));
    tag.style.top = `${b.start * h - 1}px`;
    host.appendChild(tag);

    // A timer rather than requestAnimationFrame: rAF is suspended while the tab
    // is backgrounded, which would leave these permanently invisible instead of
    // merely un-animated.
    setTimeout(() => { bar.classList.add('on'); tag.classList.add('on'); }, 30);
  });

  setMatrixNote(true);
}

function toggleSort() {
  const btn = $('#reorder');
  const host = $('#matrix');

  if (!state.sorted) {
    sortRows();
    state.sorted = true;
    btn.textContent = 'Back to register order';
  } else {
    host.classList.remove('sorted');
    host.querySelectorAll('.band, .band-tag').forEach(n => n.classList.remove('on'));
    layout(state.cls.responses.map((_, i) => i));
    state.sorted = false;
    btn.textContent = 'Sort into groups';
    setMatrixNote(false);
    setTimeout(() => host.querySelectorAll('.band, .band-tag').forEach(n => n.remove()), 480);
  }
}

/** Dim everything that is not the chosen misconception. */
function applyFilter(mid) {
  state.filterMis = mid;
  const host = $('#matrix');
  host.classList.toggle('filtered', !!mid);
  host.querySelectorAll('.m-cell').forEach(c => {
    c.classList.toggle('lit', !!mid && c.dataset.mis === mid);
  });
  $$('.leg').forEach(l => l.classList.toggle('is-on', !!mid && l.dataset.mis === mid));
  $('#clear-filter').hidden = !mid;

  if (mid) {
    const byId = misById(state.pack);
    const n = state.cls.responses.reduce((acc, row) =>
      acc + (row.some((c, i) => c >= 0 && state.pack.items[i].opts[c].mis === mid) ? 1 : 0), 0);
    $('#matrix-note').textContent =
      `Showing only “${byId[mid]?.name ?? mid}”. ${n} of ${state.cls.students.length} students made this mistake at least once.`;
  } else {
    setMatrixNote(state.sorted);
  }
}

function renderLegend() {
  const host = $('#legend');
  host.innerHTML = '';
  const byId = misById(state.pack);

  prevalence(state.inf.posterior, state.inf.misIds).forEach(p => {
    const m = byId[p.id];
    if (!m) return;
    const n = el('button', 'leg');
    n.dataset.mis = p.id;
    const sw = el('span', 'sw');
    sw.style.background = colourOf[p.id];
    n.appendChild(sw);
    n.appendChild(el('span', 'leg-n', p.id));
    n.appendChild(el('span', null, m.short || m.name));
    n.appendChild(el('span', 'leg-c', String(p.confident)));
    n.title = m.belief || m.name;
    n.addEventListener('click', () => applyFilter(state.filterMis === p.id ? null : p.id));
    host.appendChild(n);
  });

  [['var(--correct)', 'correct'], ['var(--slip)', 'wrong, no pattern'], ['transparent', 'not answered', true]]
    .forEach(([bg, label, dashed]) => {
      const n = el('span', 'leg leg-static');
      const sw = el('span', `sw${dashed ? ' sw-omit' : ''}`);
      if (!dashed) sw.style.background = bg;
      n.appendChild(sw);
      n.appendChild(el('span', null, label));
      host.appendChild(n);
    });
}

/* ======================================================================== */
/*  Groups                                                                  */
/* ======================================================================== */

function renderGroups() {
  const host = $('#groups');
  host.innerHTML = '';

  const real = state.groups.filter(g => !g.isSecure);
  const secure = state.groups.find(g => g.isSecure);
  const n = state.cls.students.length;

  const sub = $('#groups-sub');
  sub.textContent =
    `${n} students, but not ${n} problems. Students who are wrong in the same way are grouped together — ` +
    `${real.length} group${real.length === 1 ? '' : 's'} here` +
    (secure ? `, plus ${secure.size} who need no reteach.` : '.') +
    ` One lesson can serve a whole group, because they are wrong for the same reason.`;
  sub.appendChild(el('span', 'x-anchor', ' '));
  sub.querySelector('.x-anchor').appendChild(infoButton('failureMode'));

  state.groups.forEach((g, i) => host.appendChild(groupCard(g, i)));
}

function groupCard(g, idx) {
  const byId = misById(state.pack);
  const card = el('div', `group${g.isSecure ? ' secure' : ''}`);
  const total = state.cls.students.length;

  const top = el('div', 'group-top');
  if (!g.isSecure && g.signature[0]) card.style.setProperty('--gc', colourOf[g.signature[0].id]);

  const nline = el('div', 'group-n');
  nline.appendChild(el('span', null, g.isSecure ? 'No reteach needed' : `Group ${idx + 1}`));
  nline.appendChild(el('span', null, `${g.size} student${g.size === 1 ? '' : 's'} · ${Math.round((g.size / total) * 100)}%`));
  top.appendChild(nline);

  if (g.isSecure) {
    top.appendChild(el('h3', null, 'No stable misunderstanding'));
    card.appendChild(top);
    const body = el('div', 'group-body');
    body.appendChild(el('p', 'belief',
      'These students make mistakes, but the mistakes do not repeat and do not point anywhere. That is carelessness rather than a misunderstanding: they need practice and attention, not a reteach.'));
    body.appendChild(roster(g));
    card.appendChild(body);
    return card;
  }

  const details = g.signature.slice(0, 4).map(s => byId[s.id]).filter(Boolean);
  g.misDetails = details;

  const h = el('h3', null, g.aiPlan?.headline || details[0]?.name || 'Shared misunderstanding');
  if (g.aiPlan) h.appendChild(el('span', 'pill pill-ai', 'rewritten'));
  top.appendChild(h);

  const chips = el('div', 'chips');
  g.signature.slice(0, 4).forEach(s => {
    const c = el('button', 'chip');
    const sw = el('span', 'sw');
    sw.style.background = colourOf[s.id];
    c.appendChild(sw);
    c.appendChild(el('span', null, `${s.id} · ${Math.round(s.inMean * 100)}%`));
    const m = byId[s.id];
    c.title = `${m?.name ?? s.id} — click to highlight on the class map`;
    c.addEventListener('click', () => { showView('matrix'); applyFilter(s.id); });
    chips.appendChild(c);
  });
  top.appendChild(chips);
  card.appendChild(top);

  const body = el('div', 'group-body');
  if (details[0]?.belief) {
    body.appendChild(el('div', 'lab', 'What they believe'));
    body.appendChild(el('p', 'belief', details[0].belief));
  }

  body.appendChild(el('div', 'lab accent', g.aiPlan ? 'Reteach — rewritten for this group' : 'Reteach'));
  body.appendChild(el('p', 'plan', g.aiPlan?.plan || details[0]?.reteach || ''));

  const checks = g.aiPlan?.verify || details[0]?.verify || [];
  if (checks.length) {
    body.appendChild(el('div', 'lab', 'Check it landed'));
    const ul = el('ul', 'checks');
    checks.forEach(v => ul.appendChild(el('li', null, v)));
    body.appendChild(ul);
  }

  body.appendChild(roster(g));
  card.appendChild(body);
  return card;
}

function roster(g) {
  const box = el('div', 'roster');
  box.appendChild(el('div', 'lab', 'Who'));
  const list = el('div', 'roster-names');
  g.members.forEach(m => {
    const b = el('button', 'rname', state.cls.students[m].name);
    b.addEventListener('click', () => openStudent(ctx(), m));
    list.appendChild(b);
  });
  box.appendChild(list);
  return box;
}

/* ======================================================================== */
/*  Students                                                                */
/* ======================================================================== */

function renderStudents() {
  const host = $('#students');
  host.innerHTML = '';

  const { pack, cls, inf, groups } = state;
  const byId = misById(pack);
  const ci = pack.items.map(correctIndex);
  const q = ($('#student-search').value || '').trim().toLowerCase();

  const rows = cls.students.map((st, s) => {
    const score = cls.responses[s].reduce((n, c, i) => n + (c === ci[i] ? 1 : 0), 0);
    const held = inf.misIds
      .map((mid, k) => ({ mid, p: inf.posterior[s][k] }))
      .filter(x => x.p >= PARAMS.decisionThreshold)
      .sort((a, b) => b.p - a.p);
    const group = groups.find(g => g.members.includes(s));
    return { s, st, score, held, group };
  });

  // Most to act on first: students with the most confident misconceptions, then
  // lowest score. A teacher opening this wants triage, not the register.
  rows.sort((a, b) => (b.held.length - a.held.length) || (a.score - b.score));

  const shown = q ? rows.filter(r => r.st.name.toLowerCase().includes(q)) : rows;

  if (!shown.length) {
    host.appendChild(el('p', 'note', 'No student by that name.'));
    return;
  }

  shown.forEach(r => {
    const card = el('button', 'stu');

    const l = el('div', 'stu-l');
    l.appendChild(el('div', 'stu-name', r.st.name));
    l.appendChild(el('div', 'stu-meta',
      r.group ? (r.group.isSecure ? 'No reteach needed' : `Group ${state.groups.indexOf(r.group) + 1}`) : ''));
    card.appendChild(l);

    const mid = el('div', 'stu-m');
    if (r.held.length) {
      r.held.slice(0, 3).forEach(x => {
        const c = el('span', 'chip');
        const sw = el('span', 'sw');
        sw.style.background = colourOf[x.mid];
        c.appendChild(sw);
        c.appendChild(el('span', null, `${byId[x.mid]?.short || x.mid} · ${Math.round(x.p * 100)}%`));
        mid.appendChild(c);
      });
      if (r.held.length > 3) mid.appendChild(el('span', 'chip chip-more', `+${r.held.length - 3}`));
    } else {
      mid.appendChild(el('span', 'chip chip-clear', 'No stable misunderstanding'));
    }
    card.appendChild(mid);

    const rr = el('div', 'stu-r');
    rr.appendChild(el('span', 'stu-score', `${r.score}/${pack.items.length}`));
    rr.appendChild(el('span', 'stu-go', '→'));
    card.appendChild(rr);

    card.addEventListener('click', () => openStudent(ctx(), r.s));
    host.appendChild(card);
  });
}

/* ======================================================================== */
/*  Questions                                                               */
/* ======================================================================== */

function renderItems() {
  const { pack, stats, cls } = state;
  const host = $('#items');
  host.innerHTML = '';

  const bad = problemItems(stats);
  const diag = diagnosticItems(stats);
  const strong = stats.filter(s => s.quality === 'strong').length;

  const sub = $('#items-sub');
  sub.textContent =
    `The same answers score your questions too. ${strong} of ${pack.items.length} are doing real work; ` +
    `${bad.length} ${bad.length === 1 ? 'has' : 'have'} a problem worth a look. Click any question to see how the class answered it.`;

  let list;
  if (state.itemFilter === 'problem') list = bad;
  else if (state.itemFilter === 'defended') list = diag;
  else list = stats.slice().sort((a, b) => severityOf(b) - severityOf(a));

  if (!list.length) {
    host.appendChild(el('p', 'note', state.itemFilter === 'problem'
      ? 'Nothing to flag — every question on this paper is pulling its weight.'
      : 'Nothing in this category.'));
  }

  if (state.itemFilter === 'defended' && list.length) {
    const box = el('div', 'defended');
    box.appendChild(el('h4', null, 'These look weak by the usual measure. Keep them.'));
    const p = el('p', null,
      'The standard check asks whether students who did well overall also got the question right. That assumes the test measures one thing. This one does not: a question aimed at one misunderstanding is missed by exactly the students who hold it, whatever their ability elsewhere. Before calling anything broken, the tool checks whether the rest of the paper agrees with the question.');
    box.appendChild(p);
    const anchor = el('span', 'x-anchor', ' ');
    anchor.appendChild(infoButton('diagnosing'));
    box.appendChild(anchor);
    host.appendChild(box);
  }

  list.forEach(s => host.appendChild(itemCard(s)));

  const alpha = cronbachAlpha(pack, cls.responses);
  const note = $('#alpha-note');
  note.textContent = `How consistent is the paper overall? ${interpretAlpha(alpha)} `;
  const a = el('span', 'x-anchor', ' ');
  a.appendChild(infoButton('consistency'));
  note.appendChild(a);
}

function itemCard(s) {
  const card = el('button', `item ${s.quality}`);

  const top = el('div', 'item-top');
  const stem = el('div', 'item-stem');
  stem.appendChild(el('span', 'item-id', s.id));
  stem.appendChild(el('span', null, s.stem));
  top.appendChild(stem);

  const verdict = {
    strong: 'Working well', ok: 'Fine', diagnostic: 'Diagnosing, not ranking',
    minor: 'Minor issue', weak: 'Worth rewriting', broken: 'Measuring backwards'
  }[s.quality] || '';
  top.appendChild(el('span', `verdict v-${s.quality}`, verdict));
  card.appendChild(top);

  if (s.flags.length) {
    const flags = el('ul', 'flags');
    s.flags.slice(0, 2).forEach(f => {
      flags.appendChild(el('li', severityOf({ flags: [f] }) <= 1 ? 'minor' : null, f.text));
    });
    card.appendChild(flags);
  } else if (s.note) {
    card.appendChild(el('p', 'item-note', s.note));
  }

  const bars = el('div', 'bars');
  s.options.forEach(o => {
    const row = el('div', `bar-row${o.correct ? ' correct' : ''}`);
    row.appendChild(el('span', 'bar-t', o.text));
    const track = el('span', 'bar-track');
    const fill = el('span', 'bar-fill');
    fill.style.width = `${Math.max(1.5, o.share * 100)}%`;
    if (o.mis) fill.style.background = colourOf[o.mis];
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'bar-c', `${o.count}`));
    bars.appendChild(row);
  });
  card.appendChild(bars);

  card.addEventListener('click', () => openQuestion(ctx(), s.index));
  return card;
}

/* ======================================================================== */
/*  Validation                                                              */
/* ======================================================================== */

function renderValidation() {
  const { inf, cls, cl } = state;
  const host = $('#metrics');
  const wrap = $('#confusion');
  host.innerHTML = '';
  wrap.innerHTML = '';

  // An imported class has no hidden answer to compare against. Say so plainly
  // rather than showing metrics that would be meaningless.
  if (!cls.truth) {
    $('#validation-note').textContent = '';
    const box = el('div', 'empty');
    box.appendChild(el('h4', null, 'Not available for your own class — and that is the point.'));
    box.appendChild(el('p', null,
      'These numbers work by comparing the analysis against misunderstandings that were planted before any answers existed. Your real students did not come with an answer key to their own heads, so there is nothing to score against.'));
    box.appendChild(el('p', null,
      'Switch the class back to “Sample class” to see how well the method recovers what it cannot see. Then judge whether you trust it on your own data.'));
    host.appendChild(box);
    return;
  }

  const dq = scoreDiagnosis(diagnose(inf.posterior, inf.misIds), cls.truth, inf.misIds);
  const cq = scoreClustering(cl.labels, cls.truth);

  [
    { v: fmtPct(dq.recall), k: 'misunderstandings found', key: 'recall',
      x: `Of every misunderstanding actually planted in a student, ${fmtPct(dq.recall)} were recovered from their answers alone.` },
    { v: fmtPct(dq.precision), k: 'diagnoses correct', key: 'precision',
      x: `Of every misunderstanding the tool attributed to a student, ${fmtPct(dq.precision)} were genuinely there.` },
    { v: dq.f1.toFixed(2), k: 'combined score', key: 'f1',
      x: 'The two above in one number, so neither can be gamed by being reckless in one direction.' },
    { v: cq.ari.toFixed(2), k: 'groups recovered', key: 'ari',
      x: `Against the ${cq.plantedGroups} profiles the simulation planted. 1.00 is exact, 0.00 is chance.` }
  ].forEach(m => {
    const c = el('div', 'metric');
    c.appendChild(el('div', 'metric-v', m.v));
    const k = el('div', 'metric-k', m.k);
    k.appendChild(infoButton(m.key));
    c.appendChild(k);
    c.appendChild(el('div', 'metric-x', m.x));
    host.appendChild(c);
  });

  const { table, plantedIds } = confusion(cl.labels, cls.truth);
  const t = el('table');
  t.appendChild(el('caption', null,
    'Groups the tool found, against the profiles the simulation planted. One clear winner per row means it rediscovered structure it was never shown.'));

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, ''));
  plantedIds.forEach(p => hr.appendChild(el('th', null, `planted ${p}`)));
  thead.appendChild(hr);
  t.appendChild(thead);

  const tb = el('tbody');
  table.forEach((row, i) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, i === cl.secureLabel ? 'no reteach' : `group ${i + 1}`));
    const max = Math.max(...row);
    row.forEach(v => tr.appendChild(el('td', v === max && v > 0 ? 'hot' : null, String(v))));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);

  $('#validation-note').textContent =
    'Change the class variant in the toolbar to re-roll a different sample class. The figures are computed live each time, so a bad run shows a bad number.';
}

function renderMethod() {
  $('#formula').textContent =
    'logit P(holds m | answers) = logit P(m) + Σ log [ P(answer | m) / P(answer | not m) ]';
  $('#params').textContent =
    `starting assumption ${PARAMS.prior} · fires on a probing question ${PARAMS.express} · correct without it ${PARAMS.baseCorrect} · reported above ${PARAMS.decisionThreshold}`;
}

/* ======================================================================== */
/*  Packs                                                                   */
/* ======================================================================== */

function renderPackOptions(selectedId) {
  const sel = $('#pack');
  sel.innerHTML = '';
  allPacks().forEach(p => {
    const o = el('option', null, `${p.name} — ${p.subject}`);
    o.value = p.id;
    if (p.id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function switchPack(id) {
  const next = getPack(id);
  // An imported class was typed against a specific instrument. Carrying it over
  // to a different one would silently misread every column.
  if (state.imported && next.id !== state.pack.id) {
    const keep = window.confirm(
      `Your imported class was entered against “${state.pack.name}”. Switching subject will drop it and return to the sample class. Continue?`);
    if (!keep) { renderPackOptions(state.pack.id); return; }
    state.imported = null;
    $('#source').value = 'sample';
    document.body.classList.remove('has-import');
  }
  state.pack = next;
  renderPackOptions(state.pack.id);
  run();
}

/* ======================================================================== */
/*  Modals                                                                  */
/* ======================================================================== */

function openM(sel) { $(sel).hidden = false; }
function closeM(sel) { $(sel).hidden = true; }

/* ---- new subject ---- */

function openSubject() {
  $('#modal-err').textContent = '';
  $('#modal-progress').hidden = true;
  $('#modal-progress').innerHTML = '';
  $('#modal-go').disabled = false;
  $('#modal-go').textContent = 'Build it';
  if (state.apiKey) $('#api-key').value = state.apiKey;
  openM('#modal');
  $('#topic').focus();
}

function progressStep(text, cls) {
  const box = $('#modal-progress');
  box.hidden = false;
  box.querySelectorAll('.step.active').forEach(n => n.classList.replace('active', 'done'));
  box.appendChild(el('span', `step ${cls || 'active'}`, text));
}

async function doGenerate() {
  const topic = $('#topic').value.trim();
  const key = $('#api-key').value.trim();
  const err = $('#modal-err');
  err.textContent = '';

  if (!topic) { err.textContent = 'Name a subject or topic first.'; return; }
  if (!key) { err.textContent = 'A key is needed to build a new subject. The built-in subjects need no key.'; return; }

  state.apiKey = key;
  setKey(key);

  const go = $('#modal-go');
  go.disabled = true;
  go.textContent = 'Building…';
  $('#modal-progress').innerHTML = '';

  try {
    const { pack, report, attempts } = await generatePack(key, topic, {
      onProgress: p => progressStep(p.message)
    });
    if (report.warnings.length) {
      progressStep(`Checked, with ${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}.`, 'done');
    }
    progressStep(`Ready — ${pack.misconceptions.length} misunderstandings, ${pack.items.length} questions, ${attempts} pass${attempts === 1 ? '' : 'es'}.`, 'done');

    addPack(pack);
    state.imported = null;
    $('#source').value = 'sample';
    document.body.classList.remove('has-import');
    setTimeout(() => { closeM('#modal'); state.pack = pack; renderPackOptions(pack.id); run(); }, 700);
  } catch (e) {
    err.textContent = e.message;
    go.disabled = false;
    go.textContent = 'Try again';
  }
}

/* ---- import a class ---- */

function openImport() {
  $('#import-report').hidden = true;
  $('#import-report').innerHTML = '';
  openM('#import');
  $('#import-text').focus();
}

function reportImport(res) {
  const box = $('#import-report');
  box.hidden = false;
  box.innerHTML = '';
  box.className = `import-report ${res.ok ? 'good' : 'bad'}`;

  if (res.ok) {
    box.appendChild(el('div', 'ir-h',
      `Read ${res.responses.length} student${res.responses.length === 1 ? '' : 's'} × ${state.pack.items.length} questions, matched by ${res.matchedBy}.`));
  } else {
    box.appendChild(el('div', 'ir-h', 'Could not read this yet.'));
  }
  res.errors.forEach(e => box.appendChild(el('div', 'ir-e', e)));
  res.warnings.forEach(w => box.appendChild(el('div', 'ir-w', w)));
  return res.ok;
}

function doImport() {
  const res = parseResponses(state.pack, $('#import-text').value);
  if (!reportImport(res)) return;

  state.imported = { students: res.students, responses: res.responses };
  document.body.classList.add('has-import');
  $('#source').value = 'import';
  closeM('#import');
  run();
  showView('groups');
}

/** Build a paste-ready example from the current sample class. */
function demoPaste() {
  const pack = state.pack;
  const cls = state.cls;
  const letters = 'ABCDEFGH';
  const head = ['Student', ...pack.items.map(i => i.id)].join(',');
  const rows = cls.students.slice(0, 12).map((st, s) =>
    [st.name, ...cls.responses[s].map(c => (c >= 0 ? letters[c] : ''))].join(','));
  $('#import-text').value = [head, ...rows].join('\n');
}

/* ---- materials ---- */

function wireMaterials() {
  $('#mat-quiz').addEventListener('click', () => {
    if (!openPrintable(quizHtml(state.pack))) alert('Allow pop-ups to print the questions.');
  });
  $('#mat-key').addEventListener('click', () => {
    if (!openPrintable(quizHtml(state.pack, { withKey: true }))) alert('Allow pop-ups to print the key.');
  });
  $('#mat-sheet').addEventListener('click', () => {
    download(`${state.pack.id}-answer-sheet.csv`, templateCsv(state.pack));
  });
  $('#mat-keycsv').addEventListener('click', () => {
    download(`${state.pack.id}-answer-key.csv`, answerKeyCsv(state.pack));
  });
}

/* ======================================================================== */
/*  Plan output                                                             */
/* ======================================================================== */

function exportPlan() {
  download(`${state.pack.id}-reteach-plan.csv`,
    groupsCsv(state.pack, state.cls, state.groups, misById(state.pack)));
}

function printPlan() {
  showView('groups');
  closeDrawer();
  window.print();
}

/* ======================================================================== */
/*  Plan rewriting                                                          */
/* ======================================================================== */

async function adaptPlans() {
  if (!state.apiKey) {
    const key = window.prompt('Anthropic API key (held in this tab only, never stored):');
    if (!key) return;
    state.apiKey = key.trim();
    setKey(state.apiKey);
  }

  const btn = $('#regen');
  btn.disabled = true;
  btn.textContent = 'Rewriting…';

  const real = state.groups.filter(g => !g.isSecure);
  const results = await Promise.all(real.map(g =>
    rewritePlan(g, state.cls.students.length).catch(e => ({ _error: e.message }))
  ));

  let ok = 0;
  results.forEach((p, i) => { if (!p._error) { real[i].aiPlan = p; ok++; } });
  renderGroups();
  wireExplainers();

  btn.disabled = false;
  btn.textContent = ok === real.length ? 'Rewritten for this class' : `Rewrote ${ok} of ${real.length}`;
  setTimeout(() => { btn.textContent = 'Rewrite for this class'; }, 5000);
}

/* ======================================================================== */
/*  Tabs                                                                    */
/* ======================================================================== */

function showView(name) {
  $$('.tab').forEach(t => {
    const on = t.dataset.view === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));

  // Rows are absolutely positioned, so they need re-laying out whenever the
  // matrix returns from display:none at a possibly different width.
  if (name === 'matrix' && state.cls) {
    layout(state.sorted ? state.groups.flatMap(g => g.members) : state.cls.responses.map((_, i) => i));
  }
}

/* ======================================================================== */
/*  Wiring                                                                  */
/* ======================================================================== */

$('#run').addEventListener('click', run);
$('#reorder').addEventListener('click', toggleSort);
$('#clear-filter').addEventListener('click', () => applyFilter(null));
$('#pack').addEventListener('change', e => switchPack(e.target.value));
$('#new-subject').addEventListener('click', openSubject);
$('#materials').addEventListener('click', () => openM('#mats'));
$('#mats-close').addEventListener('click', () => closeM('#mats'));

$('#source').addEventListener('change', e => {
  if (e.target.value === 'import') { openImport(); e.target.value = state.imported ? 'import' : 'sample'; }
  else if (state.imported) {
    state.imported = null;
    document.body.classList.remove('has-import');
    run();
  }
});

$('#modal-cancel').addEventListener('click', () => closeM('#modal'));
$('#modal-go').addEventListener('click', doGenerate);
$('#topic').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });
$('#api-key').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });

$('#import-cancel').addEventListener('click', () => closeM('#import'));
$('#import-go').addEventListener('click', doImport);
$('#dl-template').addEventListener('click', () => download(`${state.pack.id}-answer-sheet.csv`, templateCsv(state.pack)));
$('#paste-demo').addEventListener('click', demoPaste);

$('#print-plan').addEventListener('click', printPlan);
$('#export-plan').addEventListener('click', exportPlan);
$('#regen').addEventListener('click', adaptPlans);
$('#student-search').addEventListener('input', renderStudents);

$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.hidden = true; }));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  $$('.modal').forEach(m => { m.hidden = true; });
});

$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
$$('#item-filter .seg-b').forEach(b => b.addEventListener('click', () => {
  $$('#item-filter .seg-b').forEach(x => x.classList.toggle('is-on', x === b));
  state.itemFilter = b.dataset.f;
  renderItems();
  wireExplainers();
}));

[$('#seed'), $('#size')].forEach(inp =>
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));

window.addEventListener('resize', () => {
  if (!state.cls) return;
  layout(state.sorted ? state.groups.flatMap(g => g.members) : state.cls.responses.map((_, i) => i));
});

/**
 * The tab strip sticks directly beneath the app bar, so it needs the bar's real
 * height. Hard-coding it is wrong twice over: it drifts when the webfont settles,
 * and the bar wraps to more rows at narrow widths. Measure it, and keep measuring.
 */
function syncBarHeight() {
  const h = Math.round($('.bar').getBoundingClientRect().height);
  // Reject readings taken mid-reflow: a zero or absurd height would pin the tab
  // strip somewhere useless and no later event is guaranteed to correct it.
  if (h < 30 || h > 400) return;
  document.documentElement.style.setProperty('--bar-h', `${h}px`);
}
syncBarHeight();
if ('ResizeObserver' in window) new ResizeObserver(syncBarHeight).observe($('.bar'));
if (document.fonts?.ready) document.fonts.ready.then(syncBarHeight);
window.addEventListener('resize', syncBarHeight);
window.addEventListener('orientationchange', syncBarHeight);
window.addEventListener('load', syncBarHeight);

wireMaterials();
state.pack = defaultPack();
renderPackOptions(state.pack.id);
run();

// Deep links: ?view=groups opens a tab directly, ?sorted=1 starts with the map
// already sorted. Handy for sharing a view and for the demo.
{
  const q = new URLSearchParams(location.search);
  const v = q.get('view');
  if (v && $(`#view-${v}`)) showView(v);
  if (q.get('sorted') === '1' && !state.sorted) toggleSort();
}
