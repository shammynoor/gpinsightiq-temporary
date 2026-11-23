const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);const estimate=c.window.SessionBuilderPlanning.estimateSessions;
const groups=['GP','Urgent Care Team'],clinicians={'GP Resident':'GP','GP Partner':'GP',Nurse:'Urgent Care Team'};
const session={id:'gp',name:'GP',eligibleClinicians:['GP Resident'],appointmentTypes:['Same Day','Routine'],appointmentsByMode:{Phone:10}};
const demand={sameDay:[0,0,0,20,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[0,0,0,20,0]},homeVisit:{},weekly:{},routine:{}}};
const run=(types=[session],limits={},rules=[],d=demand)=>estimate(types,['Phone'],groups,d,rules,{respectTypes:true,clinicians,clinicianLimits:limits});
test('GP resident unavailable Thursday PM is never assigned then',()=>{
 const p=run(undefined,{'GP Resident':{min:0,max:null,workingPattern:['Thu AM']}});assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,0);assert.equal(p.rows[0].periods.morning[3],2);assert.equal(p.rows[0].periods.afternoon[3],0);assert.ok(p.placements.every(x=>x.clinician!=='GP Resident'||x.day===3&&x.period==='morning'));
});
test('other eligible clinicians can cover a resident unavailable in a period',()=>{
 const p=run([{...session,eligibleClinicians:['GP Resident','GP Partner']}],{'GP Resident':{min:0,max:1,workingPattern:['Thu AM']},'GP Partner':{min:0,max:null,workingPattern:['Thu PM']}});assert.equal(p.error,undefined);assert.equal(p.rows[0].periods.morning[3],1);assert.equal(p.rows[0].periods.afternoon[3],1);assert.ok(p.placements.every(x=>x.clinician!=='GP Resident'||x.period==='morning'));
});
test('unavailable days result in unmet demand, not fabricated sessions',()=>{
 const p=run(undefined,{'GP Resident':{min:0,max:null,workingPattern:['Mon AM']}});assert.equal(p.rows[0].periods.afternoon[3],0);assert.equal(p.rows[0].periods.morning[3],0);assert.ok(p.unmetDemand.length);
});
test('mandatory session rules that conflict with patterns report the conflict',()=>{
 const rule={id:'required',kind:'minimum',sessionTypeId:'gp',enabled:true,strength:'must',scope:'afternoon',days:[4],minimum:1};const p=run(undefined,{'GP Resident':{min:0,max:null,workingPattern:['Thu AM']}},[rule]);assert.match(p.error,/working patterns/);
});
test('weekly allocations and required clinician minimums use available periods',()=>{
 const d={...demand,sameDay:[0,0,0,0,0],routine:30,types:{...demand.types,routine:['Routine']},byType:{...demand.byType,sameDay:{},routine:{Routine:30}}};
 const p=run(undefined,{'GP Resident':{min:1,max:4,workingPattern:['Fri PM']}},[],d);assert.equal(p.error,undefined);assert.equal(p.rows[0].periods.afternoon[4],3);assert.ok(p.placements.every(x=>x.day===4&&x.period==='afternoon'));assert.equal(p.routineCapacity,30);
});
test('missing working pattern retains backwards-compatible full-week availability',()=>{
 const p=run(undefined,{'GP Resident':{min:0,max:null}});assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,0);assert.equal(p.rows[0].days[3],2);
});
test('urgent share repair uses an available period and does not violate pattern',()=>{
 const mixed=[{...session,eligibleClinicians:['GP Resident','Nurse']}];
 const rule={id:'share',kind:'share',enabled:true,strength:'must',scope:'day',days:[4],minimum:20,clinicianGroup:'GP',denominator:'pair',comparisonGroup:'Urgent Care Team'};
 const p=run(mixed,{'GP Resident':{min:0,max:null,workingPattern:['Thu AM']},Nurse:{min:0,max:null,workingPattern:['Thu PM']}},[rule]);assert.equal(p.error,undefined);assert.ok(p.placements.every(x=>x.clinician!=='GP Resident'||x.day===3&&x.period==='morning'));assert.ok(p.ruleResults[0].ok);
});
test('empty working pattern cannot satisfy a positive clinician minimum',()=>{
 const p=run(undefined,{'GP Resident':{min:1,max:null,workingPattern:[]}});assert.match(p.error,/working pattern/);
});
