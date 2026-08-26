/**
 * app.js -- orchestration and rendering.
 *
 * Pipeline order matters and is worth stating once:
 *   generate -> infer -> cluster -> analyse items -> validate -> render
 * Item analysis takes the inference result because it asks a leave-one-out
 * question of it; validation takes the planted truth, which nothing upstream
 * of it is allowed to see.
 */

import { MISCONCEPTIONS, MIS_BY_ID, ITEMS, correctIndex } from './curriculum.js';
import { generateClass, totalScores } from './simulate.js';
import { inferMisconceptions, diagnose, prevalence, PARAMS } from './infer.js';
import { clusterStudents, describeClusters } from './cluster.js';
import { analyseItems, problemItems, diagnosticItems, cronbachAlpha, interpretAlpha, severityOf } from './itemstats.js';
import { scoreDiagnosis, scoreClustering, confusion, fmtPct } from './validate.js';
import { setKey, rewritePlan } from './llm.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const ROW_H = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row'), 10) || 18;

const state = {
  cls: null, inference: null, cluster: null, clusters: null,
  stats: null, sorted: false, rows: []
};

/* ======================================================================== */
/*  Run the pipeline                                                        */
/* ======================================================================== */

function run() {
  const seed = Math.max(1, parseInt($('#seed').value, 10) || 7);
  const size = Math.min(120, Math.max(12, parseInt($('#size').value, 10) || 28));

  const cls = generateClass({ seed, size });
  const inference = inferMisconceptions(cls.responses);
  const cluster = clusterStudents(inference.posterior, { seed: 42 });
  const clusters = describeClusters(inference.posterior, cluster.labels, inference.misIds, cluster);
  const stats = analyseItems(cls.responses, inference);

  Object.assign(state, { cls, inference, cluster, clusters, stats, sorted: false });

  $('#provenance').textContent =
    `class seed ${seed} · ${size} students · ${ITEMS.length} items · ${MISCONCEPTIONS.length} misconceptions · analysis runs in-browser`;

  renderLegend();
  renderMatrix();
  renderClusters();
  renderItems();
  renderValidation();
  renderParams();

  $('#reorder').disabled = false;
  $('#reorder').textContent = 'Sort into failure modes';
  $('#clusters-panel').hidden = false;
  $('#items-panel').hidden = false;
  $('#validation-panel').hidden = false;

  $('#matrix-caption').textContent =
    'Every wrong answer here is a specific claim about what the student believes. Right now the rows are in roll order, which is to say random — the structure is present but invisible.';
}

/* ======================================================================== */
/*  Matrix                                                                  */
/* ======================================================================== */

function cellClassFor(itemIndex, choice) {
  const item = ITEMS[itemIndex];
  if (choice === correctIndex(item)) return { cls: 'm-cell', style: '' };
  const mis = item.opts[choice].mis;
  if (!mis) return { cls: 'm-cell slip', style: '' };
  return { cls: 'm-cell', style: `background: var(--m-${mis})` };
}

function renderMatrix() {
  const host = $('#matrix');
  host.innerHTML = '';
  host.classList.remove('sorted');

  const { cls } = state;
  const scores = totalScores(cls.responses);
  state.rows = [];

  cls.responses.forEach((row, s) => {
    const r = el('div', 'm-row');
    r.appendChild(el('span', 'm-name', cls.students[s].name));
    row.forEach((choice, i) => {
      const { cls: cc, style } = cellClassFor(i, choice);
      const c = el('span', cc);
      if (style) c.setAttribute('style', style);
      c.title = `${cls.students[s].name} · ${ITEMS[i].id}: chose "${ITEMS[i].opts[choice].t}"`;
      r.appendChild(c);
    });
    r.appendChild(el('span', 'm-score', `${scores[s]}/${ITEMS.length}`));
    host.appendChild(r);
    state.rows.push(r);
  });

  host.style.height = `${cls.responses.length * ROW_H() + 8}px`;
  layoutRows(cls.responses.map((_, i) => i));
}

function layoutRows(order) {
  const h = ROW_H();
  order.forEach((studentIndex, position) => {
    state.rows[studentIndex].style.transform = `translateY(${position * h}px)`;
  });
}

