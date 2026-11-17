const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function expose(file,expression,context){
 const code=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.exposed='+expression+';})();');
 vm.runInNewContext(code,context);
 return context.exposed;
}
test('planning date index reuses the snapshot and rebuilds for a new report',()=>{
 const ctx={window:{},document:{addEventListener(){}}};
 const lookup=expose('planning.js','planningRowsForDates',ctx);
 const old=[{date:'2026-01-01',n:1},{date:'2026-01-03',n:2},{date:'2026-01-01',n:3}];
 assert.deepEqual(Array.from(lookup(old,['2026-01-01']),r=>r.n),[1,3]);
 assert.deepEqual(Array.from(lookup(old,['2026-01-03']),r=>r.n),[2]);
 assert.deepEqual(Array.from(lookup([{date:'2026-01-01',n:4}],['2026-01-01']),r=>r.n),[4]);
});
test('workforce totals are reused and invalidated by assignments and report data',()=>{
 const ctx={window:{},availabilityRecords:[{date:'2025-01-02',availability:'booked',count:4,slot:'A',clinician:'U'}],clinicianAssignments:{U:'GP'},excludedSlotTypes:new Set(),effectiveClinicianType(id){return ctx.clinicianAssignments[id]},isDayView2SlotReportRecord(){return true}};
 const calculate=expose('workforce-planning.js','annualBookedSlots',ctx);
 const coverage={intervals:[]},first=calculate('2026-11-17',coverage,null);
 assert.equal(first.get(JSON.stringify(['GP','2025'])),4);
 assert.equal(calculate('2026-11-17',coverage,null),first);
 ctx.clinicianAssignments.U='Nurse';
 assert.equal(calculate('2026-11-17',coverage,null).get(JSON.stringify(['Nurse','2025'])),4);
 ctx.availabilityRecords=[{date:'2025-01-02',availability:'booked',count:7,slot:'A',clinician:'U'}];
 assert.equal(calculate('2026-11-17',coverage,null).get(JSON.stringify(['Nurse','2025'])),7);
 ctx.excludedSlotTypes.add('A');
 assert.equal(calculate('2026-11-17',coverage,null).size,0);
});
