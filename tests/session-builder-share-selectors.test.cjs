const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);const {estimateSessions}=c.window.SessionBuilderPlanning;
const clinicians={'GP Resident':'GP','GP Partner':'GP','Nurse':'Urgent Care Team'},groups=['GP','Urgent Care Team'];
const rows=[{id:'mixed',name:'Mixed',eligibleClinicians:Object.keys(clinicians),appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10}}];
const demand={sameDay:[40,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[40,0,0,0,0]},homeVisit:{},weekly:{},routine:{}}};
const limits={'GP Resident':{min:1,max:null},'GP Partner':{min:1,max:null},Nurse:{min:1,max:null}};
const base={id:'r',kind:'share',enabled:true,strength:'must',scope:'day',days:[1],minimum:20,clinicianGroup:'GP',comparisonGroup:'Urgent Care Team',denominator:'pair',appointmentPool:'urgent'};
const ref=(kind,name)=>({kind,name}),run=rule=>estimateSessions(rows,['Phone'],groups,demand,[rule],{respectTypes:true,clinicians,clinicianLimits:limits});
function counts(plan){const totals={};for(const p of plan.placements.filter(p=>p.day===0))totals[p.clinician]=(totals[p.clinician]||0)+p.count*10;return totals;}
test('individual numerator with two individual denominator choices uses only those types',()=>{
 const p=run({...base,shareSubject:ref('type','GP Resident'),denominatorSelections:[ref('type','GP Resident'),ref('type','Nurse')]});assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0],n=counts(p);assert.equal(m.numerator,n['GP Resident']);assert.equal(m.denominator,n['GP Resident']+n.Nurse);assert.ok(m.numerator*100>=20*m.denominator);
});
test('group and type overlap is counted once, not duplicated',()=>{
 const p=run({...base,shareSubject:ref('type','GP Resident'),denominatorSelections:[ref('group','GP'),ref('type','GP Resident')]});assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0],n=counts(p);assert.equal(m.denominator,n['GP Resident']+n['GP Partner']);
});
test('a denominator that omits part of numerator is rejected',()=>{
 const p=run({...base,shareSubject:ref('group','GP'),denominatorSelections:[ref('type','GP Resident'),ref('type','Nurse')]});assert.match(p.error,/denominator must include/);
});
test('legacy GP plus UCT rule continues to use both clinician groups',()=>{
 const p=run(base);assert.equal(p.error,undefined);const m=p.ruleResults[0].measurements[0],n=counts(p);assert.equal(m.numerator,n['GP Resident']+n['GP Partner']);assert.equal(m.denominator,n['GP Resident']+n['GP Partner']+n.Nurse);
});
test('all-appointment shares use allocated slots rather than unrelated consultation-mode capacity',()=>{
 const chosen=[{id:'gp',name:'GP',eligibleClinicians:['GP Resident'],appointmentTypes:['Routine'],appointmentsByMode:{Phone:10,'Home Visit':5}},{id:'team',name:'Team',eligibleClinicians:['Nurse'],appointmentTypes:['Same Day'],appointmentsByMode:{Phone:10,'Home Visit':0}}];
 const d={...demand,routine:10,types:{...demand.types,routine:['Routine']},byType:{...demand.byType,routine:{Routine:10}}};
 const r={...base,appointmentPool:'all',shareSubject:ref('type','GP Resident'),denominatorSelections:[ref('type','GP Resident'),ref('type','Nurse')],minimum:0};
 const p=estimateSessions(chosen,['Phone','Home Visit'],groups,d,[r],{respectTypes:true,clinicians,clinicianLimits:{'GP Resident':{min:0,max:null},Nurse:{min:0,max:null}}});assert.equal(p.error,undefined);
 const m=p.ruleResults[0].measurements[0];const actual={};for(const row of chosen){const periods=p.appointmentBreakdown[row.id]?.[0];if(!periods)continue;for(const period of ['morning','afternoon'])actual[row.id]=(actual[row.id]||0)+Object.entries(periods[period]).filter(([name])=>name!=='Unallocated').reduce((n,[,v])=>n+v,0);}
 assert.equal(m.numerator,actual.gp||0);assert.equal(m.denominator,(actual.gp||0)+(actual.team||0));
});
