const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){const c={window:{},Date};vm.createContext(c);vm.runInContext(fs.readFileSync('vendor/javascript-lp-solver-1.0.3.js','utf8'),c);c.window.solver=c.solver;for(const p of ['session-builder-planning.js','session-builder-distribution.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(p,'utf8'),c);return c;}
const distribution=(name='Routine',strength='must',extra={})=>({id:'spread',enabled:true,kind:'distribution',scope:'week',days:[1,2,3,4,5],minimum:0,appointmentTypes:[name],distributionMode:'even',distributionTolerance:0,distributionTargets:{},strength,...extra});
const empty=()=>({sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0,eligibleDailyTypes:['Same Day'],eligiblePlannedTypes:['Follow-Up'],types:{sameDay:['Same Day'],homeVisit:['Visit'],weekly:['Within 3 Days'],routine:['Routine'],planned:['Follow-Up']},byType:{sameDay:{'Same Day':[0,0,0,0,0]},homeVisit:{},weekly:{},routine:{},planned:{}}});
function run(c,d,rules,limits={GP:{annualRate:10000,annualLeaveWeeks:0}},types){return c.window.SessionBuilderPlanning.estimateSessions(types||[{id:'gp',name:'GP',eligibleClinicians:Object.keys(limits),appointmentTypes:['Same Day','Within 3 Days','Visit','Routine','Follow-Up'],appointmentsByMode:{Phone:10,'Home Visit':2}}],['Phone','Home Visit'],['GP'],d,rules,{optimizeCost:true,respectTypes:true,clinicians:Object.fromEntries(Object.keys(limits).map(name=>[name,'GP'])),clinicianLimits:limits,appointmentPools:{'Same Day':'sameDay','Within 3 Days':'weekly',Visit:'homeVisit',Routine:'routine','Follow-Up':'planned','Follow-up Extra':'planned'}});}
function daily(p,name){return Array.from({length:5},(_,day)=>Object.values(p.appointmentBreakdown).reduce((n,days)=>n+(days[day].morning[name]||0)+(days[day].afternoon[name]||0),0));}
test('Must meet can enforce an even weekly routine distribution with whole appointments',()=>{
 const c=setup(),d=empty();d.routine=10;d.byType.routine={Routine:10};const p=run(c,d,[distribution()]);assert.equal(p.error,undefined);assert.deepEqual(daily(p,'Routine'),[2,2,2,2,2]);assert.equal(p.ruleResults[0].ok,true);assert.equal(p.clinicianCounts.GP,5);
});
test('Prefer balances an equal-cost plan without creating extra sessions or increasing cost',()=>{
 const c=setup(),d=empty();d.routine=10;d.byType.routine={Routine:10};const p=run(c,d,[distribution('Routine','prefer')]);assert.equal(p.error,undefined);assert.equal(p.annualCost,10000);assert.equal(p.clinicianCounts.GP,1);assert.equal(p.ruleResults[0].ok,false);
 const coverage={id:'coverage',enabled:true,kind:'minimum',scope:'day',days:[1,2,3,4,5],minimum:1,sessionTypeId:'gp',strength:'must'};
 const q=run(c,d,[coverage,distribution('Routine','prefer')]);assert.equal(q.error,undefined);assert.deepEqual(daily(q,'Routine'),[2,2,2,2,2]);assert.equal(q.annualCost,50000);assert.equal(q.ruleResults.find(r=>r.id==='spread').ok,true);
});
test('custom percentages apply to all planned-care subtypes through their shared pool',()=>{
 const c=setup(),d=empty();d.planned=10;d.types.planned=['Follow-up Extra'];d.byType.planned={'Follow-up Extra':10};const r=distribution('Follow-up Extra','must',{days:[1,3,5],distributionMode:'custom',distributionTargets:{1:50,3:30,5:20}}),p=run(c,d,[r]);assert.equal(p.error,undefined);assert.deepEqual(daily(p,'Planned care'),[5,0,3,0,2]);assert.equal(p.ruleResults[0].ok,true);
});
test('daily ranges allow whole-number variation within the configured tolerance',()=>{
 const c=setup(),d=empty();d.routine=7;d.byType.routine={Routine:7};const p=run(c,d,[distribution('Routine','must',{distributionTolerance:10})]);assert.equal(p.error,undefined);const counts=daily(p,'Routine'),total=counts.reduce((a,b)=>a+b,0);for(const n of counts){assert.ok(Number.isInteger(n));assert.ok(n>=total*.1-1e-5&&n<=total*.3+1e-5);}assert.ok(total>=7);assert.equal(p.ruleResults[0].ok,true);
});
test('weekly urgent and home visits can be selected, and daily urgent rules cannot override daily demand',()=>{
 const c=setup(),d=empty();d.weekly=10;d.byType.weekly={'Within 3 Days':10};let p=run(c,d,[distribution('Within 3 Days')]);assert.equal(p.error,undefined);assert.deepEqual(daily(p,'Within 3 Days'),[2,2,2,2,2]);
 const home=empty();home.homeVisit=[1,1,1,1,1];home.byType.homeVisit={Visit:[1,1,1,1,1]};p=run(c,home,[distribution('Visit')]);assert.equal(p.error,undefined);assert.equal(p.ruleResults[0].ok,true);
 const urgent=empty();urgent.sameDay=[10,0,0,0,0];urgent.byType.sameDay['Same Day']=[10,0,0,0,0];p=run(c,urgent,[distribution('Same Day','prefer')]);assert.equal(p.error,undefined);assert.ok(p.capacitySameDay[0]>=10);assert.equal(p.ruleResults[0].ok,false);
});
test('Must meet respects clinician patterns and reports a conflict; disabled rules do nothing',()=>{
 const c=setup(),d=empty();d.routine=10;d.byType.routine={Routine:10};const r=distribution();
 const limited={GP:{annualRate:10000,annualLeaveWeeks:0,workingPattern:['Mon AM']}};assert.match(run(c,d,[r],limited).error,/No valid/);
 const p=run(c,d,[{...r,enabled:false}],limited);assert.equal(p.error,undefined);assert.equal(p.ruleResults.length,0);
});
test('distribution input checks targets, tolerance and removed allocation names',()=>{
 const c=setup(),helper=c.window.SessionBuilderDistribution;
 assert.equal(helper.issue(distribution('Routine'),['Routine']),'');assert.match(helper.issue(distribution('Gone'),['Routine']),/removed/);
 assert.match(helper.issue(distribution('Routine','must',{distributionMode:'custom',distributionTargets:{1:30}}),['Routine']),/100%/);
 assert.throws(()=>helper.validate(distribution('Routine','must',{distributionTolerance:-1})),/tolerance/);
 assert.deepEqual(Object.values(helper.initialTargets([1,3,5])),[33.3,33.3,33.4]);
});
test('rule editor creates nothing automatically, exposes every allocation type, and saves only on user actions',()=>{
 class Element{constructor(){this.children=[];this.events={};this.attrs={};this.dataset={};this.value='';}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,v){this.events[k]=v}checkValidity(){return true}setCustomValidity(){}reportValidity(){}focus(){}}
 const c=setup(),nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};let saves=0,notices=0,ids=0;
 Object.assign(c,{document:{getElementById:byId,createElement:()=>new Element()},Intl,canEditSessionBuilder:()=>true,sessionBuilderRules:[],sessionBuilderTypes:[],clinicianGroupNames:['GP'],clinicianCategoryNames:['GP'],clinicianGroupAssignments:{GP:'GP'},groupUrgencyNames:['Same Day','Extra','Within 3 Days','Routine','Follow-Up','Visit','New allocation'],isDashboardToggleOption:()=>true,markCategoryDirty:()=>saves++,crypto:{randomUUID:()=>String(++ids)}});c.window.renderSessionBuilderRequirements=()=>notices++;
 vm.runInContext(fs.readFileSync('session-builder-rules.js','utf8'),c);c.window.renderSessionBuilderRules();assert.equal(c.sessionBuilderRules.length,0);assert.equal(saves,0);
 byId('sessionBuilderNewRuleKind').value='distribution';byId('sessionBuilderAddRule').events.click();assert.equal(c.sessionBuilderRules.length,1);assert.equal(c.sessionBuilderRules[0].kind,'distribution');assert.equal(c.sessionBuilderRules[0].strength,'prefer');assert.equal(c.sessionBuilderRules[0].appointmentTypes.length,0);assert.equal(saves,1);
 const all=()=>{const result=[];function visit(node){result.push(node);for(const child of node.children||[])visit(child)}visit(byId('sessionBuilderRulesBody'));return result;};
 let allocation=all().find(n=>n.attrs?.['aria-label']==='Allocation for rule 1');assert.deepEqual(allocation.children.map(n=>n.value),['',...c.groupUrgencyNames]);allocation.value='Visit';allocation.events.change();assert.equal(c.sessionBuilderRules[0].appointmentTypes[0],'Visit');assert.equal(notices,2);
 c.window.renameSessionBuilderRuleAppointmentType('Visit','Home Visit');assert.equal(c.sessionBuilderRules[0].appointmentTypes[0],'Home Visit');c.groupUrgencyNames=c.groupUrgencyNames.map(n=>n==='Visit'?'Home Visit':n);assert.equal(c.window.inspectSessionBuilderRules().length,0);
 const saved=JSON.parse(JSON.stringify(c.sessionBuilderRules));assert.equal(c.window.validateSessionBuilderRules(saved),true);assert.equal(saved[0].distributionTolerance,5);
 let mode=all().find(n=>n.attrs?.['aria-label']==='Distribution for rule 1');mode.value='custom';mode.events.change();assert.equal(c.sessionBuilderRules[0].distributionMode,'custom');assert.equal(Object.values(c.sessionBuilderRules[0].distributionTargets).reduce((a,b)=>a+b,0),100);
 c.groupUrgencyNames=c.groupUrgencyNames.filter(n=>n!=='Home Visit');assert.match(c.window.inspectSessionBuilderRules()[0].message,/removed/);
 c.sessionBuilderRules=[];c.sessionBuilderTypes=[{id:'standard',name:'Standard GP'}];byId('sessionBuilderNewRuleKind').value='minimum';byId('sessionBuilderAddRule').events.click();assert.equal(c.sessionBuilderRules[0].kind,'minimum');assert.equal(c.sessionBuilderRules[0].sessionTypeId,'standard');let count=all().find(n=>n.attrs?.['aria-label']==='Minimum sessions');count.value='2';count.events.change();assert.equal(c.sessionBuilderRules[0].minimum,2);const ruleType=all().find(n=>n.attrs?.['aria-label']==='Rule type 1');ruleType.value='mix';ruleType.events.change();assert.equal(c.sessionBuilderRules[0].kind,'mix');assert.equal(c.window.validateSessionBuilderRules(c.sessionBuilderRules),true);
 c.sessionBuilderRules=[];byId('sessionBuilderNewRuleKind').value='sessionDistribution';byId('sessionBuilderAddRule').events.click();assert.equal(c.sessionBuilderRules[0].kind,'sessionDistribution');assert.equal(c.sessionBuilderRules[0].strength,'prefer');assert.equal(c.sessionBuilderRules[0].sessionTypeId,'');assert.equal(c.sessionBuilderRules[0].sessionTolerance,1);assert.equal(c.window.validateSessionBuilderRules(c.sessionBuilderRules),true);let sessionSelect=all().find(n=>n.attrs?.['aria-label']==='Session type for rule 1');sessionSelect.value='standard';sessionSelect.events.change();assert.equal(c.sessionBuilderRules[0].sessionTypeId,'standard');
});
test('session spread can distribute a selected session type across the week',()=>{
 const c=setup(),d=empty();d.routine=50;d.byType.routine={Routine:50};const rule={id:'spread-sessions',enabled:true,kind:'sessionDistribution',strength:'must',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'trainee',sessionTolerance:1};
 const types=[{id:'trainee',name:'GP trainee',eligibleClinicians:['GP'],appointmentTypes:['Routine'],appointmentsByMode:{Phone:10,'Home Visit':0}}],p=run(c,d,[rule],{GP:{annualRate:10000,annualLeaveWeeks:0}},types);assert.equal(p.error,undefined);const row=p.rows[0],total=row.days.reduce((a,b)=>a+b,0);assert.ok(total>=5);for(const count of row.days)assert.ok(Math.abs(count-total/5)<=1+1e-6);assert.equal(p.ruleResults[0].ok,true);
});
test('session spread can apply to each type and does not restrict single-session weeks',()=>{
 const c=setup(),d=empty();d.routine=10;d.byType.routine={Routine:10};const rule={id:'all-spread',enabled:true,kind:'sessionDistribution',strength:'must',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'',sessionTolerance:1};const p=run(c,d,[rule]);assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,1);assert.ok(p.ruleResults[0].ok);
});
test('session spread reports conflict with unavailable selected weekdays',()=>{
 const c=setup(),d=empty();d.routine=50;d.byType.routine={Routine:50};const rule={id:'spread',enabled:true,kind:'sessionDistribution',strength:'must',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'gp',sessionTolerance:1};const p=run(c,d,[rule],{GP:{annualRate:10000,annualLeaveWeeks:0,workingPattern:['Mon AM']}});assert.match(p.error,/No valid costed plan/);
});
test('preferred session spread improves the layout without adding sessions or increasing cost',()=>{
 const c=setup(),d=empty();d.routine=50;d.byType.routine={Routine:50};const rule={id:'preferred-spread',enabled:true,kind:'sessionDistribution',strength:'prefer',scope:'week',days:[1,2,3,4,5],minimum:0,sessionTypeId:'gp',sessionTolerance:1};const p=run(c,d,[rule]);assert.equal(p.error,undefined);assert.equal(p.clinicianCounts.GP,5);assert.equal(p.annualCost,50000);assert.ok(p.ruleResults[0].ok);assert.ok(Math.max(...p.rows[0].days)<=2);
});
