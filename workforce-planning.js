(function(){
const years=['2023','2024','2025','2026'];
const workingWeeks=48;
const integer=new Intl.NumberFormat('en-GB');
const shareFormat=new Intl.NumberFormat('en-GB',{style:'percent',maximumFractionDigits:1});
const decimal=new Intl.NumberFormat('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1});
const cellKey=(type,year)=>JSON.stringify([type,year]);
const collapsedGroups=new Set();
const projectionYear='2026';
const dayMilliseconds=86400000;
const monthFormat=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'});
const dateFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});

function projectionCoverage(today,year=projectionYear){
 const first=year+'-01-01',last=year+'-12-31';
 const ranges=slotReportCoverage.map(({start,end,asOf})=>[
  start>first?start:first,[end,asOf||today,today,last].sort()[0]
 ]).filter(([start,end])=>start<=end).sort(([a],[b])=>a.localeCompare(b));
 const intervals=[];
 for(const [start,end] of ranges){
  const from=Date.parse(start),to=Date.parse(end);
  const previous=intervals.at(-1);
  if(previous&&from<=previous[1]+dayMilliseconds)previous[1]=Math.max(previous[1],to);
  else intervals.push([from,to]);
 }
 const days=intervals.reduce((total,[from,to])=>total+(to-from)/dayMilliseconds+1,0);
 return {
  intervals,
  through:intervals.at(-1)?.[1],
  fraction:days/((Date.parse(last)-Date.parse(first))/dayMilliseconds+1)
 };
}

function listSizeAdjustment(){
 const months=practiceMonths();
 const sizes=practiceListValues(months);
 const reference=sizes.findLastIndex(size=>size>0);
 if(reference<0)return null;
 const scaleByMonth=new Map(months.map((month,index)=>[month,sizes[index]>0?sizes[reference]/sizes[index]:1]));
 return {size:sizes[reference],month:months[reference],scaleByMonth};
}

let annualCache=null;
function annualBookedSlots(today,coverage,scaleByMonth){
 const key=JSON.stringify([today,coverage.intervals,scaleByMonth?[...scaleByMonth]:null,clinicianAssignments,[...excludedSlotTypes].sort()]);
 if(annualCache?.source===availabilityRecords&&annualCache.key===key)return annualCache.totals;
 const totals=new Map();
 for(const row of availabilityRecords){
  const year=row.date.slice(0,4);
  if(!years.includes(year)||row.date>today||String(row.availability).toLowerCase()!=='booked'
    ||!isDayView2SlotReportRecord(row)||excludedSlotTypes.has(row.slot)||!(row.count>0))continue;
  if(year===projectionYear){
   const date=Date.parse(row.date);
   if(!coverage.intervals.some(([start,end])=>date>=start&&date<=end))continue;
  }
  const type=effectiveClinicianType(row.clinician);
  if(!type)continue;
  const key=cellKey(type,year);
  const scale=scaleByMonth?.get(row.date.slice(0,7))??1;
  totals.set(key,(totals.get(key)||0)+row.count*scale);
 }
 annualCache={source:availabilityRecords,key,totals};
 return totals;
}

// Count bookings only up to the report snapshot when pairing them with
// completed sessions, so future appointments today do not inflate the ratio.
let completedSlotsCache=null;
function annualCompletedSlots(clock,scaleByMonth){
 const cacheKey=JSON.stringify([clock.date,clock.minute,scaleByMonth?[...scaleByMonth]:null,clinicianAssignments,[...excludedSlotTypes].sort()]);
 if(completedSlotsCache?.source===availabilityRecords&&completedSlotsCache.key===cacheKey)return completedSlotsCache.totals;
 const totals=new Map();
 for(const row of availabilityRecords){
  const year=row.date?.slice(0,4);
  if(!years.includes(year)||row.date>clock.date||String(row.availability).toLowerCase()!=='booked'||!isDayView2SlotReportRecord(row)||excludedSlotTypes.has(row.slot)||!(row.count>0))continue;
  if(row.date===clock.date&&(!Number.isFinite(row.minute)||row.minute>=clock.minute))continue;
  const type=effectiveClinicianType(row.clinician);if(!type)continue;
  const key=cellKey(type,year),scale=scaleByMonth?.get(row.date.slice(0,7))??1;
  totals.set(key,(totals.get(key)||0)+row.count*scale);
 }
 completedSlotsCache={source:availabilityRecords,key:cacheKey,totals};return totals;
}
function addRow(body,type){
 const row=body.insertRow();
 const heading=document.createElement('th');
 heading.scope='row';
 heading.textContent=type;
 row.append(heading);
 return row;
}

function clinicianGroups(types){
 const groups=new Map(clinicianGroupNames.map(name=>[name,[]]));
 groups.set(null,[]);
 for(const type of types){
  const name=Object.hasOwn(clinicianGroupAssignments,type)?clinicianGroupAssignments[type]:null;
  (groups.get(name)??groups.get(null)).push(type);
 }
 return groups;
}

function addGroupControls(bodies,group,onChange){
 const rows=[];
 const buttons=bodies.map(body=>{
  const row=body.insertRow();
  row.className='workforce-group-heading';
  const cell=document.createElement('th');
  cell.colSpan=years.length+1;
  const button=document.createElement('button');
  button.type='button';
  const arrow=document.createElement('span');
  arrow.setAttribute('aria-hidden','true');
  button.append(arrow,group??'Ungrouped');
  cell.append(button);
  row.append(cell);
  return button;
 });
 const refresh=()=>{
  const expanded=!collapsedGroups.has(group);
  for(const row of rows)row.hidden=!expanded;
  for(const button of buttons){
   button.setAttribute('aria-expanded',String(expanded));
   button.firstElementChild.textContent=expanded?'▾':'▸';
  }
 };
 for(const button of buttons)button.addEventListener('click',()=>{
  if(collapsedGroups.has(group))collapsedGroups.delete(group);
  else collapsedGroups.add(group);
  refresh();
  onChange();
 });
 return {rows,refresh};
}

let sessionReportCache=null;
function sessionReport(){
 const clock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const key=JSON.stringify([clock.date,clock.minute,clinicianAssignments,userTypeLocum,sessionCategoryLocum,[...excludedSlotTypes].sort(),slotReportCoverage]);
 if(sessionReportCache?.source===availabilityRecords&&sessionReportCache.key===key)return sessionReportCache.result;
 const result=GPSessionsHistory.calculate(availabilityRecords,clock,row=>effectiveClinicianType(row.clinician),row=>locumCategory(row)==='Locum',excludedSlotTypes,slotReportCoverage);
 sessionReportCache={source:availabilityRecords,key,result};return result;
}
function renderSessionsHistory(){
 if(!isOwner)return;
 const head=$('workforceSessionsHistoryHead'),body=$('workforceSessionsHistoryBody'),notice=$('workforceSessionsHistoryNotice');
 head.replaceChildren();body.replaceChildren();
 const result=sessionReport();
 if(!result.types.length){notice.textContent='No completed sessions with clinician names are available. Upload a Slot Report with the session-holder name column.';return;}
 notice.textContent='Weeks marked * have incomplete report coverage or booked appointments with missing clinician names or times. Their counts are minimums. Reports saved before this feature may need to be uploaded again.';
 const heading=document.createElement('tr');
 for(const label of ['Week beginning',...result.types]){const th=document.createElement('th');th.scope='col';th.textContent=label;heading.append(th)}head.append(heading);
 for(const year of [...result.yearWeeks.keys()].sort().reverse()){
  const yearly=result.yearWeekTotals.get(year)||new Map(),weeks=[...result.yearWeeks.get(year)].sort().reverse(),subtotal=new Map();let partial=false;
  for(const week of weeks){
   const row=document.createElement('tr'),heading=document.createElement('th');heading.scope='row';
   const end=new Date(week+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);
   const split=week.slice(0,4)!==year||String(end.getUTCFullYear())!==year;
   heading.textContent=new Date(week+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})+(split?' ('+year+' part)':'')+(result.incomplete.has(week)?' *':'');row.append(heading);
   const values=yearly.get(week);partial||=result.incomplete.has(week);
   for(const type of result.types){const cell=document.createElement('td'),value=values?.get(type)||0;subtotal.set(type,(subtotal.get(type)||0)+value);cell.textContent=result.incomplete.has(week)?(value?'≥'+value:'—'):String(value);row.append(cell)}
   body.append(row);
  }
  const row=document.createElement('tr');row.className='workforce-team-total';const heading=document.createElement('th');heading.scope='row';heading.textContent=year+' subtotal'+(partial?' *':'');row.append(heading);
  for(const type of result.types){const cell=document.createElement('td'),value=subtotal.get(type)||0;cell.textContent=partial?(value?'≥'+value:'—'):String(value);row.append(cell)}body.append(row);
 }
}
function renderAppointmentsHistory(){
 if(!isOwner)return;
 const head=$('workforceAppointmentsHistoryHead'),body=$('workforceAppointmentsHistoryBody'),notice=$('workforceAppointmentsHistoryNotice');
 head.replaceChildren();body.replaceChildren();
 const clock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const careFor=row=>{
  const type=capacityUrgencyCategory(row.slot),category=appointmentCategoryFor(type),role=appointmentCalculationRole(type);
  const base=category.trim().toLowerCase()==='urgent care'||role==='urgent'?'urgent':role==='routine'?'routine':'';
  return GPWorkforcePlanner.historicalCareType(type,category,base);
 };
 const result=GPSessionsHistory.appointmentHistory(availabilityRecords,clock,row=>effectiveClinicianType(row.clinician),row=>locumCategory(row)==='Locum',careFor,excludedSlotTypes,slotReportCoverage);
 if(!result.types.length){notice.textContent='No past booked appointments are available for these appointment types.';return}
 const selected=$('workforceAppointmentsType').value;
 notice.textContent='Booked appointments by appointment date. Weeks marked * have incomplete coverage or are still in progress; counts are minimums.';
 const heading=document.createElement('tr');
 for(const label of ['Week beginning',...result.types]){const th=document.createElement('th');th.scope='col';th.textContent=label;heading.append(th)}head.append(heading);
 for(const year of [...result.yearWeeks.keys()].sort().reverse()){
  const yearly=result.yearWeekTotals.get(year)||new Map(),weeks=[...result.yearWeeks.get(year)].sort().reverse(),subtotal=new Map();let partial=false;
  for(const week of weeks){
   const row=document.createElement('tr'),th=document.createElement('th');th.scope='row';
   const end=new Date(week+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);
   const split=week.slice(0,4)!==year||String(end.getUTCFullYear())!==year;
   th.textContent=new Date(week+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})+(split?' ('+year+' part)':'')+(result.incomplete.has(week)?' *':'');row.append(th);
   const values=yearly.get(week)?.get(selected);partial||=result.incomplete.has(week);
   for(const type of result.types){const cell=document.createElement('td'),value=values?.get(type)||0;subtotal.set(type,(subtotal.get(type)||0)+value);cell.textContent=result.incomplete.has(week)?(value?'≥'+integer.format(value):'—'):integer.format(value);row.append(cell)}body.append(row);
  }
  const row=document.createElement('tr');row.className='workforce-team-total';const th=document.createElement('th');th.scope='row';th.textContent=year+' subtotal'+(partial?' *':'');row.append(th);
  for(const type of result.types){const cell=document.createElement('td'),value=subtotal.get(type)||0;cell.textContent=partial?(value?'≥'+integer.format(value):'—'):integer.format(value);row.append(cell)}body.append(row);
 }
}
function renderWorkforcePlanning(){
 const page=$('workforcePlanningPage');
 if(page.classList.contains('hidden'))return;
 const types=clinicianCategoryNames.slice().sort((a,b)=>a.localeCompare(b,'en-GB'));
 const sessionsBody=$('workforceSessionsBody');
 const slotsBody=$('workforceSlotsBody');
 const averagesBody=$('workforceAveragesBody');
 for(const body of [sessionsBody,slotsBody,averagesBody])body.replaceChildren();
 $('workforcePlanningEmpty').hidden=types.length>0;
 $('workforcePlanningTables').hidden=!types.length;
 $('workforcePlanningSaveStatus').hidden=!isOwner||!types.length;
 $('workforcePlanningReadOnly').hidden=isOwner||!types.length;
 const today=GPCorrectness.londonDate();
 const coverage=projectionCoverage(today);
 const preferences=readChartPreferences();
 const listSizeToggle=$('workforceAdjustListSize');
 const listSizePreference='workforcePlanning:adjustListSize';
 const adjustment=listSizeAdjustment();
 listSizeToggle.disabled=!adjustment;
 listSizeToggle.checked=!!adjustment&&preferences[listSizePreference]===true;
 listSizeToggle.onchange=()=>{
  writeChartPreference(listSizePreference,listSizeToggle.checked);
  renderWorkforcePlanning();
 };
 const adjusted=listSizeToggle.checked;
 const listSizeNote=$('workforceListSizeNote');
 listSizeNote.hidden=!adjusted;
 listSizeNote.textContent=adjusted
  ?'Adjusted to a practice list size of '+integer.format(adjustment.size)+' ('+monthFormat.format(Date.parse(adjustment.month+'-01'))+' '+adjustment.month.slice(0,4)+').'
  :'';
 const totals=annualBookedSlots(today,coverage,adjusted?adjustment.scaleByMonth:null);
 const recordedSessions=sessionReport();
 const sessionClock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const sessionBookings=recordedSessions.annualByType.size?annualCompletedSlots(sessionClock,adjusted?adjustment.scaleByMonth:null):new Map();
 const yearSessionCoverage=new Map(years.map(year=>[year,projectionCoverage(today,year)]));
 const coveredYears=new Set(years.filter(year=>slotReportCoverage.some(({start,end})=>
  start<=today&&start<=year+'-12-31'&&end>=year+'-01-01'&&today>=year+'-01-01')));
 if(!coverage.fraction)coveredYears.delete(projectionYear);
 const projection=$('workforceProject');
 const canProject=coverage.fraction>0&&coverage.fraction<1;
 projection.disabled=!canProject;
 projection.checked=canProject&&preferences['workforcePlanning:projectYear']===true;
 projection.onchange=()=>{
  writeChartPreference('workforcePlanning:projectYear',projection.checked);
  renderWorkforcePlanning();
 };
 const projected=projection.checked;
 const displayCount=(count,year)=>Math.round(projected&&year===projectionYear?count/coverage.fraction:count);
 for(const heading of page.querySelectorAll('[data-workforce-projection-year]')){
  const detail=document.createElement('small');
  detail.textContent=projected?'Projected':canProject?'to '+monthFormat.format(coverage.through):'';
  heading.replaceChildren(projectionYear,detail);
 }
 $('workforceProjectionNote').textContent=coverage.through===undefined?'No 2026 Slot Report coverage yet.'
  :projected?'2026 projected to December from data through '+dateFormat.format(coverage.through)+' ('+shareFormat.format(coverage.fraction)+' of the year).'
  :'2026 data through '+dateFormat.format(coverage.through)+'.';
 const slotsView=$('workforceSlotsView'),averagesView=$('workforceAveragesView');
 const choices=[...page.querySelectorAll('input[name="workforce-measure"]')];
 const setMeasure=measure=>{
  slotsView.hidden=measure==='rate';
  averagesView.hidden=measure!=='rate';
  for(const choice of choices)choice.checked=choice.value===measure;
 };
 setMeasure(preferences['workforcePlanning:measure']==='rate'?'rate':'slots');
 for(const choice of choices)choice.onchange=()=>{
  if(!choice.checked)return;
  setMeasure(choice.value);
  writeChartPreference('workforcePlanning:measure',choice.value);
 };
 const enter=$('workforceEnterSessions');
 enter.hidden=!isOwner;
 enter.disabled=!isOwner||!types.length;
 const overview=$('workforceOverviewView'),sessionsView=$('workforceSessionsView');
 const historyTab=$('workforceSessionsHistoryTab'),historyView=$('workforceSessionsHistoryView');
 $('workforceHistoryTabs').hidden=!isOwner;historyTab.hidden=!isOwner;historyTab.disabled=!isOwner;
 const overviewTab=$('workforceOverviewTab'),appointmentTab=$('workforceAppointmentsHistoryTab'),appointmentView=$('workforceAppointmentsHistoryView');
 appointmentTab.hidden=!isOwner;appointmentTab.disabled=!isOwner;
 const selectTab=selected=>{for(const [tab,name] of [[overviewTab,'overview'],[historyTab,'sessions'],[appointmentTab,'appointments']]){tab.setAttribute('aria-selected',String(selected===name));tab.setAttribute('aria-pressed',String(selected===name))}};
 const showHistory=name=>{overview.hidden=name!=='overview';historyView.hidden=name!=='sessions';appointmentView.hidden=name!=='appointments';sessionsView.hidden=true;selectTab(name)};
 overviewTab.onclick=()=>showHistory('overview');
 if(!isOwner){historyView.hidden=true;appointmentView.hidden=true;for(const id of ['workforceSessionsHistoryHead','workforceSessionsHistoryBody','workforceAppointmentsHistoryHead','workforceAppointmentsHistoryBody'])$(id).replaceChildren();}
 historyTab.onclick=isOwner?()=>{renderSessionsHistory();showHistory('sessions');$('workforceSessionsHistoryTitle').focus()}:null;
 appointmentTab.onclick=isOwner?()=>{renderAppointmentsHistory();showHistory('appointments');$('workforceAppointmentsHistoryTitle').focus()}:null;
 $('workforceAppointmentsType').onchange=()=>renderAppointmentsHistory();
 $('workforceSessionsHistoryBack').onclick=()=>{showHistory('overview');historyTab.focus()};
 $('workforceAppointmentsHistoryBack').onclick=()=>{showHistory('overview');appointmentTab.focus()};
 if(isOwner&&!appointmentView.hidden)renderAppointmentsHistory();
 if(!isOwner){
  sessionsView.hidden=true;
  overview.hidden=false;
 }
 enter.onclick=isOwner?()=>{
  overview.hidden=true;sessionsView.hidden=false;
  $('workforceSessionsTitle').focus();
 }:null;
 $('workforceBackToHistory').onclick=()=>{
  sessionsView.hidden=true;overview.hidden=false;
  enter.focus();
 };
 const toggle=$('workforceShowSubtotals');
 const preference='workforcePlanning:showSubtotals';
 toggle.checked=preferences[preference]!==false;
 page.classList.toggle('workforce-hide-subtotals',!toggle.checked);
 toggle.onchange=()=>{
  page.classList.toggle('workforce-hide-subtotals',!toggle.checked);
  writeChartPreference(preference,toggle.checked);
 };
 const totalsFoot=$('workforceSlotsFoot');
 totalsFoot.replaceChildren();
 const totalRow=addRow(totalsFoot,'Total (expanded groups)');
 const totalCells=years.map(()=>totalRow.insertCell());
 const totalsByGroup=new Map();
 const updateVisibleTotals=()=>{
  const visibleGroups=[...totalsByGroup].filter(([group])=>!collapsedGroups.has(group));
  years.forEach((year,index)=>{
   const count=visibleGroups.reduce((sum,[,groupTotals])=>sum+groupTotals.get(year),0);
   totalCells[index].textContent=coveredYears.has(year)?integer.format(count):'—';
  });
 };
 for(const [group,members] of clinicianGroups(types)){
  if(!members.length)continue;
  const controls=addGroupControls([slotsBody,sessionsBody,averagesBody],group,updateVisibleTotals);
  const countsForYear=(year,transform)=>members.reduce((sum,type)=>sum+transform(totals.get(cellKey(type,year))??0,year),0);
  const groupTotals=new Map(years.map(year=>[year,countsForYear(year,count=>count)]));
  const displayedGroupTotals=new Map(years.map(year=>[year,countsForYear(year,displayCount)]));
  totalsByGroup.set(group,displayedGroupTotals);
  for(const type of members){
   const sessionsRow=addRow(sessionsBody,type);
   const slotsRow=addRow(slotsBody,type);
   const averagesRow=addRow(averagesBody,type);
   for(const row of [sessionsRow,slotsRow,averagesRow]){
    row.className='workforce-clinician-row';
    controls.rows.push(row);
   }
   for(const year of years){
    const key=cellKey(type,year);
    const manual=workforceWeeklySessions.get(key),yearCoverage=yearSessionCoverage.get(year);
    const sessionValue=GPSessionsHistory.weeklySessionValue(recordedSessions,year,type,yearCoverage.fraction,manual,workingWeeks);
    const useRecorded=sessionValue.automatic,sessionTotal=sessionValue.total,stored=sessionValue.value;
    const count=coveredYears.has(year)?totals.get(key)??0:null;
    const slotCell=slotsRow.insertCell();
    slotCell.textContent=count===null?'—':integer.format(displayCount(count,year));
    const groupTotal=groupTotals.get(year);
    if(count!==null&&groupTotal>0){
     const share=document.createElement('span');
     share.className='workforce-slot-share';
     share.textContent='('+shareFormat.format(count/groupTotal)+')';
     slotCell.append(' ',share);
    }
    const average=averagesRow.insertCell();
    const updateAverage=sessions=>{
     const period=year===projectionYear?coverage.fraction:1;
     const denominator=useRecorded?sessionTotal:sessions*workingWeeks*period;
     const numerator=useRecorded?(sessionBookings.get(key)||0):count;
     average.textContent=numerator!==null&&denominator>0?decimal.format(numerator/denominator):'—';
    };
    updateAverage(stored);
    const entry=sessionsRow.insertCell();
    if(!isOwner){
     entry.textContent=useRecorded?decimal.format(stored):(stored??'—');
     continue;
    }
    const input=document.createElement('input');
    input.type='number';
    input.min='0';
    input.step='any';
    input.inputMode='decimal';
    input.value=useRecorded?String(Math.round(stored*100)/100):(stored??'');
    if(useRecorded){input.readOnly=true;input.title='Calculated from recorded sessions for the covered period';}
    input.setAttribute('aria-label',type+', '+year+', average sessions per week at this practice');
    input.addEventListener('input',()=>updateAverage(input.valueAsNumber));
    input.addEventListener('change',()=>{
     if(!input.validity.valid){
      input.value=workforceWeeklySessions.get(key)??'';
      updateAverage(input.valueAsNumber);
      return;
     }
     const next=input.value===''?undefined:input.valueAsNumber;
     if(workforceWeeklySessions.get(key)===next)return;
     if(next===undefined)workforceWeeklySessions.delete(key);
     else workforceWeeklySessions.set(key,next);
     scheduleCloudSave();
    });
    entry.append(input);
    if(useRecorded){const note=document.createElement('small');note.className='workforce-slot-share';note.textContent=' '+integer.format(sessionTotal)+' recorded';entry.append(note)}
   }
  }
  if(members.length>1){
   const subtotal=addRow(slotsBody,'Total');
   subtotal.className='workforce-team-total';
   controls.rows.push(subtotal);
   for(const year of years){
    subtotal.insertCell().textContent=coveredYears.has(year)?integer.format(displayedGroupTotals.get(year)):'—';
   }
  }
  controls.refresh();
 }
 updateVisibleTotals();
}

window.renderWorkforcePlanning=renderWorkforcePlanning;
})();
