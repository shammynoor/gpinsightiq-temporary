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

function projectionCoverage(today){
 const first=projectionYear+'-01-01',last=projectionYear+'-12-31';
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

function annualBookedSlots(today,coverage,scaleByMonth){
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
 return totals;
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
 enter.disabled=!types.length;
 const overview=$('workforceOverviewView'),sessionsView=$('workforceSessionsView');
 enter.onclick=()=>{
  overview.hidden=true;sessionsView.hidden=false;
  $('workforceSessionsTitle').focus();
 };
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
    const stored=workforceWeeklySessions.get(key);
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
     average.textContent=count!==null&&sessions>0?decimal.format(count/(sessions*workingWeeks*period)):'—';
    };
    updateAverage(stored);
    const entry=sessionsRow.insertCell();
    if(!isOwner){
     entry.textContent=stored??'—';
     continue;
    }
    const input=document.createElement('input');
    input.type='number';
    input.min='0';
    input.step='any';
    input.inputMode='decimal';
    input.value=stored??'';
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
