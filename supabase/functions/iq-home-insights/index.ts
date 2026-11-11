const legacyCards = {
  seasonalDemand: ['forecast', 'acuteYear'],
  extraCapacity: ['extra'],
  unusedCapacity: ['unused'],
  routineDemand: ['routineTrend', 'routineYear'],
  waitingTimes: ['wait', 'priorWait'],
  forwardAvailability: ['available', 'horizon']
};
const expandedCards = {
  seasonalDemand: legacyCards.seasonalDemand,
  extraCapacity: legacyCards.extraCapacity,
  unusedCapacity: legacyCards.unusedCapacity,
  forecastPeak: ['peak', 'peakChange'],
  routineDemand: legacyCards.routineDemand,
  waitingTimes: legacyCards.waitingTimes,
  forwardAvailability: ['riskSlots'],
  routineUnused: ['routineUnused']
};
const bulletFields = Object.fromEntries(Object.values(expandedCards).flat().map(key => [key,[key]]));
const findingCards = {
  seasonalDemand: ['forecast','acuteYear','acuteSeason','acuteVariation'],
  extraCapacity: ['extra','extraGroupCount'],
  unusedCapacity: ['unused','unusedGroupCount'],
  forecastPeak: ['peak','peakChange'],
  routineDemand: ['routineTrend','routineYear','routineSeason','routineVariation','routineForecast'],
  waitingTimes: ['wait','priorWait','longWait','shortWait','waitGap'],
  forwardAvailability: ['riskSlots','riskCover'],
  routineUnused: ['routineUnused','routineUnusedGroupCount']
};
const detailedFindingCards = {
  ...findingCards,
  waitingTimes: [...findingCards.waitingTimes,'middleWait'],
  forwardAvailability: [...findingCards.forwardAvailability,'riskCoverDays']
};
const findingLabels = {
  extraGroupCount:'extraGroup', unusedGroupCount:'unusedGroup', peak:'peakWeek',
  longWait:'longestGroup', shortWait:'shortestGroup', riskSlots:'riskGroup',
  riskCover:'riskGroup', riskCoverDays:'riskGroup', middleWait:'middleGroup', routineUnusedGroupCount:'routineUnusedGroup'
};
const seasonalFacts = new Set(['acuteSeason','routineSeason']);
const variationFacts = new Set(['acuteVariation','routineVariation']);
const dayFacts = new Set(['longWait','shortWait','waitGap','middleWait','riskCoverDays']);
const counts = new Set(['extra', 'unused', 'available', 'peak', 'riskSlots', 'routineUnused', 'extraGroupCount', 'unusedGroupCount', 'routineUnusedGroupCount']);
const changes = new Set(['forecast', 'acuteYear', 'routineTrend', 'routineYear', 'peakChange', 'routineForecast']);
function outputSchema(metrics, cards) {
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

function sanitise(input, cards) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Metrics required.');
  return Object.fromEntries(Object.values(cards).flat().map(key => {
    const n = input[key];
    if (n === null) return [key, null];
    if (seasonalFacts.has(key) && [-1,0,1].includes(n)) return [key,n];
    if (!Number.isFinite(n) || Math.abs(n) > 1000000 ||
        (seasonalFacts.has(key)) ||
        (counts.has(key) && (!Number.isInteger(n) || n < 10)) ||
        (!changes.has(key) && n < 0) ||
        ((changes.has(key) || variationFacts.has(key)) && !Number.isInteger(n)) ||
        (!changes.has(key) && !counts.has(key) && Math.round(n * 10) / 10 !== n)) throw Error('Invalid aggregate.');
    return [key, n];
  }));
}

function formatFact(key, value, plain) {
  const number = new Intl.NumberFormat('en-GB', {maximumFractionDigits:1});
  if (changes.has(key)) {
    if (value === 0) return 'roughly unchanged';
    return number.format(Math.abs(value)) + '% ' + (plain ? (value > 0 ? 'more' : 'fewer') : (value > 0 ? 'higher' : 'lower'));
  }
  return number.format(value) + (counts.has(key) ? '' : value === 1 ? ' week' : ' weeks');
}

