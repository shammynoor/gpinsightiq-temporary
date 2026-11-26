const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-costing.js','utf8'),c);const {equalSplit,total}=c.window.SessionBuilderCosting;
test('annual cost splits weekly sessions equally and does not multiply an annualised rate by 52',()=>{
 const rates={'GP Partner':{annualRate:12000},'Salaried GP':{annualRate:10000}};
 const row=equalSplit(88,['GP Partner','Salaried GP'],rates);
 assert.equal(row.pence,96800000);assert.equal(row.complete,true);assert.equal(row.parts[0].sessions,44);assert.equal(row.parts[0].pence,52800000);assert.equal(row.parts[1].pence,44000000);
 assert.equal(rates['GP Partner'].annualRate,12000);
});
test('UCT costs support several eligible types, fractional equal shares and penny-consistent totals',()=>{
 const row=equalSplit(5,['Nurse','Paramedic','Physio','Nurse'],{Nurse:{annualRate:8000},Paramedic:{annualRate:9000},Physio:{annualRate:7000}});
 assert.equal(row.parts.length,3);assert.equal(row.parts[0].sessions,5/3);assert.equal(row.pence,row.parts.reduce((n,p)=>n+p.pence,0));assert.equal(row.pence,4000000);
});
test('zero-appointment on-call sessions still cost money and zero-session rows cost nothing',()=>{
 assert.equal(equalSplit(10,['GP'],{GP:{annualRate:12000}}).pence,12000000);
 const zero=equalSplit(0,['GP'],{});assert.equal(zero.pence,0);assert.equal(zero.complete,true);
 assert.equal(equalSplit(0,[],{}).complete,true);
});
test('missing rates give an incomplete subtotal, while an explicit zero rate is valid',()=>{
 const missing=equalSplit(2,['GP','UCT'],{GP:{annualRate:10000}});
 assert.equal(missing.complete,false);assert.equal(missing.pence,1000000);assert.equal(missing.parts[1].missing,true);
 assert.equal(equalSplit(1,['GP'],{GP:{annualRate:0}}).complete,true);
 assert.equal(equalSplit(1,[],{}).unassigned,true);
});
test('grand totals aggregate clinician breakdowns and propagate missing rates',()=>{
 const rates={GP:{annualRate:10000},UCT:{annualRate:8000}},a=equalSplit(4,['GP','UCT'],rates),b=equalSplit(2,['GP'],rates),sum=total([a,b]);
 assert.equal(sum.pence,5600000);assert.equal(sum.parts.find(p=>p.name==='GP').sessions,4);assert.equal(sum.parts.find(p=>p.name==='GP').pence,4000000);assert.equal(sum.complete,true);
 assert.equal(total([a,equalSplit(1,['Missing'],{})]).complete,false);
});
test('editing an annualised rate immediately refreshes the cost table and retains other clinician settings',()=>{
 class Element{constructor(){this.children=[];this.events={};}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(){}addEventListener(name,fn){this.events[name]=fn}setCustomValidity(){}checkValidity(){return true}reportValidity(){}}
 const elements=new Map(),byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 let refreshes=0,saves=0;const ctx={window:{renderSessionBuilderRequirements:()=>refreshes++},document:{getElementById:byId,createElement:()=>new Element()},clinicianCategoryNames:['GP Partner'],clinicianGroupNames:['GP'],clinicianGroupAssignments:{'GP Partner':'GP'},sessionBuilderClinicianLimits:{'GP Partner':{min:1,max:10,annualRate:10000,annualLeaveWeeks:5,sicknessPercent:5}},canEditSessionBuilder:()=>true,sessionBuilderTypes:[],markCategoryDirty:()=>saves++};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('session-builder-clinicians.js','utf8'),ctx);ctx.window.renderSessionBuilderClinicians();
 const rate=byId('sessionBuilderClinicianBody').children[1].children[3].children[0].children[1];rate.value='12500';rate.events.change();
 assert.equal(ctx.sessionBuilderClinicianLimits['GP Partner'].annualRate,12500);assert.equal(ctx.sessionBuilderClinicianLimits['GP Partner'].max,10);assert.equal(ctx.sessionBuilderClinicianLimits['GP Partner'].sicknessPercent,5);assert.equal(saves,1);assert.equal(refreshes,1);
});

test('average session cover applies leave and sickness once',()=>{const c={window:{}};require('node:vm').runInNewContext(require('node:fs').readFileSync('session-builder-costing.js','utf8'),c);const f=c.window.SessionBuilderCosting.coveredSessions;assert.ok(Math.abs(f(10,{annualLeaveWeeks:6,sicknessPercent:0})-10*46/52)<1e-10);assert.ok(Math.abs(f(10,{annualLeaveWeeks:6,sicknessPercent:10})-10*46/52*.9)<1e-10);assert.equal(f(10,{annualLeaveWeeks:0}),10);assert.equal(f(10,{annualLeaveWeeks:52}),0);assert.equal(f(10,{sicknessPercent:100}),0);});
