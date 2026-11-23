const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),context);const {estimateSessions,averageDemand}=context.window.SessionBuilderPlanning;
test('routine sessions go only to eligible GP, without double counting capacity',()=>{
 const rows=[{id:'gp',name:'Standard GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Routine']},{id:'team',name:'Team',clinicianTypes:['Team'],appointmentsByMode:{Phone:20},appointmentTypes:['Same Day','Within 3 Days']}];
 const demand={sameDay:[40,40,40,40,40],homeVisit:[0,0,0,0,0],weekly:20,routine:30,types:{sameDay:['Same Day'],homeVisit:[],weekly:['Within 3 Days'],routine:['Routine']}};
 const result=estimateSessions(rows,['Phone'],['GP','Team'],demand,[],{respectTypes:true});assert.equal(result.error,undefined);assert.equal(result.rows[0].routine,3);assert.equal(result.rows[1].routine,0);assert.equal(result.rows[1].weekly,1);assert.equal(result.routineCapacity,30);assert.equal(result.weeklyCapacity,20);assert.equal(result.placements.reduce((s,x)=>s+x.count,0),14);assert.deepEqual(Array.from(result.capacitySameDay),[40,40,40,40,40]);
});
test('any eligible daily urgent session can cover the combined same-day demand',()=>{
 const demand={sameDay:[15,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,types:{sameDay:['Same Day','Extra'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[10,0,0,0,0],Extra:[5,0,0,0,0]},homeVisit:{},weekly:{},routine:{}}};
 const rows=[{id:'a',name:'A',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Same Day']}];
 const result=estimateSessions(rows,['Phone'],['GP'],demand,[],{respectTypes:true});assert.equal(result.error,undefined);assert.equal(result.rows[0].days[0],2);assert.equal(result.capacitySameDay[0],20);assert.equal(result.unmetDemand.length,0);
 const missing=estimateSessions([{...rows[0],appointmentTypes:[]}],['Phone'],['GP'],demand,[],{respectTypes:true});assert.equal(missing.unmetDemand[0].name,'Same-day urgent');assert.equal(missing.unmetDemand[0].amount,15);
});
test('daily eligibility includes configured urgent types without recent bookings',()=>{
 const demand={sameDay:[10,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,eligibleDailyTypes:['Same Day','Within 3 Days'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{'Same Day':[10,0,0,0,0]},homeVisit:{},weekly:{},routine:{}}};
 const rows=[{id:'a',name:'A',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Within 3 Days']}];
 const result=estimateSessions(rows,['Phone'],['GP'],demand,[],{respectTypes:true});assert.equal(result.unmetDemand.length,0);assert.equal(result.rows[0].days[0],1);
});
test('history retains appointment types for each demand pool',()=>{
 const d=averageDemand([{bookedDay:'2026-11-16',count:2,kind:'sameDay',name:'Same Day'},{bookedDay:'2026-11-16',count:3,kind:'routine',name:'Routine'}],['2026-11-16'],{monday:()=> '2026-11-16',classify:r=>({kind:r.kind,name:r.name})});
 assert.deepEqual(Array.from(d.types.sameDay),['Same Day']);assert.deepEqual(Array.from(d.types.routine),['Routine']);
});

test('111 referrals are excluded while urgent appointment types remain in session demand',()=>{const f=context.window.SessionBuilderPlanning.isIncludedAppointmentType;assert.equal(f('111 Referral'),false);assert.equal(f('111-referral'),false);assert.equal(f('Same Day'),true);assert.equal(f('Within 3 Days'),true);});
