# Why Wrong

**"You got it wrong" is the least useful sentence in education.**

A red X tells a student nothing and a teacher less. Why Wrong takes a class's
answer sheets and works out the *specific misconception* behind each wrong
answer, groups the class into the handful of failure modes it actually shares,
and then turns the lens around to audit which of the teacher's questions
measured anything at all.

**Works for any subject.** Two curated instruments ship built in (Algebra 1 and
Evolution & Inheritance). For anything else, name a topic and a model writes the
misconception taxonomy and a distractor-mapped item bank for it, which is then
validated against the same structural contract before a single number is
computed.

Built for the Prometheus August AI Challenge (August 2026).

**Live:** https://adrian-erlikhman.github.io/why-wrong/
**Everything runs in the browser.** No server, no account, no data leaves the page.

A first visit opens a short guided tour of the real page (the map, the sort, a
reteach group, the test audit, the recovery numbers); **Take the tour** replays
it.

Deep links: `?view=groups` (or `students`, `items`, `progress`, `validation`, `method`) opens a tab
directly; `?sorted=1` starts with the class map already sorted into groups. Deep
links never open the tour; `?demo=1` forces it and `?demo=0` suppresses it.

---

## Using it with a real class

The loop closes in both directions, on paper.

1. **Pick a subject**, or build one for any topic you teach.
2. **Materials** prints the questions and the answer key, or downloads a blank
   answer sheet as a spreadsheet with one column per question.
3. Give it. Mark it, or don't — you only need which option each student picked.
4. **Class → Paste my class** and paste the sheet back in. Letters, numbers, or
   the answer text all work. A Google Forms export works as it comes: timestamp,
   email and score columns are stepped over, and questions are matched by their
   text. With no name column, the part of the email before the @ becomes the
   name. A row called Key is left out, and a repeated name is flagged. Blanks are
   read as unanswered rather than wrong. Letters and numbers mean what is printed on
   the paper: each question's options are shuffled, seeded by its id, so the
   key is not "A" every time and the printout, the answer key and the paste-back
   always agree.
5. Get reteach groups, a plan per group, and an audit of your questions.
   **Print plan** puts the groups on paper; **Export CSV** puts them in a
   spreadsheet.

Nothing is uploaded. There is no account, no server, and the class data never
leaves the tab.

**Students → Print student slips** gives each student their own slip to go back
with the paper: what their answers suggest they might be thinking, and the check
questions for it. Slips carry no percentages or group numbers, and each one says
it is a best guess and not a grade. Each misunderstanding has a `student` line
written for this, so a slip says "you may be adding the tops and the bottoms"
rather than "adds fractions componentwise". Pick a group or search a name first,
and it prints only those slips.

### Keeping a class

A pasted class exists only in the tab, so **Save class** writes it to a file on
your computer, and **Paste my class → Open a saved class** brings it back. The
page warns before a reload would lose an unsaved class. Files were chosen over
browser storage because school computers are shared and student names should not
stay behind for the next person. A saved file holds names, so keep it where you
would keep a gradebook.

Each file carries a fingerprint of its test. If the test has changed since, the
file is refused rather than read as different answers.

### After the reteach

Give the same paper again and paste the new answers into **After the reteach**.
Every student is compared with themselves, by name, and a misunderstanding only
counts as cleared if its questions were answered both times.

The counts alone would mislead, because diagnoses near the line flip between
sittings with no teaching at all. What carries information is the split: how
many students lost a misconception against how many gained it. The page runs an
exact McNemar test on that split and says plainly when a change could be chance.
Sitting the same paper twice also teaches the paper, so a good result is evidence
rather than proof.

The tab also shows each reteach group on its own: how many of the students the
lesson was aimed at cleared that group's main misunderstanding, and who needs it
again. **Print** puts it all on paper with every name showing.

On the sample class, **Simulate a reteach** removes 70% of each student's hidden
misunderstandings and generates new answers, so the reported change can be
checked against the real one. Over 40 classes of 28 per subject, `npm test`
requires no more than 2 false calls when nothing was taught.

