const cards = {
  seasonalDemand: ['forecast', 'acuteYear'],
  extraCapacity: ['extra'],
  unusedCapacity: ['unused'],
  routineDemand: ['routineTrend', 'routineYear'],
  waitingTimes: ['wait', 'priorWait'],
  forwardAvailability: ['available', 'horizon']
};
const insightVersion = 'home-insights-v2';
const counts = new Set(['extra', 'unused', 'available']);
const changes = new Set(['forecast', 'acuteYear', 'routineTrend', 'routineYear']);
const metricNames = Object.values(cards).flat();
function outputSchema(metrics) {
  const prose = "[A-Za-z .,;:!?()'’‘“”–—-]*";
  const properties = Object.fromEntries(Object.entries(cards).map(([card, allowed]) => {
    const supported = allowed.filter(key => metrics[key] !== null);
    if (!supported.length) return [card, {type:'string', enum:['']}];
    const placeholder = '\\{(' + supported.join('|') + ')\\}';
    return [card, {type:'string', pattern:'^(' + prose + placeholder + ')+' + prose + '$'}];
  }));
  return {type:'object', additionalProperties:false, required:Object.keys(cards), properties};
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: {...cors, 'Content-Type':'application/json', 'Cache-Control':'no-store'}
});

function sanitise(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Metrics required.');
  return Object.fromEntries(metricNames.map(key => {
    const n = input[key];
    if (n === null) return [key, null];
    if (!Number.isFinite(n) || Math.abs(n) > 1000000 ||
        (counts.has(key) && (!Number.isInteger(n) || n < 10)) ||
        (!changes.has(key) && n < 0) ||
        (changes.has(key) && !Number.isInteger(n)) ||
        (!changes.has(key) && !counts.has(key) && Math.round(n * 10) / 10 !== n)) throw Error('Invalid aggregate.');
    return [key, n];
  }));
}

function formatFact(key, value) {
  const number = new Intl.NumberFormat('en-GB', {maximumFractionDigits:1});
  if (changes.has(key)) {
    if (value === 0) return 'roughly unchanged';
    return number.format(Math.abs(value)) + '% ' + (value > 0 ? 'higher' : 'lower');
  }
  return number.format(value) + (counts.has(key) ? '' : value === 1 ? ' week' : ' weeks');
}

