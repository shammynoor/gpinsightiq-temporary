const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/iq-home-insights/index.ts','utf8');
async function run(modelOutput,version='home-insights-v10'){
 let handler,patches=0,schema;
 const context={Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},crypto:webcrypto,TextEncoder,Response,Request,AbortSignal,console:{warn:()=>{}},fetch:async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'test-user'});
  if(url.includes('iq_claim_home_insight_refresh'))return Response.json('claimed');
  if(url.includes('api.openai.com')){schema=JSON.parse(options.body).text.format.schema;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(modelOutput)}]}]});}
  if(options.method==='PATCH'){patches++;const row=JSON.parse(options.body);return Response.json([{...row}]);}
  throw Error('Unexpected request');
 }};vm.createContext(context);vm.runInContext(source,context);
 const fields=vm.runInContext('Array.from(new Set(Object.values(contextualFindingCards).flat()))',context);
 const metrics=Object.fromEntries(fields.map(key=>[key,null]));metrics.forecast=6;metrics.acuteYear=-2;
 const req=new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer token'},body:JSON.stringify({practice:'123e4567-e89b-12d3-a456-426614174000',period:'2026-11-16',metrics,version})});
 const response=await handler(req);return {status:response.status,body:await response.json(),patches,schema};
}
(async()=>{
 const empty={seasonalDemand:['The value is 42'],extraCapacity:[],unusedCapacity:[],forecastPeak:[],routineDemand:[],waitingTimes:[],forwardAvailability:[],routineUnused:[]};
 const legacy=await run(empty,'home-insights-v9');assert.equal(legacy.status,502);assert.equal(legacy.schema.properties.seasonalDemand.items.pattern,undefined);
 const invalid=await run(empty);assert.equal(invalid.status,200);assert.equal(invalid.body.fallback,true);assert.equal(invalid.patches,0);assert.deepEqual(invalid.body.bullets.seasonalDemand,[]);
 const pattern=new RegExp(invalid.schema.properties.seasonalDemand.items.pattern);
 assert(pattern.test('We expect {forecast} urgent bookings over the next four weeks than the recent weekly average.'));
 assert(!pattern.test('We expect 42 bookings next week.'));assert(!pattern.test('We expect {unknown} bookings.'));
 const verified=await run({...empty,seasonalDemand:['We expect {forecast} urgent bookings over the next four weeks than the recent weekly average.','The weekly average was {acuteYear} than the same weeks last year.']});
 assert.equal(verified.status,200);assert.equal(verified.body.fallback,undefined);assert.equal(verified.patches,1);assert.equal(verified.body.bullets.seasonalDemand.length,2);
 console.log('AI insight checks passed: constrained facts, verified save and safe unsaved fallback.');
})().catch(e=>{console.error(e);process.exit(1)});
