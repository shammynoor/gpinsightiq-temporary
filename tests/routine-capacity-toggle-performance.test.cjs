const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

test('routine capacity reuses classifications without changing results',()=>{
 const code=fs.readFileSync(require.resolve('../routine-capacity.js'),'utf8')
  .replace('document.addEventListener(\'DOMContentLoaded\',()=>{','globalThis.testRoutineModel=modelData;document.addEventListener(\'DOMContentLoaded\',()=>{');
 const shift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const weeks=Array.from({length:8},(_,i)=>shift('2026-01-05',7*i));
 let mappingCalls=0;
 const availabilityRecords=[],records=[],waitingTrendRecords=[];
 for(const date of weeks)for(let i=0;i<500;i++){
  const base={slot:'GP face to face',clinician:'GP',person:'',count:1};
  availabilityRecords.push({...base,availability:'Booked',date});
  records.push({...base,bookedDay:date});
  waitingTrendRecords.push({...base,appointmentDate:date,leadMinutes:10080});
 }
 const context={console,Date,Number,Map,Set,Intl,Math,
  document:{getElementById:()=>null,addEventListener:()=>{}},window:{},
  records,availabilityRecords,waitingTrendRecords,slotReportCoverage:[],
  clinicianGroupNames:['GP'],clinicianGroupAssignments:{GP:'GP'},
  consultAssignments:{'GP face to face':'Face to face'},consultCategoryNames:['Face to face'],
  excludedSlotTypes:new Set(),appointmentCalculationRole:()=> 'routine',
  isDoctorPlanningGroup:()=>true,locumMatches:()=>true,
  capacityUrgencyCategory:()=>{mappingCalls++;return 'Routine'},
  effectiveClinicianType:c=>c,isDashboardToggleOption:()=>true,prioritySort:(_,x)=>x,
  GPCorrectness:{completeWeeks:()=>weeks}
 };
 vm.createContext(context);vm.runInContext(code,context);
 const result=context.testRoutineModel();
 assert.equal(result.demand,500);assert.equal(result.capacity,500);assert.equal(result.wait,1);
 assert.equal(result.daysObserved,4000);
 assert.equal(mappingCalls,1);
});
