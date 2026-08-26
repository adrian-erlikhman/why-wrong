/**
 * app.js -- orchestration and rendering.
 *
 * Pipeline order, stated once because it matters:
 *   pack -> generate class -> infer -> cluster -> analyse items -> validate
 * Item analysis takes the inference result because it asks a leave-one-out
 * question of it. Validation takes the planted truth, which nothing upstream of
 * it is permitted to see.
 *
 * Nothing here knows what subject is loaded.
 */

import { allPacks, getPack, addPack, defaultPack } from './packs/index.js';
import { correctIndex, misById, validatePack } from './pack.js';
import { generateClass, totalScores } from './simulate.js';
import { inferMisconceptions, diagnose, prevalence, PARAMS } from './infer.js';
import { clusterStudents, describeClusters } from './cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha, interpretAlpha, severityOf } from './itemstats.js';
import { scoreDiagnosis, scoreClustering, confusion, fmtPct } from './validate.js';
import { setKey, rewritePlan } from './llm.js';
import { generatePack } from './generate.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const ROW_H = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row'), 10) || 19;

/** Misconception id -> stable colour slot, assigned per pack in declared order. */
let colourOf = {};
function assignColours(pack) {
  colourOf = {};
  pack.misconceptions.forEach((m, i) => { colourOf[m.id] = `var(--m${(i % 12) + 1})`; });
}

const state = {
  pack: null, cls: null, inf: null, cl: null, groups: null,
  stats: null, sorted: false, rows: [], apiKey: null
};

/* ======================================================================== */
/*  Run                                                                     */
/* ======================================================================== */

function run() {
  const pack = state.pack;
  const seed = Math.max(1, parseInt($('#seed').value, 10) || 7);
  const size = Math.min(120, Math.max(12, parseInt($('#size').value, 10) || 28));

  assignColours(pack);

  const cls = generateClass(pack, { seed, size });
  const inf = inferMisconceptions(pack, cls.responses);
  const cl = clusterStudents(inf.posterior, { seed: 42 });
  const groups = describeClusters(inf.posterior, cl.labels, inf.misIds, cl);
  const stats = analyseItems(pack, cls.responses, inf);

  Object.assign(state, { cls, inf, cl, groups, stats, sorted: false });

  renderPackLine();
  renderSummary();
  renderMatrix();
  renderGroups();
  renderItems();
  renderValidation();
  renderMethod();

  $('#reorder').textContent = 'Sort into failure modes';
}

function renderPackLine() {
  const { pack, cls } = state;
  const line = $('#pack-line');
  line.textContent =
    `${pack.name} · ${pack.subject}${pack.level ? ' · ' + pack.level : ''} — ` +
    `${pack.misconceptions.length} misconceptions · ${pack.items.length} items · ` +
    `class seed ${cls.meta.seed}`;
  if (pack.source === 'generated') {
    line.appendChild(el('span', 'gen-flag', 'generated this session'));
  }
}

/* ======================================================================== */
/*  Summary strip                                                           */
/* ======================================================================== */

