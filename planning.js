(function(){
const byId=id=>document.getElementById(id);
const statuses=['available','blocked','embargoed'];
const weeklyStatuses=['available','booked','embargoed'];
const combinedStatuses=['available','booked','blocked','embargoed'];
const teamAliases=[
 /^(urgent care( team)?|uct)$/,
 /^(gp(s)?|general practitioner(s)?|doctor(s)?)$/,
 /^(physio(therapy|therapist(s)?)?|msk physiotherapy)$/,
 /^(mental health( team| practitioner(s)?)?)$/
];
const consultationAliases=[
 /^(face to face|f2f|in person)( consultation)?$/,
 /^(phone|telephone|tel|telephony)( consultation)?$/
];
const weekLabels=['This week','Next week','2 weeks ahead','3 weeks ahead'];
const weekdayFormat=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'});
const dateFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const weekFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const percentFormat=new Intl.NumberFormat('en-GB',{style:'percent'});
const asDate=day=>new Date(day+'T12:00:00Z');
const dayTotals=()=>({slots:[0,0,0],teams:[0,0,0,0],consultation:[0,0]});
const sum=values=>values.reduce((total,value)=>total+value,0);

function teamIndex(group,type){
 for(const name of [group,type]){
  const label=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
  const index=teamAliases.findIndex(pattern=>pattern.test(label));
  if(index>=0)return index;
 }
 return -1;
}

function addSlot(totals,status,count,group,type,consultMode){
 totals.slots[status]+=count;
 const team=teamIndex(group,type);
 if(team>=0)totals.teams[team]+=count;
 const mode=String(consultMode||'').trim().toLowerCase().replace(/[\s-]+/g,' ');
 const consultation=consultationAliases.findIndex(pattern=>pattern.test(mode));
 if(consultation>=0)totals.consultation[consultation]+=count;
}

function renderFilters(root,names,colour){
 const options=[...new Set(names.filter(name=>name&&isDashboardToggleOption(name)))];
 const current=[...root.querySelectorAll('input')];
 if(options.length===current.length&&options.every((name,index)=>name===current[index].dataset.filterName))return;
 const selected=new Map(current.map(input=>[input.dataset.filterName,input.checked]));
 root.replaceChildren();
 for(const name of options){
  const row=document.createElement('label'),toggle=document.createElement('span');
  const input=document.createElement('input'),track=document.createElement('span'),caption=document.createElement('span');
  row.className='filter-row';toggle.className='switch';track.className='switch-track';
  input.type='checkbox';input.setAttribute('role','switch');input.dataset.filterName=name;
  input.checked=selected.get(name)??true;
  track.style.setProperty('--switch-on',colour(name));
  caption.textContent=name;
  toggle.append(input,track);row.append(toggle,caption);root.append(row);
 }
}

function appendIndicator(cell,actual,target,label){
 if(!Number.isFinite(actual)||!Number.isFinite(target))return;
 const difference=actual-target,tolerance=target*15/100;
 if(Math.abs(difference)<=tolerance)return;
 const low=difference<0,icon=document.createElement('span');
 icon.className='planning-indicator '+(low?'low':'high');
 icon.setAttribute('role','img');
 icon.setAttribute('aria-label',(low?'Below':'Above')+' the accepted range for '+label);
 icon.textContent=low?'⚠︎':'↑';
 cell.append(icon);
}

function appendRow(root,label,target,actual,mixTargets,{day,compareTotal=true,slotColumns=statuses.length}={}){
 const row=document.createElement('tr'),heading=document.createElement('th');
 heading.scope='row';heading.textContent=label;row.append(heading);
 if(day){
  const date=document.createElement('time');
  date.className='planning-day-date';
  date.dateTime=day;
  date.textContent=dateFormat.format(asDate(day));
  if(label)heading.append(' ');
  heading.append(date);
 }
 const count=actual?sum(actual.slots):null;
 const appendCell=(value,className)=>{
  const cell=document.createElement('td');
  cell.textContent=value;
  if(className)cell.className=className;
  row.append(cell);
  return cell;
 };
 appendCell(target??'—','planning-predicted');
 for(const value of actual?.slots??Array(slotColumns).fill('—'))appendCell(value);
 const totalCell=appendCell(count??'—','planning-total');
 if(compareTotal)appendIndicator(totalCell,count,target,'predicted need');
 const breakdowns=[actual?.teams??Array(teamAliases.length).fill(0),actual?.consultation??Array(consultationAliases.length).fill(0)];
 breakdowns.forEach((counts,group)=>counts.forEach((number,index)=>{
  const share=count?Math.round(100*number/count):null;
  const cell=appendCell(share===null?'—':percentFormat.format(share/100),index===0?'planning-team-start':null);
  if(group===0&&index===1)appendIndicator(cell,share,mixTargets.gp,'the desired GP percentage');
  if(group===1&&index===0)appendIndicator(cell,share,mixTargets.face,'the desired face-to-face percentage');
 }));
 root.append(row);
}

function renderWeeklyPlanning(){
 const page=byId('workforceNeedPage');
 if(page.classList.contains('hidden'))return;
 const dimensions=[
  [byId('planningAppointment'),prioritySort('urgency',groupUrgencyNames),urgencyGroupColour],
  [byId('planningClinicianGroup'),prioritySort('clinician',clinicianGroupNames),clinicianGroupColour],
  [byId('planningPurpose'),prioritySort('purpose',purposeCategoryNames),name=>purposeColours[name]||'#638fac'],
  [byId('planningConsult'),prioritySort('consult',consultCategoryNames),name=>consultModeColours[name]||'#638fac'],
  [byId('planningClinicianType'),clinicianCategoryNames,clinicianTypeColour]
 ];
 const disabled=dimensions.map(([root,names,colour])=>{
  renderFilters(root,names,colour);
  return new Set([...root.querySelectorAll('input:not(:checked)')].map(input=>input.dataset.filterName));
 });
 updateCollapsedFilterSummaries();

 const slider=byId('planningWeekOffset'),offset=slider.valueAsNumber;
 slider.parentElement.style.setProperty('--planning-week-progress',offset/Number(slider.max));
 slider.setAttribute('aria-valuetext',weekLabels[offset]);
 page.querySelectorAll('.planning-week-labels span').forEach((label,index)=>label.classList.toggle('active',index===offset));
 const now=dayView2LondonClock(),minute=Math.floor(now.minute);
 const monday=GPCorrectness.shift(GPCorrectness.monday(now.date),offset*7);
 const dates=Array.from({length:5},(_,index)=>GPCorrectness.shift(monday,index));
 byId('planningWeekDates').textContent=weekFormat.formatRange(asDate(dates[0]),asDate(dates[4]));
 const {daily:targets,weekly:allocationTargets,weeklyGroups}=window.readUrgentPlanningForecast();
 const gp=byId('planningGpTarget'),face=byId('planningFaceTarget');
 for(const input of [gp,face]){
  const value=percentFormat.format(input.valueAsNumber/100),output=input.parentElement.querySelector('output');
  input.setAttribute('aria-valuetext',value);
  if(output.value!==value)output.value=value;
 }
 const mixTargets={gp:gp.valueAsNumber,face:face.valueAsNumber};
 const remainingDates=dates.filter(day=>day>=now.date);
 const daily=new Map(remainingDates.map(day=>[day,dayTotals()]));
 const reported=new Set();
 const weekDates=new Set(dates),weeklyReported=new Set(),allocation=dayTotals();
 const snapshot=capacitySnapshotClock();
 let missingSlotTimes=false;
 for(const row of availabilityRecords){
  if(!weekDates.has(row.date)||row.source==='signposting'||!(row.count>0))continue;
  weeklyReported.add(row.date);
  const totals=daily.get(row.date);
  if(totals)reported.add(row.date);
  const availability=String(row.availability||'').trim().toLowerCase();
  if(excludedSlotTypes.has(row.slot)||(availability==='available'&&isMissedAvailableSlot(row,snapshot)))continue;
  const appointment=capacityUrgencyCategory(row.slot),isWeekly=weeklyGroups.has(appointment);
  const status=(isWeekly?weeklyStatuses:statuses).indexOf(availability);
  if(status<0||(!isWeekly&&!totals))continue;
  const type=effectiveClinicianType(row.clinician),group=clinicianGroupAssignments[type];
  const consultMode=consultAssignments[row.slot];
  const values=[appointment,group,purposeAssignments[row.slot],consultMode,type];
  if(values.some((value,index)=>disabled[index].has(value)))continue;
  if(isWeekly){
   addSlot(allocation,status,row.count,group,type,consultMode);
   continue;
  }
  if(row.date===now.date){
   if(!Number.isFinite(row.minute)){missingSlotTimes=true;continue;}
   if(row.minute<minute)continue;
  }
  addSlot(totals,status,row.count,group,type,consultMode);
 }
 const body=byId('planningDays'),footer=byId('planningTotals');
 body.replaceChildren();footer.replaceChildren();
 const week=dayTotals();
 let targetTotal=0,missingTarget=false,missingSlots=false;
 let todayNote='';
 for(const day of dates){
  const label=weekdayFormat.format(asDate(day));
  if(day<now.date){
   appendRow(body,label,null,null,mixTargets,{day});
   continue;
  }
  const target=targets.get(day),actual=reported.has(day)?daily.get(day):null;
  const today=day===now.date;
  const suggested=today?target?.remainingNeed?.(minute):target?.suggested;
  if(today&&!target?.bankHoliday){
   todayNote=suggested==null?'Today’s remaining demand needs more comparable booking-time history.'
    :'Today’s predicted need and appointment slots are shown from '+dayView2Time(minute)+'.';
   if(missingSlotTimes)todayNote+=' Some of today’s slots have no start time and are omitted.';
  }
  appendRow(body,label,target?.bankHoliday?'Bank holiday':suggested,actual,mixTargets,{day,compareTotal:!today||!missingSlotTimes});
  if(suggested!=null)targetTotal+=suggested;
  else if(!target?.bankHoliday)missingTarget=true;
  if(!actual&&!target?.bankHoliday)missingSlots=true;
  if(actual){
   actual.slots.forEach((count,index)=>week.slots[index]+=count);
   actual.teams.forEach((count,index)=>week.teams[index]+=count);
   actual.consultation.forEach((count,index)=>week.consultation[index]+=count);
  }
 }
 const dailyTarget=!remainingDates.length||missingTarget?null:targetTotal;
 const dailyActual=reported.size?week:null;
 const completeDaily=!missingSlots&&!missingSlotTimes;
 appendRow(footer,'Total',dailyTarget,dailyActual,mixTargets,{compareTotal:completeDaily});
 const allocationBody=byId('planningAllocation');
 allocationBody.replaceChildren();
 const allocationActual=weeklyGroups.size&&weeklyReported.size?allocation:null;
 const allocationTarget=allocationTargets.get(monday);
 const completeWeek=dates.every(day=>weeklyReported.has(day)||targets.get(day)?.bankHoliday);
 appendRow(allocationBody,'',allocationTarget,allocationActual,mixTargets,{
  day:monday,compareTotal:completeWeek
 });
 byId('planningAllocationNote').textContent=!weeklyGroups.size?'No appointment types are set to Weekly in Urgent Forecast.'
  :!weeklyReported.size?'The Slot Report contains no appointments for this week.'
  :!completeWeek?'Slot totals cover '+weeklyReported.size+' of the 5 weekdays.':'';

 const combinedBody=byId('planningCombined');
 combinedBody.replaceChildren();
 const combinedActual=dailyActual||allocationActual?{
  slots:combinedStatuses.map(status=>(dailyActual?.slots[statuses.indexOf(status)]??0)
   +(allocationActual?.slots[weeklyStatuses.indexOf(status)]??0)),
  teams:week.teams.map((count,index)=>count+allocation.teams[index]),
  consultation:week.consultation.map((count,index)=>count+allocation.consultation[index])
 }:null;
 const combinedNeed=missingTarget||(weeklyGroups.size&&allocationTarget==null)
  ||(dailyTarget==null&&allocationTarget==null)?null:(dailyTarget??0)+(allocationTarget??0);
 appendRow(combinedBody,'',combinedNeed,combinedActual,mixTargets,{
  day:monday,slotColumns:combinedStatuses.length,compareTotal:completeDaily&&(!weeklyGroups.size||completeWeek)
 });
 const coverage=!remainingDates.length||reported.size===remainingDates.length?'':reported.size
  ? 'Slot totals cover '+reported.size+' of '+remainingDates.length+' remaining weekdays.'
  : 'The Slot Report contains no appointments for the remaining dates.';
 byId('planningCoverage').textContent=[todayNote,coverage].filter(Boolean).join(' ');
}

window.renderWeeklyPlanning=renderWeeklyPlanning;
document.addEventListener('DOMContentLoaded',()=>{
 let redraw=0;
 const scheduleRender=()=>{
  if(redraw)return;
  // Save the control's new value before rebuilding the table triggers preference restoration.
  redraw=requestAnimationFrame(()=>{redraw=0;renderWeeklyPlanning();});
 };
 for(const id of ['planningWeekOffset','planningGpTarget','planningFaceTarget'])byId(id).addEventListener('input',scheduleRender);
 byId('workforceNeedPage').addEventListener('change',event=>{
  if(event.target.matches('[data-filter-name]'))scheduleRender();
 });
 const refreshCurrentWeek=()=>{
  if(!document.hidden&&byId('planningWeekOffset').value==='0')scheduleRender();
 };
 setInterval(refreshCurrentWeek,60000);
 document.addEventListener('visibilitychange',refreshCurrentWeek);
});
})();
