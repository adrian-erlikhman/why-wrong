/**
 * Open a student or question detail panel. Student panels show the evidence
 * behind each estimate so teachers can review how the result was produced.
 */

import { correctIndex, misById } from './pack.js';
import { PARAMS, isTested, untested } from './infer.js';
import { shownFlags } from './itemstats.js';
import { infoButton } from './explain.js';
import { paperOrder } from './importer.js';
import { setMath } from './notation.js';
import { trapTab } from './a11y.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let host = null;
let onCloseCb = null;
let openedFrom = null;

function ensureHost() {
  if (host) return host;
  host = el('div', 'drawer');
  host.hidden = true;
  host.innerHTML = '<div class="drawer-scrim"></div><div class="drawer-panel" role="dialog" aria-modal="true"></div>';
  document.body.appendChild(host);
  host.querySelector('.drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (host.hidden) return;
    if (e.key === 'Escape') closeDrawer();
    else trapTab(host.querySelector('.drawer-panel'), e);
  });
  return host;
}

export function closeDrawer() {
  if (!host || host.hidden) return;
  host.classList.remove('is-open');
  setTimeout(() => { host.hidden = true; }, 200);
  openedFrom?.focus?.();
  openedFrom = null;
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
}

function openWith(node, onClose, label) {
  ensureHost();
  openedFrom = document.activeElement;
  onCloseCb = onClose || null;
  const panel = host.querySelector('.drawer-panel');
  panel.setAttribute('aria-label', label);
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
  x.focus();
  setTimeout(() => host.classList.add('is-open'), 10);
}

/* ======================================================================== */
/*  Student                                                                 */
/* ======================================================================== */

