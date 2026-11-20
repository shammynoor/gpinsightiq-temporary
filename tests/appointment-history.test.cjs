const {test}=require('node:test');
const assert=require('node:assert/strict');
const {appointmentHistory}=require('../sessions-history.js');
const row=(date,slot,clinician,count=1,extra={})=>({source:'slot',availability:'Booked',date,slot,clinician,count,minute:600,...extra});
const type=r=>r.clinician;
const locum=r=>r.locum===true;
const care=r=>r.slot;
const coverage=[{start:'2025-12-20',end:'2026-01-18',asOf:'2026-01-18'}];
test('counts booked appointments by appointment week, type and year, including locums',()=>{
 const data=[row('2025-12-31','urgent','GP',3),row('2026-01-01','urgent','GP',2),row('2026-01-02','routine','Nurse',4,{locum:true}),row('2026-01-02','visit','GP',5),row('2026-01-02','urgent','GP',30,{availability:'Available'}),row('2026-01-09','urgent','GP',100,{source:'other'})];
 const result=appointmentHistory(data,{date:'2026-01-10',minute:720},type,locum,care,new Set(),coverage);
 assert.deepEqual(result.types,['GP','Nurse · Locum']);
 assert.equal(result.yearWeekTotals.get('2025').get('2025-12-29').get('urgent').get('GP'),3);
 const week=result.yearWeekTotals.get('2026').get('2025-12-29');
 assert.equal(week.get('urgent').get('GP'),2);assert.equal(week.get('routine').get('Nurse · Locum'),4);assert.equal(week.get('visit').get('GP'),5);
 assert.equal(result.incomplete.has('2025-12-29'),false);
});
test('excludes future and excluded slots, and marks partial weeks',()=>{
 const data=[row('2026-01-07','urgent','GP',2),row('2026-01-10','urgent','GP',8,{minute:800}),row('2026-01-10','routine','GP',7,{minute:null}),row('2026-01-11','urgent','GP',9),row('2026-01-07','excluded','GP',3)];
 const result=appointmentHistory(data,{date:'2026-01-10',minute:720},type,locum,care,new Set(['excluded']),coverage);
 assert.equal(result.yearWeekTotals.get('2026').get('2026-01-05').get('urgent').get('GP'),2);
 assert.equal(result.incomplete.has('2026-01-05'),true);
 assert.equal(result.yearWeekTotals.get('2026').get('2026-01-05').has('routine'),false);
});
