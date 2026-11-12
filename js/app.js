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

import { allPacks, getPack, addPack, defaultPack, findPack, isBuiltIn } from './packs/index.js';
import { correctIndex, misById, validatePack } from './pack.js';
import { generateClass, generateRetest, totalScores } from './simulate.js';
import { inferMisconceptions, diagnose, prevalence, coverage, posteriorForReporting, isTested, PARAMS, strength, MIN_TELLING } from './infer.js';
import { clusterStudents, describeClusters, separateThin, reteachGroups, SUPPORT_BELOW } from './cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha, interpretAlpha, severityOf, shownFlags } from './itemstats.js';
import { scoreDiagnosis, scoreClustering, confusion, fmtPct } from './validate.js';
import { setKey, rewritePlan } from './llm.js';
import { generatePack } from './generate.js';
import { infoButton, wireExplainers } from './explain.js';
import { openStudent, openQuestion, closeDrawer } from './drawer.js';
import { initTour } from './tour.js';
import { classFile, readClassFile, testFile } from './session.js';
import { compareSittings, comparePredictions, progressCsv, READING } from './compare.js';
import { trapTab, focusInto } from './a11y.js';
import { escapeHtml, mathHtml, setMath } from './notation.js';
import { unlabelledPatterns, labelPattern, withoutTracked } from './discover.js';
import {
  templateCsv, answerKeyCsv, quizHtml, reviewHtml, slipsHtml, followUpHtml, download, openPrintable,
  parseResponses, groupsCsv, OMITTED, paperOrder, paperLetter, normName
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

/** Under this many students, per-question statistics are mostly noise. */
const SMALL_CLASS = 20;

/** Under this many, there is nothing to compare one question or group against. */
const TOO_FEW = 5;

/** Past this many students the map no longer fits a screen. */
const BIG_CLASS = 40;

const students = n => `${n} student${n === 1 ? '' : 's'}`;

/** Options written as sentences, as in biology, need room that "x^7" does not. */
const wordyOptions = item => item.opts.some(o => o.t.length > 18);

/** Join names into a sentence, which a name ending in "A." should not end twice. */
const sentence = s => (s.endsWith('.') ? s : `${s}.`);

/** Separation below this and the groups are a rough sketch (see explain.js). */
const ROUGH_GROUPS = 0.2;

const VERDICTS = {
  strong: 'Working well', ok: 'Acceptable', diagnostic: 'Diagnosing, not ranking',
  minor: 'Minor issue', watch: 'Too early to tell', weak: 'Worth reviewing',
  broken: 'Unexpected pattern', insufficient: 'Too little evidence', key: 'Check the key'
};

let colourOf = Object.create(null);
let letterOf = Object.create(null);
function assignColours(pack) {
  colourOf = Object.create(null);
  letterOf = Object.create(null);
  pack.misconceptions.forEach((m, i) => {
    colourOf[m.id] = `var(--m${(i % 12) + 1})`;
    letterOf[m.id] = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
  });
}

const state = {
  pack: null, cls: null, inf: null, cl: null, groups: null, stats: null, cov: null,
  sorted: false, rows: [], apiKey: null,
  ran: false,         // whether the page has been analysed once already
  imported: null,     // { students, responses } when the class is the teacher's own
  unsaved: false,     // the imported class exists only in this tab
  unsavedTest: null,  // id of a built test that exists only in this tab
  retest: null,       // { students, responses, simulated? } the same paper, after a reteach
  importFor: 'class', // what the paste box is filling in: 'class' or 'retest'
  predictions: new Set(), // misconception ids the teacher expected before seeing a result
  filterMis: null,    // highlight one misconception across the matrix
  itemFilter: 'problem'
};

const ctx = () => ({
  pack: state.pack, cls: state.cls, inf: state.inf, cl: state.cl,
  groups: state.groups, stats: state.stats, cov: state.cov, colourOf, found: state.found
});

/* ======================================================================== */
/*  Run                                                                     */
/* ======================================================================== */

function run() {
  const pack = state.pack;
  assignColours(pack);

  // A retest belongs to one class. A re-rolled sample class is a different one.
  if (!state.imported) state.retest = null;

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
    const seed = Math.min(9999, Math.max(1, parseInt($('#seed').value, 10) || 7));
    const size = Math.min(120, Math.max(12, parseInt($('#size').value, 10) || 28));
    // Typed 500, got 120: the fields show the class that was actually built.
    $('#seed').value = seed;
    $('#size').value = size;
    // Simulated on the test as it was before any labels the teacher added,
    // so naming a pattern does not re-roll the class it was found in.
    cls = { ...generateClass(withoutTracked(pack), { seed, size }), pack };
  }

  const inf = inferMisconceptions(pack, cls.responses);
  const reportPosterior = posteriorForReporting(inf);
  const cl = clusterStudents(reportPosterior, { seed: 42 });
  const cov = coverage(pack, cls.responses);
  const groups = separateThin(describeClusters(reportPosterior, cl.labels, inf.misIds, cl, { ability: inf.ability }), cov);
  const stats = analyseItems(pack, cls.responses, inf);

  // The beliefs reported for each student, once: the group cards, the plan
  // export and the student list all read the same answer.
  const dx = diagnose(reportPosterior, inf.misIds);

  // Wrong answers the test has no label for, picked together beyond chance.
  const search = unlabelledPatterns(pack, cls.responses);
  const found = search.patterns.map(p => ({ ...p, reshuffles: search.reshuffles }));

  Object.assign(state, { cls, inf, dx, cl, groups, stats, cov, found, sorted: false, filterMis: null, studentGroup: null });

  fitMapToClass(cls.students.length);
  showTestNudge();
  renderPackLine();
  renderExample();
  renderSummary();
  renderMatrix();
  renderGroups();
  renderStudentFilter();
  renderStudents();
  renderItems();
  renderProgress();
  renderValidation();
  renderMethod();
  wireExplainers();

  $('#reorder').textContent = 'Sort into groups';
  $('#clear-filter').hidden = true;

  // A re-run changes every number on the page at once; a short fade on the
  // strip and the open view shows that it happened, where a silent swap reads
  // as nothing having changed.
  if (state.ran) [$('#summary'), $('.view.is-active')].forEach(n => replay(n));
  state.ran = true;
}

