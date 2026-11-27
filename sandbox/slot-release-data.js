(function(){
'use strict';
// This preview reads only aggregates already authorised and loaded in this dashboard.
const shift=(day,n)=>GPCorrectness.shift(day,n);
function holidayNames(year){
 const names=new Map(),date=(month,day)=>new Date(Date.UTC(year,month-1,day,12)),move=(d,n)=>{const result=new Date(d);result.setUTCDate(result.getUTCDate()+n);return result},add=(d,name)=>names.set(d.toISOString().slice(0,10),name);
 const firstMonday=month=>move(date(month,1),(8-date(month,1).getUTCDay())%7),lastMonday=month=>{const d=date(month+1,0);return move(d,-((d.getUTCDay()+6)%7))};
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114,easter=date(Math.floor(n/31),n%31+1);
 add(move(easter,-2),'Good Friday');add(move(easter,1),'Easter Monday');
 const newYear=date(1,1),newDay=newYear.getUTCDay();add(move(newYear,newDay===6?2:newDay===0?1:0),"New Year's Day"+(newDay===0||newDay===6?' (substitute)':''));
 add(firstMonday(5),'Early May bank holiday');add(lastMonday(5),'Spring bank holiday');add(lastMonday(8),'Summer bank holiday');
 for(const [day,name] of [[25,'Christmas Day'],[26,'Boxing Day']]){const original=date(12,day),weekend=original.getUTCDay()===0||original.getUTCDay()===6;add(move(original,weekend?2:0),name+(weekend?' (substitute)':''));}
 return names;
}
function filterOptions(){
 if(!canEditSessionBuilder()||!iqBridge?.practice?.id)throw Error('Sign in to an authorised practice administrator workspace first.');
 const groups=typeof clinicianGroupNames==='undefined'?[]:clinicianGroupNames.filter(isDashboardToggleOption).map(name=>({name,colour:clinicianGroupColour(name)}));
 const modes=typeof consultCategoryNames==='undefined'?[]:consultCategoryNames.filter(isDashboardToggleOption).map(name=>({name,colour:consultModeColours[name]||'#638fac'}));
 if(availabilityRecords.some(row=>!groups.some(item=>item.name===clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)])))groups.push({name:'Uncategorised',colour:'#9caab4'});
 if(availabilityRecords.some(row=>!modes.some(item=>item.name===(consultAssignments[row.slot]||suggestConsultMode(row.slot)))))modes.push({name:'Uncategorised',colour:'#9caab4'});
 return {groups,modes,locum:[{name:'Locum',colour:'#638fac'},{name:'Not Locum',colour:'#638fac'}]};
}
function buildSnapshot(filters={}){
 if(!canEditSessionBuilder()||!iqBridge?.practice?.id)throw Error('Sign in to an authorised practice administrator workspace first.');
 if(!Array.isArray(availabilityRecords)||!availabilityRecords.length)throw Error('No Slot Report is loaded for this practice.');
 const today=dayView2LondonClock().date,start=GPCorrectness.monday(today),end=shift(start,55),demand=window.getSlotReleaseSandboxDemand?.();
 const forecasts=window.readUrgentDailyPlanningForecast?.(),clock=capacitySnapshotClock();
 const empty=()=>({booked:0,bookedExtra:0,embargoed:0,open:0,blocked:0,missedEmpty:0}),byDate=new Map(),byWeek=new Map(),knownDates=new Set();let unmapped=false,forecastFiltered=false;
 const dailyGroups=new Set(forecasts?.groups||[]),weeklyGroups=new Set(forecasts?.weeklyGroups||[]);
 for(const row of availabilityRecords){
  if(row.source==='signposting'||excludedSlotTypes.has(row.slot)||!row.date||row.date<start||row.date>end)continue;
  knownDates.add(row.date);
  if(filters.groups||filters.modes||filters.locum){
   const mappedGroup=clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)],group=clinicianGroupNames.includes(mappedGroup)?mappedGroup:'Uncategorised';
   const mappedMode=consultAssignments[row.slot]||suggestConsultMode(row.slot),mode=consultCategoryNames.includes(mappedMode)?mappedMode:'Uncategorised';
   if((filters.groups&&!filters.groups.includes(group))||(filters.modes&&!filters.modes.includes(mode))||(filters.locum&&!filters.locum.includes(locumCategory(row))))continue;
  }
  const appointmentType=capacityUrgencyCategory(row.slot),type=appointmentCategoryFor(appointmentType);if(!type){unmapped=true;continue;}
  if((type==='Daily Urgent'&&!dailyGroups.has(appointmentType))||(type==='Weekly Urgent'&&!weeklyGroups.has(appointmentType)))forecastFiltered=true;
  if(!['Daily Urgent','Weekly Urgent','Routine','Planned'].includes(type))continue;
  const status=String(row.availability||'').trim().toLowerCase(),count=Number(row.count)||0;
  if(!['booked','embargoed','available','blocked'].includes(status))continue;
  const week=GPCorrectness.monday(row.date),target=type==='Daily Urgent'?byDate:byWeek,groupKey=type==='Daily Urgent'?row.date:week+'|'+type;
  if(!target.has(groupKey))target.set(groupKey,empty());const counts=target.get(groupKey);
  if(status==='available'){
   if(!clock){counts.open=null;counts.missedEmpty=null;}
   else if(isMissedAvailableSlot(row,clock))counts.missedEmpty+=count;else counts.open+=count;
  }else{counts[status]+=count;if(status==='booked'&&type==='Daily Urgent'&&/extras?$/.test(appointmentType.toLowerCase().replace(/[^a-z]/g,'')))counts.bookedExtra+=count;}

 }
 const holidays=new Set(),names=new Map();for(let year=Number(start.slice(0,4))-1;year<=Number(end.slice(0,4))+1;year++){for(const day of englandWalesBankHolidays(year))holidays.add(day);for(const [day,name] of holidayNames(year))names.set(day,name);}
 const weeks=Array.from({length:8},(_,index)=>{
  const weekStart=shift(start,index*7),dates=Array.from({length:5},(_,d)=>shift(weekStart,d));
  const days=dates.map(date=>{const known=knownDates.has(date),prediction=forecasts?.daily?.get(date);return {date,need:Number.isFinite(prediction?.suggested)?prediction.suggested:null,bankHoliday:holidays.has(date),bankHolidayName:holidays.has(date)?(names.get(date)||'Public holiday'):null,counts:known?(byDate.get(date)||empty()):null};});
  const known=dates.filter(date=>!holidays.has(date)).every(date=>knownDates.has(date)),holiday=days.some(day=>day.bankHoliday),routineNeed=demand?.listSizeAvailable!==false&&!holiday&&Number.isFinite(demand?.demand?.routine)?demand.demand.routine:null,plannedNeed=demand?.listSizeAvailable!==false&&!holiday&&Number.isFinite(demand?.demand?.planned)?demand.demand.planned:null,weeklyNeed=forecasts?.weekly?.get(weekStart);
  return {weekStart,days,known,weekly:{need:Number.isFinite(weeklyNeed)?weeklyNeed:null,counts:known?(byWeek.get(weekStart+'|Weekly Urgent')||empty()):null},routine:{need:routineNeed,counts:known?(byWeek.get(weekStart+'|Routine')||empty()):null},planned:{need:plannedNeed,counts:known?(byWeek.get(weekStart+'|Planned')||empty()):null}};
 });
 return {today,practiceName:iqBridge.practice.name||'Practice',asOf:Number.isFinite(capacityCSVLatestModified)?new Date(capacityCSVLatestModified).toISOString():null,unmapped,forecastFiltered,weeks};
}
window.getSlotReleaseSandboxFilterOptions=filterOptions;
window.getSlotReleaseSandboxData=buildSnapshot;
window.isSlotReleaseSandboxAuthorised=()=>!!(canEditSessionBuilder()&&iqBridge?.practice?.id);
})();