function sortIntoClusters() {
  const host = $('#matrix');
  const order = [];
  const bands = [];

  state.clusters.forEach(c => {
    const start = order.length;
    c.members.forEach(m => order.push(m));
    bands.push({ cluster: c, start, count: c.members.length });
  });

  layoutRows(order);
  host.classList.add('sorted');

  // Band markers appear after the rows have travelled.
  host.querySelectorAll('.band, .band-label').forEach(n => n.remove());
  const h = ROW_H();
  bands.forEach(b => {
    const colour = b.cluster.isSecure
      ? 'var(--good)'
      : `var(--m-${b.cluster.signature[0]?.id ?? 'M01'})`;

    const bar = el('div', 'band');
    bar.style.top = `${b.start * h + 2}px`;
    bar.style.height = `${b.count * h - 6}px`;
    bar.style.background = colour;
    host.appendChild(bar);

    const label = el('div', 'band-label',
      b.cluster.isSecure ? 'secure' : (b.cluster.signature[0]?.id ?? ''));
    label.style.top = `${b.start * h - 1}px`;
    host.appendChild(label);

    // A timer, not requestAnimationFrame: rAF is suspended while the tab is
    // backgrounded or not compositing, which would leave the band markers
    // permanently invisible rather than merely un-animated. The short delay
    // still gives the browser a frame to register opacity:0 so the fade runs.
    setTimeout(() => { bar.classList.add('on'); label.classList.add('on'); }, 30);
  });

  state.rows.forEach(r => r.classList.add('in-cluster'));

  const real = state.clusters.filter(c => !c.isSecure);
  $('#matrix-caption').textContent =
    `Same data, rows reordered. ${state.cls.students.length} students, ${real.length} shared failure mode${real.length === 1 ? '' : 's'} — the vertical stripes are the columns where a whole group answered the same wrong way for the same reason.`;
}

function toggleSort() {
  const btn = $('#reorder');
  if (!state.sorted) {
    sortIntoClusters();
    state.sorted = true;
    btn.textContent = 'Back to roll order';
  } else {
    $('#matrix').classList.remove('sorted');
    $('#matrix').querySelectorAll('.band, .band-label').forEach(n => n.classList.remove('on'));
    state.rows.forEach(r => r.classList.remove('in-cluster'));
    layoutRows(state.cls.responses.map((_, i) => i));
    state.sorted = false;
    btn.textContent = 'Sort into failure modes';
    setTimeout(() => $('#matrix').querySelectorAll('.band, .band-label').forEach(n => n.remove()), 500);
  }
}

function renderLegend() {
  const host = $('#legend');
  host.innerHTML = '';

  const prev = prevalence(state.inference.posterior, state.inference.misIds);
  const order = prev.map(p => p.id);

  order.forEach(id => {
    const m = MIS_BY_ID[id];
    const item = el('span', 'legend-item');
    const sw = el('span', 'swatch');
    sw.style.background = `var(--m-${id})`;
    item.appendChild(sw);
    item.appendChild(el('span', null, `${id} ${m.short}`));
    item.title = m.belief;
    host.appendChild(item);
  });

  [['var(--cell-correct)', 'correct'], ['var(--cell-slip)', 'wrong, but no pattern (slip)']].forEach(([bg, label]) => {
    const item = el('span', 'legend-item');
    const sw = el('span', 'swatch');
    sw.style.background = bg;
    item.appendChild(sw);
    item.appendChild(el('span', null, label));
    host.appendChild(item);
  });
}

/* ======================================================================== */
/*  Clusters                                                                */
/* ======================================================================== */

function renderClusters() {
  const host = $('#clusters');
  host.innerHTML = '';

  const real = state.clusters.filter(c => !c.isSecure);
  const secure = state.clusters.find(c => c.isSecure);

  $('#clusters-sub').textContent =
    `${state.cls.students.length} students, but not ${state.cls.students.length} problems. ` +
    `Clustering the inferred profiles finds ${real.length} shared failure mode${real.length === 1 ? '' : 's'}` +
    (secure ? `, plus ${secure.size} student${secure.size === 1 ? '' : 's'} with no stable misconception at all.` : '.') +
    ` Silhouette ${state.cluster.silhouette.toFixed(2)}.`;

  state.clusters.forEach((c, idx) => host.appendChild(clusterCard(c, idx)));
}