export function openStudent(ctx, s) {
  const { pack, cls, inf, groups, cov, colourOf } = ctx;
  const byId = misById(pack);
  const student = cls.students[s];
  const { answered, total, thin } = cov[s];
  const ci = pack.items.map(correctIndex);
  const score = cls.responses[s].reduce((n, c, i) => n + (c === ci[i] ? 1 : 0), 0);

  const wrap = el('div', 'dr');

  // --- header --------------------------------------------------------------
  const group = groups.find(g => g.members.includes(s));
  wrap.appendChild(el('div', 'dr-kicker', 'Student'));
  wrap.appendChild(el('h3', 'dr-title', student.name));

  const facts = el('div', 'dr-facts');
  facts.appendChild(fact(`${score}/${pack.items.length}`, 'score'));
  if (answered < total) {
    facts.appendChild(fact(`${answered}/${total}`, 'answered'));
  } else {
    facts.appendChild(fact(`${Math.round((score / pack.items.length) * 100)}%`, 'correct'));
  }
  facts.appendChild(fact(
    !group || group.isThin || group.isSecure ? '—' : `Group ${groups.indexOf(group) + 1}`,
    group?.isThin ? 'too few answers' : group?.isSecure ? 'no clear pattern' : 'reteach group'
  ));
  wrap.appendChild(facts);

  // --- ranked diagnoses ----------------------------------------------------
  const ranked = inf.misIds
    .map((mid, k) => ({ mid, p: inf.posterior[s][k], k }))
    .sort((a, b) => b.p - a.p);

  const tested = ranked.filter(r => isTested(inf, s, r.k));
  const acted = tested.filter(r => r.p >= PARAMS.decisionThreshold);
  const rest = tested.filter(r => r.p < PARAMS.decisionThreshold && r.p >= 0.12);

  const h = el('div', 'dr-h');
  h.appendChild(el('span', null, acted.length
    ? `${acted.length} possible misunderstanding${acted.length === 1 ? '' : 's'} indicated`
    : thin ? 'Not enough answers for an estimate' : 'No clear pattern identified'));
  h.appendChild(infoButton('confidence'));
  wrap.appendChild(h);

  if (thin) {
    wrap.appendChild(el('p', 'dr-note dr-warn',
      `This student answered ${answered} of ${total} questions. Blank answers add no evidence, so other misunderstandings may not be visible in this result.`));
  } else if (!acted.length) {
    wrap.appendChild(el('p', 'dr-note', score === answered
      ? 'All recorded answers were correct; this test has not indicated a reteach need.'
      : 'The wrong answers did not form a clear pattern on this test. Review the student’s work or check in with them before deciding what support would help.'));
  }

  // A misunderstanding with its questions left blank has not been ruled out, even
  // when the rest of the paper was answered.
  const notTested = untested(inf, s);
  if (notTested.length && !thin) {
    wrap.appendChild(el('p', 'dr-note dr-warn',
      `Not tested, because too many of its questions were left blank: ${notTested.map(id => byId[id]?.short || id).join(', ')}.`));
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
  if (top?.reteach) {
    wrap.appendChild(el('div', 'dr-h', 'Suggested next step'));
    wrap.appendChild(setMath(el('p', 'dr-plan'), top.reteach));
    if (top.verify?.length) {
      wrap.appendChild(el('div', 'dr-sub', 'Check understanding'));
      const ul = el('ul', 'checks');
      top.verify.forEach(v => ul.appendChild(setMath(el('li'), v)));
      wrap.appendChild(ul);
    }
  }

  openWith(wrap, ctx.onClose, `Student: ${student.name}`);
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

  if (m?.belief) card.appendChild(setMath(el('p', 'dg-belief'), m.belief));

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
      const row = el('div', `ev-row ${c.omitted ? 'blank' : c.logOdds > 0 ? 'for' : 'against'}`);
      row.appendChild(el('span', 'ev-id', c.itemId));
      const what = c.omitted ? 'left blank'
        : c.isCorrect ? 'answered correctly'
        : (c.isDiagnostic ? `chose “${c.chose}”` : `chose “${c.chose}” (not linked to this pattern)`);
      row.appendChild(setMath(el('span', 'ev-what'), what));
      row.appendChild(el('span', 'ev-w', c.omitted ? 'no evidence' : c.logOdds > 0 ? 'supports' : 'argues against'));
      list.appendChild(row);
    });

  const forN = ev.filter(c => c.logOdds > 0).length;
  const blank = ev.filter(c => c.omitted).length;
  const seen = ev.length - blank;
  list.appendChild(el('p', 'ev-sum',
    `${forN} of ${seen} answered question${seen === 1 ? '' : 's'} supported this estimate${blank ? `; ${blank} ${blank === 1 ? 'was' : 'were'} left blank` : ''}.`));

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
  wrap.appendChild(setMath(el('h3', 'dr-title'), item.stem));

  const verdict = {
    strong: ['Tracks overall score', 'Responses to this question tend to track scores on the rest of the paper.'],
    ok: ['Acceptable', 'The results do not show a strong signal either way.'],
    diagnostic: ['Specific pattern', 'This question has a weak relationship with overall scores, while answers to other questions tend to support the same pattern.'],
    minor: ['Minor issue', 'One option was rarely chosen and may not be adding much information.'],
    weak: ['Worth reviewing', 'Responses suggest this question may need revision.'],
    broken: ['Unexpected pattern', 'Students with higher scores on the rest of the paper were less likely to answer this correctly. Review the wording, options, and answer key.'],
    insufficient: ['Too little evidence', 'There is not enough response or score variation to estimate how this question relates to performance on the rest of the paper.'],
    watch: ['Too early to tell', 'Strong and weak students answered this about alike, but with this many students that could be chance. Nothing to rewrite yet; look again after the next class takes it.'],
    key: ['Check the key', 'Your strongest students mostly chose an answer the key marks wrong, and nothing else on the paper suggests they hold the belief it was written for. The key may be wrong.']
  }[st.quality] || ['—', ''];

  const v = el('div', `dr-verdict v-${st.quality}`);
  v.appendChild(el('div', 'dr-verdict-t', verdict[0]));
  v.appendChild(el('div', 'dr-verdict-b', verdict[1]));
  wrap.appendChild(v);

  const facts = el('div', 'dr-facts');
  const d1 = fact(st.difficulty.toFixed(2), 'difficulty');
  d1.querySelector('.dr-fact-k').appendChild(infoButton('difficulty'));
  const d2 = fact(st.discrimination === null ? '—' : st.discrimination.toFixed(2), 'discrimination');
  d2.querySelector('.dr-fact-k').appendChild(infoButton('discrimination'));
  facts.appendChild(d1);
  facts.appendChild(d2);
  facts.appendChild(fact(`${st.correct}/${st.answered}`, 'answered correctly'));
  wrap.appendChild(facts);

  if (st.note) {
    const n = el('div', 'dr-defend');
    n.appendChild(el('span', null, st.note));
    n.appendChild(infoButton('diagnosing'));
    wrap.appendChild(n);
  }

  const flagsShown = shownFlags(st);
  if (flagsShown.length) {
    wrap.appendChild(el('div', 'dr-h', st.quality === 'diagnostic' ? 'Why it looks weak' : 'Flags'));
    const ul = el('ul', 'flags');
    flagsShown.forEach(f => ul.appendChild(setMath(el('li'), f.text)));
    wrap.appendChild(ul);
  }

  // --- who chose what ------------------------------------------------------
  // In printed order, lettered as on the paper.
  wrap.appendChild(el('div', 'dr-h', 'How the class answered'));
  paperOrder(item).map(oi => st.options[oi]).forEach((o, k) => {
    const row = el('div', `opt${o.correct ? ' opt-correct' : ''}`);

    const head = el('div', 'opt-head');
    const t = el('span', 'opt-t');
    t.appendChild(el('span', 'opt-l', 'ABCDEFGH'[k]));
    t.appendChild(setMath(el('span'), o.text));
    head.appendChild(t);
    head.appendChild(el('span', 'opt-n', `${o.count} · ${Math.round(o.share * 100)}%`));
    row.appendChild(head);

    const track = el('div', 'opt-track');
    const fill = el('span', 'opt-fill');
    fill.style.width = `${Math.max(1.5, o.share * 100)}%`;
    if (o.correct) fill.style.background = 'var(--good)';
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
      row.appendChild(el('div', 'opt-tag opt-slip', 'Not linked to a misunderstanding'));
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

  openWith(wrap, ctx.onClose, `Question ${item.id}`);
}