/** Restart a one-shot entrance animation on `node`. */
function replay(node, cls = 'entering') {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** So two saved classes of one test can be told apart once they are open. */
function savedOn(when) {
  const d = new Date(when);
  if (!when || Number.isNaN(d.getTime())) return '';
  return `, saved ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function renderPackLine() {
  const { pack, cls } = state;
  const line = $('#pack-line');
  line.textContent =
    [pack.name, pack.subject, pack.level].filter(Boolean).join(' · ') + ' — ' +
    `${pack.misconceptions.length} misunderstandings tracked · ${pack.items.length} questions · ` +
    (cls.meta.imported ? `${students(cls.students.length)}${savedOn(state.imported.savedAt)}` : `sample class, variant ${cls.meta.seed}`);
  if (pack.source === 'generated') line.appendChild(el('span', 'gen-flag', 'built this session'));
}

/* ======================================================================== */
/*  Worked example                                                          */
/* ======================================================================== */

/**
 * The hero's card: one real question from the class on screen, every option
 * labelled with what choosing it means. It is the question that best shows the
 * class's most widespread misunderstanding, so it changes with the class.
 */
function renderExample() {
  const { pack, cls, inf } = state;
  const host = $('#example');
  const byId = misById(pack);
  const count = (i, o) => cls.responses.reduce((n, row) => n + (row[i] === o ? 1 : 0), 0);

  const top = prevalence(posteriorForReporting(inf), inf.misIds)[0];
  let at = 0, best = -1;
  pack.items.forEach((item, i) => {
    item.opts.forEach((o, k) => {
      if (top && o.mis === top.id && count(i, k) > best) { best = count(i, k); at = i; }
    });
  });

  const item = pack.items[at];
  const n = cls.students.length;
  const rows = paperOrder(item).map(k => {
    const o = item.opts[k];
    const c = count(at, k);
    const kind = o.c ? 'is-correct' : (o.mis ? 'is-mis' : 'is-slip');
    const fill = o.c ? '' : (o.mis ? ` background:${colourOf[o.mis]}` : '');
    const why = o.c
      ? 'Correct'
      : o.mis
        ? `<span class="sw" style="background:${colourOf[o.mis]}"></span>${mathHtml(byId[o.mis]?.name ?? o.mis)}`
        : 'Wrong; no known pattern';
    return `<li class="ex-opt ${kind}">
      <span class="ex-l">${paperLetter(item, k)}</span>
      <span class="ex-t">${mathHtml(o.t)}</span>
      <span class="ex-track"><span class="ex-fill" style="width:${Math.max(2, (c / n) * 100)}%;${fill}"></span></span>
      <span class="ex-n">${c}</span>
      <span class="ex-why">${why}</span>
    </li>`;
  }).join('');

  host.innerHTML = `
    <div class="ex-head">
      <span><b>Question ${escapeHtml(item.id)}</b>${item.topic ? ' · ' + mathHtml(item.topic) : ''}</span>
      <span>How ${cls.meta.imported ? 'your' : 'the sample'} class of ${n} answered</span>
    </div>
    <p class="ex-q">${mathHtml(item.stem)}</p>
    <ol class="ex-opts${wordyOptions(item) ? ' ex-long' : ''}">${rows}</ol>
    <figcaption class="ex-foot">
      Some wrong options are linked to a possible misunderstanding; others are not linked to a
      known pattern. One answer is not enough to establish why it was chosen, so Why Wrong
      combines evidence across questions that test the same idea.
    </figcaption>`;
}

/* ======================================================================== */
/*  Summary                                                                 */
/* ======================================================================== */

function renderSummary() {
  const { pack, cls, inf, groups, stats } = state;
  const host = $('#summary');
  host.innerHTML = '';

  const real = reteachGroups(groups);
  const secure = groups.find(g => g.isSecure);
  const thin = groups.find(g => g.isThin);
  const biggest = real[0];
  const prev = prevalence(posteriorForReporting(inf), inf.misIds)[0];
  const bad = cls.students.length < TOO_FEW ? [] : problemItems(stats);
  // Out of what was answered, so blanks do not drag the average down twice:
  // once here and once by being read as missing evidence everywhere else.
  const scores = totalScores(pack, cls.responses);
  const correct = scores.reduce((a, b) => a + b, 0);
  const answered = state.cov.reduce((n, c) => n + c.answered, 0);
  const hasBlanks = answered < cls.students.length * pack.items.length;
  const byId = misById(pack);

  const cards = [
    { v: String(cls.students.length), k: cls.students.length === 1 ? 'student' : 'students' },
    { v: String(real.length), k: `reteach group${real.length === 1 ? '' : 's'}`, cls: 'ok', go: 'groups' },
    { v: biggest ? String(biggest.size) : '—',
      k: biggest ? `in the biggest group` : 'no groups found', go: 'groups' },
    // The short labels are often notation ("x^a . x^b to x^(ab)"), which reads
    // badly inside a sentence. The name goes in the note below the strip instead.
    { v: prev ? String(Math.round(prev.expected)) : '—',
      k: 'estimated students with the top pattern', go: 'matrix' },
    { v: answered ? `${Math.round((correct / answered) * 100)}%` : '—', k: hasBlanks ? 'correct of those answered' : 'class average' },
    { v: String(bad.length), k: `question${bad.length === 1 ? '' : 's'} to review`,
      cls: bad.length ? 'warn' : 'ok', go: 'items' },
    // A student with no clear pattern who still gets most things wrong is the
    // easiest one to miss on this page, so they are counted on their own line.
    { v: secure ? String(secure.size) : '0', k: 'with no clear pattern found', go: 'groups',
      sub: secure?.support?.length ? `${secure.support.length} getting most wrong` : null }
  ];

  cards.forEach(c => {
    const n = el(c.go ? 'button' : 'div', `sum${c.go ? ' sum-go' : ''}`);
    n.appendChild(el('div', `sum-v${c.cls ? ' ' + c.cls : ''}`, c.v));
    const k = el('div', 'sum-k', c.k);
    k.title = c.k;
    n.appendChild(k);
    if (c.sub) n.appendChild(el('div', 'sum-sub', c.sub));
    if (c.go) n.addEventListener('click', () => { showView(c.go); scrollToView(); });
    host.appendChild(n);
  });

  const topName = prev ? (byId[prev.id]?.name ?? prev.id) : null;
  const blanks = thin
    ? ` ${thin.size} student${thin.size === 1 ? '' : 's'} left too many questions blank for a reliable estimate.`
    : '';
  // With no groups, the note has to fit a class with no mistakes in it, or no answers.
  const noGroups = !answered ? ''
    : correct === answered ? 'All recorded answers are correct; this test has not identified a reteach need.'
    : 'No clear shared pattern emerged. Review individual evidence; scattered answers alone do not show why a student missed a question.';
  // A pattern the question set has no label for sits at the end of Reteach
  // groups, below every group card; the note is how a teacher learns it is there.
  const found = state.found?.length || 0;
  const unlabelled = found
    ? ` ${found === 1 ? 'One group of students also' : `${found} groups of students also`} picked the same unlabelled wrong answers together, more often than in 95 of 100 shuffled copies of the class: see the end of Reteach groups.`
    : '';
  $('#strip-note').textContent = ((real.length
    ? `Start with the biggest group. ${topName ? `The most widespread pattern is “${topName}”.` : ''}`
    : noGroups) + blanks + unlabelled).trim();
}

/* ======================================================================== */
/*  Matrix                                                                  */
/* ======================================================================== */

/**
 * A whole year group needs to read as one picture, so its rows tighten. The key
 * moves above the map too, since below it would be 1,500px from the rows it
 * filters. Not on a phone, where the key alone fills the screen.
 */
function fitMapToClass(n) {
  const big = n > BIG_CLASS;
  const above = big && window.innerWidth > 720;
  const root = document.documentElement;
  root.classList.toggle('big-class', big);
  root.classList.toggle('key-above', above);

  const [head, key, board] = [$('.legend-head'), $('#legend'), $('.board')];
  if (above === (key.nextElementSibling === board)) return;
  if (above) board.before(head, key);
  else $('#matrix-note').after(head, key);
}

function renderMatrix() {
  const host = $('#matrix');
  host.innerHTML = '';
  host.classList.remove('sorted');

  const { pack, cls } = state;
  const scores = totalScores(pack, cls.responses);
  const ci = pack.items.map(correctIndex);
  const byId = misById(pack);
  state.rows = [];

  cls.responses.forEach((row, s) => {
    const r = el('div', 'm-row');
    r.dataset.student = String(s);
    r.setAttribute('role', 'row');

    const name = el('button', 'm-name', cls.students[s].name);
    name.tabIndex = -1;
    const near = nearGroup(s);
    name.title = `${cls.students[s].name} — click for the full evidence trail`;
    if (near) {
      name.classList.add('m-between');
      name.title += `
Almost as close to ${groupLabel(near)} as to their own group`;
      // The underline and the tooltip are visual; say it to a screen reader too.
      name.setAttribute('aria-label', `${cls.students[s].name}, almost as close to ${groupLabel(near)} as to their own group`);
    }
    const head = el('span', 'm-head');
    head.setAttribute('role', 'rowheader');
    head.appendChild(name);
    r.appendChild(head);

    row.forEach((choice, i) => {
      const item = pack.items[i];
      const c = el('button', 'm-cell');
      c.dataset.item = String(i);
      c.setAttribute('role', 'gridcell');
      c.tabIndex = -1;

      let what;
      if (choice === OMITTED || choice == null) {
        c.classList.add('omit');
        what = 'not answered';
      } else if (choice === ci[i]) {
        what = 'correct';
      } else {
        const mis = item.opts[choice].mis;
        if (mis) {
          c.style.background = colourOf[mis];
          c.dataset.mis = mis;
          c.dataset.letter = letterOf[mis];
          what = byId[mis]?.short ?? mis;
        }
        else { c.classList.add('slip'); what = 'wrong, no clear pattern'; }
      }

      c.title = `${cls.students[s].name} · ${item.id}\n${choice >= 0 ? `chose ${paperLetter(item, choice)} “${item.opts[choice].t}”` : 'left blank'} (${what})`;
      c.setAttribute('aria-label', c.title.replace('\n', ', '));
      r.appendChild(c);
    });

    r.appendChild(el('span', 'm-score', `${scores[s]}/${pack.items.length}`));
    host.appendChild(r);
    state.rows.push(r);
  });

  layout(cls.responses.map((_, i) => i));
  resetMatrixStop(0);
  renderLegend();
  setMatrixNote(false);
}

/** The map's one tab stop, on the name of the student shown first. */
function resetMatrixStop(student) {
  $('#matrix').querySelectorAll('[tabindex="0"]').forEach(n => { n.tabIndex = -1; });
  state.rows[student].querySelector('.m-name').tabIndex = 0;
}

/**
 * A group's members in map order: closest to the group's centre first, so its
 * shared stripes read as one block and anyone near another group sits at the
 * band's edge. Students outside the groups keep register order.
 */
const bandOrder = g => g.members.slice().sort((a, b) => (state.cl.edge?.[a] ?? 0) - (state.cl.edge?.[b] ?? 0));

/** Students in the order they sit on screen. */
const rowOrder = () => (state.sorted
  ? state.groups.flatMap(bandOrder)
  : state.cls.responses.map((_, i) => i));

/**
 * Arrow keys walk the map like a spreadsheet. Without this a keyboard user would
 * have to Tab through every cell of a 28-by-36 grid to reach the next section,
 * so the map holds one tab stop and the arrows do the rest.
 */
function moveInMatrix(e) {
  const at = e.target.closest('.m-cell, .m-name');
  if (!at) return;

  const order = rowOrder();
  const nItems = state.pack.items.length;
  const student = Number(at.closest('.m-row').dataset.student);
  let row = order.indexOf(student);
  let col = at.classList.contains('m-name') ? -1 : Number(at.dataset.item);

  switch (e.key) {
    case 'ArrowRight': col = Math.min(nItems - 1, col + 1); break;
    case 'ArrowLeft': col = Math.max(-1, col - 1); break;
    case 'ArrowDown': row = Math.min(order.length - 1, row + 1); break;
    case 'ArrowUp': row = Math.max(0, row - 1); break;
    case 'Home': col = -1; break;
    case 'End': col = nItems - 1; break;
    default: return;
  }
  e.preventDefault();

  const next = state.rows[order[row]].querySelector(col < 0 ? '.m-name' : `.m-cell[data-item="${col}"]`);
  $('#matrix').querySelectorAll('[tabindex="0"]').forEach(n => { n.tabIndex = -1; });
  next.tabIndex = 0;
  next.focus();
}

function setMatrixNote(sorted) {
  const real = reteachGroups(state.groups).length;
  $('#matrix-note').textContent = !real
    ? 'No clear groups emerged from these answers, so sorting may not reveal a shared pattern.'
    : sorted
    ? `Same data, rows reordered so students with similar answer patterns sit together. ${state.cls.students.length} students, ${real} group${real === 1 ? '' : 's'} — the vertical stripes show questions where a group gave similar answers.`
    : 'Rows are in register order, which is to say arbitrary. The pattern is already in this picture; it is just not visible yet.';
}

let laidRowH = 0;

function layout(order) {
  const h = ROW_H();
  order.forEach((student, pos) => {
    state.rows[student].style.transform = `translateY(${pos * h}px)`;
  });
  // Row height is a CSS variable that changes at breakpoints, so the board's
  // height has to follow it rather than be fixed once at render time.
  $('#matrix').style.height = `${order.length * h + 6}px`;
  laidRowH = h;
}

function sortRows() {
  const host = $('#matrix');
  const order = [];
  const bands = [];

  state.groups.forEach(g => {
    bands.push({ g, start: order.length, count: g.members.length });
    bandOrder(g).forEach(m => order.push(m));
  });

  layout(order);
  if (order.length) resetMatrixStop(order[0]);
  host.classList.add('sorted');
  host.querySelectorAll('.band, .band-tag').forEach(n => n.remove());

  const h = ROW_H();
  bands.forEach(b => {
    const colour = b.g.isThin ? 'var(--slip)'
      : b.g.isSecure ? 'var(--accent-hi)'
      : (colourOf[b.g.signature[0]?.id] || 'var(--accent)');

    const bar = el('div', 'band');
    bar.style.top = `${b.start * h + 2}px`;
    bar.style.height = `${b.count * h - 5}px`;
    bar.style.background = colour;
    host.appendChild(bar);

    // The label wraps onto a second row when the band has one; a one-row band
    // gets the short form so it never runs into the next band's label.
    const two = b.count >= 2;
    const tag = el('div', 'band-tag', b.g.isThin ? (two ? 'too few answers' : 'few answers')
      : b.g.isSecure ? (two ? 'no clear pattern' : 'no pattern')
      : `Group ${state.groups.indexOf(b.g) + 1}`);
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
    resetMatrixStop(0);
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
    c.classList.remove('lit-unl');
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

/**
 * Light the answers of one unlabelled pattern (js/discover.js) on the map:
 * every pick of its options, so the teacher sees the same students' grey
 * cells line up across the questions.
 */
function showPattern(f) {
  state.filterMis = PATTERN;
  const host = $('#matrix');
  host.classList.add('filtered');
  const want = new Map(f.options.map(o => [o.i, o.oi]));
  host.querySelectorAll('.m-cell').forEach(c => {
    const i = Number(c.dataset.item);
    const s = Number(c.closest('.m-row').dataset.student);
    const on = want.has(i) && state.cls.responses[s][i] === want.get(i);
    c.classList.toggle('lit', on);
    c.classList.toggle('lit-unl', on);
  });
  $$('.leg').forEach(l => l.classList.remove('is-on'));
  $('#clear-filter').hidden = false;
  $('#matrix-note').textContent =
    `Showing ${f.options.length} wrong answers the question set does not label (${f.options.map(o => state.pack.items[o.i].id).join(', ')}). ` +
    `${f.count} students picked two or more of them.`;
}
const PATTERN = '\u0000pattern';   // never a misconception id

function renderLegend() {
  const host = $('#legend');
  host.innerHTML = '';
  const byId = misById(state.pack);

  prevalence(posteriorForReporting(state.inf), state.inf.misIds).forEach(p => {
    const m = byId[p.id];
    if (!m) return;
    const n = el('button', 'leg');
    n.dataset.mis = p.id;
    const sw = el('span', 'sw');
    sw.style.background = colourOf[p.id];
    sw.dataset.letter = letterOf[p.id];
    n.appendChild(sw);
    n.appendChild(el('span', 'leg-n', p.id));
    n.appendChild(setMath(el('span'), m.short || m.name));
    n.appendChild(el('span', 'leg-c', String(p.confident)));
    n.title = m.belief || m.name;
    n.addEventListener('click', () => {
      applyFilter(state.filterMis === p.id ? null : p.id);
      // On a phone the key is long, and by its last rows the map has left the screen.
      if (state.filterMis && $('.board').getBoundingClientRect().bottom < window.innerHeight * 0.4) {
        $('.board').scrollIntoView({ block: 'start' });
      }
    });
    host.appendChild(n);
  });

  [['var(--correct)', 'correct'], ['var(--slip)', 'wrong, no clear pattern'], ['transparent', 'not answered', true]]
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

  const real = reteachGroups(state.groups);
  const secure = state.groups.find(g => g.isSecure);
  const thin = state.groups.find(g => g.isThin);
  const n = state.cls.students.length;

  const sub = $('#groups-sub');
  if (n < TOO_FEW) {
    sub.textContent = `With ${students(n)}, group patterns are hard to assess. Review each student's evidence in the Students tab.`;
    state.groups.forEach((g, i) => host.appendChild(groupCard(g, i)));
    return;
  }

  const others = [
    secure && `${secure.size} with no clear shared pattern${secure.support?.length ? ` (${secure.support.length} of them getting most questions wrong)` : ''}`,
    thin && `${thin.size} with too few answers for an estimate`
  ].filter(Boolean);

  sub.textContent = !real.length
    ? `No clear reteach groups emerged in this class: ${others.join(' and ')}.`
    : `${n} students, but not ${n} separate plans. Students with similar answer patterns are grouped together — ` +
      `${real.length} group${real.length === 1 ? '' : 's'} here` +
      (others.length ? `, plus ${others.join(', and ')}` : '') +
      `. Treat each group as a starting point and check the students' evidence before planning a lesson.` +
      (state.cl.silhouette < ROUGH_GROUPS
        ? ' These groups overlap a lot, so treat them as a sketch and check the individual students.'
        : '');
  sub.appendChild(el('span', 'x-anchor', ' '));
  sub.querySelector('.x-anchor').appendChild(infoButton('failureMode'));

  state.groups.forEach((g, i) => host.appendChild(groupCard(g, i)));
  (state.found || []).forEach(f => host.appendChild(unlabelledCard(f, { trackable: true })));
}

