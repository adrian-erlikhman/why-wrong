# Why Wrong

**"You got it wrong" is the least useful sentence in education.**

A red X says which answer was wrong, but not why. Why Wrong looks for response
patterns that may point to a misunderstanding, groups students with similar
patterns, and helps teachers review which questions gave useful information.
Its results are estimates to check against student work and teacher judgment,
not confirmed explanations of what a student thinks.

**Use a built-in subject or draft a new one.** Algebra 1 and Evolution &
Inheritance ship with the page. For another topic, an AI model can draft a
misconception list and question bank. Structural checks catch missing or
inconsistent fields, but do not verify subject accuracy or whether a question
really identifies the misunderstanding it is intended to test.

**Live:** https://adrian-erlikhman.github.io/why-wrong/
**Class names and answer sheets stay in the browser.** No account is needed.
Optional AI features send the topic or group-level misconception details to
Anthropic with the API key you provide; they do not send student names or raw
answers.

A first visit opens a short guided tour of the real page (the map, the sort, a
reteach group, the test audit, the recovery numbers); **Take the tour** replays
it.

Deep links: `?view=groups` (or `students`, `items`, `progress`, `validation`, `method`) opens a tab
directly; `?sorted=1` starts with the class map already sorted into groups. Deep
links never open the tour; `?demo=1` forces it and `?demo=0` suppresses it.

---

## Using it with a real class

The loop closes in both directions, on paper.

1. **Pick a subject**, or draft a question set for a topic you teach.
2. **Materials** prints the questions and the answer key, or downloads a blank
   answer sheet as a spreadsheet with one column per question.
3. Give it. Mark it, or don't — you only need which option each student picked.
4. **Class → Paste my class** and paste the sheet back in. Letters, numbers, or
   the answer text all work. A Google Forms export works as it comes: timestamp,
   email and score columns are stepped over, and questions are matched by their
   text. With no name column, the part of the email before the @ becomes the
   name. A row called Key is left out, so is a totals row like Average, and a repeated name is flagged. Blanks are
   read as unanswered rather than wrong. Letters and numbers mean what is printed on
   the paper: each question's options are shuffled, seeded by its id, so the
   key is not "A" every time and the printout, the answer key and the paste-back
   always agree.
5. Review groups based on similar response patterns, suggested plans, and an
   audit of your questions.
   **Print plan** puts the groups on paper; **Export CSV** puts them in a
   spreadsheet.

There is no Why Wrong server or account. Student names and raw answers stay in
the tab. If you choose an AI feature, the topic or group-level misconception
details needed for that request are sent to Anthropic.

**Students → Print student slips** gives each student their own slip to go back
with the paper: what their answers may suggest, and check questions for review.
Slips carry no percentages or group numbers, and each one says it is an estimate,
not a grade. Each misunderstanding has a `student` line
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

A test built with **+ New subject** is only in the tab too, and the answers come
back days after it prints. The page says so until it is saved, **Save test** writes
it to a file, and **+ New subject → Open a .json file** brings it back with the same
letters as the paper.

### After the reteach

Give the same paper again and paste the new answers into **After the reteach**.
Students with a unique matching name are compared across sittings. A pattern is
counted as no longer indicated only when enough of its questions were answered
both times; the comparison is based on estimates, not a confirmed change in
understanding.

The counts alone would mislead, because diagnoses near the line flip between
sittings with no teaching at all. What carries information is the split: how
many students lost a misconception against how many gained it. The page runs an
exact McNemar test on that split and says plainly when a change could be chance.
Sitting the same paper twice also teaches the paper, so a good result is evidence
rather than proof.

The tab also summarizes each reteach group: how many students had its main
pattern indicated before and no longer indicated after, how many still had it
indicated, and which students were not tested. These are changes in the
analysis, not proof that understanding changed. **Print** puts the summary on
paper with names.

On the sample class, **Simulate a reteach** removes 70% of each student's hidden
misunderstandings and generates new answers, so the reported change can be
checked against the real one. Over 40 classes of 28 per subject, `npm test`
requires no more than 2 false calls when nothing was taught.

