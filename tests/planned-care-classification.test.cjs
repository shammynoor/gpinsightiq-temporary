const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {roles}=require('../data-correctness.js');
test('planned care overrides a stale routine role while preserving the identifier',()=>{
 const saved={appointmentTypes:{'Follow-up Extra':{id:'appointment:Routine%20Extra',kind:'routine'},Routine:{id:'r',kind:'routine'},'Same Day':{id:'u',kind:'urgent'}}};
 const categories={'Follow-up Extra':' Planned Care ',Routine:'Routine Care','Same Day':'Urgent Care'};
 const updated=roles(saved,Object.keys(categories),[],name=>categories[name]);
 assert.equal(updated.appointmentTypes['Follow-up Extra'].kind,'other');assert.equal(updated.appointmentTypes['Follow-up Extra'].id,'appointment:Routine%20Extra');assert.equal(updated.appointmentTypes.Routine.kind,'routine');assert.equal(updated.appointmentTypes['Same Day'].kind,'urgent');
 assert.equal(saved.appointmentTypes['Follow-up Extra'].kind,'routine');
});
test('changing a category takes effect immediately even when a routine role is cached',()=>{
 const source=fs.readFileSync('app.js','utf8'),code=source.slice(source.indexOf('function appointmentCalculationRole('),source.indexOf('function isDoctorPlanningGroup('));
 let category='Planned Care';const context={groupUrgencyNames:['Follow-up Extra'],analyticsRoles:{appointmentTypes:{'Follow-up Extra':{kind:'routine'}}},appointmentCategoryFor:()=>category,Object,ensureAnalyticsRoles(){}};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(context.appointmentCalculationRole('Follow-up Extra'),'other');category='Routine Care';assert.equal(context.appointmentCalculationRole('Follow-up Extra'),'routine');assert.equal(context.appointmentCalculationRole('unknown'),'other');
});