/**
 * A pattern the question set has no label for: the same students picking the
 * same unlabelled wrong answers together, more than reshuffled classes do.
 * It names the answers and the students and leaves the meaning to the teacher.
 */
function unlabelledCard(f, { trackable = false } = {}) {
  const { pack, cls } = state;
  const card = el('div', 'group unlabelled');
  const top = el('div', 'group-top');
  const nline = el('div', 'group-n');
  nline.appendChild(el('span', null, 'Not in the question set'));
  nline.appendChild(el('span', null, `${f.count} student${f.count === 1 ? '' : 's'}`));
  top.appendChild(nline);
  top.appendChild(el('h3', null, 'Wrong answers picked together'));
  card.appendChild(top);

  const body = el('div', 'group-body');
  const ties = f.reshuffles - f.beats;
  body.appendChild(el('p', 'belief',
    `These students kept choosing the same wrong answers, ones the question set does not link to any misunderstanding. ` +
    `The same class with its wrong answers shuffled at random gave a pattern this large ${ties ? `in only ${ties} of ${f.reshuffles} tries` : `in none of ${f.reshuffles} tries`}, ` +
    `so it may be a shared idea the questions were not written to detect. Look at what these answers have in common, then ask the students how they got them. ` +
    `About one ordinary class in twenty shows a pattern like this by chance, so treat it as a lead rather than a finding.`));

  body.appendChild(el('div', 'lab', 'The answers'));
  const ul = el('ul', 'unl-list');
  f.options.forEach(({ i, oi }) => {
    const item = pack.items[i];
    const li = el('li');
    const q = el('button', 'unl-q', item.id);
    q.title = 'See how the class answered this question';
    q.addEventListener('click', () => openQuestion(ctx(), i));
    li.appendChild(q);
    li.appendChild(setMath(el('span', 'unl-stem'), ` ${item.stem}`));
    const pick = el('div', 'unl-pick');
    pick.appendChild(document.createTextNode(`Picked ${paperLetter(item, oi)}: `));
    pick.appendChild(setMath(el('b'), `“${item.opts[oi].t}”`));
    li.appendChild(pick);
    ul.appendChild(li);
  });
  body.appendChild(ul);

  body.appendChild(roster({ members: f.students }));

  const show = el('button', 'btn', 'Show on the class map');
  show.type = 'button';
  show.addEventListener('click', () => { showView('matrix'); showPattern(f); scrollToView(); });
  body.appendChild(show);

  // Once the teacher knows what the answers share, the test can say so: the
  // pattern becomes a misunderstanding the analysis tracks like any other.
  if (trackable) {
    const form = el('form', 'track');
    const label = el('label', 'track-l', 'If you can tell what links them, name it and the analysis will track it like the others');
    const input = el('input', 'track-i');
    input.type = 'text';
    input.maxLength = 80;
    input.required = true;
    input.placeholder = 'e.g. Adds the squares instead of expanding';
    input.id = `track-${f.options.map(o => `${o.i}-${o.oi}`).join('_')}`;
    label.htmlFor = input.id;
    const go = el('button', 'btn btn-primary', 'Track this pattern');
    go.type = 'submit';
    const msg = el('p', 'track-msg');
    msg.setAttribute('role', 'status');
    form.append(label, input, go, msg);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const res = trackPattern(f, name);
      if (!res.ok) msg.textContent = res.error;
    });
    body.appendChild(form);
  }
  card.appendChild(body);
  return card;
}

/**
 * Label a found pattern's answers with a new misunderstanding and re-run.
 *
 * A built-in test is copied first (it ships with the page and stays as it
 * is); a teacher's own test is changed in place. Question ids, option text
 * and the key are untouched, so a saved class still opens against it, and
 * because the copy is not built in, a saved class carries it inside the file.
 */
function trackPattern(f, name) {
  const { pack: copy, id } = labelPattern(state.pack, f, name, { builtIn: isBuiltIn(state.pack) });
  const check = validatePack(copy);
  if (!check.ok) return { ok: false, error: `That label could not be added: ${check.errors[0]}` };

  addPack(copy);
  state.pack = copy;
  renderPackOptions(copy.id);
  run();
  if (state.imported) markUnsaved(true);
  showView('groups');
  $('#strip-note').textContent = `Now tracking “${name}” (${id}) on ${f.options.length} questions. ` + $('#strip-note').textContent;
  return { ok: true, id };
}

function groupCard(g, idx) {
  const byId = misById(state.pack);
  const card = el('div', `group${g.isSecure ? ' secure' : ''}${g.isThin ? ' thin' : ''}`);
  const total = state.cls.students.length;

  const top = el('div', 'group-top');
  if (!g.isSecure && g.signature[0]) card.style.setProperty('--gc', colourOf[g.signature[0].id]);

  const nline = el('div', 'group-n');
  nline.appendChild(el('span', null, g.isThin ? 'Not enough answers' : g.isSecure ? 'No clear pattern found' : `Group ${idx + 1}`));
  nline.appendChild(el('span', null, `${g.size} student${g.size === 1 ? '' : 's'} · ${Math.round((g.size / total) * 100)}%`));
  top.appendChild(nline);

  if (g.isThin) {
    top.appendChild(el('h3', null, 'Not enough answers for an estimate'));
    card.appendChild(top);
    const body = el('div', 'group-body');
    body.appendChild(el('p', 'belief',
      'At least half the paper is blank, so there is not enough evidence for a reliable estimate. Collect more answers or check in with these students before drawing conclusions.'));
    body.appendChild(roster(g));
    card.appendChild(body);
    return card;
  }

  if (g.isSecure) {
    top.appendChild(el('h3', null, 'No clear pattern in these answers'));
    card.appendChild(top);
    const body = el('div', 'group-body');
    const scores = totalScores(state.pack, state.cls.responses);
    const support = g.support || [];
    const onTrack = g.onTrack || g.members;
    // Split by how often they are right where no belief is in play: the same
    // scattered errors are carelessness from a strong student and a gap from
    // a weak one, and the weak ones are the easiest students to miss here.
    if (support.length) {
      const box = el('div', 'sub-group');
      box.appendChild(el('div', 'lab warn', `Getting most questions wrong · ${support.length}`));
      box.appendChild(el('p', 'plan',
        `Right on fewer than ${Math.round(SUPPORT_BELOW * 100)}% of the questions their errors do not explain. That points to a gap or guessing rather than one misunderstanding: work through a few problems with them and see where it breaks down.`));
      box.appendChild(roster({ ...g, members: support }));
      body.appendChild(box);
    }
    if (onTrack.length) {
      const box = el('div', 'sub-group');
      if (support.length) box.appendChild(el('div', 'lab', `The rest · ${onTrack.length}`));
      box.appendChild(el('p', 'belief', onTrack.every(s => scores[s] === state.cov[s].answered)
        ? 'All recorded answers were correct. This test has not identified a reteach need for these students.'
        : 'Their wrong answers did not form a clear pattern on this test. The results cannot tell you why; review the evidence or check in with the students before deciding what support they need.'));
      box.appendChild(roster({ ...g, members: onTrack }));
      body.appendChild(box);
    }
    card.appendChild(body);
    return card;
  }

  const details = g.signature.slice(0, 4).map(s => byId[s.id]).filter(Boolean);
  g.misDetails = details;

  const h = el('h3', null, g.aiPlan?.headline || details[0]?.name || 'Shared response pattern');
  if (g.aiPlan) h.appendChild(el('span', 'pill pill-ai', 'rewritten'));
  top.appendChild(h);

  if (g.signature.length) top.appendChild(el('div', 'chips-lab', 'Average estimate in this group'));
  const chips = el('div', 'chips');
  g.signature.slice(0, 4).forEach(s => {
    const c = el('button', 'chip');
    const sw = el('span', 'sw');
    sw.style.background = colourOf[s.id];
    c.appendChild(sw);
    const m = byId[s.id];
    c.appendChild(setMath(el('span'), `${m?.short ?? s.id} · ${Math.round(s.inMean * 100)}%`));
    c.title = `${m?.name ?? s.id} — click to highlight on the class map`;
    c.addEventListener('click', () => { showView('matrix'); applyFilter(s.id); });
    chips.appendChild(c);
  });
  top.appendChild(chips);
  card.appendChild(top);

  const body = el('div', 'group-body');
  // A group is defined by what it shares on average, so not every member
  // holds every belief in it: say how many hold the one the plan is for.
  const lead = g.signature[0]?.id;
  if (details[0]?.belief) {
    const lab = el('div', 'lab', 'Pattern suggests');
    if (lead) lab.appendChild(el('span', 'lab-n', ` · ${g.members.filter(m => state.dx[m].has(lead)).length} of ${g.size} hold it`));
    body.appendChild(lab);
    body.appendChild(setMath(el('p', 'belief'), details[0].belief));
  }

  // A teacher's own test may carry no reteach plans yet; leave the heading out
  // rather than show it over nothing.
  const plan = g.aiPlan?.plan || details[0]?.reteach;
  if (plan) {
    body.appendChild(el('div', 'lab accent', g.aiPlan ? 'Reteach — rewritten for this group' : 'Reteach'));
    body.appendChild(setMath(el('p', 'plan'), plan));
  }

  const checks = g.aiPlan?.verify || details[0]?.verify || [];
  if (checks.length) {
    body.appendChild(el('div', 'lab', 'Check understanding'));
    const ul = el('ul', 'checks');
    checks.forEach(v => ul.appendChild(setMath(el('li'), v)));
    body.appendChild(ul);
  }

  // The plan above is for the group's main misunderstanding. The rest are held
  // by most of the group too, and each has its own reteach.
  const others = g.aiPlan ? [] : details.slice(1);
  if (others.length) {
    const more = el('details', 'group-more');
    more.appendChild(el('summary', null, `${others.length} more patterns identified`));
    others.forEach(m => {
      const held = g.signature.find(s => s.id === m.id);
      const h4 = setMath(el('h4'), m.name);
      h4.appendChild(el('span', 'group-more-p', ` ${Math.round(held.inMean * 100)}%`));
      more.appendChild(h4);
      if (m.belief) more.appendChild(setMath(el('p', 'belief'), m.belief));
      if (m.reteach) more.appendChild(setMath(el('p', 'plan'), m.reteach));
      if (m.verify?.length) {
        const ul = el('ul', 'checks');
        m.verify.forEach(v => ul.appendChild(setMath(el('li'), v)));
        more.appendChild(ul);
      }
    });
    body.appendChild(more);
  }

  body.appendChild(roster(g));

  // Students whose answers sit almost as close to another group. On the
  // stress benchmark about half of them were in the wrong one, so the card
  // names the other group rather than leaving the placement to look certain.
  const near = (g.between || [])
    .map(b => ({ s: b.s, other: state.groups.find(x => x.index === b.alt && !x.isSecure && !x.isThin) }))
    .filter(b => b.other);
  if (near.length) {
    const box = el('div', 'roster roster-between');
    box.appendChild(el('div', 'lab', `Check where they fit · ${near.length}`));
    box.appendChild(el('p', 'roster-note', 'Their answers are almost as close to another group. Look at their evidence before deciding which lesson they join.'));
    const list = el('div', 'roster-names');
    near.forEach(({ s, other }) => {
      const b = el('button', 'rname', state.cls.students[s].name);
      b.appendChild(el('span', 'rname-alt', ` or ${groupLabel(other)}`));
      b.addEventListener('click', () => openStudent(ctx(), s, near.map(x => x.s)));
      list.appendChild(b);
    });
    box.appendChild(list);
    body.appendChild(box);
  }

  // A reteach reaches only the students in the room for it. Anyone else who
  // holds the belief, but was grouped by a different one, belongs there too.
  const outside = lead ? alsoBringIn(g) : [];
  if (outside.length) {
    const box = roster({ ...g, members: outside });
    box.querySelector('.lab').textContent = `Also bring in · ${outside.length}`;
    box.insertBefore(el('p', 'roster-note', 'They show this pattern too, but were grouped by another one.'), box.querySelector('.roster-names'));
    body.appendChild(box);
  }

  card.appendChild(body);
  return card;
}