### A teacher's own test

A test that already exists on paper can be used as it is. Write it as a pack
file (JSON: misconceptions, and each question's options in its printed order,
with wrong options linked to a possible misunderstanding or left unlinked), then
**+ New subject → Open a .json file**. The file is read in the tab and never
uploaded, and its option order is kept, so the printed letters stay consistent.
True/false
questions work, and T and F read on them.

**Materials → Print the labels for the teacher to check** lists each
wrong answer with its label and a line to agree or fix it, plus a first page
for predictions, written before results are shown. Answers come back as
one row per student (S01, S02…) and one letter per question.

Keep teachers' tests in `local/`, which git ignores: the repo is public.

A real class has no hidden answers to score against, but it does have a teacher
who knows it. On a pasted class, **Does it work?** compares predictions recorded
on that first page with the patterns that appear most often. Treat any
agreement or surprise as a prompt for review, not as proof that either the
prediction or the analysis is correct.

### Every diagnosis opens up

A tool that says *"Milo's answers suggest a sign-distribution misunderstanding,
87%"* should also show how it reached that estimate. Teachers need a way to
review the evidence, especially when a result is surprising.

Click a student to see the estimate for each misunderstanding and **the
questions that contributed to it**: which answers supported the pattern, which
argued against it, and what the student chose. This evidence trail shows the
calculation behind the estimate; it does not independently confirm the
student's thinking.

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
- Groups are formed from *answer patterns*, not scores. Students with different
  grades can show similar patterns.
- Students with no clear pattern are kept out of the reteach groups. This does
  not establish that they have no misunderstandings; it means the test did not
  identify a stable pattern.
- Students who left too much blank are separated out too, because no evidence is
  not the same as good news.
- Of the students with no clear pattern, those still **getting most questions
  wrong** are named separately: scattered errors that frequent point to a gap or
  guessing, which needs practice and a check-in rather than a reteach.
- An estimate needs **two answers pointing to it** to be reported. One resting on
  a single answer is shown as **worth one more question**, with the question to
  ask.
- Each reteach group says how many of its members hold its main pattern, and
  **who else to bring in**: students in other groups who show it too.
- The student or question panel **steps through** the list it was opened from
  (‹ ›, or the left and right arrow keys).
- The question audit can say **check the key**: the strongest students favour one
  wrong answer, and nothing else on the paper suggests they hold the
  misunderstanding it was written for.

## The idea

Most assessment tooling reports *that* a student was wrong. Response patterns
can offer clues about *why*, but an answer alone cannot establish what a student
was thinking.

That is possible only if the test is built for it. Wrong options in these item
banks are linked to possible misunderstandings when they are designed to
represent one; other options are left unlinked. The mapping is a hypothesis
about what an answer may indicate, and should be reviewed before using the
results to plan instruction.

From there the tool answers three questions:

1. **Which patterns may this student's answers indicate?** — estimated, not read off.
2. **What response patterns does the class share?** — a starting point for planning.
3. **Which questions merit review?** — the response matrix also summarizes item performance.

## Pipeline

Four stages. **Two of them are not a language model.**

**1 · Distractor mapping** *(model-authored for generated subjects)*
A *subject pack* is a self-contained instrument: named misconceptions, an item
bank with wrong options linked to possible misunderstandings where appropriate,
and archetypes describing which misconceptions may co-occur. Unmapped options
contribute no signal; the reason a student chose one cannot be known from the
answer alone.

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
assumption that also makes Bayesian knowledge tracing tractable. Each term is
the likelihood ratio of a mixture: a held misconception either **fires** and
sends the student to its distractor, or it does not and they answer like anyone
else. Three refinements make it hold up on a real class, each kept only because
the stress benchmark (below) showed it helped:

- **Explaining away.** A question can probe two or three misconceptions that
  travel together, and a student who holds them all can only show one. Each
  question's evidence is averaged over whether the other misconceptions it
  probes are held (exact, a handful of combinations), solved in passes.