function renderSummary() {
  const { pack, cls, inf, cl, groups, stats } = state;
  const host = $('#summary');
  host.innerHTML = '';

  const real = groups.filter(g => !g.isSecure);
  const secure = groups.find(g => g.isSecure);
  const biggest = real[0];
  const prev = prevalence(inf.posterior, inf.misIds)[0];
  const bad = problemItems(stats);
  const scores = totalScores(pack, cls.responses);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const cards = [
    { v: String(cls.students.length), k: 'students analysed' },
    { v: String(real.length), k: `shared failure mode${real.length === 1 ? '' : 's'}`, cls: 'ok' },
    { v: biggest ? `${biggest.size}` : '—',
      k: biggest ? `largest group · ${biggest.signature[0]?.id ?? ''}` : 'no groups found' },
    { v: prev ? `${Math.round(prev.expected)}` : '—',
      k: prev ? `hold ${prev.id} · most prevalent` : 'no misconception found' },
    { v: `${Math.round((avg / pack.items.length) * 100)}%`, k: 'class average' },
    { v: String(bad.length), k: `question${bad.length === 1 ? '' : 's'} to review`,
      cls: bad.length ? 'warn' : 'ok' },
    { v: secure ? String(secure.size) : '0', k: 'no stable misconception' }
  ];

  cards.forEach(c => {
    const n = el('div', 'sum');
    n.appendChild(el('div', `sum-v${c.cls ? ' ' + c.cls : ''}`, c.v));
    const k = el('div', 'sum-k', c.k);
    k.title = c.k;
    n.appendChild(k);
    host.appendChild(n);
  });
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
    r.appendChild(el('span', 'm-name', cls.students[s].name));

    row.forEach((choice, i) => {
      const item = pack.items[i];
      const c = el('span', 'm-cell');
      let what;
      if (choice === ci[i]) {
        what = 'correct';
      } else {
        const mis = item.opts[choice].mis;
        if (mis) { c.style.background = colourOf[mis]; what = mis; }
        else { c.classList.add('slip'); what = 'slip, no pattern'; }
      }
      c.title = `${cls.students[s].name} · ${item.id} — chose "${item.opts[choice].t}" (${what})`;
      r.appendChild(c);
    });

    r.appendChild(el('span', 'm-score', `${scores[s]}/${pack.items.length}`));
    host.appendChild(r);
    state.rows.push(r);
  });

  host.style.height = `${cls.responses.length * ROW_H() + 6}px`;
  layout(cls.responses.map((_, i) => i));
  renderLegend();

  $('#matrix-note').textContent =
    'Rows are in roll order, which is to say arbitrary. The structure is already in this picture — it is just not visible yet.';
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

    const tag = el('div', 'band-tag', b.g.isSecure ? 'secure' : (b.g.signature[0]?.id ?? ''));
    tag.style.top = `${b.start * h - 1}px`;
    host.appendChild(tag);

    // A timer rather than requestAnimationFrame: rAF is suspended while the tab
    // is backgrounded, which would leave these permanently invisible instead of
    // merely un-animated.
    setTimeout(() => { bar.classList.add('on'); tag.classList.add('on'); }, 30);
  });

  const real = state.groups.filter(g => !g.isSecure);
  $('#matrix-note').textContent =
    `Same data, rows reordered by inferred profile. ${state.cls.students.length} students, ` +
    `${real.length} shared failure mode${real.length === 1 ? '' : 's'} — the vertical stripes are the ` +
    `questions where a whole group answered the same wrong way for the same reason.`;
}

function toggleSort() {
  const btn = $('#reorder');
  const host = $('#matrix');

  if (!state.sorted) {
    sortRows();
    state.sorted = true;
    btn.textContent = 'Back to roll order';
  } else {
    host.classList.remove('sorted');
    host.querySelectorAll('.band, .band-tag').forEach(n => n.classList.remove('on'));
    layout(state.cls.responses.map((_, i) => i));
    state.sorted = false;
    btn.textContent = 'Sort into failure modes';
    $('#matrix-note').textContent =
      'Rows are in roll order, which is to say arbitrary. The structure is already in this picture — it is just not visible yet.';
    setTimeout(() => host.querySelectorAll('.band, .band-tag').forEach(n => n.remove()), 480);
  }
}

function renderLegend() {
  const host = $('#legend');
  host.innerHTML = '';
  const byId = misById(state.pack);

  prevalence(state.inf.posterior, state.inf.misIds).forEach(p => {
    const m = byId[p.id];
    if (!m) return;
    const n = el('span', 'leg');
    const sw = el('span', 'sw');
    sw.style.background = colourOf[p.id];
    n.appendChild(sw);
    n.appendChild(el('span', 'leg-n', p.id));
    n.appendChild(el('span', null, m.short || m.name));
    n.title = m.belief || m.name;
    host.appendChild(n);
  });

  [[ 'var(--correct)', 'correct' ], [ 'var(--slip)', 'wrong, but no pattern' ]].forEach(([bg, label]) => {
    const n = el('span', 'leg');
    const sw = el('span', 'sw');
    sw.style.background = bg;
    n.appendChild(sw);
    n.appendChild(el('span', null, label));
    host.appendChild(n);
  });
}

/* ======================================================================== */
/*  Failure modes                                                           */
/* ======================================================================== */