/** Students outside group `g` who are reported with its lead belief. */
function alsoBringIn(g) {
  const lead = g.signature[0]?.id;
  return state.dx.map((held, s) => (held.has(lead) && !g.members.includes(s) ? s : -1)).filter(s => s >= 0);
}

function roster(g) {
  const box = el('div', 'roster');
  box.appendChild(el('div', 'lab', 'Who'));
  const list = el('div', 'roster-names');
  g.members.forEach(m => {
    const b = el('button', 'rname', state.cls.students[m].name);
    b.addEventListener('click', () => openStudent(ctx(), m, g.members));
    list.appendChild(b);
  });
  box.appendChild(list);
  return box;
}

/* ======================================================================== */
/*  Students                                                                */
/* ======================================================================== */

/** The other group a student's answers sit almost as close to, if any. */
function nearGroup(s) {
  const g = state.groups.find(x => x.members.includes(s));
  const b = g?.between?.find(x => x.s === s);
  return b ? state.groups.find(x => x.index === b.alt && !x.isSecure && !x.isThin) || null : null;
}

/** What a group is called wherever students are listed. */
function groupLabel(g) {
  return g.isThin ? 'Not enough answers'
    : g.isSecure ? 'No clear pattern'
    : `Group ${state.groups.indexOf(g) + 1}`;
}

