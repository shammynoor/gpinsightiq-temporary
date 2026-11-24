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
test('planned appointment splits account for all slots without duplication',()=>{
 const rows=[{id:'gp',name:'GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Same Day','Routine','Within 3 Days']}];
 const demand={sameDay:[15,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:4,routine:6,types:{sameDay:['Same Day','Within 3 Days'],homeVisit:[],weekly:['Within 3 Days'],routine:['Routine']},byType:{sameDay:{'Same Day':[10,0,0,0,0],'Within 3 Days':[5,0,0,0,0]},homeVisit:{},weekly:{'Within 3 Days':4},routine:{Routine:6}}};
 const result=estimateSessions(rows,['Phone'],['GP'],demand,[],{respectTypes:true});assert.equal(result.error,undefined);
 const totals={};for(const periods of result.appointmentBreakdown.gp)for(const period of ['morning','afternoon'])for(const [name,value] of Object.entries(periods[period]))totals[name]=(totals[name]||0)+value;
 assert.equal(Object.values(totals).reduce((a,b)=>a+b,0),result.totalCapacity);assert.ok(Object.values(totals).every(Number.isInteger));assert.equal(totals.Routine,10);assert.equal(totals['Within 3 Days'],16);assert.equal(totals['Same Day'],14);
});
test('unmet appointment types never appear as allocated appointments',()=>{
 const rows=[{id:'gp',name:'GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Same Day']}];
 const demand={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:6,types:{sameDay:[],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{},homeVisit:{},weekly:{},routine:{Routine:6}}};
 const result=estimateSessions(rows,['Phone'],['GP'],demand,[],{respectTypes:true});assert.equal(result.unmetDemand[0].name,'Routine');assert.equal(result.appointmentBreakdown.gp,undefined);
});
test('required sessions with no demand show unallocated capacity without inventing a type',()=>{
 const rows=[{id:'gp',name:'GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Same Day']}];
 const demand={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,types:{sameDay:[],homeVisit:[],weekly:[],routine:[]},byType:{sameDay:{},homeVisit:{},weekly:{},routine:{}}};
 const rules=[{id:'required',enabled:true,kind:'minimum',sessionTypeId:'gp',scope:'morning',days:[1],minimum:1,strength:'must'}];
 const result=estimateSessions(rows,['Phone'],['GP'],demand,rules,{respectTypes:true});assert.equal(result.appointmentBreakdown.gp[0].morning.Unallocated,10);assert.equal(result.totalCapacity,10);
});
test('daily urgent splits respect session selections and GP share excludes routine slots',()=>{
 const rows=[{id:'gp',name:'Standard GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Extra','111 Referral','Routine']},{id:'uct',name:'UCT',clinicianTypes:['Urgent Care Team'],appointmentsByMode:{Phone:20},appointmentTypes:['Same Day']}];
 const demand={sameDay:[100,100,100,100,100],homeVisit:[0,0,0,0,0],weekly:0,routine:400,eligibleDailyTypes:['Same Day','Extra','111 Referral'],types:{sameDay:['Same Day','Extra','111 Referral'],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{'Same Day':[60,60,60,60,60],Extra:[20,20,20,20,20],'111 Referral':[20,20,20,20,20]},homeVisit:{},weekly:{},routine:{Routine:400}}};
 const rules=[{id:'gp-share',enabled:true,kind:'share',scope:'day',days:[1,2,3,4,5],minimum:20,clinicianGroup:'GP',denominator:'pair',comparisonGroup:'Urgent Care Team',strength:'must'}];
 const result=estimateSessions(rows,['Phone'],['GP','Urgent Care Team'],demand,rules,{respectTypes:true});assert.equal(result.error,undefined);assert.equal(context.window.SessionBuilderPlanning.sharePool(rules[0]),'urgent');
 for(let day=0;day<5;day++){
  const totals={gp:0,uct:0};for(const id of ['gp','uct'])for(const period of ['morning','afternoon'])for(const [name,n] of Object.entries(result.appointmentBreakdown[id]?.[day]?.[period]||{})){
   if(id==='uct')assert.equal(name,'Same Day');if(id==='gp'&&name!=='Routine')assert.ok(['Extra','111 Referral'].includes(name));if(name!=='Routine')totals[id]+=n;
  }
  assert.ok(totals.gp*100>=20*(totals.gp+totals.uct),JSON.stringify({day,totals}));
 }
 assert.ok(result.ruleResults[0].ok);
});
test('an urgent share cannot be met by routine-only GP appointments',()=>{
 const rows=[{id:'gp',name:'GP',clinicianTypes:['GP'],appointmentsByMode:{Phone:10},appointmentTypes:['Routine']},{id:'uct',name:'UCT',clinicianTypes:['Urgent Care Team'],appointmentsByMode:{Phone:10},appointmentTypes:['Same Day']}];
 const demand={sameDay:[50,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:100,eligibleDailyTypes:['Same Day'],types:{sameDay:['Same Day'],homeVisit:[],weekly:[],routine:['Routine']},byType:{sameDay:{'Same Day':[50,0,0,0,0]},homeVisit:{},weekly:{},routine:{Routine:100}}};
 const rules=[{id:'share',enabled:true,kind:'share',scope:'day',days:[1],minimum:20,clinicianGroup:'GP',denominator:'pair',comparisonGroup:'Urgent Care Team',strength:'must'}];
 assert.match(estimateSessions(rows,['Phone'],['GP','Urgent Care Team'],demand,rules,{respectTypes:true}).error,/No plan found/);
});
test('home-visiting appointments use their appointment category, separate from urgent forecast',()=>{
 const kind=context.window.SessionBuilderPlanning.historicalCareKind;
 assert.equal(kind('Home Visiting','other','daily'),'homeVisit');
 assert.equal(kind('HOME VISITING','routine','weekly'),'homeVisit');
 assert.equal(kind('Urgent Care','urgent','daily'),'sameDay');
 assert.equal(kind('Urgent Care','urgent','weekly'),'weekly');
 assert.equal(kind('Planned Care','other','daily'),null);
});