- **Each student's own accuracy.** A student who gets half of everything wrong
  lands on a given distractor by chance often enough that it proves little, so
  accuracy where no misconception fires is estimated per student, shrunk toward
  the class.
- **Tempting options.** Where each question's slips land is estimated from the
  class, so a wrong answer that tempts everyone is not read as a misconception.

Both estimates need five students; below that the fixed parameters stand. An
estimate is reported above 0.6 **and on at least two answers that point to it**:
on the benchmark, one resting on a single answer was right 42% of the time, on
two 79%, on three or more 97%. Fitting the fire rate and each misconception's
prevalence to the class was tried and left out: it lowered F1 and group
recovery. The likelihood parameters are exported and shown in the UI rather
than buried, because they are assumptions rather than facts.

**3 · Class structure** *(no LLM — `js/cluster.js`)*
Each student becomes a point in misconception space. Two design
decisions matter more than the choice of algorithm:

- Students with no confidently indicated misconception are **separated out
  before** clustering. This avoids forcing students without a clear pattern into
  a group; it does not establish that they have no misunderstandings.
- The rest are compared by **direction, not magnitude** — posteriors are
  L2-normalised so k-means operates on cosine similarity. A student who
  expresses the sign misconceptions weakly belongs with those who express them
  strongly; under plain Euclidean distance they'd look like someone with no
  misconception at all.

k is chosen by mean silhouette, ties broken toward *fewer* groups. A teacher can
act on three groups and not on eleven. Students are put in a fixed order before
any of this runs, so the groups do not change with the order of the sheet.

**4 · Next steps.** Each indicated group gets a reteach suggestion and
verification items. The paper can then be given again and results compared for
students with unique matching names (`js/compare.js`). This summarizes changes
in the estimates; it cannot establish that a lesson caused a change in
understanding.

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

Before flagging an item, the tool checks whether it **agrees with the rest of the
test**: do the students who chose an answer mapped to its main pattern show that
pattern in their responses to other items *clearly more often than the rest of
the class does*? (Lift of at least 0.15 and a one-sided z of at least 1.64; on
the benchmark the lift averages 0.34–0.50 on sound questions and about 0 on flat
or miskeyed ones.) The item's own contribution is subtracted from the estimate
for this comparison. Agreement is useful evidence for review, not independent
proof that the item is valid.

Low agreement plus low discrimination can flag an item for review. Low
discrimination with high agreement may point to a diagnostic item worth keeping,
but the teacher should still review the question and its response patterns.

For questions without mapped distractors, comparisons with random guessing use
exact binomial probabilities rather than a normal approximation. Results that
are unusually below chance are called out separately from results that are
simply inconclusive. Discrimination is left unavailable when too few students
answered or their scores on the other questions do not vary enough to calculate
a meaningful correlation.

Discrimination is a correlation over a few dozen students, so it is called low
or backward only when the top of its 80% interval is low too; otherwise the
question is **too early to tell**, not flagged. "Often skipped" means skipped
clearly more than the rest of the paper (or by half the class). And **check the
key** fires when the strongest third favour one wrong option over the key and
its choosers show no sign of its pattern elsewhere.

Similarly, Cronbach's alpha may be low here. Alpha assumes a single underlying
trait, while this instrument targets several distinct misconceptions. A low
value is not by itself evidence that the test is unreliable; interpret it
alongside the item-level results.

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
| Diagnosis precision | 92.5% | 94.5% |
| Diagnosis recall | 83.2% | 88.0% |
| Diagnosis F1 | **0.875** | **0.910** |
| Group recovery (Adjusted Rand Index) | **0.691** | **0.649** |
| Correct number of groups recovered | 36/40 | 36/40 |

Deliberately weak questions are planted in the item bank — one trivial, one
ambiguously worded — and marked nowhere in the analysis data. The item analysis
flags Algebra's trivial one in 39/40 seeds, its ambiguous one in 37/40, and
Biology's in 40/40. These results describe the simulation, not how reliably real
classroom items will be flagged.

