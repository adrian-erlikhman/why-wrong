/**
 * Plain-language explanations for statistical terms in the interface.
 * Keep the technical term available, then explain what it means and how a
 * teacher might use it.
 */

export const TERMS = {
  confidence: {
    term: 'Confidence',
    also: 'posterior probability',
    body: 'The estimated likelihood that this student has this misunderstanding, based on their answers. It is not the percentage of questions they got wrong.',
    use: 'Treat this as a signal, not certainty. Check the evidence list before planning around a result, especially when it is close to the reporting threshold.'
  },
  failureMode: {
    term: 'Reteach group',
    also: 'cluster',
    body: 'A group of students whose answer patterns suggest a shared misunderstanding. The groups are based on those patterns, not on scores.',
    use: 'Use a group as a starting point for planning. Check each student’s evidence before deciding whether one lesson fits everyone.'
  },
  separation: {
    term: 'Separation',
    also: 'silhouette score',
    body: 'How clearly separated the groups are. Higher values generally mean clearer separation; values near 0 mean students overlap across groups.',
    use: 'Use this as a guide, not a guarantee. When separation is low, rely more on the individual evidence.'
  },
  difficulty: {
    term: 'Difficulty',
    also: 'p-value / facility index',
    body: 'The share of students who answered correctly. A higher value means an easier question.',
    use: 'As a rough guide, values around 0.5–0.8 often leave room to distinguish responses. A very high value may mean the question offers little information for this class.'
  },
  discrimination: {
    term: 'Discrimination',
    also: 'corrected point-biserial correlation',
    body: 'How closely correct answers to this question track scores on the rest of the test. A negative value means students with higher scores on the other questions were less likely to get this one right.',
    use: 'A low value can flag a question for review, but it does not prove the wording is unclear. With one class it is a noisy number, so the tool only calls it low when even its plausible upper end is low, and otherwise says it is too early to tell. A diagnostic question may reveal a specific misunderstanding without tracking overall score.'
  },
  diagnosing: {
    term: 'Diagnosing, not ranking',
    body: 'A question designed to reveal one misunderstanding may be missed by students with that misunderstanding, even if they do well elsewhere. That can lower its relationship with the overall score without making it unhelpful.',
    use: 'The tool checks whether the students who picked its wrong answer show the same misunderstanding on the other questions clearly more often than the rest of the class does. Review that evidence before deciding whether to keep or revise the item.'
  },
  consistency: {
    term: 'Internal consistency',
    also: "Cronbach's alpha",
    body: 'Whether the questions behave as if they measure one underlying skill. This test covers several different misunderstandings, so a low value is not automatically a sign of poor quality.',
    use: 'Read this alongside the item-level results. A single consistency score cannot tell you whether each question is useful.'
  },
  slip: {
    term: 'Slip',
    body: 'A wrong answer that is not linked to one of the misunderstandings in the test. It could be a guess, a misread, or an arithmetic error; the answer alone cannot tell us why.',
    use: 'If no repeated pattern appears, review the student’s work or check in with them before deciding what support would help.'
  },
  recall: {
    term: 'Misunderstandings found',
    also: 'recall',
    body: 'In the simulated class, each student has a hidden set of misunderstandings. This is the share the analysis identified from the answers.',
    use: 'This measures performance on simulated data. It is useful for checking the method, but it does not guarantee results in a real class.'
  },
  precision: {
    term: 'Diagnoses correct',
    also: 'precision',
    body: 'Of the misunderstandings the analysis attributed to simulated students, the share that appeared in their hidden profiles.',
    use: 'This is a simulation measure, not a confirmed diagnosis of a real student.'
  },
  f1: {
    term: 'F1',
    body: 'A single score that balances the share of hidden patterns found with the share of diagnoses that were correct.',
    use: 'Useful for comparing runs. Nothing to act on directly.'
  },
  ari: {
    term: 'Group recovery',
    also: 'adjusted Rand index',
    body: 'How closely the groups found by the analysis match the groups used to generate the sample class. 1.00 means exact agreement; 0.00 is the expected score from random grouping.',
    use: 'This describes the simulation only; it does not establish that real students fit the same groups.'
  },
  evidence: {
    term: 'Evidence',
    body: 'The questions that raised or lowered the estimated likelihood of a misunderstanding. Together, their contributions produce the result.',
    use: 'Review this evidence before acting on a result, especially when it is unexpected.'
  }
};

let open = null;
let openFrom = null;   // the "?" that opened it

/** `refocus`: hand focus back to the "?", as when Escape or Tab leaves it. */
function close(refocus = false) {
  if (open) { open.remove(); open = null; }
  if (openFrom) {
    openFrom.setAttribute('aria-expanded', 'false');
    if (refocus) openFrom.focus();
  }
  openFrom = null;
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('scroll', onScroll, true);
}

// Escape closes the explanation only. Caught on the way down and stopped there,
// it does not also close the student panel or dialog the "?" sits in.
// Tab from inside it goes back to its "?" and on from there, so the keyboard
// carries on where it was rather than at the end of the page.
function onKey(e) {
  if (!open) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close(true);
  } else if (e.key === 'Tab' && open.contains(document.activeElement)) {
    close(true);
  }
}
function onDocClick(e) {
  if (open && !open.contains(e.target) && !e.target.closest('.info')) close();
}
// The popup sits on the page, so when the student panel it was opened from
// scrolls, its "?" moves away and the popup would be left pointing at nothing.
function onScroll(e) {
  if (openFrom && e.target !== document && e.target.contains?.(openFrom)) close();
}

function show(anchor, key) {
  close();
  const t = TERMS[key];
  if (!t) return;

  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'pop-h');
  pop.tabIndex = -1;

  const h = document.createElement('div');
  h.className = 'pop-h';
  h.id = 'pop-h';
  h.textContent = t.term;
  if (t.also) {
    const s = document.createElement('span');
    s.className = 'pop-also';
    s.textContent = t.also;
    h.appendChild(s);
  }
  pop.appendChild(h);

  const b = document.createElement('p');
  b.className = 'pop-b';
  b.textContent = t.body;
  pop.appendChild(b);

  if (t.use) {
    const u = document.createElement('p');
    u.className = 'pop-u';
    u.textContent = t.use;
    pop.appendChild(u);
  }

  document.body.appendChild(pop);

  // Keep the popup within the viewport when the anchor is near an edge.
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = r.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < window.scrollX + 12) left = window.scrollX + 12;

  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;

  open = pop;
  openFrom = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  // Into the explanation, so a screen reader reads it out.
  pop.focus({ preventScroll: true });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
}

/** Build a clickable marker that opens the explanation for `key`. */
export function infoButton(key) {
  const b = document.createElement('button');
  b.className = 'info';
  b.type = 'button';
  b.textContent = '?';
  b.setAttribute('aria-label', `What is ${TERMS[key]?.term ?? key}?`);
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', e => {
    e.stopPropagation();
    // A second click on the same "?" closes it; another "?" opens its own.
    if (open && openFrom === b) { close(); return; }
    show(b, key);
  });
  return b;
}

/** Wire any element carrying data-explain="key" that has not been wired yet. */
export function wireExplainers(root = document) {
  root.querySelectorAll('[data-explain]').forEach(n => {
    if (n.dataset.explained) return;
    n.dataset.explained = '1';
    n.appendChild(infoButton(n.dataset.explain));
  });
}

export { close as closeExplainer };
