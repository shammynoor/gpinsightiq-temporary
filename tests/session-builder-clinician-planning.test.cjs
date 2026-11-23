const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);const estimate=c.window.SessionBuilderPlanning.estimateSessions;
const clinicians={Partner:'GP',Salaried:'GP',Nurse:'Urgent Care Team'},groups=['GP','Urgent Care Team'];
const demand={sameDay:[30,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[30,0,0,0,0]},homeVisit:{},weekly:{},routine:{}}};
const types=[{id:'gp',name:'GP',appointmentsByMode:{Phone:10},clinicianTypes:['GP'],eligibleClinicians:['Partner','Salaried'],appointmentTypes:['Same Day']},{id:'team',name:'Team',appointmentsByMode:{Phone:10},clinicianTypes:['Urgent Care Team'],eligibleClinicians:['Nurse'],appointmentTypes:['Same Day']}];
function plan(limits,rules=[],chosen=types){return estimate(chosen,['Phone'],groups,demand,rules,{respectTypes:true,clinicians,clinicianLimits:limits});}
test('session assignments respect clinician min and max across multiple session types',()=>{
 const p=plan({Partner:{min:1,max:1},Salaried:{min:0,max:1},Nurse:{min:1,max:3}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.Partner,1);assert.ok((p.clinicianCounts.Salaried||0)<=1);assert.ok(p.clinicianCounts.Nurse>=1&&p.clinicianCounts.Nurse<=3);assert.equal(p.unmetDemand.length,0);assert.equal(p.rows.length,2);
});
test('maxima are not exceeded when total capacity cannot meet demand',()=>{
 const p=plan({Partner:{min:0,max:0},Salaried:{min:0,max:1},Nurse:{min:0,max:0}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.Partner||0,0);assert.equal(p.clinicianCounts.Salaried,1);assert.equal(p.clinicianCounts.Nurse||0,0);assert.ok(p.unmetDemand.length>0);
});
test('a minimum without any eligible session is reported instead of ignored',()=>{
 const p=plan({Partner:{min:1,max:null}},[],[types[1]]);assert.match(p.error,/Partner/);
});
test('mandatory session rules count across all eligible types and respect max',()=>{
 const rule={id:'r',kind:'minimum',sessionTypeId:'gp',enabled:true,strength:'must',scope:'morning',days:[1,2],minimum:1};
 const p=plan({Partner:{min:0,max:1},Salaried:{min:0,max:1}},[rule]);assert.equal(p.error,undefined);assert.equal(p.rows[0].periods.morning[0],1);assert.equal(p.rows[0].periods.morning[1],1);
 const fail=plan({Partner:{min:0,max:0},Salaried:{min:0,max:1}},[rule]);assert.match(fail.error,/maximum/);
});
test('urgent share rules measure actual clinician group assignments',()=>{
 const both=[{id:'mixed',name:'Mixed',appointmentsByMode:{Phone:10},eligibleClinicians:['Partner','Nurse'],appointmentTypes:['Same Day']}];
 const rule={id:'share',kind:'share',enabled:true,strength:'must',scope:'day',days:[1],minimum:20,clinicianGroup:'GP',denominator:'pair',comparisonGroup:'Urgent Care Team'};
 const p=plan({Partner:{min:0,max:2},Nurse:{min:0,max:10}},[rule],both);assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0];assert.ok(m.numerator*100>=20*m.denominator);assert.ok(p.clinicianCounts.Partner>0);
});
test('a clinician maximum applies across every session type they can provide',()=>{
 const chosen=[{...types[0],id:'one',eligibleClinicians:['Partner']},{...types[0],id:'two',eligibleClinicians:['Partner']}];
 const p=plan({Partner:{min:0,max:1}},[],chosen);assert.equal(p.clinicianCounts.Partner,1);assert.equal(p.rows.reduce((n,row)=>n+row.days[0],0),1);assert.ok(p.unmetDemand.length);
});
test('minimum sessions with routine-only eligibility contribute towards routine need',()=>{
 const only=[{id:'gp',name:'GP',appointmentsByMode:{Phone:10},eligibleClinicians:['Partner'],appointmentTypes:['Routine']}];
 const d={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:15,eligibleDailyTypes:[],types:{sameDay:[],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{},homeVisit:{},weekly:{},routine:{Routine:15}}};
 const p=estimate(only,['Phone'],groups,d,[],{respectTypes:true,clinicians,clinicianLimits:{Partner:{min:1,max:2}}});assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.Partner,2);assert.equal(p.routineSessions,2);assert.equal(p.unmetDemand.length,0);
});
test('urgent share rules fail safely when the clinician maximum makes them impossible',()=>{
 const only=[{id:'mixed',name:'Mixed',appointmentsByMode:{Phone:10},eligibleClinicians:['Partner','Nurse'],appointmentTypes:['Same Day']}];
 const r={id:'share',kind:'share',enabled:true,strength:'must',scope:'day',days:[1],minimum:50,clinicianGroup:'GP',denominator:'pair',comparisonGroup:'Urgent Care Team'};
 const p=plan({Partner:{min:0,max:0},Nurse:{min:0,max:10}},[r],only);assert.match(p.error,/No plan found/);
});
test('limits for removed clinician types do not block the current plan',()=>{
 const p=plan({Retired:{min:4,max:5}});assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,0);
});