### A teacher's own test

A test that already exists on paper can be used as it is. Write it as a pack
file (JSON: misconceptions, and each question's options in her printed order,
with every wrong option tagged or left untagged as a slip), then **+ New
subject → Open a .json file**. The file is read in the tab and never uploaded,
and her option order is kept, so her "A" is the tool's "A". True/false
questions work.

**Materials → Print the labels for the teacher to check** gives her every
wrong answer with its label and a line to agree or fix it, plus a first page
for her predictions, written before she sees any result. Answers come back as
one row per student (S01, S02…) and one letter per question.

Keep teachers' tests in `local/`, which git ignores: the repo is public.

A real class has no hidden answers to score against, but it does have a teacher
who knows it. On a pasted class, **Does it work?** takes the predictions from
that first page and sets them against the result: how many she expected are
among the most common, what she did not expect, and what she expected that barely
appears. It only counts if they were written down first.

### Every diagnosis opens up

A tool that says *"Milo holds the sign-distribution misconception, 87%"* and
offers no way to check has asked for faith — and a teacher who cannot check
will, correctly, ignore it the first time it says something surprising.

So click any student. You get the confidence for each misunderstanding and,
under it, **the questions that produced that number**: which ones pointed to it,
which argued against it, and what they actually chose. Because the model is a
sum of one term per question, that trail is not an explanation written
afterwards — it is the arithmetic itself, taken apart again.

Click any question instead and you get how the class answered it, which
misunderstanding each wrong option corresponds to, and **the names of the
students who picked it**.

### Other things worth knowing

- **It works from the keyboard.** The class map is one tab stop and the arrow keys
  walk it like a spreadsheet; left and right move between the tabs.

- **Click a colour** in the key to show only that misunderstanding across the
  whole class map. **Show letters** marks every cell with a letter as well, for
  anyone who cannot tell the colours apart.
- **Every statistic has a "?"** next to it. Plain-language explanation of what it
  means, and what to do about the number in front of you.
- **Students** shows one group at a time, and search finds a name typed without
  its accents.
- **A whole year group fits.** Over 40 students the map's rows tighten, and on a
  computer the colour key moves above it.
- **What a paste turned up stays on the page**: a name pasted twice, a cell that
  could not be read, a class too small to group. A paste with no readable answers
  is refused.
- Groups are formed by *what students believe*, not by score — two students with
  very different grades routinely land in the same group, which is the point.
- Students with no stable misunderstanding are separated out rather than forced
  into a group. They are not a failure mode; they need practice, not a reteach.
- Students who left too much blank are separated out too, because no evidence is
  not the same as good news.

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

**1 · Distractor mapping** *(model-authored for generated subjects)*
A *subject pack* is a self-contained instrument: named misconceptions, an item
bank whose every wrong option maps to one of them, and archetypes describing
which misconceptions travel together. Wrong options carrying no diagnostic
meaning are tagged as slips so they contribute no signal.

Authoring one is the genuinely knowledge-intensive part of this exercise: it
needs someone who knows not just the content but the characteristic ways
students get it wrong. That is a task a language model is actually good at, so
for a new subject the model writes the instrument — and only the instrument. It
never sees a student response, never decides who holds what, never groups a
class, never judges an item. **The model builds the ruler; deterministic code
does the measuring.**

Generated packs are untrusted until `validatePack` says otherwise, because a
malformed pack would not throw — it would produce confident nonsense. Generation
is a loop: generate, validate, feed the specific structural failures back for
repair.

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
Each student becomes a point in misconception space. Two design
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
act on three groups and not on eleven. Students are put in a fixed order before
any of this runs, so the groups do not change with the order of the sheet.

**4 · Prescription.** Each failure mode gets a reteach aimed at the specific
belief, plus verification items. Then the paper is given again and each student
is compared with themselves (`js/compare.js`), so the loop closes on evidence
rather than on a feeling that the lesson went well.

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

