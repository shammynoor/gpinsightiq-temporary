const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={window:{},console,Date};vm.createContext(c);vm.runInContext(fs.readFileSync('vendor/javascript-lp-solver-1.0.3.js','utf8'),c);c.window.solver=c.solver;
for(const file of ['session-builder-planning.js','session-builder-optimisation.js','session-builder-costing.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
const solve=c.window.SessionBuilderPlanning.estimateSessions;
const type=(id,clinicians,capacity=10,appointmentTypes=['Same Day','Routine','Follow-Up'])=>({id,name:id,eligibleClinicians:clinicians,appointmentsByMode:{Phone:capacity,'Home Visit':0},appointmentTypes});
const empty=()=>({sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,eligibleDailyTypes:['Same Day'],eligiblePlannedTypes:['Follow-Up'],types:{sameDay:['Same Day'],homeVisit:['Visit'],weekly:['Within 3 Days'],routine:['Routine'],planned:['Follow-Up']},byType:{sameDay:{'Same Day':[0,0,0,0,0]},homeVisit:{},weekly:{},routine:{},planned:{}}});
function run(types,d,rates,rules=[],groups){const clinicians=Object.fromEntries(Object.keys(rates).map(name=>[name,groups?.[name]||'GP']));return solve(types,['Phone','Home Visit'],['GP','UCT'],d,rules,{respectTypes:true,optimizeCost:true,clinicians,clinicianLimits:Object.fromEntries(Object.entries(rates).map(([name,rate])=>[name,{annualLeaveWeeks:0,...rate}])),appointmentPools:{'Same Day':'sameDay','Within 3 Days':'weekly',Routine:'routine','Follow-Up':'planned','Extra follow-up':'planned',Visit:'homeVisit'}});}
test('chooses the cheapest actual clinician instead of equal cost splitting or table order',()=>{
 const d=empty();d.sameDay[0]=30;d.byType.sameDay['Same Day'][0]=30;
 const types=[type('GP',['Partner','Salaried'])],rates={Partner:{annualRate:12000},Salaried:{annualRate:8000}};
 const p=run(types,d,rates);assert.equal(p.error,undefined);assert.equal(p.annualCost,24000);assert.equal(p.clinicianCounts.Salaried,3);assert.equal(p.clinicianCounts.Partner,undefined);
 assert.equal(c.window.SessionBuilderCosting.allocated(p.placements,'GP',rates).pence,2400000);
});
test('respects minimums, maxima and working patterns across all session types',()=>{
 const d=empty();d.sameDay=[20,10,0,0,0];d.byType.sameDay['Same Day']=[20,10,0,0,0];
 const rates={Partner:{annualRate:12000,min:1,max:10},Salaried:{annualRate:8000,min:0,max:2,workingPattern:['Mon AM']}};
 const p=run([type('A',['Partner','Salaried']),type('B',['Partner','Salaried'])],d,rates);assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.Salaried,2);assert.equal(p.clinicianCounts.Partner,1);assert.equal(p.annualCost,28000);
 assert.ok(p.placements.filter(s=>s.clinician==='Salaried').every(s=>s.day===0&&s.period==='morning'));
});
test('UCT can beat Standard GP and still meet a required GP urgent share',()=>{
 const d=empty();d.sameDay[0]=40;d.byType.sameDay['Same Day'][0]=40;
 const rules=[{id:'share',enabled:true,kind:'share',strength:'must',scope:'day',days:[1],minimum:25,comparison:'atLeast',clinicianGroup:'GP',appointmentPool:'urgent',denominator:'all'}];
 const p=run([type('Standard GP',['GP']),type('UCT',['Nurse'])],d,{GP:{annualRate:12000},Nurse:{annualRate:6000}},rules,{GP:'GP',Nurse:'UCT'});
 assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,1);assert.equal(p.clinicianCounts.Nurse,3);assert.equal(p.annualCost,30000);assert.equal(p.ruleResults[0].ok,true);
});
test('zero-capacity required on-call sessions are included and costed in the required periods',()=>{
 const d=empty(),rule={id:'on',enabled:true,kind:'minimum',strength:'must',sessionTypeId:'On-call',scope:'both',days:[1,2,3,4,5],minimum:1};
 const p=run([type('On-call',['GP'],0,[])],d,{GP:{annualRate:12000,max:10}},[rule]);assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,10);assert.equal(p.annualCost,120000);assert.equal(p.totalCapacity,0);
 for(const day of p.rows[0].periods.morning)assert.equal(day,1);
});
test('the model can mix routine and planned care in an existing urgent session without double counting',()=>{
 const d=empty();d.sameDay[0]=5;d.routine=3;d.planned=2;d.byType.sameDay['Same Day'][0]=5;d.byType.routine={Routine:3};d.byType.planned={'Extra follow-up':2};d.types.planned=['Extra follow-up'];
 const p=run([type('GP',['GP'])],d,{GP:{annualRate:10000,max:1}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,1);assert.equal(p.annualCost,10000);assert.ok(p.capacitySameDay[0]>=5);assert.ok(p.routineCapacity>=3);assert.ok(p.plannedCapacity>=2);assert.equal(p.totalCapacity,10);
});
test('required appointment mixes are enforced while minimising cost',()=>{
 const d=empty();d.sameDay[0]=5;d.routine=5;d.byType.sameDay['Same Day'][0]=5;d.byType.routine={Routine:5};
 const rule={id:'mix',enabled:true,kind:'mix',strength:'must',scope:'week',days:[1,2,3,4,5],minimum:50,comparison:'exact',shareSubject:{kind:'type',name:'GP'},appointmentTypes:['Routine']};
 const p=run([type('GP',['GP'])],d,{GP:{annualRate:10000,max:1}},[rule]);assert.equal(p.error,undefined);assert.equal(p.ruleResults[0].ok,true);assert.equal(p.annualCost,10000);
});
test('missing rates and impossible constraints are explicit, not a free or invalid plan',()=>{
 const d=empty();d.sameDay[0]=20;d.byType.sameDay['Same Day'][0]=20;
 assert.match(run([type('GP',['GP'])],d,{GP:{max:1}}).error,/annualised sessional rate/);
 assert.match(run([type('GP',['GP'])],d,{GP:{annualRate:10000,max:1}}).error,/No valid costed plan/);
 assert.match(run([type('GP',['GP'])],d,{GP:{annualRate:10000,min:1,workingPattern:[]}}).error,/minimum/);
});
test('explicit zero rates are bounded and do not generate gratuitous sessions',()=>{
 const d=empty();d.sameDay[0]=10;d.byType.sameDay['Same Day'][0]=10;
 const p=run([type('free',['GP'])],d,{GP:{annualRate:0}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,1);assert.equal(p.annualCost,0);
});
test('leave and sickness reduce productive capacity without discounting the annual contracted cost',()=>{
 const d=empty();d.sameDay[0]=10;d.byType.sameDay['Same Day'][0]=10;
 const p=run([type('GP',['GP'])],d,{GP:{annualRate:10000,annualLeaveWeeks:26}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,2);assert.equal(p.annualCost,20000);
 const q=run([type('GP',['GP'])],d,{GP:{annualRate:10000,sicknessPercent:20}});assert.equal(q.error,undefined);assert.equal(q.clinicianCounts.GP,2);
});
test('small integer cost plans match exhaustive enumeration and are independent of table order',()=>{
 for(const need of [1,4,7,11,16,20]){
  const d=empty();d.sameDay[0]=need;d.byType.sameDay['Same Day'][0]=need;
  let best=Infinity;for(let a=0;a<=10;a++)for(let b=0;b<=10;b++)if(a*3+b*5>=need)best=Math.min(best,a*4000+b*6500);
  const types=[type('A',['A'],3),type('B',['B'],5)],rates={A:{annualRate:4000,max:10},B:{annualRate:6500,max:10}};
  assert.equal(run(types,d,rates).annualCost,best);assert.equal(run(types.slice().reverse(),d,rates).annualCost,best);
 }
});
