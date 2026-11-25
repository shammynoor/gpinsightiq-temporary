const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let enginePromise;
async function setup(){
 enginePromise??=require('../vendor/highs.js')();const engine=await enginePromise;
 const c={window:{},Date,Intl};vm.createContext(c);
 for(const file of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-distribution.js','session-builder-diagnostics.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(engine);return c;
}
const fixture=()=>JSON.parse(fs.readFileSync('tests/mip-planner-fixture.json','utf8'));
async function calculate(args){const c=await setup(),start=Date.now(),plan=c.window.SessionBuilderOptimisation.estimate(...args);const summary=assertAllocationPlan(args,plan);assert.equal(plan.costOptimal,true);assert.ok(Date.now()-start<30000);return {...summary,plan};}
function assertAllocationPlan(args,plan){
 const [types,modes,groups,demand,rules,options]=args,byId=new Map(types.map(t=>[t.id,t])),counts={},perTypeDay=new Map();
 assert.equal(plan.error,undefined,plan.error);assert.equal(plan.verifiedPlan,true);
 const arrays=['capacitySameDay','capacityHomeVisit'];for(const k of arrays)assert.ok(plan[k].every(n=>Number.isSafeInteger(n)&&n>=0),k);
 for(const k of ['weeklyCapacity','routineCapacity','plannedCapacity','totalCapacity'])assert.ok(Number.isSafeInteger(plan[k])&&plan[k]>=0,k);
 let totalSessions=0,cost=0,productive=0;
 for(const p of plan.placements){
  assert.ok(Number.isSafeInteger(p.count)&&p.count>=0);totalSessions+=p.count;
  const type=byId.get(p.sourceId);assert.ok(type);assert.ok(type.eligibleClinicians.includes(p.clinician));
  const limit=options.clinicianLimits[p.clinician]||{},period=['Mon','Tue','Wed','Thu','Fri'][p.day]+' '+(p.period==='morning'?'AM':'PM');
  if(Array.isArray(limit.workingPattern))assert.ok(limit.workingPattern.includes(period),p.clinician+' unavailable '+period);
  counts[p.clinician]=(counts[p.clinician]||0)+p.count;cost+=p.count*limit.annualRate;
  let home=0,other=0;for(const mode of modes){if(/home.?visit/i.test(mode))home+=type.appointmentsByMode[mode]||0;else other+=type.appointmentsByMode[mode]||0;}
  const fraction=(52-(limit.annualLeaveWeeks??5))/52*(1-(limit.sicknessPercent??0)/100);
  productive+=Math.floor(p.count*home*fraction+1e-7)+Math.floor(p.count*other*fraction+1e-7);
  const key=p.sourceId+'|'+p.day;perTypeDay.set(key,(perTypeDay.get(key)||0)+p.count);
 }
 assert.equal(Math.round(cost*100),Math.round(plan.annualCost*100));assert.equal(productive,plan.totalCapacity);
 assert.deepEqual(JSON.parse(JSON.stringify(counts)),JSON.parse(JSON.stringify(plan.clinicianCounts)));
 for(const [name,limit]of Object.entries(options.clinicianLimits)){assert.ok((counts[name]||0)>=(limit.min||0),name+' minimum');if(limit.max!=null)assert.ok((counts[name]||0)<=limit.max,name+' maximum');}
 let appointmentTotal=0;for(const days of Object.values(plan.appointmentBreakdown))for(const day of days)for(const values of Object.values(day))for(const n of Object.values(values)){assert.ok(Number.isSafeInteger(n)&&n>=0);appointmentTotal+=n;}
 assert.equal(appointmentTotal,productive);assert.equal(productive,plan.capacitySameDay.reduce((a,b)=>a+b,0)+plan.capacityHomeVisit.reduce((a,b)=>a+b,0)+plan.weeklyCapacity+plan.routineCapacity+plan.plannedCapacity);
 for(let i=0;i<5;i++){assert.ok(plan.capacitySameDay[i]>=Math.ceil(demand.sameDay[i]));assert.ok(plan.capacityHomeVisit[i]>=Math.ceil(demand.homeVisit[i]));}
 for(const [d,p]of [['weekly','weeklyCapacity'],['routine','routineCapacity'],['planned','plannedCapacity']])assert.ok(plan[p]>=Math.ceil(demand[d]||0));
 assert.ok(plan.ruleResults.filter(r=>r.strength==='must').every(r=>r.ok));
 // Independently verify session-count rules rather than trusting returned ruleResults.
 for(const r of rules.filter(r=>r.enabled&&r.strength==='must'&&r.kind==='minimum')){const buckets=r.scope==='week'?[r.days]:r.days.map(d=>[d]);for(const days of buckets){const n=days.reduce((sum,d)=>sum+(perTypeDay.get(r.sessionTypeId+'|'+(d-1))||0),0);if(r.minimum!=null)assert.ok(n>=r.minimum);if(r.maximum!=null)assert.ok(n<=r.maximum);}}
 const planned=new Set(Object.keys(options.appointmentPools).filter(n=>options.appointmentPools[n]==='planned'));
 for(const rule of rules.filter(r=>r.enabled&&r.strength==='must'&&r.kind==='distribution')){
  const daily=[0,0,0,0,0];for(const days of Object.values(plan.appointmentBreakdown))for(let i=0;i<5;i++)for(const values of Object.values(days[i]))for(const [name,n]of Object.entries(values))if(rule.appointmentTypes.includes(name)||name==='Planned care'&&rule.appointmentTypes.some(n=>planned.has(n)))daily[i]+=n;
  const sum=daily.reduce((a,b)=>a+b,0);for(let i=0;i<5;i++){const target=rule.days.includes(i+1)?(rule.distributionMode==='even'?100/rule.days.length:Number(rule.distributionTargets[i+1]||0)):0,tolerance=rule.days.includes(i+1)?rule.distributionTolerance:0;assert.ok(daily[i]>=sum*Math.max(0,target-tolerance)/100-1e-6);assert.ok(daily[i]<=sum*Math.min(100,target+tolerance)/100+1e-6);}
 }
 return {cost:plan.annualCost,appointments:productive,sessions:totalSessions,daily:plan.capacitySameDay};
}


test('current realistic planner reaches minimum cost and reconciles every whole appointment',async()=>{
 const result=await calculate(fixture());assert.equal(result.cost,1422300);assert.ok(result.appointments<1700);assert.ok(result.daily.every((n,i)=>n<=Math.ceil(fixture()[3].sameDay[i])+20));
});
test('tightening routine distribution still finds a compact globally costed plan',async()=>{
 for(const tolerance of [1,5,10]){const args=fixture();args[4].find(r=>r.kind==='distribution').distributionTolerance=tolerance;const p=await calculate(args);assert.ok(p.cost<1500000);assert.ok(p.appointments<1700);}
});
test('a soft trainee preference does not buy extra staff or block cost reduction',async()=>{
 const withPreference=await calculate(fixture());const args=fixture();args[4]=args[4].filter(r=>r.strength!=='prefer');const without=await calculate(args);assert.equal(withPreference.cost,without.cost);assert.ok(without.appointments<1700);
});
test('changing UCT visiting capacity from two to one remains feasible and low cost',async()=>{
 const args=fixture();args[0].find(t=>t.name==='UCT').appointmentsByMode['Home Visit']=1;const result=await calculate(args);assert.ok(result.cost<1500000);assert.ok(result.appointments<1700);
});
test('updated clinician minima maxima and unavailable days are independently enforced',async()=>{
 for(const alter of [a=>{a[5].clinicianLimits.Resident.min=28;a[5].clinicianLimits.Resident.max=28;},a=>{a[5].clinicianLimits.Nurse.max=10;},a=>{a[5].clinicianLimits.Resident.workingPattern=['Mon AM','Mon PM','Wed AM','Wed PM','Fri AM','Fri PM'];}]){const args=fixture();alter(args);const result=await calculate(args);assert.ok(result.cost<1600000);assert.ok(result.appointments<1750);}
});
test('exact clinician mix permits coordinated reductions rather than retaining an oversized feasible plan',async()=>{
 const types=[{id:'GP',name:'GP',eligibleClinicians:['GP'],appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10}},{id:'Nurse',name:'Nurse',eligibleClinicians:['Nurse'],appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10}}];
 const demand={sameDay:[20,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,types:{sameDay:['Same Day']},byType:{sameDay:{'Same Day':[20,0,0,0,0]}}};
 const rules=[{id:'exact-half',kind:'share',enabled:true,strength:'must',scope:'day',days:[1],minimum:50,comparison:'exact',shareSubject:{kind:'type',name:'GP'},denominatorSelections:[{kind:'type',name:'GP'},{kind:'type',name:'Nurse'}],appointmentPool:'all'}];
 const args=[types,['Phone'],['GP','Nurse'],demand,rules,{respectTypes:true,optimizeCost:true,clinicians:{GP:'GP',Nurse:'Nurse'},clinicianLimits:{GP:{annualRate:1000,min:0,max:10,annualLeaveWeeks:0},Nurse:{annualRate:800,min:0,max:10,annualLeaveWeeks:0}},appointmentPools:{'Same Day':'sameDay'}}];
 const result=await calculate(args);assert.equal(result.cost,1800);assert.equal(result.appointments,20);assert.equal(result.sessions,2);
});