function renderGroups() {
  const host = $('#groups');
  host.innerHTML = '';

  const real = state.groups.filter(g => !g.isSecure);
  const secure = state.groups.find(g => g.isSecure);
  const n = state.cls.students.length;

  $('#groups-sub').textContent =
    `${n} students, but not ${n} problems. Clustering the inferred profiles finds ` +
    `${real.length} shared failure mode${real.length === 1 ? '' : 's'}` +
    (secure ? `, plus ${secure.size} student${secure.size === 1 ? '' : 's'} with no stable misconception.` : '.') +
    ` Silhouette ${state.cl.silhouette.toFixed(2)}; groups below ${state.cl.minClusterSize ?? 3} students are not reported as failure modes.`;

  state.groups.forEach(g => host.appendChild(groupCard(g)));
}

function groupCard(g) {
  const byId = misById(state.pack);
  const card = el('div', `group${g.isSecure ? ' secure' : ''}`);
  const total = state.cls.students.length;

  const top = el('div', 'group-top');
  if (!g.isSecure && g.signature[0]) card.style.setProperty('--gc', colourOf[g.signature[0].id]);

  const nline = el('div', 'group-n');
  nline.appendChild(el('span', null, `${g.size} student${g.size === 1 ? '' : 's'}`));
  nline.appendChild(el('span', null, `${Math.round((g.size / total) * 100)}%`));
  top.appendChild(nline);

  if (g.isSecure) {
    top.appendChild(el('h3', null, 'No stable misconception'));
    card.appendChild(top);
    const body = el('div', 'group-body');
    body.appendChild(el('p', 'belief',
      'These students make mistakes, but the mistakes do not repeat and do not point anywhere. That is a slip profile rather than a failure mode: it calls for practice, not reteaching.'));
    body.appendChild(roster(g));
    card.appendChild(body);
    return card;
  }

  const details = g.signature.slice(0, 4).map(s => byId[s.id]).filter(Boolean);
  g.misDetails = details;

  const h = el('h3', null, g.aiPlan?.headline || details[0]?.name || 'Shared misconception');
  if (g.aiPlan) h.appendChild(el('span', 'pill pill-ai', 'adapted'));
  top.appendChild(h);

  const chips = el('div', 'chips');
  g.signature.slice(0, 4).forEach(s => {
    const c = el('span', 'chip');
    const sw = el('span', 'sw');
    sw.style.background = colourOf[s.id];
    c.appendChild(sw);
    c.appendChild(el('span', null, `${s.id} ${Math.round(s.inMean * 100)}%`));
    const m = byId[s.id];
    c.title = `${m?.name ?? s.id} — mean probability ${s.inMean.toFixed(2)} in this group against ${s.outMean.toFixed(2)} elsewhere`;
    chips.appendChild(c);
  });
  top.appendChild(chips);
  card.appendChild(top);

  const body = el('div', 'group-body');
  if (details[0]?.belief) body.appendChild(el('p', 'belief', details[0].belief));

  body.appendChild(el('div', 'lab accent', g.aiPlan ? 'Reteach — adapted for this group' : 'Reteach'));
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
  return el('div', 'roster', g.members.map(m => state.cls.students[m].name).join(', '));
}

/* ======================================================================== */
/*  Test quality                                                            */
/* ======================================================================== */

function renderItems() {
  const { pack, stats, cls } = state;
  const host = $('#items');
  host.innerHTML = '';

  const bad = problemItems(stats);
  const diag = diagnosticItems(stats);
  const strong = stats.filter(s => s.quality === 'strong').length;

  $('#items-sub').textContent =
    `The same response matrix scores your questions. ${strong} of ${pack.items.length} items discriminate well; ` +
    `${bad.length} have a problem worth looking at. These are computed statistics, not opinions.`;

  bad.slice(0, 4).forEach(s => host.appendChild(itemCard(s)));

  if (bad.length > 4) {
    const extra = bad.length - 4;
    host.appendChild(el('p', 'note',
      `${extra} further item${extra === 1 ? '' : 's'} carry a marginal flag, mostly low discrimination — which at ${cls.students.length} students is often just sample noise. The ones above are ranked by severity.`));
  }

  const box = $('#defended');
  box.innerHTML = '';
  if (diag.length) {
    box.appendChild(el('h4', null,
      `${diag.length} item${diag.length === 1 ? '' : 's'} look weak by the usual statistic, and should be kept anyway`));
    box.appendChild(el('p', null,
      'Point-biserial discrimination asks whether students who did well overall also got this item right, which presumes the test measures one underlying thing. A diagnostic instrument deliberately does not. An item targeting a misconception held by one group is missed by that group whatever their ability elsewhere, so it can correlate weakly — even negatively — with total score while being the most informative question on the page.'));
    box.appendChild(el('p', 'mono',
      diag.slice(0, 4).map(d => `${d.id} r=${d.discrimination.toFixed(2)} agreement=${Math.round(d.modelAgreement * 100)}%`).join('   ')));
  }

  $('#alpha-note').textContent =
    `Cronbach's alpha across the whole instrument: ${interpretAlpha(cronbachAlpha(pack, cls.responses))}`;
}