| Metric (mean over 40 seeds) | Algebra 1 | Evolution & Inheritance |
| --- | --- | --- |
| Diagnosis precision | 91.3% | 96.3% |
| Diagnosis recall | 82.7% | 69.3% |
| Diagnosis F1 | **0.867** | **0.804** |
| Group recovery (Adjusted Rand Index) | **0.674** | **0.535** |
| Correct number of groups recovered | 36/40 | 30/40 |

Two deliberately defective questions are planted in the item bank — one trivial,
one ambiguously worded — and marked nowhere in the data. The item analysis has to
find them on its own. It catches the trivial one in 39/40 seeds and the ambiguous
one in 36/40.

Reproduce:

```bash
npm test
```

## Where the language model fits

Deliberately at the edge, not the centre. Everything above is deterministic
numeric code, and the reteach plans that ship are written by hand — so the page
is fully functional with no key, no network, and no account.

Two optional uses, both requiring a key. **Authoring a new subject** is the
substantial one, described above. The smaller one rewrites a reteach plan for the
specific *combination* of misconceptions a given group holds and its size.
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
index.html             single page, tabbed workspace
css/style.css
js/pack.js             the subject-pack contract + validation
js/packs/index.js      registry of built-in packs
js/packs/algebra1.js   12 misconceptions, 36 items
js/packs/biology.js     8 misconceptions, 24 items
js/generate.js         model-authored packs for any subject, with a repair loop
js/simulate.js         generative class model + planted ground truth
js/infer.js            naive Bayes misconception inference
js/cluster.js          cosine k-means, silhouette, adjusted Rand index
js/itemstats.js        item analysis + leave-one-out model agreement
js/validate.js         recovery scoring against planted truth
js/drawer.js           per-student evidence trail, per-question breakdown
js/importer.js         CSV/TSV import, printable quiz, answer sheet, plan export
js/session.js          save and reopen a class as a local file
js/compare.js          before-and-after comparison, exact McNemar test
js/a11y.js             focus handling for dialogs
js/explain.js          inline glossary written for teachers
js/llm.js              optional reteach adaptation, plain-language API errors
js/tour.js             first-visit intro and guided tour
js/notation.js         sets typed maths on screen
js/rng.js              seeded random numbers, so a class can be re-rolled
js/app.js              orchestration and rendering
og.png                 link-preview card
test/pipeline.test.mjs every built-in pack, the paper round trip, and the checks
                       on blanks, spreadsheets, saved classes, retests and the
                       model layer
```

## Honest limitations

- The class is **simulated**, not real. That buys a measurable ground truth and
  costs external validity: the response model is my model of how students err,
  so recovery figures describe the pipeline's consistency with that model, not
  its accuracy on a real classroom.
- Built-in item banks are hand-authored and cover two topics. A generated pack
  is only as good as the model that wrote it: the contract checks it is
  *structurally* sound (every misconception probed enough times, every
  distractor mapped, exactly one correct option) but cannot check that a
  distractor really is what that misconception produces. Treat a generated
  instrument as a first draft for a teacher to review, not a finished
  assessment.
- At 28 students, per-item statistics are noisy. Several items pick up marginal
  low-discrimination flags that are sample noise, which is why findings are
  ranked by severity and the marginal ones are collapsed. Below 28 the bars widen
  with the noise, which took a class of 12 from about 10 flags to about 7 on
  Algebra, at a cost of 4 points of planted-defect detection, and the page says
  the figures are rough under 20 students.
- Unanswered questions carry no evidence either way, rather than counting as
  wrong. So a student who skipped most of the paper has no diagnosis, which is
  not the same as a clean one. Anyone who answered under half the paper is moved
  out of "no reteach" into a separate **Not enough answers** group, and a
  misconception whose questions were left blank is listed as not tested on the
  student card. The 50% line is a judgement call, not a measured threshold.
- Misconceptions are treated as conditionally independent. Real ones co-occur
  causally — M07 and M11 are plausibly the same underlying failure — and a model
  with a dependency structure would do better.

## License

MIT