function renderBullets(output, metrics, cards) {
  const plain = cards === bulletFields;
  const result = {};
  let generated = 0;
  const rejected = [];
  for (const [card, allowed] of Object.entries(cards)) {
    const supported = allowed.filter(key => metrics[key] !== null);
    const text = typeof output?.[card] === 'string'
      ? output[card].trim().replace(/(\{(?:wait|priorWait|horizon)\})\s+weeks?\b/gi, '$1') : '';
    if (!supported.length) {
      result[card] = cards !== legacyCards || card === 'extraCapacity' ? null : 'There is not enough reportable data for this insight.';
      continue;
    }
    const refs = [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(m => m[1]);
    const awkward = plain && (refs.length !== 1 || /\b(?:compares?|represents?|placeholder|headline|snapshot|corresponds?)\b/i.test(text));
    if (awkward || text.length > (plain ? 125 : 260) || !refs.length || refs.some(key => !supported.includes(key)) ||
        !/^[A-Za-z .,;:!?()'’‘“”\u2013\u2014-]*$/.test(text.replace(/\{[a-zA-Z]+\}/g, ''))) {
      rejected.push(card);
      result[card] = null;
      continue;
    }
    result[card] = text.replace(/\{([a-zA-Z]+)\}/g, (_, key) => formatFact(key, metrics[key], plain));
    generated++;
  }
  return {bullets:result, generated, rejected};
}

const legacyInstructions = [
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

const expandedInstructions = [
  'Write the short British English evidence sentences that sit under eight verified headlines on a GP practice dashboard.',
  'Use only the supplied aggregates. Each sentence must use at least one supported metric as an exact placeholder, like {forecast}. Use all non-null metrics for that card where possible. Return an empty string for cards with only null metrics.',
  'Never use literal numbers or percent signs. Change placeholders include direction, for example “8% higher” or “roughly unchanged”. Wait placeholders include weeks. Use English letters and punctuation.',
  'Seasonal demand: {forecast} compares the next four forecast weeks of urgent bookings with the recent average. {acuteYear} compares recent bookings with the same four weeks last year. The headline already assesses seasonality separately.',
  'Extra capacity: {extra} urgent Extra slots were booked in the last four complete weeks.',
  'Unused capacity: {unused} urgent slots remained unfilled in the last four complete weeks according to the latest snapshot.',
  'Peak demand: {peak} is the number of urgent bookings forecast in the busiest of the next four forecast weeks. {peakChange} compares that week with the recent weekly average.',
  'Routine demand: {routineTrend} compares routine bookings with the preceding four weeks. {routineYear} compares with the same four weeks last year. The headline already assesses seasonality separately.',
  'Waiting times: {wait} and {priorWait} are median routine booking-to-appointment waits for the latest and preceding periods.',
  'Forward availability: {riskSlots} routine slots in the uploaded diary are available for the clinician group and consultation mode named in the headline. Do not invent the group, mode, dates, or a time to run out.',
  'Routine unused capacity: {routineUnused} routine slots remained unfilled in the last four complete weeks according to the latest snapshot.',
  'Keep forecasts and observed activity distinct. Never infer the cause, identify clinicians or patients, or give clinical advice.'
].join(' ');

const bulletInstructions = [
  'Write brief, conversational British English for a GP practice dashboard. Each field is a separate bullet, with one finding per bullet. Aim for under sixteen words. Lead with what happened or what to expect.',
  'Use each field’s own placeholder exactly once. Use no digits, percent signs, or facts beyond the supplied metrics. Write an empty string for a null field.',
  'Change placeholders become phrases such as “eight per cent more”, “eight per cent fewer” or “roughly unchanged”. Choose grammar that fits the sign of the supplied figure.',
  'Use the following examples as patterns. For non-zero forecast: Expect {forecast} urgent bookings than the recent average. For non-zero acuteYear: Urgent bookings were {acuteYear} than in the same weeks last year.',
  'For extra: The practice booked {extra} urgent Extra slots in the last four weeks. For unused: {unused} urgent slots went unused in the last four weeks.',
  'For peak: Expect around {peak} urgent bookings in the busiest week. For non-zero peakChange: That is {peakChange} than the recent weekly average.',
  'For non-zero routineTrend: There were {routineTrend} routine bookings than in the previous four weeks. For non-zero routineYear: Routine bookings were {routineYear} than in the same weeks last year.',
  'For wait: The median wait was {wait} for appointments booked at least a day ahead. For priorWait: The median for the previous period was {priorWait}. Both wait fields already include their unit.',
  'For riskSlots: The diary has {riskSlots} slots open for this group. For routineUnused: {routineUnused} routine slots went unused over the last four weeks.',
  'Avoid technical or meta language such as “compares”, “represents”, “according to the latest snapshot” or references to a headline. Never invent a date, clinician group, cause or action.'
].join(' ');

const findingInstructions = [
  'Write the key insights for a GP practice dashboard in brief, conversational British English. Make each bullet specific and easy to read at a glance. Lead with the finding and use natural wording of your own.',
  'Choose what is worth highlighting within each card. Use up to three bullets, fewer when there is little to add. Each bullet should add something: a comparison, an outlier, a gap, a point of concern, a trend, a seasonal change, a forecast or an indication of volatility. Related bullets are welcome when they add different information. Avoid filler and repeated comparisons.',
  'Ground each bullet in the figures provided for its card. Use named placeholders in braces for numerical facts and report labels. Omit null facts. The app inserts the displayed numbers and labels. For a figure with an accompanying report label, include both placeholders in the same bullet. The input lists the label keys next to their figures. You can combine facts in one bullet. Avoid guessing causes or inventing figures.',
  'For forecast and routineForecast, state the coming four-week window and compare with the recent weekly average for the same appointment type. Peak is the busiest forecast week; peakWeek gives its start date, and peakChange compares that week with the recent weekly average. Percentage changes are signed: positive becomes more, negative becomes fewer, zero becomes roughly unchanged.',
  'AcuteYear and routineYear compare actual bookings with the same weeks last year. RoutineTrend compares the latest four weeks with the preceding four. If a seasonal range is supplied, it is for this time of year. Variation shows how much higher the busiest week was than the quietest among reportable, list-size-adjusted weeks in the last eight calendar weeks, excluding bank holidays. It measures spread, not growth.',
  'Extra and unused counts cover the last four complete weeks. Group counts identify where the most occurred. The labelled waits are the longest and shortest median waits among reportable groups over the last twenty-eight days. WaitGap is the difference. Wait and priorWait are overall medians for appointments booked at least a day ahead, for the latest and preceding periods.',
  'RiskSlots is the number of open diary slots for the group with the shortest reportable cover. RiskCover is estimated from the recent booking pace, assuming no more slots are released. Include that condition when describing cover.',
  'Return the requested JSON. Use ordinary bullets as plain sentences inside the arrays, without adding bullet characters.'
].join(' ');

const detailedFindingInstructions = findingInstructions + ' ' + [
  'Write like a practice colleague briefing the team. Use phrases such as “we’re seeing”, “we’ve seen” and “we expect to see” where they fit. Vary the opening naturally.',
  'The peak forecast looks across the next nine weeks, about two months. When describing the peak, mention that horizon and use the date label for the week starting.',
  'When waiting times differ across categories, name the categories alongside their median waits. Give the longest and shortest, include the middle comparison if supplied, and mention the gap when it adds context. The labels already include any appointment mode in parentheses.',
  'When riskCoverDays is supplied, state the estimate in days and keep it approximate. Include the named group, the recent booking pace, and the assumption that no further slots are released.'
].join(' ');

function findingInput(metrics,cards=findingCards) {
  return Object.fromEntries(Object.entries(cards).map(([card,fields])=>{
    const figures = Object.fromEntries(fields.filter(key=>metrics[key]!==null).map(key=>[key,metrics[key]]));
    const reportLabels = Object.fromEntries(Object.keys(figures).filter(key=>findingLabels[key]).map(key=>[key,findingLabels[key]]));
    return [card,{figures,reportLabels}];
  }));
}

function findingSchema(metrics,cards=findingCards) {
  const properties = Object.fromEntries(Object.keys(cards).map(card =>
    [card,{type:'array',maxItems:cards[card].some(key=>metrics[key]!==null)?3:0,items:{type:'string'}}]));
  return {type:'object',additionalProperties:false,required:Object.keys(cards),properties};
}

function formatFinding(key,value) {
  if (seasonalFacts.has(key)) return ['below','within','above'][value+1]+' the usual range';
  if (variationFacts.has(key)) return value===0?'about the same':value+'% higher';
  if (dayFacts.has(key)) return value+(value===1?' day':' days');
  if (key==='riskCover' && value<1) return 'less than a week';
  return formatFact(key,value,true);
}

function renderFindings(output,metrics,cards=findingCards) {
  const bullets = {};
  const rejected = [];
  let generated = 0;
  let bytesRemaining = 3600;
  const encoder = new TextEncoder();
  for (const [card,fields] of Object.entries(cards)) {
    const available = new Set(fields.filter(key=>metrics[key]!==null));
    const labels = new Set([...available].map(key=>findingLabels[key]).filter(Boolean));
    const accepted = [];
    const seen = new Set();
    for (const line of Array.isArray(output?.[card])?output[card].slice(0,3):[]) {
      const text = typeof line==='string'?line.trim():'';
      const refs = [...text.matchAll(/\{([A-Za-z]+)\}/g)].map(match=>match[1]);
      const facts = refs.filter(key=>available.has(key));
      const validProse = /^[A-Za-z .,;:!?()'’‘“”–—-]+$/.test(text.replace(/\{[A-Za-z]+\}/g,''));
      const forecastClear = !facts.some(key=>key==='forecast'||key==='routineForecast')||(/\b(?:weeks?|month)\b/i.test(text)&&/\b(?:next|coming|ahead)\b/i.test(text)&&/\b(?:average|recent)\b/i.test(text));
      const coverClear = !facts.some(key=>key==='riskCover'||key==='riskCoverDays')||(/\b(?:pace|rate)\b/i.test(text)&&/\b(?:if|unless|without|assuming)\b/i.test(text));
      const peakClear = cards!==detailedFindingCards || !facts.includes('peak') || /\b(?:nine weeks|two months|couple of months)\b/i.test(text);
      if (!validProse || text.length>160 || !facts.some(key=>!seen.has(key)) ||
          !forecastClear || !coverClear || !peakClear || refs.some(key=>!available.has(key)&&!labels.has(key)) ||
          facts.some(key=>findingLabels[key]&&!refs.includes(findingLabels[key]))) {
        rejected.push(card);
        continue;
      }
      const display = text.replace(/\{([A-Za-z]+)\}/g,(match,key)=>available.has(key)?formatFinding(key,metrics[key]):match);
      const size = encoder.encode(display).length;
      if (size>155 || size>bytesRemaining) continue;
      bytesRemaining-=size;
      accepted.push(display);
      facts.forEach(key=>seen.add(key));
      generated++;
    }
    const required = card==='waitingTimes'?['longWait','shortWait','middleWait']:
      card==='forwardAvailability'?['riskCoverDays']:card==='forecastPeak'?['peak']:[];
    const complete = cards!==detailedFindingCards || required.every(key=>!available.has(key)||seen.has(key));
    bullets[card]=complete?accepted:[];
    if(!complete)generated-=accepted.length;
  }
  return {bullets,generated,rejected:[...new Set(rejected)]};
}

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
    let body, metrics, cards, version, isFindings;
    try {
      body = JSON.parse(raw);
      if (!uuid.test(body.practice) || !/^\d{4}-\d{2}-\d{2}$/.test(body.period)) throw Error();
      cards = body.version === 'home-insights-v6' ? detailedFindingCards : body.version === 'home-insights-v5' ? findingCards : body.version === 'home-insights-v4' ? bulletFields : body.metrics && Object.hasOwn(body.metrics, 'peak') ? expandedCards : legacyCards;
      isFindings = cards === findingCards || cards === detailedFindingCards;
      version = cards === detailedFindingCards ? 'home-insights-v6' : cards === findingCards ? 'home-insights-v5' : cards === bulletFields ? 'home-insights-v4' : cards === expandedCards ? 'home-insights-v3' : 'home-insights-v2';
      metrics = sanitise(body.metrics, cards);
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
        model:'gpt-6-luna', store:false, reasoning:{effort:'none'}, max_output_tokens:isFindings ? 2000 : cards === legacyCards ? 900 : 1100,
        instructions:cards === detailedFindingCards ? detailedFindingInstructions : cards === findingCards ? findingInstructions : cards === bulletFields ? bulletInstructions : cards === expandedCards ? expandedInstructions : legacyInstructions, input:JSON.stringify(isFindings ? findingInput(metrics,cards) : metrics),
        text:{format:{type:'json_schema',name:'practice_overview',strict:true,schema:isFindings ? findingSchema(metrics,cards) : outputSchema(metrics, cards)}}
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
    const parsed = JSON.parse(output.text);
    const {bullets, generated, rejected} = isFindings ? renderFindings(parsed,metrics,cards) : renderBullets(parsed,metrics,cards);
    if (rejected.length) console.warn(JSON.stringify({event:'home_insights_cards_rejected', cards:rejected}));
    if (!generated) { stage = 'openai_no_valid_cards'; throw Error('No verified insights.'); }
    const evidence = isFindings ? Object.entries(metrics).sort(([a],[b])=>a<b?-1:a>b?1:0) : metrics;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([body.period, evidence, version])));
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