/** One button per group, because nobody scrolls a list of 120 to find a group of 30. */
function renderStudentFilter() {
  const host = $('#student-filter');
  host.innerHTML = '';
  const { groups, cls } = state;

  const add = (label, n, key) => {
    const b = el('button', key === null ? 'seg-b is-on' : 'seg-b', `${label} · ${n}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(key === null));
    b.addEventListener('click', () => {
      state.studentGroup = key;
      $$('#student-filter .seg-b').forEach(x => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      renderStudents();
    });
    host.appendChild(b);
  };
  add('Everyone', cls.students.length, null);
  groups.forEach((g, i) => add(groupLabel(g), g.members.length, i));
  // Two ways of slicing the class that cut across the groups, offered only
  // when this class has some: the students getting most questions wrong with
  // no clear pattern, and the ones with a belief worth one more question.
  const support = groups.find(g => g.isSecure)?.support?.length ?? 0;
  if (support) add('Getting most wrong', support, 'support');
  const check = cls.students.filter((_, s) => state.inf.misIds.some((__, k) => strength(state.inf, s, k).level === 'check')).length;
  if (check) add('One more question', check, 'check');
  const between = cls.students.filter((_, s) => nearGroup(s)).length;
  if (between) add('Between groups', between, 'between');
  host.hidden = host.children.length < 3;
}

function renderStudents() {
  const host = $('#students');
  host.innerHTML = '';

  const { pack, cls, inf, groups, cov } = state;
  const byId = misById(pack);
  const ci = pack.items.map(correctIndex);
  const h = normName($('#student-search').value || '');

  const rows = cls.students.map((st, s) => {
    const score = cls.responses[s].reduce((n, c, i) => n + (c === ci[i] ? 1 : 0), 0);
    const levels = inf.misIds.map((mid, k) => ({ mid, k, ...strength(inf, s, k) })).sort((a, b) => b.p - a.p);
    const held = levels.filter(x => x.level === 'clear' || x.level === 'likely');
    const check = levels.filter(x => x.level === 'check');
    const group = groups.find(g => g.members.includes(s));
    return { s, st, score, held, check, group };
  });

  // Most to act on first: students with the most confident misconceptions,
  // then, among those with none, the ones getting most questions wrong, then
  // lowest score. A teacher opening this wants triage, not the register.
  const struggling = r => (r.group?.isSecure && r.group.support?.includes(r.s) ? 1 : 0);
  rows.sort((a, b) => (b.held.length - a.held.length) || (struggling(b) - struggling(a)) || (a.score - b.score));

  const picked = state.studentGroup == null ? rows
    : state.studentGroup === 'support' ? rows.filter(r => r.group?.isSecure && r.group.support?.includes(r.s))
    : state.studentGroup === 'check' ? rows.filter(r => r.check.length > 0)
    : state.studentGroup === 'between' ? rows.filter(r => nearGroup(r.s))
    : rows.filter(r => r.group === groups[state.studentGroup]);
  const shown = h ? picked.filter(r => normName(r.st.name).includes(h)) : picked;

  // Slips print what is on screen, so one group or one student takes no scissors.
  const everyone = shown.length === rows.length;
  state.slipsFor = everyone ? null : shown.map(r => r.s);
  const slipsButton = $('#print-slips');
  slipsButton.disabled = !shown.length;
  slipsButton.textContent = everyone || !shown.length ? 'Print student slips'
    : shown.length === 1 ? 'Print this slip'
    : `Print these ${shown.length} slips`;
  $('#student-count').textContent = shown.length === rows.length ? '' : `${shown.length} of ${students(rows.length)}`;

  if (!shown.length) {
    host.appendChild(el('p', 'note', state.studentGroup == null ? 'No student by that name.' : 'No student by that name in this group.'));
    return;
  }

  shown.forEach(r => {
    const card = el('button', 'stu');

    const l = el('div', 'stu-l');
    l.appendChild(el('div', 'stu-name', r.st.name));
    const near = nearGroup(r.s);
    const placed = !r.group ? '' : r.group.isSecure && r.group.support?.includes(r.s) ? 'Getting most wrong'
      : near ? `${groupLabel(r.group)} or ${state.groups.indexOf(near) + 1}?` : groupLabel(r.group);
    const blank = cov[r.s].total - cov[r.s].answered;
    l.appendChild(el('div', 'stu-meta', blank ? `${placed} · ${blank} left blank` : placed));
    card.appendChild(l);

    const mid = el('div', 'stu-m');
    if (r.held.length) {
      r.held.slice(0, 3).forEach(x => {
        const c = el('span', 'chip');
        const sw = el('span', 'sw');
        sw.style.background = colourOf[x.mid];
        c.appendChild(sw);
        c.appendChild(setMath(el('span'), `${byId[x.mid]?.short || x.mid} · ${Math.round(x.p * 100)}%`));
        mid.appendChild(c);
      });
      if (r.held.length > 3) mid.appendChild(el('span', 'chip chip-more', `+${r.held.length - 3}`));
    } else if (r.group?.isThin) {
      mid.appendChild(el('span', 'chip chip-thin', 'Not enough answers for an estimate'));
    } else if (!r.check.length) {
      mid.appendChild(r.group?.support?.includes(r.s)
        ? el('span', 'chip chip-check', 'Scattered errors: needs practice')
        : el('span', 'chip chip-clear', 'No clear pattern found'));
    }
    // A belief resting on one answer is not a diagnosis; it is a question to ask.
    if (r.check.length && (r.held.length < 3 || state.studentGroup === 'check')) {
      const c = el('span', 'chip chip-check');
      c.appendChild(setMath(el('span'), `Check: ${byId[r.check[0].mid]?.short || r.check[0].mid}`));
      c.title = 'Only one answer points here. Ask one more question before acting on it.';
      mid.appendChild(c);
    }
    card.appendChild(mid);

    const rr = el('div', 'stu-r');
    rr.appendChild(el('span', 'stu-score', `${r.score}/${pack.items.length}`));
    rr.appendChild(el('span', 'stu-go', '→'));
    card.appendChild(rr);

    card.addEventListener('click', () => openStudent(ctx(), r.s, shown.map(x => x.s)));
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

  const sub = $('#items-sub');
  $('#item-filter').hidden = cls.students.length < TOO_FEW;
  if (cls.students.length < TOO_FEW) {
    sub.textContent = '';
    $('#alpha-note').textContent = '';
    const box = el('div', 'empty');
    box.appendChild(el('h3', null, 'Too few students to judge the questions.'));
    box.appendChild(el('p', null,
      `These checks compare students with each other, and ${students(cls.students.length)} is not enough for a useful comparison. You can still review each student's estimate and evidence.`));
    host.appendChild(box);
    return;
  }

  const bad = problemItems(stats);
  const diag = diagnosticItems(stats);
  const strong = stats.filter(s => s.quality === 'strong').length;

  sub.textContent =
    `The same answers can help review your questions. ${strong} of ${pack.items.length} are rated as working well; ` +
    `${bad.length} ${bad.length === 1 ? 'is' : 'are'} flagged for review. Click a question to see how the class answered it.` +
    (cls.students.length < SMALL_CLASS
      ? ` With ${cls.students.length} students these figures are rough, so treat a flag as a reason to reread the question, not a verdict.`
      : '');

  let list;
  if (state.itemFilter === 'problem') list = bad;
  else if (state.itemFilter === 'defended') list = diag;
  else list = stats.slice().sort((a, b) => severityOf(b) - severityOf(a));

  if (!list.length) {
    host.appendChild(el('p', 'note', state.itemFilter === 'problem'
      ? 'No questions were flagged for review. Check the results alongside your knowledge of the class.'
      : 'Nothing in this category.'));
  }

  if (state.itemFilter === 'defended' && list.length) {
    const box = el('div', 'defended');
    box.appendChild(el('h3', null, 'These look weak by the usual measure. Keep them.'));
    const p = el('p', null,
      'The standard check asks whether students who did well overall also got the question right. That assumes the test measures one thing. A diagnostic question may be missed by students with a particular misunderstanding, even if they do well elsewhere. Before flagging it, the tool checks whether answers to the rest of the paper support the same pattern.');
    box.appendChild(p);
    const anchor = el('span', 'x-anchor', ' ');
    anchor.appendChild(infoButton('diagnosing'));
    box.appendChild(anchor);
    host.appendChild(box);
  }

  const order = list.map(x => x.index);
  list.forEach(s => host.appendChild(itemCard(s, order)));

  const alpha = cronbachAlpha(pack, cls.responses);
  const note = $('#alpha-note');
  note.textContent = `How consistent is the paper overall? ${interpretAlpha(alpha, pack.misconceptions.length)} `;
  const a = el('span', 'x-anchor', ' ');
  a.appendChild(infoButton('consistency'));
  note.appendChild(a);
}

function itemCard(s, order) {
  const card = el('button', `item ${s.quality}`);

  const top = el('div', 'item-top');
  const stem = el('div', 'item-stem');
  stem.appendChild(el('span', 'item-id', s.id));
  stem.appendChild(setMath(el('span'), s.stem));
  top.appendChild(stem);

  top.appendChild(el('span', `verdict v-${s.quality}`, VERDICTS[s.quality] || ''));
  card.appendChild(top);

  // A question defended as diagnostic carries the flags that made it look
  // weak; on its card the defence is the finding, so it is what is shown.
  const shown = shownFlags(s);
  if (s.note) {
    card.appendChild(setMath(el('p', 'item-note'), s.note));
  } else if (shown.length) {
    const flags = el('ul', 'flags');
    shown.slice(0, 2).forEach(f => {
      flags.appendChild(setMath(el('li', severityOf({ flags: [f] }) <= 1 ? 'minor' : null), f.text));
    });
    card.appendChild(flags);
  }

  // Options in the order they are printed on paper, lettered to match.
  const item = state.pack.items[s.index];
  const bars = el('div', wordyOptions(item) ? 'bars bars-long' : 'bars');
  paperOrder(item).map(oi => s.options[oi]).forEach((o, k) => {
    const row = el('div', `bar-row${o.correct ? ' correct' : ''}`);
    const t = el('span', 'bar-t');
    t.appendChild(el('span', 'opt-l', 'ABCDEFGH'[k]));
    t.appendChild(setMath(el('span'), o.text));
    t.title = o.text;
    row.appendChild(t);
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

  card.addEventListener('click', () => openQuestion(ctx(), s.index, order));
  return card;
}

/* ======================================================================== */
/*  After the reteach                                                       */
/* ======================================================================== */

function renderProgress() {
  const host = $('#progress');
  host.innerHTML = '';
  $('#export-progress').hidden = !state.retest;
  $('#print-progress').hidden = !state.retest;
  $('#clear-retest').hidden = !state.retest;
  if (!state.retest) { host.appendChild(progressEmpty()); return; }

  const { pack, cls, retest } = state;
  const real = reteachGroups(state.groups);
  const cmp = compareSittings(pack, cls, retest, real);
  const { totals: t, match } = cmp;
  const matchNotes = [
    match.onlyBefore.length && sentence(`Only in the first sitting: ${match.onlyBefore.join(', ')}`),
    match.onlyAfter.length && sentence(`Only in the retest: ${match.onlyAfter.join(', ')}`),
    match.ambiguous.length && sentence(`Repeated or missing names, so left out: ${match.ambiguous.join(', ')}`)
  ].filter(Boolean);

  if (!match.pairs.length) {
    $('#export-progress').hidden = true;
    $('#print-progress').hidden = true;
    const box = el('div', 'empty');
    box.appendChild(el('h3', null, 'No students could be matched between sittings.'));
    box.appendChild(el('p', null, 'Students are matched by name. Check spelling and add a name to every row before comparing.'));
    if (matchNotes.length) box.appendChild(el('p', 'note', matchNotes.join(' ')));
    host.appendChild(box);
    return;
  }

  host.appendChild(progressVerdict(t));

  const metrics = el('div', 'metrics');
  [
    [t.students, 'students in both sittings', `Each one is compared with themselves.`],
    [t.cleared, 'no longer indicated', 'Indicated before the reteach, not after.'],
    [t.stuck, 'indicated both times', 'The same pattern appeared in both sittings.'],
    [t.emerged, 'newly indicated', 'Not indicated before, but indicated after.']
  ].forEach(([v, k, x]) => {
    const c = el('div', 'metric');
    c.appendChild(el('div', 'metric-v', String(v)));
    c.appendChild(el('div', 'metric-k', k));
    c.appendChild(el('div', 'metric-x', x));
    metrics.appendChild(c);
  });
  host.appendChild(metrics);

  const byId = misById(pack);
  const reached = cmp.groups.filter(g => g.cleared.length + g.stuck.length);
  if (reached.length) {
    host.appendChild(el('h3', 'prog-h', 'By reteach group'));
    const box = el('div', 'prog-groups');
    reached.forEach(g => box.appendChild(progressGroup(g, byId)));
    host.appendChild(box);
  }

  host.appendChild(el('h3', 'prog-h', 'By misunderstanding'));
  const shown = cmp.misconceptions.filter(m => m.before || m.after);
  // One pattern is a handful of students, so most rows can read "could be
  // chance" while the class as a whole clearly moved. Say so, or the rows
  // read as contradicting the headline.
  const unclear = shown.filter(m => m.reading === 'unclear').length;
  if (unclear >= 2) {
    host.appendChild(el('p', 'note prog-note',
      `Each pattern below is tested on its own, using only the few students who showed it, so ${unclear} of ${shown.length} read “${READING.unclear}” even where the class as a whole changed. The whole-class result above rests on every student and is the stronger evidence.`));
  }
  const list = el('div', 'progs');
  shown.forEach(m => list.appendChild(progressCard(m, byId, t.students)));
  host.appendChild(list);

  if (matchNotes.length) host.appendChild(el('p', 'note', matchNotes.join(' ')));

  if (retest.simulated) {
    const held = rows => rows.reduce((n, r) => n + r.held.size, 0);
    host.appendChild(el('p', 'note',
      `This retest is simulated: ${Math.round(retest.simulated.cleared * 100)}% of each student's misunderstandings were removed before new answers were generated. The class really went from ${held(cls.truth)} held to ${held(retest.truth)}; the tool, which never saw that, reports ${t.before} to ${t.after}.`));
  }
}

/** One reteach group: did its lesson reach the students it was for? */
function progressGroup(g, byId) {
  const held = g.cleared.length + g.stuck.length;
  const row = el('div', 'prog-group');
  row.style.setProperty('--gc', colourOf[g.main] ?? 'var(--accent)');

  const head = el('div', 'prog-group-top');
  const number = state.groups.findIndex(x => x.index === g.index) + 1;
  head.appendChild(el('span', 'prog-group-n', `Group ${number}`));
  head.appendChild(setMath(el('span', 'prog-name'), byId[g.main]?.name ?? g.main));
  head.appendChild(el('span', 'prog-group-score', `${g.cleared.length} of ${held} no longer indicated`));
  row.appendChild(head);

  if (g.stuck.length) {
    const p = el('p', 'prog-group-who');
    p.appendChild(el('b', null, 'Review with: '));
    p.appendChild(document.createTextNode(g.stuck.join(', ')));
    row.appendChild(p);
  } else {
    row.appendChild(el('p', 'prog-group-who', 'This pattern was no longer indicated for everyone in the group who was retested.'));
  }
  if (g.absent.length) {
    row.appendChild(el('p', 'prog-group-who', sentence(`Not retested: ${g.absent.join(', ')}`)));
  }
  return row;
}

function progressEmpty() {
  const box = el('div', 'empty');
  box.appendChild(el('h3', null, 'Nothing to compare yet.'));
  box.appendChild(el('p', null,
    'After a reteach, give the class the same paper and paste the new answers. Students are matched by name, and you can review which patterns changed in the analysis.'));
  const row = el('div', 'empty-actions');
  const paste = el('button', 'btn btn-primary', 'Paste the retest');
  paste.addEventListener('click', () => openImport('retest'));
  row.appendChild(paste);
  if (state.cls.truth) {
    const sim = el('button', 'btn', 'Simulate a reteach');
    sim.addEventListener('click', simulateReteach);
    row.appendChild(sim);
  }
  box.appendChild(row);
  return box;
}

function progressVerdict(t) {
  const split = `${students(t.fewer)} had fewer misunderstandings indicated and ${students(t.more)} had more`;
  const [title, body] = {
    improved: ['Fewer patterns were indicated.', `${split}. This difference is unlikely to be due to chance alone.`],
    worse: ['More patterns were indicated.', `${split}. This difference is unlikely to be due to chance alone.`],
    unclear: ['No clear difference yet.', `${split}. This could be chance, so review each pattern and student separately.`],
    none: ['No diagnosis changed.', 'The same patterns were indicated in both sittings.']
  }[t.reading];
  const box = el('div', `prog-verdict is-${t.reading}`);
  box.appendChild(el('h3', null, title));
  box.appendChild(el('p', null, body));
  box.appendChild(el('p', 'prog-caveat', 'Sitting the same paper twice teaches the paper, so read this as evidence rather than proof.'));
  return box;
}

function progressCard(m, byId, n) {
  const card = el('div', 'prog');

  const top = el('div', 'prog-top');
  const sw = el('span', 'sw');
  sw.style.background = colourOf[m.id];
  top.appendChild(sw);
  top.appendChild(setMath(el('span', 'prog-name'), byId[m.id]?.name ?? m.id));
  top.appendChild(el('span', `prog-read is-${m.reading}`, READING[m.reading]));
  card.appendChild(top);

  [['Before', m.before], ['After', m.after]].forEach(([label, v]) => {
    const row = el('div', 'prog-row');
    row.appendChild(el('span', 'prog-lab', label));
    const track = el('span', 'prog-track');
    const fill = el('span', 'prog-fill');
    fill.style.width = `${Math.max(1.5, (v / n) * 100)}%`;
    fill.style.background = colourOf[m.id];
    if (label === 'Before') fill.style.opacity = '.45';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'prog-n', String(v)));
    card.appendChild(row);
  });

  const who = [['Indicated both times', m.stuck], ['No longer indicated', m.cleared], ['Newly indicated', m.emerged], ['Not tested', m.untested]]
    .filter(([, names]) => names.length);
  if (who.length) {
    const more = el('details', 'prog-who');
    more.appendChild(el('summary', null, 'Who'));
    who.forEach(([label, names]) => {
      const line = el('p', null);
      line.appendChild(el('b', null, `${label}: `));
      line.appendChild(document.createTextNode(names.join(', ')));
      more.appendChild(line);
    });
    card.appendChild(more);
  }
  return card;
}

/** A retest for the sample class, generated from its hidden profiles. */
function simulateReteach() {
  const cleared = 0.7;
  const seed = (state.cls.meta.seed || 1) + 1;
  state.retest = { ...generateRetest(state.cls, { seed, cleared }), simulated: { cleared } };
  renderProgress();
}

function clearRetest() {
  if (state.imported) markUnsaved(true);
  state.retest = null;
  renderProgress();
}

function exportProgress() {
  download(`${state.pack.id}-after-reteach.csv`,
    progressCsv(compareSittings(state.pack, state.cls, state.retest), misById(state.pack)));
}

function printProgress() {
  showView('progress');
  closeDrawer();
  document.body.classList.add('print-progress');
  window.addEventListener('afterprint', () => document.body.classList.remove('print-progress'), { once: true });
  printUnfolded($('#progress'));
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
    box.appendChild(el('h3', null, 'Real classes have no hidden answer key.'));
    box.appendChild(el('p', null,
      'These measures are calculated by comparing the analysis with misunderstandings planted in the sample class before its answers were generated. For a real class, we do not know each student’s underlying thinking, so there is no ground truth to score against.'));
    box.appendChild(el('p', null,
      'Switch to “Sample class” to see how well the method recovers those simulated patterns. This is a useful check, but it cannot guarantee the same results for a real class.'));
    host.appendChild(box);
    wrap.appendChild(predictionPanel());
    ['tabindex', 'role', 'aria-label'].forEach(a => wrap.removeAttribute(a));
    return;
  }

  // The table can be wider than a phone, so the keyboard has to be able to scroll it.
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Groups compared with the simulated profiles');

  const dq = scoreDiagnosis(diagnose(posteriorForReporting(inf), inf.misIds), cls.truth, inf.misIds);
  const cq = scoreClustering(cl.labels, cls.truth);

  [
    { v: fmtPct(dq.recall), k: 'misunderstandings found', key: 'recall',
      x: `Of the misunderstandings planted in the simulated students, the analysis recovered ${fmtPct(dq.recall)} from their answers.` },
    { v: fmtPct(dq.precision), k: 'diagnoses correct', key: 'precision',
      x: `Of the misunderstandings attributed to simulated students, ${fmtPct(dq.precision)} were present in the hidden profiles.` },
    { v: dq.f1.toFixed(2), k: 'combined score', key: 'f1',
      x: 'A single score that balances the share of real patterns found with the share of diagnoses that were correct.' },
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
  const caption = el('caption');
  caption.appendChild(el('span', 'cap-in',
    'Groups the tool found, against the profiles the simulation planted. One clear winner per row means it rediscovered structure it was never shown.'));
  t.appendChild(caption);

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, 'Found'));
  plantedIds.forEach(p => hr.appendChild(el('th', null, `planted ${p}`)));
  thead.appendChild(hr);
  t.appendChild(thead);

  const tb = el('tbody');
  table.forEach((row, i) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, i === cl.secureLabel ? 'no clear pattern' : `group ${i + 1}`));
    const max = Math.max(...row);
    row.forEach(v => tr.appendChild(el('td', v === max && v > 0 ? 'hot' : null, String(v))));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);

  $('#validation-note').textContent =
    'Change the class variant in the toolbar to re-roll a different sample class. The figures are computed live each time, so a bad run shows a bad number.';

  renderBetweenCheck();
  renderHideTest();
}