function clusterCard(c, idx) {
  const card = el('div', `cluster${c.isSecure ? ' secure' : ''}`);
  if (!c.isSecure && c.signature[0]) {
    card.style.setProperty('--cl', `var(--m-${c.signature[0].id})`);
  }

  card.appendChild(el('div', 'cluster-size',
    `${c.size} student${c.size === 1 ? '' : 's'} · ${Math.round(100 * c.size / state.cls.students.length)}% of class`));

  if (c.isSecure) {
    card.appendChild(el('h3', null, 'No stable misconception'));
    const p = el('p', 'belief',
      'These students make mistakes, but the mistakes do not repeat and do not point anywhere. That is a slip profile, not a failure mode, and it needs practice rather than reteaching.');
    card.appendChild(p);
    card.appendChild(memberList(c));
    return card;
  }

  const details = c.signature.slice(0, 4).map(s => MIS_BY_ID[s.id]).filter(Boolean);
  c.misDetails = details;

  const headline = c.aiPlan?.headline || details[0]?.name || 'Shared misconception';
  const h = el('h3', null, headline);
  if (c.aiPlan) h.appendChild(el('span', 'ai-badge', 'AI-adapted'));
  card.appendChild(h);

  const sig = el('div', 'sig');
  c.signature.slice(0, 4).forEach(s => {
    const chip = el('span', 'chip');
    const sw = el('span', 'swatch');
    sw.style.background = `var(--m-${s.id})`;
    chip.appendChild(sw);
    chip.appendChild(el('span', null, `${s.id} · ${Math.round(s.inMean * 100)}%`));
    chip.title = `${MIS_BY_ID[s.id].name} — mean posterior ${s.inMean.toFixed(2)} in this group vs ${s.outMean.toFixed(2)} elsewhere`;
    sig.appendChild(chip);
  });
  card.appendChild(sig);

  if (details[0]) card.appendChild(el('p', 'belief', details[0].belief));

  card.appendChild(el('div', 'reteach-h', c.aiPlan ? 'Reteach — adapted for this group' : 'Reteach'));
  card.appendChild(el('p', 'reteach', c.aiPlan?.plan || details[0]?.reteach || ''));

  card.appendChild(el('div', 'reteach-h', 'Check it landed'));
  const ul = el('ul', 'verify');
  (c.aiPlan?.verify || details[0]?.verify || []).forEach(v => ul.appendChild(el('li', null, v)));
  card.appendChild(ul);

  card.appendChild(memberList(c));
  return card;
}

function memberList(c) {
  const names = c.members.map(m => state.cls.students[m].name).join(', ');
  return el('div', 'members', names);
}

/* ======================================================================== */
/*  Item analysis                                                           */
/* ======================================================================== */

function renderItems() {
  const host = $('#items');
  host.innerHTML = '';

  const bad = problemItems(state.stats);
  const diag = diagnosticItems(state.stats);
  const strong = state.stats.filter(s => s.quality === 'strong').length;

  $('#items-sub').textContent =
    `The same response matrix scores your questions. ${strong} of ${ITEMS.length} items are discriminating well; ` +
    `${bad.length} have a problem worth looking at. These are computed statistics, not opinions.`;

  bad.slice(0, 4).forEach(s => host.appendChild(itemCard(s)));

  if (bad.length > 4) {
    const more = el('p', 'caption',
      `${bad.length - 4} further item${bad.length - 4 === 1 ? '' : 's'} carry a marginal flag — mostly low discrimination, which at ${state.cls.students.length} students is often just sample noise. The four above are the ones with a real defect.`);
    host.appendChild(more);
  }

  const note = $('#diagnostic-items');
  note.innerHTML = '';
  if (diag.length) {
    note.appendChild(el('h4', null, `${diag.length} item${diag.length === 1 ? '' : 's'} look weak by the usual statistic, and should be kept anyway`));
    note.appendChild(el('p', null,
      'Point-biserial discrimination asks whether students who did well overall also got this item right. That presumes the test measures one thing. This one does not: an item targeting a misconception held by a single group will be missed by that group whatever their ability elsewhere, so it can correlate weakly — even negatively — with total score while being the most informative question on the page.'));
    note.appendChild(el('p', null,
      diag.slice(0, 3).map(d => `${d.id} (r = ${d.discrimination.toFixed(2)}, ${Math.round(d.modelAgreement * 100)}% model agreement)`).join(', ') + '.'));
  }

  const alpha = cronbachAlpha(state.cls.responses);
  $('#alpha-caption').textContent = `Cronbach's alpha across the whole instrument: ${interpretAlpha(alpha)}`;
}

function itemCard(s) {
  const card = el('div', `item ${s.quality}`);

  const stem = el('div', 'item-stem');
  stem.appendChild(el('span', 'item-id', s.id));
  stem.appendChild(el('span', null, s.stem));
  card.appendChild(stem);

  const stats = el('div', 'item-stats');
  stats.innerHTML =
    `difficulty <b>${s.difficulty.toFixed(2)}</b><br>discrimination <b>${s.discrimination.toFixed(2)}</b>`;
  card.appendChild(stats);

  const flags = el('ul', 'item-flags');
  s.flags.forEach(f => {
    const li = el('li', severityOf({ flags: [f] }) <= 1 ? 'sev-1' : null, f.text);
    flags.appendChild(li);
  });
  card.appendChild(flags);

  const bars = el('div', 'opt-bars');
  s.options.forEach(o => {
    const row = el('div', `opt-row${o.correct ? ' correct' : ''}`);
    row.appendChild(el('span', 'opt-text', o.text));
    const track = el('span', 'opt-track');
    const fill = el('span', 'opt-fill');
    fill.style.width = `${Math.max(1, o.share * 100)}%`;
    if (o.mis) fill.style.background = `var(--m-${o.mis})`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'opt-count', `${o.count} · ${Math.round(o.share * 100)}%`));
    bars.appendChild(row);
  });
  card.appendChild(bars);

  return card;
}

