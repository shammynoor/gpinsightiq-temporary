(function(){
const years=['2023','2024','2025','2026'];
const workingWeeks=48;
const integer=new Intl.NumberFormat('en-GB');
const shareFormat=new Intl.NumberFormat('en-GB',{style:'percent',maximumFractionDigits:1});
const decimal=new Intl.NumberFormat('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1});
const cellKey=(type,year)=>JSON.stringify([type,year]);
const collapsedGroups=new Set();

function annualBookedSlots(today){
 const totals=new Map();
 for(const row of availabilityRecords){
  const year=row.date.slice(0,4);
  if(!years.includes(year)||row.date>today||String(row.availability).toLowerCase()!=='booked'
    ||!isDayView2SlotReportRecord(row)||excludedSlotTypes.has(row.slot)||!(row.count>0))continue;
  const type=effectiveClinicianType(row.clinician);
  if(!type)continue;
  const key=cellKey(type,year);
  totals.set(key,(totals.get(key)||0)+row.count);
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
 const totals=annualBookedSlots(today);
 const coveredYears=new Set(years.filter(year=>slotReportCoverage.some(({start,end})=>
  start<=today&&start<=year+'-12-31'&&end>=year+'-01-01'&&today>=year+'-01-01')));
 const toggle=$('workforceShowSubtotals');
 const preference='workforcePlanning:showSubtotals';
 toggle.checked=readChartPreferences()[preference]!==false;
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
  const groupTotals=new Map(years.map(year=>[
   year,members.reduce((sum,type)=>sum+(totals.get(cellKey(type,year))??0),0)
  ]));
  totalsByGroup.set(group,groupTotals);
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
    slotCell.textContent=count===null?'—':integer.format(count);
    const groupTotal=groupTotals.get(year);
    if(count!==null&&groupTotal>0){
     const share=document.createElement('span');
     share.className='workforce-slot-share';
     share.textContent='('+shareFormat.format(count/groupTotal)+')';
     slotCell.append(' ',share);
    }
    const average=averagesRow.insertCell();
    const updateAverage=sessions=>{
     average.textContent=count!==null&&sessions>0?decimal.format(count/(sessions*workingWeeks)):'—';
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
    subtotal.insertCell().textContent=coveredYears.has(year)?integer.format(groupTotals.get(year)):'—';
   }
  }
  controls.refresh();
 }
 updateVisibleTotals();
}

window.renderWorkforcePlanning=renderWorkforcePlanning;
})();
