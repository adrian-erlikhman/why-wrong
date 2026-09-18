/**
 * tour.js -- what a first-time visitor sees.
 * ---------------------------------------------------------------------------
 * Someone opening this link cold has no reason to know what a class map is or
 * why sorting it matters. So the first visit in a tab opens a short intro, and
 * the tour walks the real page -- not screenshots -- through the things worth
 * seeing: the map, the sort, a reteach group, the audit of the test, and the
 * recovery numbers. Every sentence is filled in from the analysis on screen,
 * so it stays true for any subject, class size or variant.
 *
 * The intro never opens over a deep link (?view=, ?sorted=, ?static=), which
 * someone sent on purpose. ?demo=1 forces it, ?demo=0 suppresses it, and the
 * Demo button replays it at any time.
 */

const SEEN = 'whywrong.intro';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const STEPS = [
  {
    title: 'The class map',
    view: 'matrix', sorted: false, target: '.board',
    text: f => `Each row is one of ${f.students} students, each column a question. A coloured square is a wrong answer, coloured by the misunderstanding it points to; grey means wrong at random. The rows are in register order, so the pattern is still hidden.`
  },
  {
    title: 'Sorted by belief, not by score',
    view: 'matrix', sorted: true, target: '.board',
    text: f => f.groups
      ? `Same answers, rows regrouped by what each student believes. ${plural(f.groups, 'group')} appear, and the vertical stripes are questions a whole group missed for the same reason.`
      : 'Same answers, rows regrouped by what each student believes. This class shows no shared pattern: the mistakes are scattered, which calls for practice rather than a reteach.'
  },
  {
    title: 'One lesson per group',
    view: 'groups', target: '#groups .group',
    text: f => f.topName
      ? `${plural(f.topSize, 'student')} share “${f.topName}”. Each group gets a reteach aimed at that exact belief, and three quick questions to check it landed.`
      : 'No group shares a stable misunderstanding here, so nobody needs a reteach, only practice.'
  },
  {
    title: 'It audits the test too',
    view: 'items', target: '#items .item',
    text: f => f.bad
      ? `${f.bad} of ${f.items} questions have a problem worth a look. ${f.worstId} is flagged “${f.worstVerdict}”. Questions aimed at one misunderstanding are kept even when the usual statistics say they are weak.`
      : `All ${f.items} questions are pulling their weight on this class. Click any question to see how the class answered it.`
  },
  {
    title: 'Does it actually work?',
    view: 'validation', target: '#metrics',
    text: f => f.recall
      ? `The sample class was simulated with hidden misunderstandings the analysis never sees. It found ${f.recall} of them from the answers alone, and ${f.precision} of its diagnoses were right.`
      : 'Your own class has no hidden answer key, so there is nothing to score it against here. Switch Class back to Sample class to see how much the method recovers.'
  },
  {
    title: 'Now try your own class',
    view: 'matrix', target: '#toolbar', top: true, final: true,
    text: () => 'Pick a subject, or build one for any topic with New subject. Print the questions from Materials, give them to a class, then paste the answers back under Class to analyse your real students.'
  }
];

export function initTour(app) {
  const $ = s => document.querySelector(s);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let coach = null;
  let at = -1;
  let lit = null;

  /* ------------------------------------------------------------- intro */

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
      try { if (sessionStorage.getItem(SEEN)) return; } catch { /* storage blocked: show it */ }
    }
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* fine */ }
    openIntro();
  }

  $('#intro-go').addEventListener('click', () => { closeIntro(); start(); });
  $('#intro-skip').addEventListener('click', closeIntro);

  /* -------------------------------------------------------------- tour */

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
