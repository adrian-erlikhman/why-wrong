/**
 * First-visit intro and guided tour. Tour examples use the current analysis.
 * Deep links skip the intro; ?demo=1 forces it, ?demo=0 suppresses it, and the
 * tour button can replay it.
 */

const SEEN = 'whywrong.intro';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const STEPS = [
  {
    title: 'The class map',
    view: 'matrix', sorted: false, target: '.board',
    text: f => `Each row is one of ${f.students} students, and each column is a question. A coloured cell marks a wrong answer linked to a possible misunderstanding; grey means the answer did not match a known pattern. Rows start in register order.`
  },
  {
    title: 'Group similar answer patterns',
    view: 'matrix', sorted: true, target: '.board',
    text: f => f.groups
      ? `The same answers, regrouped by pattern rather than score. ${plural(f.groups, 'group')} appear, with columns showing questions where students in a group answered similarly.`
      : 'The same answers, regrouped by pattern rather than score. No clear shared pattern emerged, so review individual answers before planning a group reteach.'
  },
  {
    title: 'Plan for each group',
    view: 'groups', target: '#groups .group',
    text: f => f.topName
      ? `${plural(f.topSize, 'student')} show a similar pattern around “${f.topName}”. Each group gets a reteach suggestion and three questions to check understanding.` +
        (f.between ? ` ${f.between === 1 ? 'One student sits' : `${f.between} students sit`} almost as close to another group; each card names them under “Check where they fit”.` : '')
      : 'No clear shared misunderstanding emerged in this class. Review the individual evidence before deciding what support students need.'
  },
  {
    title: 'Review the questions too',
    view: 'items', target: '#items .item',
    text: f => f.bad
      ? `${f.bad} of ${f.items} questions are flagged for review. ${f.worstId} is marked “${f.worstVerdict}”. Some questions that target one misunderstanding can look weak by overall score but still carry useful information.`
      : `No questions were flagged for review in this class. Click any question to see how students answered it.`
  },
  {
    title: 'Compare a retest',
    view: 'progress', target: '#view-progress',
    text: () => 'After a reteach, give the same paper again. This tab compares each student’s results and shows which patterns changed. Treat the result as evidence, not proof: students have seen the questions before.'
  },
  {
    title: 'Check the method on a sample',
    view: 'validation', target: '#metrics',
    text: f => f.recall
      ? `The sample class has simulated misunderstandings that the analysis does not see. It recovered ${f.recall} from the answers, and ${f.precision} of its diagnoses matched the hidden profiles. This check does not guarantee the same results for a real class.`
      : 'A real class has no hidden answer key to compare with. Switch Class to Sample class to see how well the method recovers simulated patterns.'
  },
  {
    title: 'Try it with your class',
    view: 'matrix', target: '#toolbar', final: true,
    text: () => 'Choose a subject, or use New subject to draft questions for another topic. Review those questions first. Print them from Materials, give them to a class, then paste the answers back under Class.'
  }
];

export function initTour(app) {
  const $ = s => document.querySelector(s);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let coach = null;
  let at = -1;
  let lit = null;

  /* Intro dialog */

  function openIntro() {
    stop();
    app.closeDrawer();
    $('#intro').hidden = false;
    $('#intro-go').focus();
  }

  function closeIntro() { $('#intro').hidden = true; }

  function maybeOpen() {
    const q = new URLSearchParams(location.search);
    const demo = q.get('demo');
    if (demo === '0') return;
    if (demo !== '1') {
      if (q.has('view') || q.has('sorted') || q.has('static')) return;
      try { if (sessionStorage.getItem(SEEN)) return; } catch { /* Storage is unavailable; show the intro. */ }
    }
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* The intro can still open without session storage. */ }
    openIntro();
  }

  $('#intro-go').addEventListener('click', () => { closeIntro(); start(); });
  $('#intro-skip').addEventListener('click', closeIntro);

  /* Guided tour */

  function build() {
    coach = document.createElement('div');
    coach.className = 'coach';
    coach.setAttribute('role', 'dialog');
    coach.setAttribute('aria-labelledby', 'coach-title');
    coach.innerHTML = `
      <div class="coach-top">
        <span class="coach-n"></span>
        <button class="coach-x" type="button" aria-label="End the tour">&times;</button>
      </div>
      <h4 id="coach-title" class="coach-title"></h4>
      <p class="coach-text" aria-live="polite"></p>
      <div class="coach-foot">
        <div class="coach-dots" aria-hidden="true">${STEPS.map(() => '<i></i>').join('')}</div>
        <div class="coach-btns">
          <button class="btn btn-quiet coach-back" type="button">Back</button>
          <button class="btn btn-quiet coach-extra" type="button" hidden>Paste my class</button>
          <button class="btn btn-primary coach-next" type="button">Next</button>
        </div>
      </div>`;
    document.body.appendChild(coach);
    coach.querySelector('.coach-x').addEventListener('click', stop);
    coach.querySelector('.coach-back').addEventListener('click', () => go(at - 1));
    coach.querySelector('.coach-next').addEventListener('click', () => (at === STEPS.length - 1 ? stop() : go(at + 1)));
    coach.querySelector('.coach-extra').addEventListener('click', () => { stop(); app.openImport(); });
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape' && coach) { e.preventDefault(); stop(); }
  }

  function reveal(el, top) {
    const behavior = reduced() ? 'auto' : 'smooth';
    if (top) { window.scrollTo({ top: 0, behavior }); return; }
    const tabs = $('.tabs');
    const clear = (tabs ? tabs.getBoundingClientRect().height : 0) + 18;
    const y = el.getBoundingClientRect().top + window.scrollY - clear;
    window.scrollTo({ top: Math.max(0, y), behavior });
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    at = i;
    const s = STEPS[i];

    app.closeDrawer();
    if (s.view) app.show(s.view);
    if ('sorted' in s) app.setSorted(s.sorted);
    if (s.final) app.openToolbar();

    if (lit) lit.classList.remove('tour-lit');
    lit = document.querySelector(s.target);
    if (lit) {
      lit.classList.add('tour-lit');
      reveal(lit, s.top);
    }

    const f = app.facts();
    coach.querySelector('.coach-n').textContent = `${i + 1} / ${STEPS.length}`;
    coach.querySelector('.coach-title').textContent = s.title;
    coach.querySelector('.coach-text').textContent = s.text(f);
    coach.querySelectorAll('.coach-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
    coach.querySelector('.coach-back').disabled = i === 0;
    coach.querySelector('.coach-extra').hidden = !s.final;
    const next = coach.querySelector('.coach-next');
    next.textContent = s.final ? 'Finish' : 'Next';
    next.focus({ preventScroll: true });
  }

  function start() {
    closeIntro();
    if (!coach) build();
    document.body.classList.add('touring');
    go(0);
  }

  function stop() {
    if (!coach) return;
    document.removeEventListener('keydown', onKey);
    coach.remove();
    coach = null;
    at = -1;
    if (lit) lit.classList.remove('tour-lit');
    lit = null;
    document.body.classList.remove('touring');
    $('#demo')?.focus({ preventScroll: true });
  }

  return { maybeOpen, openIntro, start, stop, isRunning: () => !!coach };
}
