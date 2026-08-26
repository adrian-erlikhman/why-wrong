/**
 * generate.js -- build a diagnostic instrument for any subject.
 * ---------------------------------------------------------------------------
 * This is where the language model earns its place, and it is worth being
 * precise about the division of labour.
 *
 * Authoring a misconception inventory is the genuinely hard, genuinely
 * knowledge-intensive part of this whole exercise. It takes a subject expert
 * who knows not just the content but the *characteristic ways students get it
 * wrong*, and then the patience to write distractors that each correspond to
 * exactly one of those wrong mental models. Real concept inventories take years
 * and multiple rounds of student interviews.
 *
 * That is a task a language model is actually good at, because it is recall and
 * composition over pedagogical content. So the model writes the instrument.
 *
 * What the model does NOT do is any of the analysis. It never sees a student
 * response, never decides who holds which misconception, never groups the
 * class, never judges an item. Those are arithmetic, and arithmetic is more
 * reliable and more inspectable. The model builds the ruler; the deterministic
 * pipeline does the measuring.
 *
 * Everything it returns is untrusted until `validatePack` says otherwise. A
 * malformed pack would not throw, it would silently produce confident nonsense,
 * so generation is a loop: generate, validate, and feed the specific structural
 * errors back for repair.
 */

import { validatePack, itemsProbing, MIN_PROBES } from './pack.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const MAX_REPAIRS = 2;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'generated';
}

function buildPrompt(topic, { misconceptionCount, probesPer }) {
  const itemCount = misconceptionCount * probesPer + 1;
  return `You are an assessment designer building a diagnostic instrument for this topic:

"${topic}"

A diagnostic instrument is not a quiz. Its purpose is not to rank students but to reveal *which specific wrong mental model* a student holds. That requires every wrong option to be engineered: each distractor must be the answer a student would produce if they held one particular, nameable misconception.

Produce exactly ${misconceptionCount} misconceptions and exactly ${itemCount} items.

Rules that are not negotiable:

1. Misconceptions must be REAL and DOCUMENTED errors that students of this subject actually make — the kind that survive instruction and reappear later. Not random wrong facts. If the topic is too narrow to support ${misconceptionCount} genuine misconceptions, broaden slightly within the same subject rather than inventing filler.
2. Every misconception must be probed by AT LEAST ${probesPer} different items. This is a hard requirement: the analysis holds items out one at a time, and with fewer probes it cannot function.
3. Each item has 4 options, exactly one correct. Wrong options are either tagged with the misconception id that produces them, or tagged null when they are just an undirected slip. Aim for 2 tagged distractors and 1 null per item.
4. A distractor tagged with a misconception must be genuinely what that misconception produces. Do not tag loosely.
5. Option text must be short and must be distinct within an item.
6. Include EXACTLY ONE deliberately weak item at the end, with "weak": "trivial" — something so easy that essentially every student answers correctly, so it separates nobody. This is a control: the item analysis must be able to find it unaided. Do not mark it in any other way.
7. Archetypes describe which misconceptions tend to co-occur in one student. Give 3 groups of related misconceptions, plus a final "broadly secure" group with an empty core.
8. The reteach must be a real instructional move a teacher could run — what to do, not a restatement of the misconception. 2-4 sentences.

Respond with JSON only. No prose, no code fence, no commentary.

{
  "name": "<short name for this instrument, 2-4 words>",
  "subject": "<the discipline, one or two words>",
  "level": "<approximate grade or course level>",
  "blurb": "<one sentence on what this instrument covers and why these errors matter>",
  "misconceptions": [
    {
      "id": "M01",
      "name": "<short name of the wrong belief>",
      "short": "<3-6 word label>",
      "belief": "<one sentence stating what the student wrongly believes>",
      "reteach": "<2-4 sentences: a concrete instructional move that targets this belief>",
      "verify": ["<check question 1>", "<check question 2>", "<check question 3>"]
    }
  ],
  "items": [
    {
      "id": "Q01",
      "topic": "<sub-topic>",
      "stem": "<the question>",
      "opts": [
        {"t": "<correct answer>", "c": true},
        {"t": "<distractor>", "mis": "M01"},
        {"t": "<distractor>", "mis": "M03"},
        {"t": "<distractor>", "mis": null}
      ]
    }
  ],
  "archetypes": [
    {"id": "A", "label": "<name of this profile>", "blurb": "<one sentence>", "core": ["M01","M02"], "weight": 0.28},
    {"id": "B", "label": "<name>", "blurb": "<one sentence>", "core": ["M03","M04"], "weight": 0.28},
    {"id": "C", "label": "<name>", "blurb": "<one sentence>", "core": ["M05","M06"], "weight": 0.26},
    {"id": "D", "label": "Broadly secure", "blurb": "No stable misconception; errors are slips.", "core": [], "weight": 0.18}
  ]
}`;
}

