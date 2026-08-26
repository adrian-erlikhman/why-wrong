# Why Wrong

**"You got it wrong" is the least useful sentence in education.**

A red X tells a student nothing and a teacher less. Why Wrong takes a class's
answer sheets and works out the *specific misconception* behind each wrong
answer, groups the class into the handful of failure modes it actually shares,
and then turns the lens around to audit which of the teacher's questions
measured anything at all.

Built for the Prometheus August AI Challenge (August 2026).

**Live:** https://adrian-erlikhman.github.io/why-wrong/
**Everything runs in the browser.** No server, no account, no data leaves the page.

---

## The idea

Most assessment tooling reports *that* a student was wrong. What changes
instruction is knowing *why* — which broken rule in their head produced that
particular answer.

That is possible only if the test is built for it. Every wrong option in this
item bank is tagged with the misconception that generates it, so a wrong answer
carries information rather than merely being negative. This is how real concept
inventories work; the Force Concept Inventory in physics is the canonical
example.

From there the tool answers three questions:

1. **Which misconception does this student hold?** — inferred, not read off.
2. **What does the class share?** — 28 students are rarely 28 problems.
3. **Was the test any good?** — the response matrix scores the questions too.

## Pipeline

Four stages. **Two of them are not a language model.**

**1 · Distractor mapping.** 36 algebra items, 12 named misconceptions, each
probed by at least 3 items. Wrong options that carry no diagnostic meaning are
tagged as slips so they contribute no signal.

**2 · Per-student inference** *(no LLM — `js/infer.js`)*
A misconception is latent. A student who holds one still answers correctly
sometimes, and a student who doesn't still slips onto that option occasionally,
so a single item cannot diagnose anybody. Evidence is accumulated across every
probing item as a log-odds update:

```
logit P(holds m | responses) = logit P(m) + Σᵢ log [ P(rᵢ | m) / P(rᵢ | ¬m) ]
```

Naive Bayes over item responses — "naive" for the conditional-independence
assumption that also makes Bayesian knowledge tracing tractable. The likelihood
parameters are exported and shown in the UI rather than buried, because they are
assumptions rather than facts.

**3 · Class structure** *(no LLM — `js/cluster.js`)*
Each student becomes a point in 12-dimensional misconception space. Two design
decisions matter more than the choice of algorithm:

- Students with no confident misconception are **separated out before**
  clustering. They aren't a failure mode, they're the students who are fine, and
  leaving them in drags every centroid toward the origin.
- The rest are compared by **direction, not magnitude** — posteriors are
  L2-normalised so k-means operates on cosine similarity. A student who
  expresses the sign misconceptions weakly belongs with those who express them
  strongly; under plain Euclidean distance they'd look like someone with no
  misconception at all.

k is chosen by mean silhouette, ties broken toward *fewer* groups. A teacher can
act on three groups and not on eleven.

**4 · Prescription.** Each failure mode gets a reteach aimed at the specific
belief, plus verification items. Because those exist, the loop closes: reteach,
re-run, watch the cluster shrink.

## The test also gets graded

Classical item analysis (`js/itemstats.js`): difficulty, corrected point-biserial
discrimination, per-distractor selection shares, dead options, Cronbach's alpha.

The interesting part is what the tool *refuses* to call a bad question.

Point-biserial discrimination asks whether students who did well overall also got
this item right — which presumes the test measures one underlying trait. A
diagnostic instrument deliberately doesn't. An item targeting a misconception
held by one subgroup gets missed by that subgroup regardless of their ability
elsewhere, so it can correlate weakly, even negatively, with total score while
being the most informative question on the page.

So before pronouncing an item broken, the tool asks whether it **agrees with the
rest of the test**: of the students who chose its main diagnostic distractor, how
many are independently diagnosed with that same misconception by the other items?
The posterior used has that item's own contribution subtracted out, so an item is
never allowed to vote on its own validity.

Low agreement plus low discrimination is a broken item. Low discrimination with
high agreement is a *diagnostic* item, and it gets defended rather than flagged.

Similarly, Cronbach's alpha comes out low here — and correctly so. Alpha assumes
a single underlying trait; this instrument targets twelve distinct
misconceptions. Low internal consistency is evidence of multidimensionality, not
of an unreliable test, and the UI says so rather than leaving the number to be
misread.

## Does it actually work?

This is why the class is simulated rather than borrowed.

`js/simulate.js` doesn't hand-write a plausible answer sheet. It builds a
generative model of a class: each student gets a hidden profile — a set of
misconceptions they genuinely hold plus an ability parameter — and their answers
are generated *from* that profile. The profile is then withheld from every
downstream stage.

So the pipeline has a ground truth to be scored against, computed live on
whatever seed is loaded:

| Metric | Mean over 40 seeds |
| --- | --- |
| Diagnosis precision | 91.3% |
| Diagnosis recall | 82.7% |
| Diagnosis F1 | **0.867** |
| Cluster recovery (Adjusted Rand Index) | **0.676** |
| Correct *k* recovered | 27/40 seeds |

Two deliberately defective questions are planted in the item bank — one trivial,
one ambiguously worded — and marked nowhere in the data. The item analysis has to
find them on its own. It catches the trivial one in 39/40 seeds and the ambiguous
one in 36/40.

Reproduce:

```bash
node test/pipeline.test.mjs
```

## Where the language model fits

Deliberately at the edge, not the centre. Everything above is deterministic
numeric code, and the reteach plans that ship are written by hand — so the page
is fully functional with no key, no network, and no account.

Optionally, paste an Anthropic API key and the reteach plans are rewritten for
the specific *combination* of misconceptions a given cluster holds and its size.
That's an appropriate use of a language model — generating prose conditioned on
structured input — rather than asking it to do the diagnosis, which arithmetic
does more reliably. The key is held in the tab only, never stored, and sent
nowhere except `api.anthropic.com`.

## Running locally

No build step. Any static server:

```bash
npx http-server . -p 4173 -c-1
```

## Layout

```
index.html            single page
css/style.css
js/curriculum.js      12 misconceptions, 36 distractor-mapped items, reteach content
js/simulate.js        generative class model + planted ground truth
js/infer.js           naive Bayes misconception inference
js/cluster.js         cosine k-means, silhouette, adjusted Rand index
js/itemstats.js       classical item analysis + leave-one-out model agreement
js/validate.js        recovery scoring against planted truth
js/llm.js             optional Anthropic rewrite layer
js/app.js             orchestration and rendering
test/pipeline.test.mjs
```

## Honest limitations

- The class is **simulated**, not real. That buys a measurable ground truth and
  costs external validity: the response model is my model of how students err,
  so recovery figures describe the pipeline's consistency with that model, not
  its accuracy on a real classroom.
- The item bank is one topic (Algebra 1) and hand-authored.
- At 28 students, per-item statistics are noisy. Several items pick up marginal
  low-discrimination flags that are sample noise, which is why findings are
  ranked by severity and the marginal ones are collapsed.
- Misconceptions are treated as conditionally independent. Real ones co-occur
  causally — M07 and M11 are plausibly the same underlying failure — and a model
  with a dependency structure would do better.

## License

MIT
