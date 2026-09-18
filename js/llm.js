/**
 * llm.js -- optional language-model layer.
 * ---------------------------------------------------------------------------
 * Everything the tool concludes is computed without this file. The inference,
 * the clustering, the item analysis and the validation are all deterministic
 * numeric code, and the reteach plans shipped in curriculum.js are written by
 * hand. So the page works fully with no key, no network, and no account, which
 * is the only sane default for something a teacher might open once.
 *
 * What a model adds is adaptation: rewriting a generic reteach plan for the
 * specific combination of misconceptions *this* cluster actually holds, and for
 * its size. That is a genuine improvement and a genuinely appropriate use of a
 * language model -- generating prose conditioned on structured input -- rather
 * than asking it to do the diagnosis, which it would do less reliably than
 * arithmetic does.
 *
 * The key lives in a module-scoped variable for the lifetime of the tab. It is
 * never written to localStorage, never logged, and never sent anywhere except
 * api.anthropic.com.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

let apiKey = null;

export function setKey(k) { apiKey = k ? k.trim() : null; }
export function hasKey() { return !!apiKey; }
export function clearKey() { apiKey = null; }

/**
 * A failed API call, as a sentence a teacher can act on. The raw error body is
 * JSON ({type: "error", error: {type, message}}), which is noise to anyone who
 * is not a developer; the status code says what actually went wrong.
 */
export async function apiFailure(res) {
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* body was not JSON */ }
  const why = detail ? `: ${detail}` : '.';
  const say = {
    400: `The API turned the request down${why}`,
    401: 'Anthropic did not accept that API key. Check it was pasted in full (it starts with sk-ant-) and has not been revoked.',
    403: `That key is not allowed to make this request${why}`,
    404: `The model this tool uses is not available to that key${why}`,
    413: 'The request was too large for the API.',
    429: 'That key has hit its rate limit. Wait a minute, then try again.'
  }[res.status] ?? (res.status >= 500
    ? 'Anthropic’s API is overloaded or having trouble right now. Try again in a minute.'
    : `The API returned an error${why}`);
  return new Error(`${say} (HTTP ${res.status})`);
}

/** fetch() itself rejecting: the request never got an answer at all. */
export function networkFailure() {
  return new Error('Could not reach api.anthropic.com. Check your connection, or whether a browser extension is blocking it, and try again.');
}

/**
 * Rewrite one cluster's reteach plan.
 * @param {object} cluster  { size, signature: [{id, inMean}], misDetails: [...] }
 * @returns {Promise<{headline: string, plan: string, verify: string[]}>}
 */
export async function rewritePlan(cluster, classSize) {
  if (!apiKey) throw new Error('No API key set.');

  const profile = cluster.misDetails.map(m =>
    `- ${m.id} "${m.name}": ${m.belief}\n  Standard remedy: ${m.reteach}`
  ).join('\n');

  const prompt = `You are helping a mathematics teacher plan a reteach for one group within their class.

The class has ${classSize} students. This group contains ${cluster.size} of them. A diagnostic analysis found that these students share the following misconceptions:

${profile}

Write a single focused reteach plan for this group specifically. Requirements:
- Address the combination above as one coherent session, not as a list of separate fixes. Where two of these misconceptions share a root cause, say so and teach the root cause.
- 10-15 minutes of class time. Be concrete about what the teacher does and says.
- No preamble, no restating the task, no headings.
- Then give exactly 3 short verification questions that would show whether it worked.

Respond as JSON only, with this exact shape:
{"headline": "<6 words or fewer naming the root cause>", "plan": "<2-4 sentences>", "verify": ["<q1>", "<q2>", "<q3>"]}`;

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch {
    throw networkFailure();
  }

  if (!res.ok) throw await apiFailure(res);

  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('').trim();

  // The model is asked for bare JSON, but tolerate a fenced block.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return usable JSON.');

  const parsed = JSON.parse(match[0]);
  if (!parsed.plan || !Array.isArray(parsed.verify)) {
    throw new Error('Model response was missing required fields.');
  }
  return {
    headline: String(parsed.headline || '').slice(0, 80),
    plan: String(parsed.plan),
    verify: parsed.verify.slice(0, 3).map(String)
  };
}
