(function(){
const byId=id=>document.getElementById(id);
const statuses=['available','blocked','embargoed'];
const teamAliases=[
 /^(urgent care( team)?|uct)$/,
 /^(gp(s)?|general practitioner(s)?|doctor(s)?)$/,
 /^(physio(therapy|therapist(s)?)?|msk physiotherapy)$/,
 /^(mental health( team| practitioner(s)?)?)$/
];
const weekLabels=['This week','Next week','2 weeks ahead','3 weeks ahead'];
const dateFormat=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'});
const weekFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const percentFormat=new Intl.NumberFormat('en-GB',{style:'percent'});
const asDate=day=>new Date(day+'T12:00:00Z');
const dayTotals=()=>({slots:[0,0,0],teams:[0,0,0,0]});
const sum=values=>values.reduce((total,value)=>total+value,0);

function teamIndex(group,type){
 for(const name of [group,type]){
  const label=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
  const index=teamAliases.findIndex(pattern=>pattern.test(label));
  if(index>=0)return index;
 }
 return -1;
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

function appendRow(root,label,target,actual){
 const row=document.createElement('tr'),heading=document.createElement('th');
 heading.scope='row';heading.textContent=label;row.append(heading);
 const count=actual?sum(actual.slots):null;
 const values=[target??'—',...(actual?.slots??['—','—','—']),count??'—',
  ...teamAliases.map((_,index)=>count?percentFormat.format(actual.teams[index]/count):'—')];
 values.forEach((value,index)=>{
  const cell=document.createElement('td');
  cell.textContent=value;
  if(index===4)cell.className='planning-total';
  if(index===5)cell.className='planning-team-start';
  row.append(cell);
 });
 root.append(row);
}

function renderWeeklyPlanning(){
 const page=byId('workforceNeedPage');
 if(page.classList.contains('hidden'))return;
 const monthly=byId('planningMonthly').checked;
 byId('planningWeeklyPanel').hidden=monthly;
 byId('planningMonthlyPanel').hidden=!monthly;
 if(monthly)return;

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
 slider.setAttribute('aria-valuetext',weekLabels[offset]);
 page.querySelectorAll('.planning-week-labels span').forEach((label,index)=>label.classList.toggle('active',index===offset));
 const monday=GPCorrectness.shift(GPCorrectness.dateContext(new Date()).week,offset*7);
 const dates=Array.from({length:5},(_,index)=>GPCorrectness.shift(monday,index));
 byId('planningWeekDates').textContent=weekFormat.formatRange(asDate(dates[0]),asDate(dates[4]));
 const targets=window.readUrgentDailyTargets();
 const daily=new Map(dates.map(day=>[day,dayTotals()]));
 const reported=new Set();
 const snapshot=capacitySnapshotClock();
 for(const row of availabilityRecords){
  const totals=daily.get(row.date);
  if(!totals||row.source==='signposting'||!(row.count>0))continue;
  reported.add(row.date);
  const status=statuses.indexOf(String(row.availability||'').trim().toLowerCase());
  if(status<0||excludedSlotTypes.has(row.slot))continue;
  if(statuses[status]==='available'&&isMissedAvailableSlot(row,snapshot))continue;
  const type=effectiveClinicianType(row.clinician),group=clinicianGroupAssignments[type];
  const values=[capacityUrgencyCategory(row.slot),group,purposeAssignments[row.slot],consultAssignments[row.slot],type];
  if(values.some((value,index)=>disabled[index].has(value)))continue;
  totals.slots[status]+=row.count;
  const team=teamIndex(group,type);
  if(team>=0)totals.teams[team]+=row.count;
 }
 const body=byId('planningDays'),footer=byId('planningTotals');
 body.replaceChildren();footer.replaceChildren();
 const week=dayTotals();
 let targetTotal=0,missingTarget=false;
 for(const day of dates){
  const target=targets.get(day),actual=reported.has(day)?daily.get(day):null;
  appendRow(body,dateFormat.format(asDate(day)),target?.bankHoliday?'Bank holiday':target?.suggested,actual);
  if(target?.suggested!=null)targetTotal+=target.suggested;
  else if(!target?.bankHoliday)missingTarget=true;
  if(actual){
   actual.slots.forEach((count,index)=>week.slots[index]+=count);
   actual.teams.forEach((count,index)=>week.teams[index]+=count);
  }
 }
 appendRow(footer,'Total',missingTarget?null:targetTotal,reported.size?week:null);
 byId('planningCoverage').textContent=reported.size===5?'':reported.size
  ? 'Slot totals cover '+reported.size+' of the 5 weekdays in the report.'
  : 'The Slot Report contains no appointments for these dates.';
}

window.renderWeeklyPlanning=renderWeeklyPlanning;
document.addEventListener('DOMContentLoaded',()=>{
 let redraw=0;
 const scheduleRender=()=>{
  if(redraw)return;
  // Save the control's new value before rebuilding the table triggers preference restoration.
  redraw=requestAnimationFrame(()=>{redraw=0;renderWeeklyPlanning();});
 };
 byId('planningWeekOffset').addEventListener('input',scheduleRender);
 byId('workforceNeedPage').addEventListener('change',event=>{
  if(event.target.matches('[name="planningPeriod"],[data-filter-name]'))scheduleRender();
 });
});
})();
