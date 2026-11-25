const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let engine;
before(async()=>{engine=await require('../vendor/highs.js')();});
const weekdays=[1,2,3,4,5],names=['GP Partner','Salaried GP'];
const oncall={id:'greenwood',name:'Greenwood on call',eligibleClinicians:names,appointmentTypes:[],appointmentsByMode:{Phone:0}};
const demand=()=>({sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,types:{sameDay:['Same Day'],routine:['Routine']},byType:{sameDay:{'Same Day':[0,0,0,0,0]},routine:{Routine:0}}});
const mix=(extra={})=>({id:'session-mix',kind:'sessionClinicianMix',enabled:true,strength:'must',scope:'week',days:weekdays,sessionTypeId:'greenwood',shareSubject:{kind:'type',name:'GP Partner'},minimum:50,comparison:'exact',...extra});
const required=(total,type='greenwood',id='required')=>({id,kind:'minimum',enabled:true,strength:'must',scope:'week',days:weekdays,sessionTypeId:type,minimum:total,maximum:total});
function calculate({total=10,rule=mix(),types=[oncall],rules=[],limits={},rates=[1000,500]}={}){
 const c={window:{},Date,Intl};vm.createContext(c);
 for(const file of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(engine);
 const clinicianLimits=Object.fromEntries(names.map((name,i)=>[name,{min:0,max:100,annualRate:rates[i],annualLeaveWeeks:0,...limits[name]}]));
 return c.window.SessionBuilderOptimisation.estimate(types,['Phone'],['GP'],demand(),[...(total===null?[]:[required(total)]),rule,...rules],{respectTypes:true,optimizeCost:true,clinicians:Object.fromEntries(names.map(n=>[n,'GP'])),clinicianLimits,appointmentPools:{'Same Day':'sameDay',Routine:'routine'}});
}
function sessions(p,name,type='greenwood'){return p.placements.filter(s=>s.sourceId===type&&s.clinician===name).reduce((n,s)=>n+s.count,0);}
function valid(p){assert.equal(p.error,undefined,p.error);assert.equal(p.verifiedPlan,true);for(const s of p.placements)assert.ok(Number.isSafeInteger(s.count)&&s.count>=0);assert.ok(p.ruleResults.filter(r=>r.strength==='must').every(r=>r.ok));return p.ruleResults.find(r=>r.id==='session-mix');}

test('exact weekly clinician mix counts zero-appointment on-call sessions, not appointments',()=>{
 const p=calculate(),r=valid(p);assert.equal(p.costOptimal,true);assert.equal(sessions(p,'GP Partner'),5);assert.equal(sessions(p,'Salaried GP'),5);assert.equal(p.totalCapacity,0);assert.equal(p.annualCost,7500);assert.equal(r.ok,true);assert.equal(r.measurements.length,1);assert.equal(r.measurements[0].numerator,5);assert.equal(r.measurements[0].denominator,10);
});

test('other session types do not enter the selected session clinician mix denominator',()=>{
 const other={id:'other',name:'Other GP session',eligibleClinicians:['GP Partner'],appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10}};
 const p=calculate({types:[oncall,other],rules:[required(8,'other','other-required')]}),r=valid(p);assert.equal(sessions(p,'GP Partner','other'),8);assert.equal(sessions(p,'GP Partner'),5);assert.equal(sessions(p,'Salaried GP'),5);assert.equal(r.measurements[0].denominator,10);assert.equal(p.clinicianCounts['GP Partner'],13);
});

test('weekly mix allows different daily clinician patterns and honours daily and weekly bounds',()=>{
 const limits={'GP Partner':{min:5,max:5,workingPattern:['Mon AM'],dailySessions:{Mon:{min:5,max:5}}},'Salaried GP':{min:5,max:5,workingPattern:['Fri PM'],dailySessions:{Fri:{min:5,max:5}}}};
 const p=calculate({limits});valid(p);assert.equal(sessions(p,'GP Partner'),5);assert.equal(sessions(p,'Salaried GP'),5);assert.ok(p.placements.filter(s=>s.clinician==='GP Partner').every(s=>s.day===0&&s.period==='morning'));assert.ok(p.placements.filter(s=>s.clinician==='Salaried GP').every(s=>s.day===4&&s.period==='afternoon'));
});

test('an exact fifty percent mix does not invent fractional sessions for an odd fixed total',()=>{
 const p=calculate({total:5});assert.ok(p.error);assert.equal(p.verifiedPlan,undefined);assert.ok(!p.placements||p.placements.length===0);
});

test('minimum and maximum clinician session shares use whole weekly session counts',()=>{
 const lower=calculate({rule:mix({comparison:'atLeast',minimum:40})});valid(lower);assert.equal(sessions(lower,'GP Partner'),4);assert.equal(sessions(lower,'Salaried GP'),6);assert.equal(lower.annualCost,7000);
 const upper=calculate({rule:mix({comparison:'atMost',minimum:40}),rates:[100,500]});valid(upper);assert.equal(sessions(upper,'GP Partner'),4);assert.equal(sessions(upper,'Salaried GP'),6);assert.equal(upper.annualCost,3400);
});

test('zero and one hundred percent targets remain valid session-count rules',()=>{
 for(const minimum of [0,100]){const p=calculate({rule:mix({minimum})});valid(p);assert.equal(sessions(p,'GP Partner'),minimum/10);assert.equal(sessions(p,'Salaried GP'),10-minimum/10);}
});

test('an unused session type does not force extra staffing merely to define a percentage',()=>{
 const p=calculate({total:null}),r=valid(p);assert.equal(p.annualCost,0);assert.equal(p.placements.length,0);assert.equal(r.ok,true);assert.equal(r.measurements[0].denominator,0);assert.equal(r.measurements[0].numerator,0);
});

test('Prefer can refine an equal-cost plan but never buy extra sessions or increase cost',()=>{
 const balanced=calculate({rule:mix({strength:'prefer'}),rates:[500,500]});valid(balanced);assert.equal(balanced.annualCost,5000);assert.equal(sessions(balanced,'GP Partner'),5);assert.equal(sessions(balanced,'Salaried GP'),5);assert.equal(balanced.ruleResults.find(r=>r.id==='session-mix').ok,true);
 const expensive=calculate({rule:mix({strength:'prefer'})});valid(expensive);assert.equal(expensive.annualCost,5000);assert.equal(sessions(expensive,'Salaried GP'),10);assert.equal(sessions(expensive,'GP Partner'),0);assert.equal(expensive.ruleResults.find(r=>r.id==='session-mix').ok,false);
});

test('disabled mix rules do not constrain allocation and non-weekly rules are rejected',()=>{
 const disabled=calculate({rule:mix({enabled:false})});valid(disabled);assert.equal(disabled.annualCost,5000);assert.equal(sessions(disabled,'Salaried GP'),10);
 const invalid=calculate({rule:mix({scope:'day'})});assert.ok(invalid.error);assert.equal(invalid.verifiedPlan,undefined);
});
