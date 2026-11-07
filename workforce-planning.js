(function(){
const years=['2023','2024','2025','2026'];
const workingWeeks=48;
const integer=new Intl.NumberFormat('en-GB');
const decimal=new Intl.NumberFormat('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1});
const cellKey=(type,year)=>JSON.stringify([type,year]);

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
 for(const type of types){
  const sessionsRow=addRow(sessionsBody,type);
  const slotsRow=addRow(slotsBody,type);
  const averagesRow=addRow(averagesBody,type);
  for(const year of years){
   const key=cellKey(type,year);
   const stored=workforceWeeklySessions.get(key);
   const count=coveredYears.has(year)?totals.get(key)??0:null;
   slotsRow.insertCell().textContent=count===null?'—':integer.format(count);
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
}

window.renderWorkforcePlanning=renderWorkforcePlanning;
})();
