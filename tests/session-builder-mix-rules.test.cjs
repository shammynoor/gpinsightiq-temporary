const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);const solve=c.window.SessionBuilderPlanning.estimateSessions;
const clinicians={'GP Resident':'GP'},groups=['GP'],rows=[{id:'gp',name:'GP',eligibleClinicians:['GP Resident'],appointmentTypes:['Same Day','Routine'],appointmentsByMode:{Phone:10}}],base={id:'mix',kind:'mix',enabled:true,strength:'must',scope:'week',days:[1,2,3,4,5],minimum:50,clinicianGroup:'GP',comparisonGroup:'',denominator:'all',shareSubject:{kind:'type',name:'GP Resident'},appointmentTypes:['Routine']};
function run(rule,routine=10){const d={sameDay:[10,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{'Same Day':[10,0,0,0,0]},homeVisit:{},weekly:{},routine:{Routine:routine}}};return solve(rows,['Phone'],groups,d,[rule],{respectTypes:true,clinicians,clinicianLimits:{}});}
test('exact appointment mix counts routine within clinician appointments over week',()=>{const p=run({...base,comparison:'exact'},20);assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0];assert.equal(m.numerator*2,m.denominator);});
test('at least and at most targets change allocation and are verified',()=>{for(const [comparison,minimum] of [['atLeast',75],['atMost',25]]){const p=run({...base,comparison,minimum});assert.equal(p.error,undefined,comparison);const m=p.ruleResults[0].measurements[0];assert.ok(comparison==='atLeast'?m.numerator*100>=minimum*m.denominator:m.numerator*100<=minimum*m.denominator);}});
test('invalid exact target is reported rather than falsely passing',()=>{const p=run({...base,comparison:'exact',minimum:37.1},10);assert.match(p.error,/No plan found/);});
test('a planned-care mix rule can add planned slots without inflating routine or urgent totals',()=>{
 const clinician={'GP Resident':'GP'},types=[{id:'gp',name:'GP',eligibleClinicians:['GP Resident'],appointmentTypes:['Same Day','Follow-Up'],appointmentsByMode:{Phone:10}}],d={sameDay:[10,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[10,0,0,0,0]},homeVisit:{},weekly:{},routine:{}}},rule={...base,appointmentTypes:['Follow-Up'],comparison:'exact'};
 const p=solve(types,['Phone'],groups,d,[rule],{respectTypes:true,clinicians:clinician,clinicianLimits:{},appointmentPools:{'Same Day':'sameDay','Follow-Up':'planned'}});assert.equal(p.error,undefined);assert.equal(p.plannedCapacity,10);assert.equal(p.routineCapacity,0);assert.equal(p.capacitySameDay[0],10);assert.equal(p.ruleResults[0].measurements[0].numerator*2,p.ruleResults[0].measurements[0].denominator);
});
test('appointment mix does not require a session when the clinician has no appointments in a selected period',()=>{
 const rule={...base,scope:'morning',days:[1,3,5],minimum:10,comparison:'atLeast'};
 const d={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{'Same Day':[0,0,0,0,0]},homeVisit:{},weekly:{},routine:{Routine:0}}};
 const p=solve(rows,['Phone'],groups,d,[rule],{respectTypes:true,clinicians,clinicianLimits:{'GP Resident':{max:0,workingPattern:[]}}});
 assert.equal(p.error,undefined);assert.equal(p.placements.length,0);assert.ok(p.ruleResults[0].measurements.every(m=>m.denominator===0));
});
test('appointment mix still applies in a selected period with booked slots',()=>{
 const rule={...base,scope:'morning',days:[1,3,5],minimum:10,comparison:'atLeast'};
 const p=run(rule,0);assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0];assert.ok(m.denominator>0);assert.ok(m.numerator*100>=10*m.denominator);
});
test('moves an existing routine session into the required morning without exceeding the clinician maximum',()=>{
 const d={sameDay:[10,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:10,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{'Same Day':[10,0,0,0,0]},homeVisit:{},weekly:{},routine:{Routine:10}}};
 const rule={...base,scope:'morning',days:[1],minimum:10,comparison:'atLeast'};
 const p=solve(rows,['Phone'],groups,d,[rule],{respectTypes:true,clinicians,clinicianLimits:{'GP Resident':{max:2}}});
 assert.equal(p.error,undefined);assert.equal(p.clinicianCounts['GP Resident'],2);assert.equal(p.capacitySameDay[0],10);assert.equal(p.routineCapacity,10);const m=p.ruleResults[0].measurements[0];assert.ok(m.numerator*100>=10*m.denominator);
});