/**
 * The between-groups flag, checked on this class: of the students it marks,
 * how many sit in a group whose commonest planted profile is not theirs,
 * against the same share for everyone else in the groups.
 */
function renderBetweenCheck() {
  const { cls } = state;
  const old = $('#between-check');
  if (old) old.remove();
  const real = reteachGroups(state.groups);
  if (!cls.truth || real.length < 2) return;

  const misplaced = new Set();
  real.forEach(g => {
    const count = new Map();
    g.members.forEach(s => count.set(cls.truth[s].archetype, (count.get(cls.truth[s].archetype) || 0) + 1));
    const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.members.forEach(s => { if (cls.truth[s].archetype !== main) misplaced.add(s); });
  });
  const flagged = real.flatMap(g => (g.between || []).map(b => b.s));
  const rest = real.flatMap(g => g.members).filter(s => !flagged.includes(s));
  const off = list => list.filter(s => misplaced.has(s)).length;

  const p = el('p', 'note');
  p.id = 'between-check';
  p.textContent = flagged.length
    ? `Between groups: ${flagged.length} student${flagged.length === 1 ? ' is' : 's are'} marked as almost as close to another group. ` +
      `${off(flagged)} of them ${off(flagged) === 1 ? 'is' : 'are'} in a group whose commonest planted profile is not their own, against ${off(rest)} of the other ${rest.length}. ` +
      'Across many simulated classes it is about half against one in eight.'
    : `Between groups: no student in this class is marked as almost as close to another group. ${off(rest)} of the ${rest.length} grouped students are in a group whose commonest planted profile is not their own.`;
  $('#validation-note').after(p);
}

/**
 * The search for unlabelled patterns, tested live: take the labels off one of
 * this class's commoner misunderstandings, so the tool can only see it as
 * unlabelled wrong answers, and look for it.
 */
function renderHideTest(rank = 0) {
  const host = $('#hide-test');
  host.innerHTML = '';
  const { pack, cls } = state;
  if (!cls.truth) return;

  const counts = new Map();
  cls.truth.forEach(t => t.held.forEach(m => counts.set(m, (counts.get(m) || 0) + 1)));
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!common.length) return;
  const [hidden, holders] = common[rank % common.length];
  const byId = misById(pack);

  host.appendChild(el('h3', null, 'Can it find a misunderstanding it was never told about?'));
  host.appendChild(setMath(el('p', 'sub'),
    `Here the labels for “${byId[hidden]?.name ?? hidden}” (held by ${holders} of these students) are taken off every question, ` +
    `so its answers look like any other unlabelled wrong answer. The search below has to find it from which students picked them together.`));

  const blind = {
    ...pack,
    misconceptions: pack.misconceptions.filter(m => m.id !== hidden),
    items: pack.items.map(it => ({ ...it, opts: it.opts.map(o => (o.mis === hidden ? { ...o, mis: undefined } : o)) }))
  };
  const search = unlabelledPatterns(blind, cls.responses);
  const top = search.patterns[0];

  const res = el('p', 'hide-res');
  if (!top) {
    res.textContent = 'Not found in this class. In the benchmark, with classes of 28, a belief hidden like this was found in 1 of 3 Algebra classes and 1 of 10 Biology ones (most Biology questions have only one unlabelled answer, which says nothing beyond being wrong), and 2 of 80 ordinary classes gave a false find.';
  } else {
    const own = top.options.filter(o => pack.items[o.i].opts[o.oi].mis === hidden).length;
    const hold = top.students.filter(s => cls.truth[s].held.has(hidden)).length;
    res.textContent = `Found: ${own} of the ${top.options.length} answers in the pattern are the hidden misunderstanding’s, ` +
      `and ${hold} of the ${top.count} students it names really hold it.`;
  }
  host.appendChild(res);
  if (top) host.appendChild(unlabelledCard({ ...top, reshuffles: search.reshuffles }));

  if (common.length > 1) {
    const again = el('button', 'btn', 'Hide a different one');
    again.type = 'button';
    again.addEventListener('click', () => {
      renderHideTest(rank + 1);
      // The section is rebuilt, button and all: keep a keyboard user on it.
      [...$('#hide-test').querySelectorAll('button')].pop()?.focus({ preventScroll: true });
    });
    host.appendChild(again);
  }
}

/** Compare the teacher's recorded predictions with patterns in the class. */
function predictionPanel() {
  const box = el('div', 'pred');
  box.appendChild(el('h3', null, 'Check it against what you expected'));
  box.appendChild(el('p', null,
    'If you ticked the misunderstandings you expected on the label sheet from Materials, tick the same ones here. This is only a fair test if they were written down before you saw any results.'));

  const list = el('div', 'pred-list');
  state.pack.misconceptions.forEach(m => {
    const row = el('label', 'pred-row');
    const tick = el('input');
    tick.type = 'checkbox';
    tick.checked = state.predictions.has(m.id);
    tick.addEventListener('change', () => {
      if (tick.checked) state.predictions.add(m.id);
      else state.predictions.delete(m.id);
      if (state.imported) markUnsaved(true);
      renderPredictionResult();
    });
    row.appendChild(tick);
    row.appendChild(setMath(el('span'), m.name));
    list.appendChild(row);
  });
  box.appendChild(list);

  const result = el('div', 'pred-result');
  result.id = 'pred-result';
  box.appendChild(result);
  setTimeout(renderPredictionResult, 0);
  return box;
}

function renderPredictionResult() {
  const host = $('#pred-result');
  if (!host) return;
  host.innerHTML = '';
  if (!state.predictions.size) return;

  const byId = misById(state.pack);
  const name = id => byId[id]?.name ?? id;
  const rows = prevalence(posteriorForReporting(state.inf), state.inf.misIds);
  const r = comparePredictions(state.predictions, rows, state.cls.students.length);

  host.appendChild(el('p', 'pred-sum',
    `You expected ${r.k}. ${r.agree.length} of them ${r.agree.length === 1 ? 'is' : 'are'} among the ${r.k === 1 ? 'single most common' : `${r.k} most common`} in this class.`));

  const list = (title, note, items) => {
    if (!items.length) return;
    const p = el('p', null);
    p.appendChild(el('b', null, `${title}: `));
    p.appendChild(document.createTextNode(items.map(x => `${name(x.id)} (${x.students})`).join('; ')));
    p.appendChild(document.createTextNode(`. ${note}`));
    host.appendChild(p);
  };
  list('Not what you expected', 'Review the student evidence and question labels; this difference may reflect the class, the test, or the analysis.', r.surprises);
  list('Expected, but rarely indicated', 'The questions may not be detecting this pattern, or it may be less common than expected.', r.absent);
}

function renderMethod() {
  $('#formula').textContent =
    'logit P(holds m | answers) = logit P(m) + Σ log [ P(answer | m) / P(answer | not m) ]';
  const ability = state.inf.ability || [];
  const avg = ability.length ? ability.reduce((a, b) => a + b, 0) / ability.length : PARAMS.baseCorrect;
  const lift = state.inf.fitted?.slipLift ?? 1;
  $('#params').textContent =
    `starting assumption ${PARAMS.prior} · fires on a probing question ${PARAMS.express} · ` +
    `correct without it: estimated per student (${Math.round(avg * 100)}% on average here) · ` +
    `careless errors land on a pattern-linked option ${lift.toFixed(1)}× as often as on another wrong one, on this paper · ` +
    `reported above ${PARAMS.decisionThreshold}, on at least ${MIN_TELLING} answers that point to it`;
}