function itemCard(s) {
  const card = el('div', `item ${s.quality}`);

  const top = el('div', 'item-top');
  const stem = el('div', 'item-stem');
  stem.appendChild(el('span', 'item-id', s.id));
  stem.appendChild(el('span', null, s.stem));
  top.appendChild(stem);

  const st = el('div', 'item-stats');
  st.innerHTML = `difficulty <b>${s.difficulty.toFixed(2)}</b> &nbsp; discrimination <b>${s.discrimination.toFixed(2)}</b>`;
  top.appendChild(st);
  card.appendChild(top);

  const flags = el('ul', 'flags');
  s.flags.forEach(f => {
    flags.appendChild(el('li', severityOf({ flags: [f] }) <= 1 ? 'minor' : null, f.text));
  });
  card.appendChild(flags);

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
    row.appendChild(el('span', 'bar-c', `${o.count} · ${Math.round(o.share * 100)}%`));
    bars.appendChild(row);
  });
  card.appendChild(bars);

  return card;
}

/* ======================================================================== */
/*  Validation                                                              */
/* ======================================================================== */

function renderValidation() {
  const { inf, cls, cl } = state;
  const dq = scoreDiagnosis(diagnose(inf.posterior, inf.misIds), cls.truth, inf.misIds);
  const cq = scoreClustering(cl.labels, cls.truth);

  const host = $('#metrics');
  host.innerHTML = '';

  [
    { v: fmtPct(dq.recall), k: 'misconceptions found',
      x: `Of every misconception actually planted in a student, ${fmtPct(dq.recall)} were recovered from their answers alone.` },
    { v: fmtPct(dq.precision), k: 'diagnoses correct',
      x: `Of every misconception attributed to a student, ${fmtPct(dq.precision)} were genuinely there. The rest are false accusations.` },
    { v: dq.f1.toFixed(2), k: 'F1',
      x: 'Harmonic mean of the two — one number for the quality of the per-student diagnosis.' },
    { v: cq.ari.toFixed(2), k: 'group recovery (ARI)',
      x: `Adjusted Rand index against the ${cq.plantedGroups} planted profiles. 1.00 is exact agreement, 0.00 is chance.` }
  ].forEach(m => {
    const c = el('div', 'metric');
    c.appendChild(el('div', 'metric-v', m.v));
    c.appendChild(el('div', 'metric-k', m.k));
    c.appendChild(el('div', 'metric-x', m.x));
    host.appendChild(c);
  });

  const { table, plantedIds } = confusion(cl.labels, cls.truth);
  const wrap = $('#confusion');
  wrap.innerHTML = '';

  const t = el('table');
  t.appendChild(el('caption', null,
    'Discovered groups against the profiles the generator planted. One clear winner per row means the clustering rediscovered structure it was never told about.'));

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, ''));
  plantedIds.forEach(p => hr.appendChild(el('th', null, `planted ${p}`)));
  thead.appendChild(hr);
  t.appendChild(thead);

  const tb = el('tbody');
  table.forEach((row, i) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, i === cl.secureLabel ? 'secure' : `group ${i}`));
    const max = Math.max(...row);
    row.forEach(v => tr.appendChild(el('td', v === max && v > 0 ? 'hot' : null, String(v))));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
}

function renderMethod() {
  $('#formula').textContent =
    'logit P(holds m | responses) = logit P(m) + Σᵢ log [ P(rᵢ | m) / P(rᵢ | ¬m) ]';
  $('#params').textContent =
    `prior ${PARAMS.prior} · P(distractor | holds) ${PARAMS.express} · P(correct | not holds) ${PARAMS.baseCorrect} · decision threshold ${PARAMS.decisionThreshold}`;
}

