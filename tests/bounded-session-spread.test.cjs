const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const weekdays=['Mon','Tue','Wed','Thu','Fri'];let engine;
before(async()=>{engine=await require('../vendor/highs.js')();});

// Independent reference: project an even split onto the permitted daily ranges.
// This does not use model variables, reported targets, or the production helper.
function waterFill(total,bounds){
 const sum=level=>bounds.reduce((n,b)=>n+Math.max(b.min,Math.min(b.max??Infinity,level)),0);
 assert.ok(total>=bounds.reduce((n,b)=>n+b.min,0));
 assert.ok(total<=bounds.reduce((n,b)=>n+(b.max??Infinity),0));
 let low=0,high=total+Math.max(...bounds.map(b=>b.min))+1;
 for(let i=0;i<100;i++){const mid=(low+high)/2;if(sum(mid)<total)low=mid;else high=mid;}
 return bounds.map(b=>Math.max(b.min,Math.min(b.max??Infinity,(low+high)/2)));
}
function fullDays(changes={}){return Object.fromEntries(weekdays.map(day=>[day,{min:2,max:null,...changes[day]}]));}
function solve({min=30,max=30,need=300,daily=fullDays(),workingPattern,clinicians}={}){
 const c={window:{},Date,Intl};vm.createContext(c);
 for(const f of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-distribution.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
 c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(engine);
 const limits=clinicians||{Resident:{min,max,annualRate:100,annualLeaveWeeks:0,dailySessions:daily,...(workingPattern?{workingPattern}:{})}},names=Object.keys(limits);
 const args=[[{id:'trainee',name:'Trainee',eligibleClinicians:names,appointmentTypes:['Routine'],appointmentsByMode:{Phone:10}}],['Phone'],['GP'],{sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:need,planned:0,types:{routine:['Routine']},byType:{routine:{Routine:need}}},[{id:'spread',enabled:true,kind:'sessionDistribution',strength:'must',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'trainee',sessionTolerance:1}],{clinicians:Object.fromEntries(names.map(name=>[name,'GP'])),clinicianLimits:limits,appointmentPools:{Routine:'routine'}}];
 const plan=c.window.SessionBuilderOptimisation.estimate(...args);
 assert.equal(plan.error,undefined,plan.error);assert.equal(plan.verifiedPlan,true);assert.equal(plan.costOptimal,true);
 const expected=weekdays.map(()=>0);
 for(const [name,limit]of Object.entries(limits)){
  const bounds=weekdays.map(day=>{
   const b=limit.dailySessions?.[day]||{min:0,max:null};
   return Array.isArray(limit.workingPattern)&&!limit.workingPattern.some(p=>p.startsWith(day+' '))?{min:0,max:0}:b;
  });
  const target=waterFill(plan.clinicianCounts[name]||0,bounds);
  for(let day=0;day<5;day++){
   expected[day]+=target[day];
   const count=plan.placements.filter(p=>p.clinician===name&&p.day===day).reduce((n,p)=>n+p.count,0);
   assert.ok(Number.isSafeInteger(count));assert.ok(count>=bounds[day].min);if(bounds[day].max!=null)assert.ok(count<=bounds[day].max);
  }
 }
 const rule=plan.ruleResults.find(r=>r.id==='spread');
 for(const m of rule.measurements){
  assert.ok(Math.abs(m.target-expected[m.day])<1e-6,`${weekdays[m.day]} reported target ${m.target}; independent capped target ${expected[m.day]}`);
  assert.ok(Math.abs(m.numerator-expected[m.day])<=1+1e-6,`${weekdays[m.day]} ${m.numerator} sessions exceeds ±1 of capped target ${expected[m.day]}`);
 }
 assert.equal(rule.ok,true);assert.deepEqual([...rule.failures],[]);
 return {plan,expected};
}

test('Thursday capped at two redistributes thirty sessions across the other days',()=>{
 const {plan,expected}=solve({daily:fullDays({Thu:{max:2}})});
 assert.deepEqual(expected.map(n=>Math.round(n)),[7,7,7,2,7]);
 assert.equal(plan.rows[0].days[3],2);
 assert.ok([0,1,2,4].every(d=>plan.rows[0].days[d]>=6&&plan.rows[0].days[d]<=8));
});
test('multiple upper caps redistribute the remaining sessions without relaxing the rule',()=>{
 const {expected}=solve({daily:fullDays({Mon:{max:3},Thu:{max:2}})});
 assert.ok(Math.abs(expected[1]-25/3)<1e-6);assert.equal(expected[0],3);assert.equal(expected[3],2);
});
test('a binding daily minimum redistributes the remaining total after an upper cap',()=>{
 const {expected}=solve({daily:fullDays({Mon:{min:12},Thu:{max:2}})});
 assert.equal(expected[0],12);assert.equal(expected[3],2);assert.ok(Math.abs(expected[1]-16/3)<1e-6);
});
test('a non-working Thursday is excluded from the bounded target',()=>{
 const {plan,expected}=solve({daily:fullDays({Thu:{min:0,max:0}})});
 assert.equal(plan.rows[0].days[3],0);assert.ok(Math.abs(expected[0]-7.5)<1e-6);
});
test('bounded targets follow the selected integer weekly count rather than a guessed input total',()=>{
 const {plan,expected}=solve({min:10,max:40,need:230,daily:fullDays({Thu:{max:2}})});
 assert.equal(plan.clinicianCounts.Resident,23);assert.ok(Math.abs(expected[0]-5.25)<1e-6);assert.equal(expected[3],2);
});
test('without a binding cap the original even target remains six sessions per day',()=>{
 const {expected}=solve();assert.deepEqual(expected.map(n=>Math.round(n)),[6,6,6,6,6]);
});
test('clinician-specific bounded targets combine without overriding different working patterns',()=>{
 const clinicians={A:{min:20,max:20,annualRate:100,annualLeaveWeeks:0,workingPattern:['Mon AM']},B:{min:10,max:10,annualRate:100,annualLeaveWeeks:0,workingPattern:['Tue AM','Wed AM','Thu AM','Fri AM'],dailySessions:{Thu:{min:0,max:1}}}};
 const {expected}=solve({clinicians});assert.deepEqual(expected.map(n=>Math.round(n)),[20,3,3,1,3]);
});

function customPlan(types,limits,need,rules){
 const c={window:{},Date,Intl};vm.createContext(c);
 for(const f of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-distribution.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
 c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(engine);
 return c.window.SessionBuilderOptimisation.estimate(types,['Phone'],['GP'],{sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:need,planned:0,types:{routine:['Routine']},byType:{routine:{Routine:need}}},rules,{clinicians:Object.fromEntries(Object.keys(limits).map(name=>[name,'GP'])),clinicianLimits:limits,appointmentPools:{Routine:'routine'}});
}
test('other required session types reserve the clinician daily range before trainee targets are calculated',()=>{
 const types=[{id:'trainee',name:'Trainee',eligibleClinicians:['Resident'],appointmentTypes:['Routine'],appointmentsByMode:{Phone:10}},{id:'on-call',name:'On call',eligibleClinicians:['Resident'],appointmentTypes:[],appointmentsByMode:{Phone:0}}];
 const dailySessions=fullDays(Object.fromEntries(weekdays.map(day=>[day,{max:day==='Thu'?2:3}]))),limits={Resident:{min:10,max:10,annualRate:100,annualLeaveWeeks:0,dailySessions}};
 const rules=[{id:'spread',kind:'sessionDistribution',enabled:true,strength:'must',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'trainee',sessionTolerance:1},{id:'on-call-monday',kind:'minimum',enabled:true,strength:'must',scope:'day',days:[1],minimum:2,maximum:2,sessionTypeId:'on-call'}];
 const plan=customPlan(types,limits,80,rules);assert.equal(plan.error,undefined);assert.equal(plan.verifiedPlan,true);assert.equal(plan.costOptimal,true);assert.equal(plan.clinicianCounts.Resident,10);
 const other=weekdays.map((_,day)=>plan.placements.filter(p=>p.sourceId==='on-call'&&p.day===day).reduce((n,p)=>n+p.count,0));assert.deepEqual(other,[2,0,0,0,0]);
 const trainee=plan.rows.find(r=>r.id==='trainee'),residual=weekdays.map((day,i)=>({min:Math.max(0,dailySessions[day].min-other[i]),max:dailySessions[day].max-other[i]}));
 const reference=waterFill(8,residual);assert.deepEqual(reference.map(n=>Math.round(n)),[0,2,2,2,2]);
 const spread=plan.ruleResults.find(r=>r.id==='spread');assert.equal(spread.ok,true);
 for(const m of spread.measurements){assert.ok(Math.abs(m.target-reference[m.day])<1e-6);assert.ok(Math.abs(trainee.days[m.day]-reference[m.day])<=1+1e-6);}
 for(let day=0;day<5;day++){const actual=plan.placements.filter(p=>p.day===day).reduce((n,p)=>n+p.count,0);assert.equal(actual,2);}
});
test('Prefer on a capped selected day permits necessary spill and honestly reports the unmet preference',()=>{
 const types=[{id:'trainee',name:'Trainee',eligibleClinicians:['Resident'],appointmentTypes:['Routine'],appointmentsByMode:{Phone:10}}],dailySessions=fullDays({Mon:{max:2}}),limits={Resident:{min:30,max:30,annualRate:100,annualLeaveWeeks:0,dailySessions}};
 const rule={id:'spread',kind:'sessionDistribution',enabled:true,strength:'prefer',scope:'week',days:[1],minimum:0,sessionTypeId:'trainee',sessionTolerance:1};
 const plan=customPlan(types,limits,300,[rule]);assert.equal(plan.error,undefined);assert.equal(plan.verifiedPlan,true);assert.equal(plan.costOptimal,true);assert.equal(plan.clinicianCounts.Resident,30);assert.equal(plan.rows[0].days[0],2);
 const spread=plan.ruleResults[0];assert.equal(spread.ok,false);assert.ok(spread.failures.length>0);assert.equal(spread.adjustedForClinicianSetup,false);
 const target=spread.measurements.find(m=>m.day===0);assert.equal(target.target,2);for(const m of spread.measurements.filter(m=>m.day!==0))assert.equal(m.target,0);
 assert.equal(plan.rows[0].days.slice(1).reduce((n,x)=>n+x,0),28);
});
