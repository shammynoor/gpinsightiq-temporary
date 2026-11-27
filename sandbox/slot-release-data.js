(function(){
'use strict';
// This preview reads only aggregates already authorised and loaded in this dashboard.
const shift=(day,n)=>GPCorrectness.shift(day,n);
function buildSnapshot(){
 if(!canEditSessionBuilder()||!iqBridge?.practice?.id)throw Error('Sign in to an authorised practice administrator workspace first.');
 if(!Array.isArray(availabilityRecords)||!availabilityRecords.length)throw Error('No Slot Report is loaded for this practice.');
 const today=dayView2LondonClock().date,start=GPCorrectness.monday(today),end=shift(start,55),demand=window.getSlotReleaseSandboxDemand?.();
 const forecasts=window.readUrgentDailyPlanningForecast?.(),clock=capacitySnapshotClock();
 const empty=()=>({booked:0,bookedExtra:0,embargoed:0,open:0,blocked:0,missedEmpty:0}),byDate=new Map(),byWeek=new Map(),knownDates=new Set();let unmapped=false,forecastFiltered=false;
 const dailyGroups=new Set(forecasts?.groups||[]),weeklyGroups=new Set(forecasts?.weeklyGroups||[]);
 for(const row of availabilityRecords){
  if(row.source==='signposting'||excludedSlotTypes.has(row.slot)||!row.date||row.date<start||row.date>end)continue;
  knownDates.add(row.date);const appointmentType=capacityUrgencyCategory(row.slot),type=appointmentCategoryFor(appointmentType);if(!type){unmapped=true;continue;}
  if((type==='Daily Urgent'&&!dailyGroups.has(appointmentType))||(type==='Weekly Urgent'&&!weeklyGroups.has(appointmentType)))forecastFiltered=true;
  if(!['Daily Urgent','Weekly Urgent','Routine'].includes(type))continue;
  const status=String(row.availability||'').trim().toLowerCase(),count=Number(row.count)||0;
  if(!['booked','embargoed','available','blocked'].includes(status))continue;
  const week=GPCorrectness.monday(row.date),target=type==='Daily Urgent'?byDate:byWeek,groupKey=type==='Daily Urgent'?row.date:week+'|'+type;
  if(!target.has(groupKey))target.set(groupKey,empty());const counts=target.get(groupKey);
  if(status==='available'){
   if(!clock){counts.open=null;counts.missedEmpty=null;}
   else if(isMissedAvailableSlot(row,clock))counts.missedEmpty+=count;else counts.open+=count;
  }else{counts[status]+=count;if(status==='booked'&&type==='Daily Urgent'&&/extras?$/.test(appointmentType.toLowerCase().replace(/[^a-z]/g,'')))counts.bookedExtra+=count;}

 }
 const holidays=new Set();for(let year=Number(start.slice(0,4))-1;year<=Number(end.slice(0,4))+1;year++)for(const day of englandWalesBankHolidays(year))holidays.add(day);
 const weeks=Array.from({length:8},(_,index)=>{
  const weekStart=shift(start,index*7),dates=Array.from({length:5},(_,d)=>shift(weekStart,d));
  const days=dates.map(date=>{const known=knownDates.has(date),prediction=forecasts?.daily?.get(date);return {date,need:Number.isFinite(prediction?.suggested)?prediction.suggested:null,bankHoliday:holidays.has(date),counts:known?(byDate.get(date)||empty()):null};});
  const known=dates.filter(date=>!holidays.has(date)).every(date=>knownDates.has(date)),holiday=days.some(day=>day.bankHoliday),routineNeed=demand?.listSizeAvailable!==false&&!holiday&&Number.isFinite(demand?.demand?.routine)?demand.demand.routine:null,weeklyNeed=forecasts?.weekly?.get(weekStart);
  return {weekStart,days,known,weekly:{need:Number.isFinite(weeklyNeed)?weeklyNeed:null,counts:known?(byWeek.get(weekStart+'|Weekly Urgent')||empty()):null},routine:{need:routineNeed,counts:known?(byWeek.get(weekStart+'|Routine')||empty()):null}};
 });
 return {today,practiceName:iqBridge.practice.name||'Practice',asOf:Number.isFinite(capacityCSVLatestModified)?new Date(capacityCSVLatestModified).toISOString():null,unmapped,forecastFiltered,weeks};
}
window.getSlotReleaseSandboxData=buildSnapshot;
window.isSlotReleaseSandboxAuthorised=()=>!!(canEditSessionBuilder()&&iqBridge?.practice?.id);
})();