/* ======================================================================== */
/*  Pack selection                                                          */
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
  state.pack = getPack(id);
  renderPackOptions(state.pack.id);
  run();
}

/* ======================================================================== */
/*  Generate a new subject                                                  */
/* ======================================================================== */

function openModal() {
  $('#modal-err').textContent = '';
  $('#modal-progress').hidden = true;
  $('#modal-progress').innerHTML = '';
  $('#modal-go').disabled = false;
  $('#modal-go').textContent = 'Build it';
  if (state.apiKey) $('#api-key').value = state.apiKey;
  $('#modal').hidden = false;
  $('#topic').focus();
}

function closeModal() { $('#modal').hidden = true; }

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
  if (!key) { err.textContent = 'An API key is needed to build a new subject. The built-in subjects need no key.'; return; }

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
      progressStep(`Validated with ${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}.`, 'done');
    }
    progressStep(`Ready — ${pack.misconceptions.length} misconceptions, ${pack.items.length} items, ${attempts} pass${attempts === 1 ? '' : 'es'}.`, 'done');

    addPack(pack);
    setTimeout(() => {
      closeModal();
      switchPack(pack.id);
    }, 700);
  } catch (e) {
    err.textContent = e.message;
    go.disabled = false;
    go.textContent = 'Try again';
  }
}

/* ======================================================================== */
/*  Optional plan adaptation                                                */
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
  btn.textContent = 'Adapting…';

  const real = state.groups.filter(g => !g.isSecure);
  const results = await Promise.all(real.map(g =>
    rewritePlan(g, state.cls.students.length).catch(e => ({ _error: e.message }))
  ));

  let ok = 0;
  results.forEach((p, i) => { if (!p._error) { real[i].aiPlan = p; ok++; } });
  renderGroups();

  btn.disabled = false;
  btn.textContent = ok === real.length ? 'Adapted for this class' : `Adapted ${ok} of ${real.length}`;
  setTimeout(() => { btn.textContent = 'Adapt plans with AI'; }, 5000);
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
  // matrix goes from display:none back to visible at a possibly new width.
  if (name === 'matrix' && state.cls) {
    layout(state.sorted ? state.groups.flatMap(g => g.members) : state.cls.responses.map((_, i) => i));
  }
}

/* ======================================================================== */
/*  Wiring                                                                  */
/* ======================================================================== */

$('#run').addEventListener('click', run);
$('#reorder').addEventListener('click', toggleSort);
$('#pack').addEventListener('change', e => switchPack(e.target.value));
$('#new-subject').addEventListener('click', openModal);
$('#regen').addEventListener('click', adaptPlans);
$('#modal-cancel').addEventListener('click', closeModal);
$('#modal-go').addEventListener('click', doGenerate);
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
$('#topic').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });
$('#api-key').addEventListener('keydown', e => { if (e.key === 'Enter') doGenerate(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

[$('#seed'), $('#size')].forEach(inp =>
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));

window.addEventListener('resize', () => {
  if (!state.cls) return;
  layout(state.sorted ? state.groups.flatMap(g => g.members) : state.cls.responses.map((_, i) => i));
});

/**
 * The tab strip sticks directly beneath the app bar, so it needs the bar's real
 * height. Hard-coding it is wrong twice over: it drifts when the webfont
 * settles, and the bar wraps to two or three rows at narrow widths. Measure it
 * instead, and keep measuring.
 */
function syncBarHeight() {
  const h = Math.round($('.bar').getBoundingClientRect().height);
  // Reject readings taken mid-reflow: a zero or absurd height would pin the tab
  // strip somewhere useless and there is no later event guaranteed to correct it.
  if (h < 30 || h > 400) return;
  document.documentElement.style.setProperty('--bar-h', `${h}px`);
}
syncBarHeight();
if ('ResizeObserver' in window) new ResizeObserver(syncBarHeight).observe($('.bar'));
if (document.fonts?.ready) document.fonts.ready.then(syncBarHeight);
// ResizeObserver can be throttled while the tab is not compositing, and the bar
// re-wraps at narrow widths, so pair it with the resize event rather than
// trusting either alone.
window.addEventListener('resize', syncBarHeight);
window.addEventListener('orientationchange', syncBarHeight);
window.addEventListener('load', syncBarHeight);

state.pack = defaultPack();
renderPackOptions(state.pack.id);
run();
