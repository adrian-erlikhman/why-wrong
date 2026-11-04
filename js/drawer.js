/**
 * Open a student or question detail panel. Student panels show the evidence
 * behind each estimate so teachers can review how the result was produced.
 */

import { correctIndex, misById } from './pack.js';
import { untested, strength } from './infer.js';
import { SUPPORT_BELOW } from './cluster.js';
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
let nav = null;          // { order, at, noun, open(k) } for stepping through a list

function ensureHost() {
  if (host) return host;
  host = el('div', 'drawer');
  host.hidden = true;
  host.innerHTML = '<div class="drawer-scrim"></div><div class="drawer-panel" role="dialog" aria-modal="true"></div>';
  document.body.appendChild(host);
  host.querySelector('.drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (host.hidden) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    // Left and right step through the list the panel was opened from, unless
    // the teacher is in a field or on a control that uses the arrows itself.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1, false);
      return;
    }
    trapTab(host.querySelector('.drawer-panel'), e);
  });
  return host;
}

function step(d, fromButton) {
  if (!nav) return;
  const k = nav.at + d;
  if (k < 0 || k >= nav.order.length) return;
  nav.open(k);
  // Keep focus on the control that did it, so the same key or button steps again.
  const again = host.querySelector(fromButton ? (d > 0 ? '.drawer-next' : '.drawer-prev') : '.drawer-pos');
  (again && !again.disabled ? again : host.querySelector('.drawer-x'))?.focus();
}

export function closeDrawer() {
  if (!host || host.hidden) return;
  host.classList.remove('is-open');
  setTimeout(() => { host.hidden = true; }, 200);
  nav = null;
  openedFrom?.focus?.();
  openedFrom = null;
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
}

function openWith(node, onClose, label, navigation = null) {
  ensureHost();
  // Already open: this is a step to the next student or question, so the panel
  // stays put, only its content changes, and focus still returns to whatever
  // opened it in the first place.
  const stepping = !host.hidden;
  if (!stepping) openedFrom = document.activeElement;
  onCloseCb = onClose || null;
  nav = navigation;
  const panel = host.querySelector('.drawer-panel');
  panel.setAttribute('aria-label', label);
  panel.innerHTML = '';

  const bar = el('div', 'drawer-bar');
  if (nav && nav.order.length > 1) {
    const box = el('div', 'drawer-step');
    const prev = el('button', 'drawer-nav drawer-prev', '‹');
    prev.setAttribute('aria-label', `Previous ${nav.noun}`);
    prev.disabled = nav.at <= 0;
    prev.addEventListener('click', () => step(-1, true));
    const next = el('button', 'drawer-nav drawer-next', '›');
    next.setAttribute('aria-label', `Next ${nav.noun}`);
    next.disabled = nav.at >= nav.order.length - 1;
    next.addEventListener('click', () => step(1, true));
    const pos = el('span', 'drawer-pos', `${nav.at + 1} of ${nav.order.length}`);
    pos.tabIndex = -1;
    pos.title = 'The left and right arrow keys step through them too';
    box.append(prev, pos, next);
    bar.appendChild(box);
  }
  const x = el('button', 'drawer-x', '×');
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', closeDrawer);
  bar.appendChild(x);
  panel.appendChild(bar);
  if (stepping) node.classList.add('dr-step');
  panel.appendChild(node);

  host.hidden = false;
  panel.scrollTop = 0;
  if (!stepping) x.focus();
  setTimeout(() => host.classList.add('is-open'), 10);
}

/* ======================================================================== */
/*  Student                                                                 */
/* ======================================================================== */

/**
 * `order` is the list the student was picked from (a group, the filtered
 * student list, the map's rows), so the panel can step through it; without
 * one it steps through the register.
 */
export function openStudent(ctx, s, order = null) {
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
    group?.isThin ? 'too few answers' : group?.isSecure ? (group.support?.includes(s) ? 'getting most wrong' : 'no clear pattern') : 'reteach group'
  ));
  wrap.appendChild(facts);

  // A student almost as close to a second group: half of them were placed in
  // the wrong one on the stress benchmark, so say which other group it is.
  const near = group?.between?.find(b => b.s === s);
  const other = near && groups.find(g => g.index === near.alt && !g.isSecure && !g.isThin);
  if (other) {
    wrap.appendChild(el('p', 'dr-note dr-warn',
      `Their answers are almost as close to Group ${groups.indexOf(other) + 1}. Check the evidence below before deciding which lesson they join.`));
  }

  // --- ranked diagnoses ----------------------------------------------------
  const ranked = inf.misIds
    .map((mid, k) => ({ mid, k, ...strength(inf, s, k) }))
    .sort((a, b) => b.p - a.p);

  const acted = ranked.filter(r => r.level === 'clear' || r.level === 'likely');
  const check = ranked.filter(r => r.level === 'check');
  const rest = ranked.filter(r => r.level === 'none' && r.p >= 0.12);

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
    const right = inf.ability?.[s];
    wrap.appendChild(el('p', 'dr-note', score === answered
      ? 'All recorded answers were correct; this test has not indicated a reteach need.'
      : right != null && right < SUPPORT_BELOW
        ? `The wrong answers did not form a clear pattern, but this student was right on only about ${Math.round(right * 100)}% of the questions their errors do not explain. That points to a gap or guessing rather than one misunderstanding: work through a few problems with them and see where it breaks down.`
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

  // Over the line on a single answer: right less than half the time, so it is
  // offered as a question to ask rather than as a diagnosis.
  if (check.length) {
    wrap.appendChild(el('div', 'dr-h', 'Worth one more question'));
    check.forEach(r => wrap.appendChild(diagnosisCard(ctx, s, r, byId, colourOf, false)));
  }

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

  const list = order && order.includes(s) ? order : cls.students.map((_, k) => k);
  openWith(wrap, ctx.onClose, `Student: ${student.name}`,
    { order: list, at: list.indexOf(s), noun: 'student', open: k => openStudent(ctx, list[k], list) });
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

  // Resting on one answer: name the question that would settle it.
  if (r.level === 'check' && m?.verify?.length) {
    const ask = el('p', 'ev-ask');
    ask.appendChild(el('b', null, 'Before acting on it, ask: '));
    ask.appendChild(setMath(el('span'), m.verify[0]));
    list.appendChild(ask);
  }

  card.appendChild(list);
  return card;
}

/* ======================================================================== */
/*  Question                                                                */
/* ======================================================================== */

export function openQuestion(ctx, i, order = null) {
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

  const list = order && order.includes(i) ? order : pack.items.map((_, k) => k);
  openWith(wrap, ctx.onClose, `Question ${item.id}`,
    { order: list, at: list.indexOf(i), noun: 'question', open: k => openQuestion(ctx, list[k], list) });
}
