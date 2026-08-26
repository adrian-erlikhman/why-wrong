/**
 * explain.js -- inline glossary.
 * ---------------------------------------------------------------------------
 * The analysis leans on real psychometric and statistical terms, and a teacher
 * has no reason to know any of them. Two bad options are usually taken here:
 * drop the terms (and with them any way to check the work), or keep them and
 * let most readers bounce off.
 *
 * So: plain language in the sentence, the real term available on demand. Every
 * statistic on screen carries a small marker that opens a short explanation
 * written for someone who teaches for a living -- what it means, and what a
 * teacher should actually do about the number in front of them.
 */

export const TERMS = {
  confidence: {
    term: 'Confidence',
    also: 'posterior probability',
    body: 'How sure the analysis is that this student holds this particular misconception, given every answer they gave. It is not a percentage of questions they got wrong — it is the weight of the evidence.',
    use: 'Above roughly 80% is worth acting on directly. Between 50% and 80%, check the evidence list before you plan around it.'
  },
  failureMode: {
    term: 'Failure mode',
    also: 'cluster',
    body: 'A group of students whose wrong answers point at the same underlying misunderstanding. They are grouped by what they believe, not by their scores — two students with very different grades can sit in the same group.',
    use: 'This is your reteach group. One lesson can serve the whole group because they are wrong in the same way.'
  },
  separation: {
    term: 'Separation',
    also: 'silhouette score',
    body: 'How cleanly the groups come apart. Near 1.0 the groups are sharply distinct; near 0 the students blur into each other and the grouping is arbitrary.',
    use: 'Above about 0.35, trust the groups. Below about 0.20, treat them as a rough sketch and lean on the individual diagnoses instead.'
  },
  difficulty: {
    term: 'Difficulty',
    also: 'p-value / facility index',
    body: 'The proportion of the class that answered correctly. Confusingly, a HIGH number means an EASY question.',
    use: 'Around 0.5–0.8 is the useful range. Above 0.93 the question separates nobody and is costing you time on the paper.'
  },
  discrimination: {
    term: 'Discrimination',
    also: 'corrected point-biserial correlation',
    body: 'Whether students who did well on the rest of the test also got this question right. High means the question sorts strong from weak. Negative means it sorted them backwards — your best students got it wrong.',
    use: 'Below 0.15 usually means the wording is unclear. But see "diagnosing, not ranking" — on a diagnostic test a low number is not automatically a fault.'
  },
  diagnosing: {
    term: 'Diagnosing, not ranking',
    body: 'A question aimed at one specific misconception is missed by exactly the students who hold it — whatever their ability elsewhere. So it can look statistically weak while being the most informative question on the page.',
    use: 'Keep these. The tool checks whether the rest of the test agrees with the question before it calls anything broken.'
  },
  consistency: {
    term: 'Internal consistency',
    also: "Cronbach's alpha",
    body: 'Whether all the questions behave as though they measure one single thing. A test built to detect several unrelated misconceptions should NOT score highly here.',
    use: 'A low number on this tool is expected and healthy. It means your questions are picking up genuinely different misunderstandings.'
  },
  slip: {
    term: 'Slip',
    body: 'A wrong answer that does not match any known misconception — arithmetic noise, a misread, a rushed guess. Everyone produces them.',
    use: 'Slips are not reteachable. If a student is mostly slips, they need practice and attention, not a reteach.'
  },
  recall: {
    term: 'Misconceptions found',
    also: 'recall',
    body: 'In the simulated class, every student was given a hidden set of misconceptions before any answers existed. This is the share of those the analysis managed to find using only the answer sheet.',
    use: 'This is how you know the method works at all, rather than merely producing confident-looking output.'
  },
  precision: {
    term: 'Diagnoses correct',
    also: 'precision',
    body: 'Of every misconception the analysis attributed to a student, the share that was genuinely there. The remainder are false accusations.',
    use: 'High precision matters more than high recall here: telling a teacher a student is confused when they are not wastes a lesson.'
  },
  f1: {
    term: 'F1',
    body: 'One number combining the two above, so that a method cannot look good by being reckless in one direction.',
    use: 'Useful for comparing runs. Nothing to act on directly.'
  },
  ari: {
    term: 'Group recovery',
    also: 'adjusted Rand index',
    body: 'Whether the groups the tool discovered match the groups the simulation actually planted. 1.00 is exact agreement, 0.00 is what random guessing would score.',
    use: 'Evidence that the grouping reflects something real rather than shapes found in noise.'
  },
  evidence: {
    term: 'Evidence',
    body: 'The specific questions that led to a diagnosis. Each one either supports the conclusion or argues against it, and the weights add up to the confidence figure.',
    use: 'Read this before you act on any diagnosis you find surprising. It is the whole audit trail.'
  }
};

let open = null;

function close() {
  if (open) { open.remove(); open = null; }
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('click', onDocClick, true);
}

function onKey(e) { if (e.key === 'Escape') close(); }
function onDocClick(e) {
  if (open && !open.contains(e.target) && !e.target.closest('.info')) close();
}

function show(anchor, key) {
  close();
  const t = TERMS[key];
  if (!t) return;

  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');

  const h = document.createElement('div');
  h.className = 'pop-h';
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

  // Position under the anchor, nudged back inside the viewport if it would
  // hang off the right edge.
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = r.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < window.scrollX + 12) left = window.scrollX + 12;

  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;

  open = pop;
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
}

/** Build a clickable marker that opens the explanation for `key`. */
export function infoButton(key) {
  const b = document.createElement('button');
  b.className = 'info';
  b.type = 'button';
  b.textContent = '?';
  b.setAttribute('aria-label', `What is ${TERMS[key]?.term ?? key}?`);
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (open) { close(); return; }
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