async function callModel(apiKey, messages, maxTokens = 16000) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();
  return (data.content || []).map(c => c.text || '').join('').trim();
}

function parsePack(text, topic) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The model did not return JSON.');

  let raw;
  try {
    raw = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`The model returned malformed JSON: ${e.message}`);
  }

  // Normalise into the pack shape. The model is asked for `weak` rather than
  // `_weak` because leading underscores invite it to omit the field entirely.
  const items = (raw.items || []).map(it => {
    const out = {
      id: it.id,
      topic: it.topic || raw.subject || '',
      stem: it.stem,
      opts: (it.opts || []).map(o => ({
        t: String(o.t ?? '').trim(),
        ...(o.c ? { c: true } : {}),
        ...(o.c ? {} : { mis: o.mis ?? null })
      }))
    };
    if (it.weak) out._weak = it.weak;
    return out;
  });

  return {
    id: `gen-${slugify(raw.name || topic)}`,
    name: raw.name || topic,
    subject: raw.subject || 'Generated',
    level: raw.level || '',
    blurb: raw.blurb || '',
    source: 'generated',
    topic,
    misconceptions: raw.misconceptions || [],
    items,
    archetypes: raw.archetypes || []
  };
}

/** Structural problems worth asking the model to repair, as instructions. */
function repairNotes(pack, report) {
  const notes = [...report.errors];
  pack.misconceptions.forEach(m => {
    const n = itemsProbing(pack, m.id).length;
    if (n < MIN_PROBES) {
      notes.push(`Misconception ${m.id} ("${m.name}") is probed by only ${n} item${n === 1 ? '' : 's'}. It needs at least ${MIN_PROBES}. Add items whose distractors are tagged ${m.id}.`);
    }
  });
  if (!pack.items.some(i => i._weak)) {
    notes.push('No item is marked "weak": "trivial". Exactly one is required as a control.');
  }
  return notes;
}

/**
 * Generate and validate a pack for an arbitrary topic.
 *
 * @param {string} apiKey
 * @param {string} topic     free text, e.g. "AP US History: causes of the Civil War"
 * @param {object} opts      { misconceptionCount, probesPer, onProgress }
 * @returns {Promise<{pack: object, report: object, attempts: number}>}
 */
export async function generatePack(apiKey, topic, {
  misconceptionCount = 8,
  probesPer = 3,
  onProgress = () => {}
} = {}) {
  if (!apiKey) throw new Error('An Anthropic API key is required to generate a new subject.');
  if (!topic || !topic.trim()) throw new Error('Give a subject or topic first.');

  const messages = [{ role: 'user', content: buildPrompt(topic.trim(), { misconceptionCount, probesPer }) }];

  onProgress({ stage: 'writing', attempt: 1, message: 'Writing the misconception taxonomy and item bank…' });
  let text = await callModel(apiKey, messages);
  let pack = parsePack(text, topic.trim());
  let report = validatePack(pack);
  let attempts = 1;

  // Repair loop. Structural failure is fed back specifically rather than as a
  // generic "try again", because the model fixes a named defect far more
  // reliably than it fixes an unnamed one.
  while ((!report.ok || repairNotes(pack, report).length) && attempts <= MAX_REPAIRS) {
    const notes = repairNotes(pack, report);
    if (!notes.length) break;

    onProgress({
      stage: 'repairing',
      attempt: attempts + 1,
      message: `Validating… ${notes.length} structural problem${notes.length === 1 ? '' : 's'} to repair.`,
      notes
    });

    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: `The instrument has structural problems that make it unusable:\n\n${notes.map(n => `- ${n}`).join('\n')}\n\nReturn the COMPLETE corrected JSON, same shape, with every problem fixed. Keep everything that was already valid. JSON only.`
    });

    text = await callModel(apiKey, messages);
    pack = parsePack(text, topic.trim());
    report = validatePack(pack);
    attempts++;
  }

  if (!report.ok) {
    throw new Error(`The generated instrument did not validate after ${attempts} attempts: ${report.errors.slice(0, 3).join('; ')}`);
  }

  onProgress({ stage: 'done', attempt: attempts, message: 'Instrument ready.' });
  return { pack, report, attempts };
}