/* ======================================================================== */
/*  Packs                                                                   */
/* ======================================================================== */

/** Back to the sample class. */
function dropClass() {
  showPasteNotes();
  // A class given part of a test was read against a cut-down copy; the sample
  // class goes back to the whole test.
  if (state.pack.partOf && findPack(state.pack.partOf)) {
    state.pack = findPack(state.pack.partOf);
    renderPackOptions(state.pack.id);
  }
  state.imported = null;
  state.retest = null;
  state.predictions = new Set();
  markUnsaved(false);
  $('#source').value = 'sample';
  document.body.classList.remove('has-import');
}

function renderPackOptions(selectedId) {
  const sel = $('#pack');
  sel.innerHTML = '';
  allPacks().forEach(p => {
    // The subject is already in the line under the headline; the name alone
    // keeps the toolbar to one row.
    const o = el('option', null, p.name);
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
    dropClass();
  }
  state.pack = next;
  renderPackOptions(state.pack.id);
  run();
}

/**
 * Opening or building another test replaces the class on screen, as switching
 * subject does, so it asks first too. An unsaved class would be gone for good.
 */
function okToDropClass(action) {
  if (!state.imported) return true;
  return window.confirm(`${action} drops your pasted class and returns to the sample class.` +
    (state.unsaved ? ' The class is not saved, so its answers will be lost.' : '') + ' Continue?');
}

/* ======================================================================== */
/*  Modals                                                                  */
/* ======================================================================== */

let openedFrom = null;

function openM(sel) {
  openedFrom = document.activeElement;
  const m = $(sel);
  m.hidden = false;
  focusInto(m.querySelector('.modal-card'));
}

function closeM(sel) {
  $(sel).hidden = true;
  openedFrom?.focus?.();
  openedFrom = null;
}

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

/* ---- a teacher's own test, from a file ---- */

// A file is a test that already exists on paper, so its option order is kept
// unless the file says otherwise. It is read here and goes nowhere else.
async function openPackFile(file) {
  const err = $('#modal-err');
  err.textContent = '';
  let pack;
  try {
    pack = JSON.parse(await file.text());
  } catch {
    err.textContent = `${file.name} is not readable JSON.`;
    return;
  }
  const report = validatePack(pack);
  if (!report.ok) {
    err.textContent = `${file.name} can't be used: ${report.errors.slice(0, 3).join(' ')}${report.errors.length > 3 ? ` (${report.errors.length - 3} more)` : ''}`;
    return;
  }
  if (!okToDropClass(`Opening ${file.name}`)) return;
  if (pack.keepOrder !== false) pack.keepOrder = true;
  pack.id = pack.id || `file-${file.name.replace(/\.json$/i, '')}`;
  pack.name = pack.name || file.name;
  pack.source = 'file';
  addPack(pack);
  dropClass();
  closeM('#modal');
  state.pack = pack;
  renderPackOptions(pack.id);
  run();
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
  if (!okToDropClass('Building a new subject')) return;

  state.apiKey = key;
  setKey(key);

  const go = $('#modal-go');
  go.disabled = true;
  go.textContent = 'Building…';
  $('#modal-progress').innerHTML = '';

  try {
    const { pack, report } = await generatePack(key, topic, {
      onProgress: p => progressStep(p.message)
    });
    if (report.warnings.length) {
      progressStep(`Checked, with ${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}.`, 'done');
    }
    progressStep(`Ready — ${pack.misconceptions.length} misunderstandings, ${pack.items.length} questions.`, 'done');

    addPack(pack);
    dropClass();
    state.unsavedTest = pack.id;
    setTimeout(() => { closeM('#modal'); state.pack = pack; renderPackOptions(pack.id); run(); }, 700);
  } catch (e) {
    err.textContent = e.message;
    go.disabled = false;
    go.textContent = 'Try again';
  }
}

/* ---- import a class ---- */

function openImport(mode = 'class') {
  state.importFor = mode;
  const retest = mode === 'retest';
  $('#import-title').textContent = retest ? 'Paste the retest' : 'Paste your class';
  $('#import-go').textContent = retest ? 'Compare with the first sitting' : 'Analyse this class';
  $('#class-open').textContent = retest ? 'Open a saved retest…' : 'Open a saved class…';
  $('#paste-demo').hidden = retest;
  $('#import-text').value = '';
  $('#import-report').hidden = true;
  $('#import-report').innerHTML = '';
  openM('#import');
  $('#import-text').focus();
}

/** Explain import errors here; successful imports close the dialog and show notes on the page. */
function reportImport(res) {
  const box = $('#import-report');
  box.hidden = res.ok;
  box.innerHTML = '';
  if (res.ok) return true;
  box.appendChild(el('div', 'ir-h', 'We could not read these answers.'));
  res.errors.forEach(e => box.appendChild(el('div', 'ir-e', e)));
  return false;
}

/** A repeated name or an unreadable cell has to outlast the box it was found in. */
function showPasteNotes(res) {
  const notes = res?.warnings ?? [];
  $('#paste-notes').hidden = !notes.length;
  if (!notes.length) return;
  const readAs = { letters: 'letters', numbers: 'option numbers', text: 'answer text' }[res.coding];
  $('#paste-notes-title').textContent =
    `Read ${students(res.responses.length)} × ${state.pack.items.length} questions, matched by ${res.matchedBy}, answers read as ${readAs}.`;
  $('#paste-notes-list').replaceChildren(...notes.map(w => el('li', null, w)));
}

function doImport() {
  // A class given part of a test is shown against a cut-down copy of it. The
  // next class pasted may have had the whole test, or a different part, so it
  // is read against the whole one; cut-down copies of it are not other tests.
  const whole = state.importFor === 'class' && state.pack.partOf ? findPack(state.pack.partOf) : null;
  const base = whole || state.pack;
  const res = parseResponses(base, $('#import-text').value, allPacks().filter(p => p.partOf !== base.id));
  // A retest is compared question by question with the class, so it has to
  // cover the same questions; only a class can be read against part of a test.
  if (res.pack && state.importFor === 'retest') {
    reportImport({ ok: false, errors: [`The retest has ${res.asked.length} of this test's ${state.pack.items.length} questions. Paste the same questions the class answered.`], warnings: [], responses: [] });
    return;
  }
  if (!reportImport(res)) return;

  closeM('#import');
  if (state.importFor === 'retest') useRetest(res);
  else {
    // Part of a test: read and shown against just the questions that were given.
    const read = res.pack ? addPack(res.pack) : base;
    if (read !== state.pack) {
      state.pack = read;
      renderPackOptions(read.id);
    }
    useClass(res);
    showView('groups');
  }
  showPasteNotes(res);
}

function useRetest({ students, responses }) {
  showPasteNotes();
  state.retest = { students, responses };
  if (state.imported) markUnsaved(true);
  renderProgress();
  showView('progress');
}

/** Make a class the one on screen. Typed answers exist only here until saved. */
function useClass({ students, responses, retest = null, predictions = [], savedAt = null }, { saved = false } = {}) {
  showPasteNotes();
  state.imported = { students, responses, savedAt };
  state.retest = retest;
  state.predictions = new Set(predictions);
  markUnsaved(!saved);
  document.body.classList.add('has-import');
  $('#source').value = 'import';
  run();
}

/* ---- save and reopen a class ---- */

/** A built test has to outlast the tab: the answers come back days after it prints. */
function saveTest() {
  download(`${state.pack.id}-test.json`, testFile(state.pack), 'application/json');
  state.unsavedTest = null;
  showTestNudge();
}

function showTestNudge() {
  // Save class writes the test into its file, so one reminder covers both.
  $('#test-nudge').hidden = state.unsavedTest !== state.pack.id || !!state.imported;
  $('#mat-pack').hidden = isBuiltIn(state.pack);
}

function saveClass() {
  const { pack, imported } = state;
  const savedAt = new Date();
  const day = savedAt.toISOString().slice(0, 10);
  download(`${pack.id}-class-${day}.json`,
    classFile({ pack, ...imported, savedAt, retest: state.retest, predictions: [...state.predictions], builtIn: isBuiltIn(pack) }), 'application/json');
  imported.savedAt = savedAt.toISOString();
  if (state.unsavedTest === pack.id) state.unsavedTest = null;   // the class file carries it
  showTestNudge();
  markUnsaved(false);
  renderPackLine();
  flashSaved();
}

/** Typed answers exist only in this tab until saved, so the page keeps saying so. */
function markUnsaved(on) {
  state.unsaved = on;
  $('#save-nudge').hidden = !on;
}

function flashSaved() {
  const b = $('#save-class');
  b.textContent = 'Saved to your computer';
  setTimeout(() => { b.textContent = 'Save class'; }, 2600);
}

async function openClassFile(file) {
  const res = readClassFile(await file.text(), findPack);
  if (!res.ok) {
    reportImport({ ok: false, errors: res.errors, warnings: [], responses: [] });
    return;
  }
  if (state.importFor === 'retest') {
    if (res.pack.id !== state.pack.id) {
      reportImport({ ok: false, errors: ['That file was saved on a different test, so it cannot be compared with this class.'], warnings: [], responses: [] });
      return;
    }
    closeM('#import');
    useRetest(res);
    return;
  }

  // A test that lived only in the tab it was saved from comes back with its class.
  if (res.embedded) addPack(res.pack);
  state.pack = res.pack;
  renderPackOptions(res.pack.id);
  useClass(res, { saved: true });
  closeM('#import');
  showView('groups');
}

/** Build a paste-ready example from the current sample class. */
function demoPaste() {
  const pack = state.pack;
  const cls = state.cls;
  const head = ['Student', ...pack.items.map(i => i.id)].join(',');
  const rows = cls.students.slice(0, 12).map((st, s) =>
    [st.name, ...cls.responses[s].map((c, i) => (c >= 0 ? paperLetter(pack.items[i], c) : ''))].join(','));
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
  $('#mat-review').addEventListener('click', () => {
    if (!openPrintable(reviewHtml(state.pack))) alert('Allow pop-ups to print the labels.');
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
    groupsCsv(state.pack, state.cls, state.groups, misById(state.pack), state.dx, state.found || []));
}

/** Print with everything unfolded, since paper has no way to open a section. */
function printUnfolded(root) {
  const folded = [...root.querySelectorAll('details:not([open])')];
  folded.forEach(d => { d.open = true; });
  window.addEventListener('afterprint', () => { folded.forEach(d => { d.open = false; }); }, { once: true });
  window.print();
}

function printPlan() {
  showView('groups');
  closeDrawer();
  printUnfolded($('#groups'));
}

/* ======================================================================== */
/*  Plan rewriting                                                          */
/* ======================================================================== */

/** Ask for a key in a proper dialog; `message` explains a failed attempt. */
function openKeyModal(message = '') {
  $('#key-err').textContent = message;
  $('#key-input').value = state.apiKey || '';
  $('#key-go').disabled = false;
  $('#key-go').textContent = message ? 'Try again' : 'Rewrite';
  openM('#keymodal');
  $('#key-input').focus();
}

async function submitKey() {
  const key = $('#key-input').value.trim();
  if (!key) {
    $('#key-err').textContent = 'Paste a key first. Everything else on the page works without one.';
    return;
  }
  state.apiKey = key;
  setKey(key);
  const go = $('#key-go');
  go.disabled = true;
  go.textContent = 'Rewriting…';
  $('#key-err').textContent = '';
  const failed = await rewriteGroups();
  if (failed) openKeyModal(failed);
  else closeM('#keymodal');
}

async function adaptPlans() {
  if (!state.apiKey) { openKeyModal(); return; }
  const failed = await rewriteGroups();
  if (failed) openKeyModal(failed);
}

/** Rewrite every group's plan. Returns the reason if not one of them came back. */
async function rewriteGroups() {
  const btn = $('#regen');
  btn.disabled = true;
  btn.textContent = 'Rewriting…';

  const real = reteachGroups(state.groups);
  const results = await Promise.all(real.map(g =>
    rewritePlan(g, state.cls.students.length, state.pack.subject).catch(e => ({ _error: e.message }))
  ));

  let ok = 0;
  results.forEach((p, i) => { if (!p._error) { real[i].aiPlan = p; ok++; } });
  renderGroups();
  wireExplainers();

  btn.disabled = false;
  btn.textContent = ok === real.length ? 'Rewritten for this class' : `Rewrote ${ok} of ${real.length}`;
  setTimeout(() => { btn.textContent = 'Rewrite for this class'; }, 5000);
  return real.length && !ok ? results[0]._error : null;
}

/* ======================================================================== */
/*  Tabs                                                                    */
/* ======================================================================== */

function showView(name) {
  const was = $('.view.is-active')?.id;
  $$('.tab').forEach(t => {
    const on = t.dataset.view === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
  if (was !== `view-${name}`) replay($(`#view-${name}`));
  showActiveTab();

  // Rows are absolutely positioned, so they need re-laying out whenever the
  // matrix returns from display:none at a possibly different width.
  if (name === 'matrix' && state.cls) layout(rowOrder());

  // A long tab leaves you far down the page, and the next one should open at its
  // top rather than wherever that scroll position happens to land in it.
  const top = viewTop();
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
}

/** Where the open tab starts, just under the tab bar. */
function viewTop() {
  return $('.main').getBoundingClientRect().top + window.scrollY - $('.tabs').offsetHeight;
}

/** For a control above the tabs: on a phone the tab it opens starts off screen. */
function scrollToView() {
  window.scrollTo({ top: viewTop(), behavior: 'smooth' });
}

/** On a phone the tabs scroll sideways, so keep the open one in view. */
function showActiveTab() {
  const bar = $('.tabs-in');
  const tab = $('.tab.is-active');
  const [b, t] = [bar.getBoundingClientRect(), tab.getBoundingClientRect()];
  if (t.left < b.left) bar.scrollLeft -= b.left - t.left;
  else if (t.right > b.right) bar.scrollLeft += t.right - b.right;
}

/** Left and right move between tabs, as they do in any tab list. */
function moveInTabs(e) {
  const tabs = $$('.tab');
  const at = tabs.indexOf(document.activeElement);
  if (at < 0) return;
  const next = {
    ArrowRight: (at + 1) % tabs.length,
    ArrowLeft: (at - 1 + tabs.length) % tabs.length,
    Home: 0,
    End: tabs.length - 1
  }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  showView(tabs[next].dataset.view);
  tabs[next].focus();
}

/* ======================================================================== */
/*  Wiring                                                                  */
/* ======================================================================== */

$('#run').addEventListener('click', run);
$('#reorder').addEventListener('click', toggleSort);
$('#matrix').addEventListener('keydown', moveInMatrix);
// One listener for the whole map rather than one per cell: a class of 120 is
// 4,320 cells, rebuilt on every run.
$('#matrix').addEventListener('click', e => {
  const name = e.target.closest('.m-name');
  if (name) { openStudent(ctx(), Number(name.closest('.m-row').dataset.student), rowOrder()); return; }
  const cell = e.target.closest('.m-cell');
  if (cell) openQuestion(ctx(), Number(cell.dataset.item));
});
$('.tabs-in').addEventListener('keydown', moveInTabs);
$('#clear-filter').addEventListener('click', () => applyFilter(null));

// Colour alone cannot carry the map: about 1 man in 12 cannot tell these hues
// apart. Letters give every misunderstanding a second, independent mark.
$('#show-letters').addEventListener('click', e => {
  const on = !document.body.classList.contains('show-letters');
  document.body.classList.toggle('show-letters', on);
  e.target.setAttribute('aria-pressed', String(on));
});
$('#pack').addEventListener('change', e => switchPack(e.target.value));
$('#new-subject').addEventListener('click', openSubject);
$('#materials').addEventListener('click', () => openM('#mats'));
$('#mats-close').addEventListener('click', () => closeM('#mats'));

$('#source').addEventListener('change', e => {
  if (e.target.value === 'import') { openImport('class'); e.target.value = state.imported ? 'import' : 'sample'; }
  else if (state.imported) {
    // A wrong click on a yes/no box loses a class typed in by hand, so an
    // unsaved one gets three choices, saving first among them.
    if (state.unsaved) {
      e.target.value = 'import';
      openM('#leave');
      return;
    }
    leaveForSample();
  }
});

function leaveForSample() {
  dropClass();
  run();
}
$('#leave-cancel').addEventListener('click', () => closeM('#leave'));
$('#leave-discard').addEventListener('click', () => { closeM('#leave'); leaveForSample(); });
$('#leave-save').addEventListener('click', () => { saveClass(); closeM('#leave'); leaveForSample(); });

$('#modal-cancel').addEventListener('click', () => closeM('#modal'));
$('#modal-go').addEventListener('click', doGenerate);
$('#pack-open').addEventListener('click', () => $('#pack-file').click());
$('#pack-file').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openPackFile(f);
});
$('#topic').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });
$('#api-key').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });

$('#import-cancel').addEventListener('click', () => closeM('#import'));
$('#import-go').addEventListener('click', doImport);
$('#dl-template').addEventListener('click', () => download(`${state.pack.id}-answer-sheet.csv`, templateCsv(state.pack)));
$('#paste-demo').addEventListener('click', demoPaste);
$('#class-open').addEventListener('click', () => $('#class-file').click());
$('#class-file').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openClassFile(f);
});
$('#save-class').addEventListener('click', saveClass);
$('#save-nudge-go').addEventListener('click', saveClass);
$('#test-nudge-go').addEventListener('click', saveTest);
$('#mat-pack').addEventListener('click', saveTest);
$('#paste-notes-close').addEventListener('click', () => { $('#paste-notes').hidden = true; });
$('#export-progress').addEventListener('click', exportProgress);
$('#print-progress').addEventListener('click', printProgress);
$('#clear-retest').addEventListener('click', clearRetest);

// Thirty typed answer sheets are not worth losing to a stray reload.
window.addEventListener('beforeunload', e => {
  if ((state.imported && state.unsaved) || state.unsavedTest) { e.preventDefault(); e.returnValue = ''; }
});

$('#print-plan').addEventListener('click', printPlan);
$('#export-plan').addEventListener('click', exportPlan);
$('#regen').addEventListener('click', adaptPlans);
$('#student-search').addEventListener('input', renderStudents);
$('#print-followup').addEventListener('click', () => {
  if (!openPrintable(followUpHtml(state.pack, state.cls, state.inf, state.groups))) alert('Allow pop-ups to print the follow-up questions.');
});
$('#print-slips').addEventListener('click', () => {
  if (!openPrintable(slipsHtml(state.pack, state.cls, state.inf, state.cov, state.slipsFor))) alert('Allow pop-ups to print the slips.');
});

$('#key-cancel').addEventListener('click', () => closeM('#keymodal'));
$('#key-go').addEventListener('click', submitKey);
$('#key-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitKey(); });

// On a phone the toolbar folds away behind "Setup", so the page opens on the
// analysis rather than on five rows of controls.
function setToolbar(open) {
  document.body.classList.toggle('toolbar-open', open);
  $('#bar-toggle').setAttribute('aria-expanded', String(open));
}
$('#bar-toggle').addEventListener('click', () => setToolbar(!document.body.classList.contains('toolbar-open')));

$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeM(`#${m.id}`); }));
document.addEventListener('keydown', e => {
  const open = $$('.modal').find(m => !m.hidden);
  if (!open) return;
  if (e.key === 'Escape') closeM(`#${open.id}`);
  else trapTab(open.querySelector('.modal-card'), e);
});

$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

// A nav link straight to one tab: open it and scroll so it starts under the tabs.
$$('[data-to-view]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  showView(a.dataset.toView);
  scrollToView();
}));
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
  fitMapToClass(state.cls.students.length);
  // Crossing a breakpoint changes the row height, and the group bands were
  // drawn at the old one, so a sorted map is redrawn rather than just moved.
  if (state.sorted && ROW_H() !== laidRowH) sortRows();
  else layout(rowOrder());
});

/* ======================================================================== */
/*  Tour                                                                    */
/* ======================================================================== */

/** What the tour says about the class on screen, computed rather than canned. */
function tourFacts() {
  const real = reteachGroups(state.groups);
  const byId = misById(state.pack);
  // As on the Your questions tab: under TOO_FEW students nothing is judged.
  const tooFew = state.cls.students.length < TOO_FEW;
  const bad = tooFew ? [] : problemItems(state.stats);
  const top = real[0];
  const f = {
    students: state.cls.students.length,
    tooFew,
    groups: real.length,
    topSize: top?.size ?? 0,
    topName: top ? (byId[top.signature[0]?.id]?.name ?? null) : null,
    items: state.pack.items.length,
    bad: bad.length,
    worstId: bad[0]?.id,
    worstVerdict: bad[0] ? VERDICTS[bad[0].quality] : null,
    recall: null,
    precision: null,
    between: real.reduce((n, g) => n + (g.between?.length || 0), 0)
  };
  if (state.cls.truth) {
    const dq = scoreDiagnosis(diagnose(posteriorForReporting(state.inf), state.inf.misIds), state.cls.truth, state.inf.misIds);
    f.recall = fmtPct(dq.recall);
    f.precision = fmtPct(dq.precision);
  }
  return f;
}

const tour = initTour({
  facts: tourFacts,
  show: showView,
  setSorted: on => { if (on !== state.sorted) toggleSort(); },
  openToolbar: () => setToolbar(true),
  openImport,
  closeDrawer
});
$('#demo').addEventListener('click', tour.start);
$$('[data-demo]').forEach(b => b.addEventListener('click', tour.start));

/* ======================================================================== */
/*  Start                                                                   */
/* ======================================================================== */

wireMaterials();
state.pack = defaultPack();
renderPackOptions(state.pack.id);
run();

// Deep links: ?view=groups opens a tab directly, ?sorted=1 starts with the map
// already sorted. Handy for sharing a view and for the demo.
{
  const h = new URLSearchParams(location.search);
  const v = h.get('view');
  if (v && $(`#view-${v}`)) showView(v);
  if (h.get('sorted') === '1' && !state.sorted) toggleSort();
}

tour.maybeOpen();