### Stress test: classes that break the model's assumptions

The table above is measured on classes generated exactly the way the model
assumes, which flatters it. `test/benchmark.mjs` runs both packs over ten kinds
of class that each break one assumption: distractors that fire less (55%) or
more (92%) reliably, wrong options that tempt everyone, a weaker or stronger
class, rarer misconceptions, 15% blanks, and classes of 14 and 90. It also
plants a flat question and a miskeyed one next to the built-in weak questions.
Averaged over every scenario, 40 seeds each:

| | Before (3 Nov, 13:46) | Now |
| --- | --- | --- |
| Diagnosis F1 | 0.799 | **0.868** |
| False diagnoses per student, weakest quarter of the class | 0.42 | **0.34** |
| … in a weaker class (Algebra) | 1.31 | **0.40** |
| … with tempting options (Algebra) | 1.55 | **0.90** |
| Calibration error (when it says 80%, is it right 80%?) | 0.048 | **0.020** |
| Group recovery (ARI) | 0.588 | **0.650** |
| Sound questions flagged for review, per class | 4.03 | **1.30** |
| Miskeyed questions named as such | never | **40–93%** |

Where it costs something: flat questions (strong and weak students alike) are
flagged less often in small classes, about half the time at 28 students, with
another tenth marked too early to tell; and precision is a point lower on
Biology's default class (96.7% → 94.5%) as recall rose from 66.6% to 88.0%.

Reproduce:

```bash
npm test
node test/benchmark.mjs
```

## Where the language model fits

Deliberately at the edge, not the centre. Everything above is deterministic
numeric code, and the reteach plans that ship are written by hand — so the page
is fully functional with no key, no network, and no account.

Two optional uses, both requiring a key. **Authoring a new subject** is the
substantial one, described above. The smaller one rewrites a reteach plan for the
specific *combination* of patterns attributed to a group and its size.
That's an appropriate use of a language model — generating prose conditioned on
structured input — rather than asking it to analyze student responses. Review
generated plans before using them. The key is held in the tab only, never stored,
and sent only to `api.anthropic.com`.

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
js/infer.js            misconception inference, evidence levels
js/cluster.js          cosine k-means, silhouette, adjusted Rand index
js/itemstats.js        item analysis, leave-one-out agreement, key check
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
test/benchmark.mjs     stress scenarios, planted flat and miskeyed questions
```

## Honest limitations

- The class is **simulated**, not real. That provides known profiles for testing,
  but limits external validity: recovery figures describe the pipeline's
  consistency with the simulation's assumptions, not
  its accuracy on a real classroom. The stress benchmark varies those
  assumptions, but its scenarios are still a model of how students err.
- Built-in item banks are hand-authored and cover two topics. A generated pack
  is only as good as the model that wrote it: the contract checks it is
  *structurally* sound (every misconception probed enough times, each wrong
  option mapped or left unlinked, exactly one correct option) but cannot check that a
  distractor really is what that misconception produces. Treat a generated
  instrument as a first draft for a teacher to review, not a finished
  assessment.
- At 28 students, per-item statistics are noisy. Low discrimination is reported
  only when its interval is low throughout, and otherwise as too early to tell,
  which brought sound questions flagged per class from about 4 to about 1.3 on
  the stress benchmark, at the cost of catching flat questions less often in
  small classes. The page says the figures are rough under 20 students.
- Unanswered questions carry no evidence either way, rather than counting as
  wrong. A student who skipped most of the paper may have too little evidence
  for a useful estimate; that is not the same as a clean result. Students in the
  no-pattern group who answered under half the paper are moved to a separate
  **Not enough answers** group. A pattern with too few answered questions is
  listed as not tested on the student card and is not used as a diagnosis or
  for grouping. At least two questions mapped to a pattern must be answered
  before the estimate is reported. The 50% line is a judgement call, not a
  measured threshold.
- Misconceptions are treated as conditionally independent. In practice, some
  response patterns may overlap or share an underlying cause; the model does
  not represent those dependencies.

## License

MIT
