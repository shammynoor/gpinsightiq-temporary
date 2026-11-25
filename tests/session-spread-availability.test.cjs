const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');let engine;
before(async()=>{engine=await require('../vendor/highs.js')();});
function run(limits,selected=[1,2,3,4,5]){
 const c={window:{},Date,Intl};vm.createContext(c);for(const f of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(engine);
 const names=Object.keys(limits),need=Object.values(limits).reduce((n,l)=>n+l.min*10,0);
 return c.window.SessionBuilderOptimisation.estimate([{id:'trainee',name:'Trainee',eligibleClinicians:names,appointmentTypes:['Routine'],appointmentsByMode:{Phone:10}}],['Phone'],['GP'],{sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:need,planned:0,types:{routine:['Routine']},byType:{routine:{Routine:need}}},[{id:'spread',enabled:true,kind:'sessionDistribution',strength:'must',scope:'week',days:selected,minimum:0,sessionTypeId:'trainee',sessionTolerance:1}],{clinicians:Object.fromEntries(names.map(n=>[n,'GP'])),clinicianLimits:limits,appointmentPools:{Routine:'routine'}});
}
test('required trainee spread skips Thursday and honours fixed weekly clinician setup',()=>{
 for(const selected of [[1,2,3,4,5],[4]]){
 const p=run({Resident:{min:30,max:30,annualRate:10,annualLeaveWeeks:0,workingPattern:['Mon AM','Tue AM','Wed AM','Fri AM']}},selected);
 assert.equal(p.error,undefined);assert.equal(p.costOptimal,true);assert.equal(p.clinicianCounts.Resident,30);assert.equal(p.rows[0].days[3],0);assert.ok([0,1,2,4].every(day=>[7,8].includes(p.rows[0].days[day])));assert.equal(p.ruleResults[0].ok,true);
 }
});
test('spread combines clinician-specific working patterns without overriding fixed minima',()=>{
 const p=run({A:{min:20,max:20,annualRate:100,annualLeaveWeeks:0,workingPattern:['Mon AM']},B:{min:10,max:10,annualRate:100,annualLeaveWeeks:0,workingPattern:['Tue AM','Wed AM','Thu AM','Fri AM']}});
 assert.equal(p.error,undefined);assert.equal(p.costOptimal,true);assert.equal(p.rows[0].days[0],20);assert.ok(p.rows[0].days.slice(1).every(n=>[2,3].includes(n)));assert.equal(p.ruleResults[0].ok,true);assert.equal(p.clinicianCounts.A,20);assert.equal(p.clinicianCounts.B,10);
});