/* ======================================================================== */
/*  Validation                                                              */
/* ======================================================================== */

function renderValidation() {
  const { inference, cls, cluster } = state;
  const diagnosed = diagnose(inference.posterior, inference.misIds);
  const dq = scoreDiagnosis(diagnosed, cls.truth, inference.misIds);
  const cq = scoreClustering(cluster.labels, cls.truth);

  const host = $('#validation');
  host.innerHTML = '';

  const metrics = [
    { val: fmtPct(dq.recall), lbl: 'misconceptions found',
      exp: `Of every misconception actually planted in a student, ${fmtPct(dq.recall)} were recovered from their answers alone.` },
    { val: fmtPct(dq.precision), lbl: 'diagnoses correct',
      exp: `Of every misconception the system attributed to a student, ${fmtPct(dq.precision)} were genuinely there. The rest are false accusations.` },
    { val: dq.f1.toFixed(2), lbl: 'F1',
      exp: 'Harmonic mean of the two. One number for how good the per-student diagnosis is.' },
    { val: cq.ari.toFixed(2), lbl: 'cluster recovery (ARI)',
      exp: `Adjusted Rand index between the discovered groups and the ${cq.plantedGroups} planted archetypes. 1.0 is exact; 0.0 is chance.` }
  ];

  metrics.forEach(m => {
    const card = el('div', 'metric');
    card.appendChild(el('div', 'val', m.val));
    card.appendChild(el('div', 'lbl', m.lbl));
    card.appendChild(el('div', 'exp', m.exp));
    host.appendChild(card);
  });

  const { table, plantedIds } = confusion(cluster.labels, cls.truth);
  const wrap = $('#confusion');
  wrap.innerHTML = '';
  const t = el('table');
  const cap = el('caption', null,
    'Discovered groups against planted archetypes. A clean diagonal means the clustering rediscovered the structure the generator put there.');
  t.appendChild(cap);

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, ''));
  plantedIds.forEach(p => hr.appendChild(el('th', null, `planted ${p}`)));
  thead.appendChild(hr);
  t.appendChild(thead);

  const tb = el('tbody');
  table.forEach((row, i) => {
    const tr = el('tr');
    const isSecure = i === cluster.secureLabel;
    tr.appendChild(el('th', null, isSecure ? 'secure' : `group ${i}`));
    const max = Math.max(...row);
    row.forEach(v => {
      const td = el('td', v === max && v > 0 ? 'hot' : null, String(v));
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
}

function renderParams() {
  $('#params').textContent =
    `prior ${PARAMS.prior} · P(distractor | holds) ${PARAMS.express} · P(correct | not holds) ${PARAMS.baseCorrect} · decision threshold ${PARAMS.decisionThreshold}`;
}

/* ======================================================================== */
/*  Optional AI rewrite                                                     */
/* ======================================================================== */

function openKeyModal() { $('#key-err').textContent = ''; $('#key-modal').hidden = false; $('#api-key').focus(); }
function closeKeyModal() { $('#key-modal').hidden = true; $('#api-key').value = ''; }

async function doRewrite() {
  const key = $('#api-key').value.trim();
  if (!key) { $('#key-err').textContent = 'Paste a key, or cancel — the analysis is already complete without it.'; return; }

  setKey(key);
  closeKeyModal();

  const btn = $('#regen');
  btn.disabled = true;
  btn.textContent = 'Rewriting…';

  const real = state.clusters.filter(c => !c.isSecure);
  try {
    const plans = await Promise.all(real.map(c =>
      rewritePlan(c, state.cls.students.length).catch(e => ({ _error: e.message }))
    ));
    let ok = 0;
    plans.forEach((p, i) => { if (!p._error) { real[i].aiPlan = p; ok++; } });
    renderClusters();
    btn.textContent = ok === real.length
      ? 'Rewritten with Claude'
      : `Rewrote ${ok} of ${real.length}`;
  } catch (e) {
    btn.textContent = 'Rewrite failed';
    console.error(e);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Rewrite plans with AI'; }, 5000);
  }
}

/* ======================================================================== */

$('#run').addEventListener('click', run);
$('#reorder').addEventListener('click', toggleSort);
$('#regen').addEventListener('click', openKeyModal);
$('#key-cancel').addEventListener('click', closeKeyModal);
$('#key-go').addEventListener('click', doRewrite);
$('#api-key').addEventListener('keydown', e => { if (e.key === 'Enter') doRewrite(); });
$('#key-modal').addEventListener('click', e => { if (e.target === $('#key-modal')) closeKeyModal(); });
window.addEventListener('resize', () => {
  if (!state.cls) return;
  const order = state.sorted
    ? state.clusters.flatMap(c => c.members)
    : state.cls.responses.map((_, i) => i);
  layoutRows(order);
});

run();
