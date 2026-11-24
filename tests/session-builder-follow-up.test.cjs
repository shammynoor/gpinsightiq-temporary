const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('session-builder-planning.js','utf8');
function model(){const c={window:{}};vm.createContext(c);vm.runInContext(source,c);return c;}
const empty=()=>({sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,types:{sameDay:[],homeVisit:[],weekly:[],routine:[],planned:[]},byType:{sameDay:{},homeVisit:{},weekly:{},routine:{},planned:{}}});
const session=(id,appointments,capacity=10)=>({id,name:id,clinicianTypes:['GP'],eligibleClinicians:['GP Partner'],appointmentTypes:appointments,appointmentsByMode:{Phone:capacity}});
test('Planned Care history supplies follow-up averages independently of routine and slot display name',()=>{
 const {historicalCareKind,averageDemand}=model().window.SessionBuilderPlanning;
 assert.equal(historicalCareKind('Planned Care','routine','daily'),'planned');
 const rows=[{bookedDay:'2026-11-09',category:'Planned Care',role:'other',name:'Review',count:30},{bookedDay:'2026-11-09',category:'Routine Care',role:'routine',name:'Routine',count:10},{bookedDay:'2026-11-02',category:'Planned Care',role:'other',name:'Review',count:1000}];
 const d=averageDemand(rows,['2026-11-09','2026-11-16'],{monday:day=>day,classify:r=>({kind:historicalCareKind(r.category,r.role,'daily'),name:r.name})});
 assert.equal(d.planned,15);assert.equal(d.routine,5);assert.equal(d.byType.planned.Review,15);assert.deepEqual([...d.types.planned],['Review']);assert.equal(d.byType.routine.Review,undefined);
});
test('follow-ups add eligible sessions to the plan and never reuse routine capacity',()=>{
 const d=empty();d.sameDay[0]=10;d.weekly=10;d.routine=20;d.planned=25;d.types={sameDay:['Same Day'],homeVisit:[],weekly:['Within 3 Days'],routine:['Routine'],planned:['Follow-Up']};d.byType={sameDay:{'Same Day':[10,0,0,0,0]},homeVisit:{},weekly:{'Within 3 Days':10},routine:{Routine:20},planned:{'Follow-Up':25}};
 const rows=[session('urgent',['Same Day','Within 3 Days']),session('routine',['Routine']),session('follow-up',['Follow-Up'])];
 const p=model().window.SessionBuilderPlanning.estimateSessions(rows,['Phone'],['GP'],d,[],{respectTypes:true});
 assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,0);assert.equal(p.plannedCapacity,30);assert.equal(p.plannedSessions,3);assert.equal(p.routineCapacity,20);assert.equal(p.rows[2].planned,3);assert.equal(p.rows[1].planned,0);assert.equal(p.totalNeed,65);assert.equal(p.totalCapacity,70);
 const split=Object.values(p.appointmentBreakdown).flatMap(days=>days.flatMap(day=>[day.morning,day.afternoon])).reduce((n,cell)=>n+(cell['Planned care']||0),0);assert.equal(split,30);
 assert.equal(p.placements.reduce((n,s)=>n+s.count,0),7);
});
test('follow-up shortages remain explicit under clinician limits and type eligibility',()=>{
 const d=empty();d.planned=25;d.types.planned=['Follow-Up'];d.byType.planned={'Follow-Up':25};
 const solve=model().window.SessionBuilderPlanning.estimateSessions;
 const limited=solve([session('follow-up',['Follow-Up'])],['Phone'],['GP'],d,[],{respectTypes:true,clinicians:{'GP Partner':'GP'},clinicianLimits:{'GP Partner':{max:2}}});
 assert.equal(limited.error,undefined);assert.equal(limited.plannedCapacity,20);assert.equal(limited.unmetDemand[0].pool,'planned');assert.equal(limited.unmetDemand[0].amount,5);
 const ineligible=solve([session('routine',['Routine'])],['Phone'],['GP'],d,[],{respectTypes:true});assert.equal(ineligible.plannedCapacity,0);assert.equal(ineligible.unmetDemand[0].amount,25);
});
test('planned-care mix rules reuse forecast follow-up allocation and preserve all pool totals',()=>{
 const d=empty();d.sameDay[0]=10;d.planned=10;d.types.sameDay=['Same Day'];d.types.planned=['Follow-Up'];d.byType.sameDay={'Same Day':[10,0,0,0,0]};d.byType.planned={'Follow-Up':10};
 const rule={id:'mix',kind:'mix',enabled:true,strength:'must',scope:'week',days:[1,2,3,4,5],minimum:50,comparison:'exact',shareSubject:{kind:'group',name:'GP'},appointmentTypes:['Follow-Up']};
 const p=model().window.SessionBuilderPlanning.estimateSessions([session('gp',['Same Day','Follow-Up'])],['Phone'],['GP'],d,[rule],{respectTypes:true,appointmentPools:{'Same Day':'sameDay','Follow-Up':'planned'}});
 assert.equal(p.error,undefined);assert.equal(p.plannedCapacity,10);assert.equal(p.routineCapacity,0);assert.equal(p.capacitySameDay[0],10);assert.equal(p.totalCapacity,20);assert.equal(p.ruleResults[0].ok,true);
});
test('renderer keeps follow-up history when urgent forecast is applied and displays allocation in both tables',()=>{
 const c=model();class Element{constructor(){this.children=[];this.style={};this.classList={add(){}};this.value='';}append(...children){this.children.push(...children)}replaceChildren(...children){this.children=children}setAttribute(){}addEventListener(){}}
 const elements=new Map(),byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*864e5).toISOString().slice(0,10),monday=day=>shift(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
 const weeks=Array.from({length:52},(_,i)=>shift('2025-11-24',i*7)),history=weeks.flatMap(day=>[{bookedDay:day,count:30,slot:'Follow-Up',status:'Booked'},{bookedDay:day,count:20,slot:'Routine',status:'Booked'}]);
 Object.assign(c,{document:{getElementById:byId,createElement:()=>new Element()},console,Intl,Date,Number,Math,Set,Map,JSON,crypto:{randomUUID:()=> 'new'},consultCategoryNames:['Phone'],clinicianGroupNames:['GP'],clinicianCategoryNames:['GP Partner','Salaried GP'],clinicianGroupAssignments:{'GP Partner':'GP','Salaried GP':'GP'},groupUrgencyNames:['Same Day','Routine','Follow-Up'],sessionBuilderTypes:[{...session('gp',['Same Day','Routine','Follow-Up']),eligibleClinicians:['GP Partner','Salaried GP']}],sessionBuilderClinicianLimits:{'GP Partner':{annualRate:12000},'Salaried GP':{annualRate:10000}},sessionBuilderRules:[],canEditSessionBuilder:()=>true,isDashboardToggleOption:()=>true,dayView2LondonClock:()=>({date:'2026-11-24'}),GPCorrectness:{monday,shift,completeWeeks:()=>weeks},historicalBookingRecords:()=>history,slotReportCoverage:[],excludedSlotTypes:new Set(),assignments:{},groupUrgencyAssignments:{},consultAssignments:{},capacityUrgencyCategory:slot=>slot,appointmentCalculationRole:name=>name==='Routine'?'routine':name==='Same Day'?'urgent':'other',appointmentCategoryFor:name=>name==='Follow-Up'?'Planned Care':name==='Routine'?'Routine Care':'Urgent Care',urgencyGroupColour:()=> '#123456'});
 c.window.gpChartPreferences={read:()=>({})};c.window.getSessionBuilderUrgentForecast=()=>({weeks:[{daily:Array.from({length:5},()=>({'Same Day':10})),weekly:{}}],dailyGroups:['Same Day'],weeklyGroups:[],listAdjusted:true});
 vm.runInContext(fs.readFileSync('session-builder-costing.js','utf8'),c);vm.runInContext(fs.readFileSync('session-builder.js','utf8'),c);c.window.renderSessionBuilderRequirements();
 const costRow=byId('sessionBuilderPlanBody').children[0];assert.equal(costRow.children.length,14);assert.equal(costRow.children[11].textContent,'£110,000');assert.equal(costRow.children[12].textContent,'10');assert.equal(costRow.children[13].textContent,'100');assert.equal(costRow.children[11].children[0].children[0].textContent,'GP Partner · 5 sessions/week · £60,000/year');assert.equal(costRow.children[11].children[0].children[1].textContent,'Salaried GP · 5 sessions/week · £50,000/year');assert.equal(byId('sessionBuilderPlanFoot').children[0].children[11].textContent,'£110,000');const before=byId('sessionBuilderPlanBody').children[0].children.slice(1,11).map(x=>x.textContent);c.sessionBuilderClinicianLimits['GP Partner'].annualRate=20000;c.window.renderSessionBuilderRequirements();assert.deepEqual(byId('sessionBuilderPlanBody').children[0].children.slice(1,11).map(x=>x.textContent),before);assert.equal(byId('sessionBuilderPlanBody').children[0].children[11].textContent,'£150,000');const summary=byId('sessionBuilderCapacityBody').children;assert.equal(summary[0].children.length,9);assert.equal(summary[0].children[8].textContent,'30');assert.equal(summary[1].children[8].textContent,'30');assert.equal(summary[0].children[7].textContent,'20');assert.equal(summary[2].children[8].textContent,'—');
 assert.match(byId('sessionBuilderHistory').textContent,/52 completed weeks/);assert.match(byId('sessionBuilderPlanFoot').children[0].children[13].children[0].children.map(x=>x.textContent).join(','),/Planned care 30/);
 const html=fs.readFileSync('dashboard.html','utf8');assert.match(html,/<th scope="col">Routine allocation<\/th><th scope="col">Planned care allocation<\/th>/);
});
test('any configured planned-care session covers the pooled demand, including extra follow-ups',()=>{
 const d=empty();d.planned=12.3;d.types.planned=['Urgent Extra Follow-up'];d.byType.planned={'Urgent Extra Follow-up':12.3};d.eligiblePlannedTypes=['Follow-Up','Urgent Extra Follow-up'];
 const p=model().window.SessionBuilderPlanning.estimateSessions([session('follow-up',['Follow-Up'])],['Phone'],['GP'],d,[],{respectTypes:true});
 assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,0);assert.equal(p.plannedCapacity,20);assert.equal(p.rows[0].planned,2);
 const cells=Object.values(p.appointmentBreakdown).flatMap(days=>days.flatMap(day=>[day.morning,day.afternoon]));
 assert.equal(cells.reduce((n,cell)=>n+(cell['Planned care']||0),0),20);assert.ok(cells.every(cell=>!Object.hasOwn(cell,'Urgent Extra Follow-up')));
});
test('a planned-care percentage rule accepts capacity from any planned-care subtype',()=>{
 const d=empty();d.sameDay[0]=10;d.planned=10;d.types.sameDay=['Same Day'];d.byType.sameDay={'Same Day':[10,0,0,0,0]};d.types.planned=['Follow-up Extra'];d.byType.planned={'Follow-up Extra':10};d.eligiblePlannedTypes=['Follow-Up','Follow-up Extra'];
 const rule={id:'mix',kind:'mix',enabled:true,strength:'must',scope:'week',days:[1,2,3,4,5],minimum:50,comparison:'exact',shareSubject:{kind:'group',name:'GP'},appointmentTypes:['Follow-up Extra']};
 const p=model().window.SessionBuilderPlanning.estimateSessions([session('gp',['Same Day','Follow-Up'])],['Phone'],['GP'],d,[rule],{respectTypes:true,appointmentPools:{'Same Day':'sameDay','Follow-Up':'planned','Follow-up Extra':'planned'}});
 assert.equal(p.error,undefined);assert.equal(p.ruleResults[0].ok,true);assert.equal(p.plannedCapacity,10);assert.equal(p.totalCapacity,20);assert.equal(p.unmetDemand.length,0);
});
test('true planned-care shortages are reported once as pooled care, not as missing subtypes',()=>{
 const d=empty();d.planned=12.3;d.byType.planned={'Follow-up Extra':12.3};d.types.planned=['Follow-up Extra'];d.eligiblePlannedTypes=['Follow-Up','Follow-up Extra'];
 const p=model().window.SessionBuilderPlanning.estimateSessions([session('gp',['Follow-Up'])],['Phone'],['GP'],d,[],{respectTypes:true,clinicians:{'GP Partner':'GP'},clinicianLimits:{'GP Partner':{max:1}}});
 assert.equal(p.error,undefined);assert.equal(p.unmetDemand.length,1);assert.equal(p.unmetDemand[0].pool,'planned');assert.equal(p.unmetDemand[0].name,'Planned care');assert.ok(Math.abs(p.unmetDemand[0].amount-2.3)<1e-7);
 const aggregate={...d,byType:{...d.byType,planned:{}}};const q=model().window.SessionBuilderPlanning.estimateSessions([session('gp',['Follow-Up'])],['Phone'],['GP'],aggregate,[],{respectTypes:true,clinicians:{'GP Partner':'GP'},clinicianLimits:{'GP Partner':{max:1}}});assert.equal(q.unmetDemand.length,1);
});
