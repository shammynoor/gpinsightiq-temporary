const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../session-builder-planning.js','utf8'),c);
const estimate=c.window.SessionBuilderPlanning.estimateSessions,modes=['Phone','Home visit'],groups=['GP','Team'];
const type=(id,group,phone=0,home=0)=>({id,name:id,clinicianTypes:[group],appointmentsByMode:{Phone:phone,'Home visit':home}});
const types=[type('Team','Team',20),type('GP','GP',10),type('Visiting Doctor','GP',0,5),type('On-call GW','GP')];
const demand={sameDay:[100,80,70,60,50],homeVisit:[5,5,5,5,5],weekly:40,routine:60};
const min=(id,scope='morning',minimum=1)=>({id,enabled:true,kind:'minimum',sessionTypeId:id,scope,days:[1,2,3,4,5],minimum,strength:'must'});
const share=(group,minimum=40,scope='both')=>({id:group,enabled:true,kind:'share',scope,days:[1,2,3,4,5],minimum,clinicianGroup:group,denominator:'all',comparisonGroup:'',strength:'must'});
const run=rules=>estimate(types,modes,groups,demand,rules);
const p=run([min('On-call GW'),min('Visiting Doctor')]);assert.equal(p.error,undefined);
for(const id of ['On-call GW','Visiting Doctor']){const r=p.rows.find(r=>r.id===id);for(let d=0;d<5;d++){assert.ok(r.days[d]>=1);assert.ok(r.periods.morning[d]>=1);}}
const verify=plan=>{assert.equal(plan.error,undefined);for(let d=0;d<5;d++){assert.ok(plan.capacitySameDay[d]>=demand.sameDay[d]);assert.ok(plan.capacityHomeVisit[d]>=demand.homeVisit[d]);}assert.ok(plan.weeklyCapacity>=demand.weekly);assert.ok(plan.routineCapacity>=demand.routine);assert.equal(plan.totalCapacity,plan.capacitySameDay.reduce((s,n)=>s+n,0)+plan.capacityHomeVisit.reduce((s,n)=>s+n,0)+plan.weeklyCapacity+plan.routineCapacity);for(const row of plan.rows){const count=plan.placements.filter(p=>p.id===row.id).reduce((s,p)=>s+p.count,0);assert.equal(count,row.days.reduce((s,n)=>s+n,0)+row.weekly+row.routine);}};
verify(p);assert.equal(p.rows.find(r=>r.id==='Visiting Doctor').days[0],1,'seed capacity covers home need once');
const duplicate=run([min('On-call GW','both',2),{...min('On-call GW','morning',2),id:'duplicate'}, {...min('On-call GW','day',3),id:'day'}]);
assert.equal(duplicate.error,undefined);const oncall=duplicate.rows.find(r=>r.id==='On-call GW');assert.deepEqual([...oncall.days],[4,4,4,4,4]);
for(const rule of [{...min('On-call GW'),enabled:false},{...min('On-call GW'),strength:'prefer'}]){const q=run([rule]);assert.ok(q.rows.find(r=>r.id==='On-call GW').days.every(n=>n===0));if(rule.enabled)assert.equal(q.ruleResults[0].ok,false);}
assert.match(run([min('removed')]).error,/missing/);
assert.match(estimate(types.map(t=>t.id==='On-call GW'?{...t,clinicianTypes:[]}:t),modes,groups,demand,[min('On-call GW')]).error,/clinician group/);
const shares=run([min('On-call GW'),share('GP')]);verify(shares);assert.ok(shares.ruleResults.every(r=>r.ok));
for(let d=0;d<5;d++)for(const period of ['morning','afternoon']){const total=shares.rows.reduce((s,r)=>s+r.periods[period][d]*r.capacity,0),gp=shares.rows.filter(r=>r.group==='GP').reduce((s,r)=>s+r.periods[period][d]*r.capacity,0);assert.ok(gp>=total*.4-1e-7);}
const pair=run([{...share('GP',60,'day'),denominator:'pair',comparisonGroup:'Team'}]);verify(pair);assert.equal(pair.ruleResults[0].ok,true);
assert.ok(run([share('GP',60),share('Team',60)]).error,'conflicting shares cannot be reported as met');
assert.ok(estimate([types[0],types[3]],modes,groups,{...demand,homeVisit:[0,0,0,0,0]},[min('On-call GW'),share('GP')]).error,'zero-capacity on-call cannot satisfy GP appointment share');
const zero={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0};
const mandatory=estimate([types[3]],modes,groups,zero,[min('On-call GW')]);assert.equal(mandatory.error,undefined);assert.equal(mandatory.days[0],1);assert.equal(mandatory.totalCapacity,0);
const renamed=estimate(types.map(t=>t.id==='On-call GW'?{...t,name:'Renamed'}:t),modes,groups,demand,[min('On-call GW')]);assert.equal(renamed.error,undefined);assert.equal(renamed.rows.find(r=>r.id==='On-call GW').days[0],1);
console.log('Passed: saved on-call rules, zero-capacity mandatory sessions, AM/PM scopes, duplicates, disabled/preferred rules, stable IDs, missing references, residual demand, share rules and conflicts, separate pool accounting.');
