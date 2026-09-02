/**
 * ui.js -- presentation-only behaviour.
 * ---------------------------------------------------------------------------
 * Nothing in here touches the analysis. Three things live here:
 *
 *   1. The hero backdrop: an ambient canvas of a class response map that keeps
 *      shuffling itself from register order into sorted bands and back. It is
 *      the product's own centrepiece (the reorder) playing quietly behind the
 *      headline, not a decoration borrowed from somewhere else.
 *   2. Count-up on the summary figures, so a re-run visibly re-computes.
 *   3. The sliding indicator under the active tab.
 */

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ======================================================================== */
/*  Hero backdrop                                                           */
/* ======================================================================== */

const HUES = [4, 26, 46, 90, 150, 174, 193, 214, 250, 280, 316, 340];

export function heroBackdrop(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // ?static=1 (or reduced motion) draws the sorted state once and stops.
  const still = reduceMotion() || new URLSearchParams(location.search).get('static') === '1';

  const COLS = 34, ROWS = 26, GROUPS = 4;
  let cell = 12, gap = 4, dpr = 1, W = 0, H = 0;

  // a hidden "class": each row belongs to one of a few groups, and the group
  // determines which columns light up and in which hue
  const rows = [];
  const groupCols = [];
  for (let g = 0; g < GROUPS; g++) {
    const cols = new Set();
    while (cols.size < 7) cols.add(Math.floor(Math.random() * COLS));
    groupCols.push({ cols, hue: HUES[(g * 3 + 1) % HUES.length] });
  }
  for (let r = 0; r < ROWS; r++) {
    const g = Math.floor(Math.random() * GROUPS);
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      const inGroup = groupCols[g].cols.has(c);
      const roll = Math.random();
      if (inGroup && roll < 0.82) cells.push({ hue: groupCols[g].hue, a: 0.85 });
      else if (roll < 0.10) cells.push({ hue: HUES[Math.floor(Math.random() * HUES.length)], a: 0.55 });
      else if (roll < 0.16) cells.push({ hue: null, a: 0.28 });   // slip
      else cells.push({ hue: null, a: 0.07 });                   // correct
    }
    rows.push({ g, cells, y: r, from: r, to: r });
  }

  const register = rows.map((_, i) => i);
  const sorted = rows.map((_, i) => i).sort((a, b) => rows[a].g - rows[b].g || a - b);

  let phase = 0;            // 0 = register, 1 = sorted
  let raf = 0;
  let visible = true;
  let t0 = performance.now();
  const HOLD = 3200, MOVE = 1400;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.max(9, Math.min(15, Math.floor(H / (ROWS * 1.45))));
    gap = Math.max(3, Math.round(cell * 0.3));
    // setting the backing size wipes the canvas; a still page must redraw here
    if (still && W > 1) drawStill();
  }

  function drawStill() {
    visible = false;                 // frame() will not reschedule itself
    phase = 1; t0 = performance.now();
    frame(t0);                       // phase 1 at k=0 is the sorted layout
  }

  const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function frame(now) {
    const elapsed = now - t0;
    let k;                                    // 0..1 progress of the current move
    if (elapsed < HOLD) k = 0;
    else if (elapsed < HOLD + MOVE) k = easeInOut((elapsed - HOLD) / MOVE);
    else { phase ^= 1; t0 = now; k = 0; }

    const fromOrder = phase === 0 ? register : sorted;
    const toOrder = phase === 0 ? sorted : register;
    const posFrom = new Array(ROWS), posTo = new Array(ROWS);
    fromOrder.forEach((r, p) => { posFrom[r] = p; });
    toOrder.forEach((r, p) => { posTo[r] = p; });

    ctx.clearRect(0, 0, W, H);
    const gridW = COLS * (cell + gap);
    const gridH = ROWS * (cell + gap);
    const ox = W - gridW - 56;
    const oy = (H - gridH) / 2;
    const step = cell + gap;

    // faint band markers appear as the sort completes
    if (phase === 0 ? k > 0.7 : k < 0.3) {
      const on = phase === 0 ? (k - 0.7) / 0.3 : (0.3 - k) / 0.3;
      let p = 0;
      for (let g = 0; g < GROUPS; g++) {
        const n = rows.filter(r => r.g === g).length;
        ctx.fillStyle = `hsla(${groupCols[g].hue} 90% 65% / ${0.9 * on})`;
        ctx.fillRect(ox - 14, oy + p * step + 1, 3, n * step - gap - 2);
        p += n;
      }
    }

    rows.forEach((row, r) => {
      const y = oy + (posFrom[r] + (posTo[r] - posFrom[r]) * k) * step;
      row.cells.forEach((c, i) => {
        const x = ox + i * step;
        ctx.fillStyle = c.hue == null
          ? `rgba(255,255,255,${c.a})`
          : `hsla(${c.hue} 92% 66% / ${c.a})`;
        ctx.beginPath();
        ctx.roundRect(x, y, cell, cell, 3);
        ctx.fill();
      });
    });

    if (visible) raf = requestAnimationFrame(frame);
  }


  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => {
        const v = e.isIntersecting;
        if (v && !visible) { visible = true; t0 = performance.now(); raf = requestAnimationFrame(frame); }
        else if (!v) { visible = false; cancelAnimationFrame(raf); }
      }, { threshold: 0.02 })
    : null;

  resize();
  window.addEventListener('resize', resize);
  if (still) { drawStill(); return; }
  io?.observe(canvas);
  raf = requestAnimationFrame(frame);
}

/* ======================================================================== */
/*  Count-up                                                                */
/* ======================================================================== */

/**
 * Animate a node's text from 0 to its numeric value, preserving any suffix
 * ("61%") and leaving non-numeric text ("—") alone.
 */
export function countUp(node, text, ms = 700) {
  node.textContent = text;
  if (reduceMotion()) return;
  const m = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(text);
  if (!m) return;
  const target = parseFloat(m[1]);
  const decimals = (m[1].split('.')[1] || '').length;
  const suffix = m[2];
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const t = Math.min(1, (now - start) / ms);
    node.textContent = (target * ease(t)).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = text;
  }
  requestAnimationFrame(tick);
}

/* ======================================================================== */
/*  Tab indicator                                                           */
/* ======================================================================== */

export function tabIndicator(strip) {
  if (!strip) return;
  const ind = document.createElement('span');
  ind.className = 'tab-ind';
  ind.setAttribute('aria-hidden', 'true');
  strip.prepend(ind);

  function move() {
    const on = strip.querySelector('.tab.is-active');
    if (!on) { ind.classList.remove('on'); return; }
    ind.style.width = `${on.offsetWidth}px`;
    ind.style.transform = `translateX(${on.offsetLeft}px)`;
    ind.classList.add('on');
    // keep the active tab in view when the strip scrolls on a phone — scroll
    // the strip itself, never the page
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollLeft = l - 8;
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 8;
  }

  // Only react to the tabs themselves: move() writes to the indicator, which
  // also lives in the strip, and reacting to that would loop forever.
  new MutationObserver(recs => {
    if (recs.some(r => r.target !== ind && r.target.classList?.contains('tab'))) move();
  }).observe(strip, { attributes: true, subtree: true, attributeFilter: ['class'] });
  window.addEventListener('resize', move);
  if (document.fonts?.ready) document.fonts.ready.then(move);
  // first paint: no transition, so it does not slide in from the left edge
  ind.style.transition = 'none';
  move();
  requestAnimationFrame(() => requestAnimationFrame(() => { ind.style.transition = ''; }));
}