function renderBullets(output, metrics) {
  const result = {};
  let generated = 0;
  const rejected = [];
  for (const [card, allowed] of Object.entries(cards)) {
    const supported = allowed.filter(key => metrics[key] !== null);
    const text = typeof output?.[card] === 'string'
      ? output[card].trim().replace(/(\{(?:wait|priorWait|horizon)\})\s+weeks?\b/gi, '$1') : '';
    if (!supported.length) {
      result[card] = card === 'extraCapacity' ? null : 'There is not enough reportable data for this insight.';
      continue;
    }
    const refs = [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(m => m[1]);
    if (text.length > 260 || !refs.length || refs.some(key => !supported.includes(key)) ||
        !/^[A-Za-z .,;:!?()'’‘“”\u2013\u2014-]*$/.test(text.replace(/\{[a-zA-Z]+\}/g, ''))) {
      rejected.push(card);
      result[card] = null;
      continue;
    }
    result[card] = text.replace(/\{([a-zA-Z]+)\}/g, (_, key) => formatFact(key, metrics[key]));
    generated++;
  }
  return {bullets:result, generated, rejected};
}

const instructions = [
  'Write six short British English homepage insights for a GP practice operations dashboard, one sentence each.',
  'Only describe the supplied metrics. Treat a null as unavailable and leave the corresponding field empty when it has no usable metric.',
  'For every non-empty insight insert at least one supported metric as an exact placeholder, such as {forecast}. Never write literal numbers or percent signs.',
  'Example: Urgent bookings are forecast to be {forecast} compared with the recent average.',
  'Example: The latest diary shows {available} routine slots available up to {horizon} ahead.',
  'Placeholders for changes expand to a complete phrase such as “8% higher” or “roughly unchanged”.',
  'Use English letters and punctuation. The wait, priorWait and horizon placeholders already include the unit week or weeks. Never add a unit after them.',
  'Seasonal demand: {forecast} compares the next four forecast weeks of urgent bookings to the recent average; {acuteYear} compares recent bookings with the same weeks last year.',
  'Extra capacity: {extra} is booked urgent Extra slots over the last four complete weeks.',
  'Unused capacity: {unused} is previously unfilled urgent slots in the latest imported snapshot, looking at the last four complete weeks.',
  'Routine demand: {routineTrend} compares bookings with the preceding four weeks; {routineYear} compares with the equivalent period last year.',
  'Waiting times: {wait} and {priorWait} are median booking-to-appointment waits in weeks for the latest and preceding 28-day periods.',
  'Forward availability: {available} is the number of routine slots marked available; {horizon} is how many weeks ahead the furthest available slot is, never a forecast or run-out date.',
  'Keep forecast and actual activity distinct. Do not infer reasons, clinician or patient identities, causes, or detail not present. Do not give clinical advice.'
].join(' ');

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, {headers:cors});
  if (request.method !== 'POST') return json(405, {error:'Method not allowed.'});
  const token = request.headers.get('Authorization');
  if (!token?.startsWith('Bearer ')) return json(401, {error:'Sign in to continue.'});
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  let stage = 'authentication';
  try {
    const identity = await fetch(url + '/auth/v1/user', {headers:{apikey:publicKey, Authorization:token}});
    if (!identity.ok) return json(401, {error:'Sign in to continue.'});
    const user = await identity.json();
    const raw = await request.text();
    if (raw.length > 2500) return json(400, {error:'The insights request is too large.'});
    let body, metrics;
    try {
      body = JSON.parse(raw);
      if (!uuid.test(body.practice) || !/^\d{4}-\d{2}-\d{2}$/.test(body.period)) throw Error();
      metrics = sanitise(body.metrics);
    } catch { return json(400, {error:'The insights request is invalid.'}); }
    if (Object.values(metrics).every(value => value === null)) return json(422, {error:'There are no reportable figures for AI insights yet.'});
    const key = Deno.env.get('HOME_INSIGHTS_OPENAI_API_KEY');
    if (!key) return json(503, {error:'AI insights are awaiting API setup.'});
    const headers = {apikey:serviceKey, Authorization:'Bearer '+serviceKey, 'Content-Type':'application/json'};
    const attempt = crypto.randomUUID();
    stage = 'reservation';
    const claim = await fetch(url + '/rest/v1/rpc/iq_claim_home_insight_refresh', {
      method:'POST', headers, body:JSON.stringify({p_practice:body.practice,p_user:user.id,p_attempt:attempt})
    });
    if (!claim.ok) throw Error('Claim failed.');
    const claimed = await claim.json();
    if (claimed === 'forbidden') return json(403, {error:'Practice administrator access is required.'});
    if (claimed !== 'claimed') return json(429, {error:'Wait 30 seconds between regenerations. Each practice can regenerate up to 30 times a day.'});
    stage = 'openai_request';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(20000),
      body:JSON.stringify({
        model:'gpt-5.4-nano', store:false, reasoning:{effort:'none'}, max_output_tokens:900,
        instructions, input:JSON.stringify(metrics),
        text:{format:{type:'json_schema',name:'practice_overview',strict:true,schema:outputSchema(metrics)}}
      })
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const reported = failure?.error?.code;
      const code = typeof reported === 'string' && /^[a-z0-9_]{1,50}$/.test(reported) ? reported : 'unknown';
      console.warn(JSON.stringify({event:'home_insights_provider_error', status:response.status, code}));
      if (['credit_balance_exhausted','insufficient_quota','billing_hard_limit_reached'].includes(code)) {
        return json(503, {error:'OpenAI billing or credits are required for AI insights.'});
      }
      if (response.status === 401) return json(503, {error:'OpenAI rejected the API key. Check the key saved in Supabase.'});
      if (response.status === 403 || code === 'model_not_found') {
        return json(503, {error:'The OpenAI project or API key lacks access to the configured model or Responses API.'});
      }
      if (response.status === 429) return json(503, {error:'OpenAI is rate limiting requests. Try regenerating in a minute.'});
      return json(502, {error:'OpenAI could not process this generation request.'});
    }
    stage = 'openai_output';
    const answer = await response.json();
    if (answer.status !== 'completed') {
      stage = answer.incomplete_details?.reason === 'max_output_tokens' ? 'openai_token_limit' : 'openai_incomplete';
      throw Error('Generation did not complete.');
    }
    const output = answer.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text');
    if (!output?.text) { stage = 'openai_missing_text'; throw Error('No text response.'); }
    stage = 'openai_invalid_json';
    const {bullets, generated, rejected} = renderBullets(JSON.parse(output.text), metrics);
    if (rejected.length) console.warn(JSON.stringify({event:'home_insights_cards_rejected', cards:rejected}));
    if (!generated) { stage = 'openai_no_valid_cards'; throw Error('No verified insights.'); }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([body.period, metrics, insightVersion])));
    const snapshot = [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,'0')).join('');
    stage = 'save';
    const saved = await fetch(url + '/rest/v1/iq_home_insights?practice_id=eq.'+body.practice+'&attempt_id=eq.'+attempt, {
      method:'PATCH', headers:{...headers,Prefer:'return=representation'},
      body:JSON.stringify({snapshot, bullets, generated_at:new Date().toISOString()})
    });
    if (!saved.ok) throw Error('Save failed.');
    const [record] = await saved.json();
    if (!record) return json(409, {error:'A newer regeneration is in progress.'});
    return json(200, {snapshot:record.snapshot,bullets:record.bullets,generated_at:record.generated_at});
  } catch {
    console.warn(JSON.stringify({event:'home_insights_failed', stage}));
    return json(502, {error:stage.startsWith('openai_') && stage !== 'openai_request'
      ? 'The AI response could not be verified against the dashboard figures. Try regenerating.'
      : 'AI insights could not be generated. The existing overview is still available.'});
  }
});
