/**
 * drawer.js -- inspect one student, or one question.
 * ---------------------------------------------------------------------------
 * The part that makes the analysis trustworthy rather than merely impressive.
 *
 * A tool that tells a teacher "Milo holds the sign-distribution misconception,
 * 87%" and offers no way to check has asked for faith. And a teacher who cannot
 * check will, correctly, ignore it the first time it says something surprising.
 *
 * So every diagnosis opens up. The inference model is a sum of independent
 * log-odds contributions, one per question, which means the reasoning is
 * genuinely decomposable -- not reconstructed after the fact, but the actual
 * arithmetic that produced the number. Each question either pushed the
 * conclusion up or pulled it down, and by how much.
 */

import { correctIndex, misById } from './pack.js';
import { PARAMS } from './infer.js';
import { infoButton } from './explain.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let host = null;
let onCloseCb = null;

function ensureHost() {
  if (host) return host;
  host = el('div', 'drawer');
  host.hidden = true;
  host.innerHTML = '<div class="drawer-scrim"></div><aside class="drawer-panel" role="dialog" aria-modal="true"></aside>';
  document.body.appendChild(host);
  host.querySelector('.drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !host.hidden) closeDrawer(); });
  return host;
}

export function closeDrawer() {
  if (!host || host.hidden) return;
  host.classList.remove('is-open');
  setTimeout(() => { host.hidden = true; }, 200);
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
}

function openWith(node, onClose) {
  ensureHost();
  onCloseCb = onClose || null;
  const panel = host.querySelector('.drawer-panel');
  panel.innerHTML = '';

  const bar = el('div', 'drawer-bar');
  const x = el('button', 'drawer-x', '×');
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', closeDrawer);
  bar.appendChild(x);
  panel.appendChild(bar);
  panel.appendChild(node);

  host.hidden = false;
  panel.scrollTop = 0;
  setTimeout(() => host.classList.add('is-open'), 10);
}

/* ======================================================================== */
/*  Student                                                                 */
/* ======================================================================== */

export function openStudent(ctx, s) {
  const { pack, cls, inf, groups, colourOf } = ctx;
  const byId = misById(pack);
  const student = cls.students[s];
  const ci = pack.items.map(correctIndex);
  const score = cls.responses[s].reduce((n, c, i) => n + (c === ci[i] ? 1 : 0), 0);

  const wrap = el('div', 'dr');

  // --- header --------------------------------------------------------------
  const group = groups.find(g => g.members.includes(s));
  wrap.appendChild(el('div', 'dr-kicker', 'Student'));
  wrap.appendChild(el('h3', 'dr-title', student.name));

  const facts = el('div', 'dr-facts');
  facts.appendChild(fact(`${score}/${pack.items.length}`, 'score'));
  facts.appendChild(fact(`${Math.round((score / pack.items.length) * 100)}%`, 'correct'));
  facts.appendChild(fact(
    group ? (group.isSecure ? 'None' : (group.signature[0]?.id ?? '—')) : '—',
    group && group.isSecure ? 'no stable pattern' : 'main misconception'
  ));
  wrap.appendChild(facts);

  // --- ranked diagnoses ----------------------------------------------------
  const ranked = inf.misIds
    .map((mid, k) => ({ mid, p: inf.posterior[s][k], k }))
    .sort((a, b) => b.p - a.p);

  const acted = ranked.filter(r => r.p >= PARAMS.decisionThreshold);
  const rest = ranked.filter(r => r.p < PARAMS.decisionThreshold && r.p >= 0.12);

  const h = el('div', 'dr-h');
  h.appendChild(el('span', null, acted.length
    ? `${acted.length} misconception${acted.length === 1 ? '' : 's'} identified`
    : 'No misconception identified'));
  h.appendChild(infoButton('confidence'));
  wrap.appendChild(h);

  if (!acted.length) {
    wrap.appendChild(el('p', 'dr-note',
      'This student’s wrong answers do not repeat and do not point anywhere in particular. That is a slip profile: they need practice and attention rather than a reteach.'));
  }

  acted.forEach(r => wrap.appendChild(diagnosisCard(ctx, s, r, byId, colourOf, true)));

  if (rest.length) {
    const more = el('details', 'dr-more');
    more.appendChild(el('summary', null, `${rest.length} weaker signal${rest.length === 1 ? '' : 's'}, below the reporting threshold`));
    rest.forEach(r => more.appendChild(diagnosisCard(ctx, s, r, byId, colourOf, false)));
    wrap.appendChild(more);
  }

  // --- what to do ----------------------------------------------------------
  const top = acted[0] && byId[acted[0].mid];
  if (top) {
    wrap.appendChild(el('div', 'dr-h', 'What to do'));
    wrap.appendChild(el('p', 'dr-plan', top.reteach));
    if (top.verify?.length) {
      wrap.appendChild(el('div', 'dr-sub', 'Check it landed'));
      const ul = el('ul', 'checks');
      top.verify.forEach(v => ul.appendChild(el('li', null, v)));
      wrap.appendChild(ul);
    }
  }

  openWith(wrap, ctx.onClose);
}

function fact(v, k) {
  const n = el('div', 'dr-fact');
  n.appendChild(el('div', 'dr-fact-v', v));
  n.appendChild(el('div', 'dr-fact-k', k));
  return n;
}

function diagnosisCard(ctx, s, r, byId, colourOf, strong) {
  const m = byId[r.mid];
  const card = el('div', `dg${strong ? '' : ' dg-weak'}`);

  const top = el('div', 'dg-top');
  const sw = el('span', 'sw');
  sw.style.background = colourOf[r.mid];
  top.appendChild(sw);
  top.appendChild(el('span', 'dg-name', m ? m.name : r.mid));
  top.appendChild(el('span', 'dg-p', `${Math.round(r.p * 100)}%`));
  card.appendChild(top);

  const meter = el('div', 'dg-meter');
  const fill = el('span', 'dg-fill');
  fill.style.width = `${Math.round(r.p * 100)}%`;
  fill.style.background = colourOf[r.mid];
  meter.appendChild(fill);
  card.appendChild(meter);

  if (m?.belief) card.appendChild(el('p', 'dg-belief', m.belief));

  // --- the audit trail -----------------------------------------------------
  const ev = ctx.inf.evidence[s][r.k];
  const list = el('div', 'ev');
  const evh = el('div', 'ev-h');
  evh.appendChild(el('span', null, 'Why'));
  evh.appendChild(infoButton('evidence'));
  list.appendChild(evh);

  ev.slice()
    .sort((a, b) => Math.abs(b.logOdds) - Math.abs(a.logOdds))
    .forEach(c => {
      const row = el('div', `ev-row ${c.logOdds > 0 ? 'for' : 'against'}`);
      row.appendChild(el('span', 'ev-id', c.itemId));
      const what = c.isCorrect
        ? 'answered correctly'
        : (c.isDiagnostic ? `chose “${c.chose}”` : `chose “${c.chose}” (unrelated slip)`);
      row.appendChild(el('span', 'ev-what', what));
      row.appendChild(el('span', 'ev-w', c.logOdds > 0 ? 'supports' : 'argues against'));
      list.appendChild(row);
    });

  const forN = ev.filter(c => c.logOdds > 0).length;
  list.appendChild(el('p', 'ev-sum',
    `${forN} of ${ev.length} question${ev.length === 1 ? '' : 's'} that test this point to the misconception.`));

  card.appendChild(list);
  return card;
}

/* ======================================================================== */
/*  Question                                                                */
/* ======================================================================== */

export function openQuestion(ctx, i) {
  const { pack, stats, cls, colourOf } = ctx;
  const st = stats[i];
  const item = pack.items[i];
  const byId = misById(pack);

  const wrap = el('div', 'dr');
  wrap.appendChild(el('div', 'dr-kicker', `Question ${item.id}${item.topic ? ' · ' + item.topic : ''}`));
  wrap.appendChild(el('h3', 'dr-title', item.stem));

  const verdict = {
    strong: ['Working well', 'This question separates students who understand from those who do not.'],
    ok: ['Acceptable', 'Not the sharpest question on the paper, but it is doing its job.'],
    diagnostic: ['Diagnosing, not ranking', 'Statistically this looks weak, and it is not. It targets one misconception, so exactly the students who hold that misconception miss it — whatever their ability elsewhere.'],
    minor: ['Minor issue', 'The question works. One of its options is going to waste.'],
    weak: ['Worth rewriting', 'This question is not earning its place on the paper.'],
    broken: ['Measuring backwards', 'Stronger students did worse on this than weaker ones, which usually means the wording misleads.']
  }[st.quality] || ['—', ''];

  const v = el('div', `dr-verdict v-${st.quality}`);
  v.appendChild(el('div', 'dr-verdict-t', verdict[0]));
  v.appendChild(el('div', 'dr-verdict-b', verdict[1]));
  wrap.appendChild(v);

  const facts = el('div', 'dr-facts');
  const d1 = fact(st.difficulty.toFixed(2), 'difficulty');
  d1.querySelector('.dr-fact-k').appendChild(infoButton('difficulty'));
  const d2 = fact(st.discrimination.toFixed(2), 'discrimination');
  d2.querySelector('.dr-fact-k').appendChild(infoButton('discrimination'));
  facts.appendChild(d1);
  facts.appendChild(d2);
  facts.appendChild(fact(`${Math.round(st.difficulty * cls.students.length)}`, 'answered correctly'));
  wrap.appendChild(facts);

  if (st.note) {
    const n = el('div', 'dr-defend');
    n.appendChild(el('span', null, st.note));
    n.appendChild(infoButton('diagnosing'));
    wrap.appendChild(n);
  }

  if (st.flags.length) {
    wrap.appendChild(el('div', 'dr-h', 'Flags'));
    const ul = el('ul', 'flags');
    st.flags.forEach(f => ul.appendChild(el('li', null, f.text)));
    wrap.appendChild(ul);
  }

  // --- who chose what ------------------------------------------------------
  wrap.appendChild(el('div', 'dr-h', 'How the class answered'));
  st.options.forEach(o => {
    const row = el('div', `opt${o.correct ? ' opt-correct' : ''}`);

    const head = el('div', 'opt-head');
    head.appendChild(el('span', 'opt-t', o.text));
    head.appendChild(el('span', 'opt-n', `${o.count} · ${Math.round(o.share * 100)}%`));
    row.appendChild(head);

    const track = el('div', 'opt-track');
    const fill = el('span', 'opt-fill');
    fill.style.width = `${Math.max(1.5, o.share * 100)}%`;
    if (o.correct) fill.style.background = 'var(--accent)';
    else if (o.mis) fill.style.background = colourOf[o.mis];
    track.appendChild(fill);
    row.appendChild(track);

    if (o.correct) {
      row.appendChild(el('div', 'opt-tag', 'Correct answer'));
    } else if (o.mis) {
      const t = el('div', 'opt-tag');
      t.appendChild(el('span', 'opt-mis', o.mis));
      t.appendChild(el('span', null, byId[o.mis]?.name || ''));
      row.appendChild(t);
    } else {
      row.appendChild(el('div', 'opt-tag opt-slip', 'Not linked to a misconception'));
    }

    // Naming the students is the point: this is what turns a statistic into
    // something a teacher can act on before Monday.
    const who = cls.responses
      .map((r, s) => (r[i] === o.index ? cls.students[s].name : null))
      .filter(Boolean);
    if (who.length && !o.correct) {
      row.appendChild(el('div', 'opt-who', who.join(', ')));
    }

    wrap.appendChild(row);
  });

  openWith(wrap, ctx.onClose);
}
