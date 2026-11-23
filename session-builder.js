(function(){
'use strict';
const byId=id=>document.getElementById(id);
const configuredModes=()=>consultCategoryNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
const configuredAppointmentTypes=()=>groupUrgencyNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
const configuredGroups=()=>clinicianGroupNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
function validateRows(rows){
 if(!Array.isArray(rows))throw Error('Session types must be a list.');
 const ids=new Set(),names=new Set();
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||ids.has(row.id))throw Error('Session types must have unique identifiers.');
  if(typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>120)throw Error('Enter a session type of up to 120 characters.');
  const name=row.name.trim().toLocaleLowerCase('en-GB');
  if(names.has(name))throw Error('That session type already exists.');
  if(!row.appointmentsByMode||typeof row.appointmentsByMode!=='object'||Array.isArray(row.appointmentsByMode)||Object.entries(row.appointmentsByMode).some(([mode,count])=>!mode.trim()||!Number.isSafeInteger(count)||count<0))throw Error('Appointment counts must be whole numbers of zero or more, mapped to consultation modes.');
  if(row.clinicianTypes!==undefined&&(!Array.isArray(row.clinicianTypes)||row.clinicianTypes.some(type=>typeof type!=='string'||!type.trim())||new Set(row.clinicianTypes.map(type=>type.trim().toLocaleLowerCase('en-GB'))).size!==row.clinicianTypes.length))throw Error('Choose each eligible clinician group only once.');
  if(row.appointmentTypes!==undefined&&(!Array.isArray(row.appointmentTypes)||row.appointmentTypes.some(type=>typeof type!=='string'||!type.trim())||new Set(row.appointmentTypes.map(type=>type.trim().toLocaleLowerCase('en-GB'))).size!==row.appointmentTypes.length))throw Error('Choose each appointment type only once.');
  ids.add(row.id);names.add(name);
 }
 return true;
}
window.validateSessionBuilderTypes=validateRows;
function reconcileRows(rows){
 const modes=configuredModes(),groups=new Set(configuredGroups());
 return rows.map(row=>({...row,appointmentsByMode:Object.fromEntries(modes.map(mode=>[mode,Object.hasOwn(row.appointmentsByMode,mode)?row.appointmentsByMode[mode]:0])),clinicianTypes:(row.clinicianTypes||[]).filter(name=>groups.has(name))}));
}
window.syncSessionBuilderSettings=()=>{if(canEditSessionBuilder())sessionBuilderTypes=reconcileRows(sessionBuilderTypes);};
window.renameSessionBuilderSetting=(kind,oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderTypes=sessionBuilderTypes.map(row=>kind==='consult'
  ?{...row,appointmentsByMode:Object.fromEntries(Object.entries(row.appointmentsByMode).map(([mode,count])=>[mode===oldName?newName:mode,count]))}
  :kind==='clinicianGroups'?{...row,clinicianTypes:(row.clinicianTypes||[]).map(name=>name===oldName?newName:name)}:kind==='appointmentTypes'&&Array.isArray(row.appointmentTypes)?{...row,appointmentTypes:row.appointmentTypes.map(name=>name===oldName?newName:name)}:row);
 if(kind==='clinicianGroups')window.renameSessionBuilderRuleGroup?.(oldName,newName);
};
function commit(rows){
 if(!canEditSessionBuilder())throw Error('Practice administrator access is required.');
 validateRows(rows);sessionBuilderTypes=reconcileRows(rows);markCategoryDirty();renderSessionRequirements();
}
let demandCache=null;
function readAverageDemand(){
 const today=dayView2LondonClock().date,current=GPCorrectness.monday(today),start=GPCorrectness.shift(current,-364),end=GPCorrectness.shift(current,-1);
 const history=historicalBookingRecords();
 const planningModes=window.gpChartPreferences?.read()?.forecastPlanningModes||{};
 const roles=new Map(groupUrgencyNames.filter(isDashboardToggleOption).map(name=>[name,{role:appointmentCalculationRole(name),category:appointmentCategoryFor(name).toLowerCase().replace(/[^a-z]/g,'')}]));
 const key=JSON.stringify([start,end,window.gpChartPreferences?.account?.(),[...roles],planningModes,[...excludedSlotTypes].sort(),assignments,groupUrgencyAssignments,consultAssignments,consultCategoryNames]);
 if(demandCache?.history===history&&demandCache.coverage===slotReportCoverage&&demandCache.key===key)return demandCache.result;
 const weeks=GPCorrectness.completeWeeks(slotReportCoverage,today,52).filter(week=>week>=start&&week<current);
 const demand=window.SessionBuilderPlanning.averageDemand(history,weeks,{monday:GPCorrectness.monday,classify:row=>{
  if(row.source==='signposting'||excludedSlotTypes.has(row.slot)||String(row.status||'').toLowerCase()!=='booked')return null;
  const name=capacityUrgencyCategory(row.slot),info=roles.get(name);if(!info)return null;
  if(info.role==='routine')return 'routine';
  if(info.role==='urgent'&&planningModes[name]==='weekly')return 'weekly';
  const mode=consultAssignments[row.slot]||suggestConsultMode(row.slot)||'';
  if(info.category==='homevisiting'||info.role==='urgent'&&window.SessionBuilderPlanning.isHomeVisit(mode))return 'homeVisit';
  return info.role==='urgent'?'sameDay':null;
 }});
 const result={demand,start,end,weeks:weeks.length};demandCache={history,coverage:slotReportCoverage,key,result};return result;
}
function renderSessionRequirements(){
 const root=byId('sessionBuilderRequirements');if(!root)return;
 if(!canEditSessionBuilder()){root.hidden=true;return;}root.hidden=false;
 const history=readAverageDemand(),demand=history.demand;
 const format=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
 const fmt=value=>Number.isFinite(value)?format.format(value):'—';
 for(let i=0;i<5;i++){byId('sessionBuilderSameDayNeed'+i).textContent=fmt(demand?.sameDay[i]);byId('sessionBuilderHomeVisitNeed'+i).textContent=fmt(demand?.homeVisit[i]);}
 byId('sessionBuilderWeeklyNeed').textContent=fmt(demand?.weekly);byId('sessionBuilderRoutineNeed').textContent=fmt(demand?.routine);
 const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 byId('sessionBuilderHistory').textContent='Last 52 completed weeks: '+dateLabel(history.start)+'–'+dateLabel(history.end)+' · '+history.weeks+' complete covered week'+(history.weeks===1?'':'s')+' used. Zero-booking days in those weeks are included.';
 const estimate=window.SessionBuilderPlanning.estimateSessions(sessionBuilderTypes,configuredModes(),configuredGroups(),demand,typeof sessionBuilderRules==='undefined'?[]:sessionBuilderRules);
 const body=byId('sessionBuilderPlanBody');body.replaceChildren();
 function addRow(parent,label,values,weekly,routine,group='',split=false){
  const tr=document.createElement('tr'),heading=document.createElement('th');heading.scope='row';heading.textContent=label;
  if(group){const note=document.createElement('span');note.className='session-builder-plan-group';note.textContent=group;heading.append(note);}tr.append(heading);
  for(const value of values){const td=document.createElement('td');if(!split)td.colSpan=2;td.textContent=fmt(value);tr.append(td);}
  for(const value of [weekly,routine]){const td=document.createElement('td');td.textContent=fmt(value);tr.append(td);}parent.append(tr);return tr;
 }
 for(const row of estimate.rows){
   const tr=addRow(body,row.name,estimate.error?Array(5).fill(null):row.days,estimate.error?null:row.weekly,estimate.error?null:row.routine,row.group||'Choose one clinician group');
   if(!estimate.error&&estimate.ruleResults?.length)for(let day=0;day<5;day++){
    const note=document.createElement('span');note.className='session-builder-plan-group';
    const daily=period=>estimate.placements.filter(p=>p.id===row.id&&p.day===day&&p.period===period&&p.pool==='daily').reduce((s,p)=>s+p.count,0);
    note.textContent='AM '+daily('morning')+' · PM '+daily('afternoon');tr.children[day+1].append(note);
   }
  }
 if(!estimate.rows.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=13;cell.textContent='Add session types above to calculate the requirement.';row.append(cell);body.append(row);}
 const foot=byId('sessionBuilderPlanFoot');foot.replaceChildren();
 addRow(foot,'Total sessions',estimate.days||Array(5).fill(null),estimate.weeklySessions,estimate.routineSessions);
 const capacities=Array.from({length:5},(_,i)=>[estimate.capacitySameDay?.[i],estimate.capacityHomeVisit?.[i]]).flat();
 addRow(foot,'Total appointment capacity',capacities,estimate.weeklyCapacity,estimate.routineCapacity,'',true);
 const caption=byId('sessionBuilderPlanStatus');
 if(estimate.error)caption.textContent=estimate.error;
 else{
  const unused=estimate.rows.filter(row=>!row.group||!row.capacity&&!row.days.some(n=>n>0)).map(row=>row.name);
  caption.textContent='Daily session counts cover both same-day and home-visit need; their capacity is split underneath. Urgent weekly and routine allocations use separate sessions, so capacity is not counted twice. Staff availability is not assessed.'+(estimate.ruleResults?.length?' Required rules checked: '+estimate.ruleResults.filter(r=>r.strength==='must').length+'. Daily AM/PM session placement is shown above. Preferences not met: '+estimate.ruleResults.filter(r=>r.strength==='prefer'&&!r.ok).length+'.':'')+(estimate.ruleAdjusted?' Clinician-share rules use a feasible estimate; the session count may not be minimal.':'')+(estimate.approximate?' Large demand uses a feasible capacity-led estimate.':'')+(unused.length?' Not used (choose one group and enter capacity): '+unused.join(', ')+'.':'');
 }
 if(sessionBuilderTypes.some(row=>Array.isArray(row.appointmentTypes)&&configuredAppointmentTypes().some(type=>!row.appointmentTypes.includes(type))))caption.textContent+=' Appointment type selections are saved but are not yet applied to these session estimates.';
}
function renderSessionBuilder(){
 const page=byId('sessionBuilderPage'),body=byId('sessionBuilderBody');if(!page||!body)return;
 if(!canEditSessionBuilder()){page.classList.add('hidden');body.replaceChildren();return;}
 window.syncSessionBuilderSettings();
 const modes=configuredModes(),head=byId('sessionBuilderHead');head.replaceChildren();
 for(const label of ['Session type','Eligible clinician group','Appointment types',...modes,'Actions']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
 byId('sessionBuilderTable').style.minWidth=Math.max(950,800+modes.length*120)+'px';
 byId('sessionBuilderModeNotice').hidden=modes.length>0;
 body.replaceChildren();
 for(const row of sessionBuilderTypes){
  const tr=document.createElement('tr');tr.dataset.sessionId=row.id;
  const nameCell=document.createElement('td'),name=document.createElement('input');name.type='text';name.value=row.name;name.maxLength=120;name.required=true;name.className='session-builder-name';name.setAttribute('aria-label','Session type '+row.name);
  name.addEventListener('input',()=>name.setCustomValidity(''));
  name.addEventListener('change',()=>{try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,name:name.value.trim()}:item));name.value=name.value.trim();name.setCustomValidity('');renderSessionBuilder();}catch(error){name.setCustomValidity(error.message);name.reportValidity();}});
  nameCell.append(name);tr.append(nameCell);
  const eligibleCell=document.createElement('td'),choices=document.createElement('select');choices.className='session-builder-clinician-select';choices.setAttribute('aria-label','Eligible clinician group for '+row.name);
  const types=configuredGroups();
  const empty=document.createElement('option');empty.value='';empty.textContent=types.length?'Choose clinician group':'Add groups in People Settings';choices.append(empty);
  for(const type of types){
   const option=document.createElement('option');option.value=type;option.textContent=type;choices.append(option);
  }
  choices.value=row.clinicianTypes?.length===1?row.clinicianTypes[0]:'';
  choices.addEventListener('change',()=>{try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,clinicianTypes:choices.value?[choices.value]:[]}:item));}catch(error){choices.value=row.clinicianTypes?.length===1?row.clinicianTypes[0]:'';byId('sessionBuilderSaveStatus').textContent=error.message;}});
  eligibleCell.append(choices);tr.append(eligibleCell);
  if(row.clinicianTypes?.length>1){const note=document.createElement('span');note.className='session-builder-group-note';note.textContent='Previously assigned to several groups. Choose one.';eligibleCell.append(note);}
  const appointmentCell=document.createElement('td'),dropdown=document.createElement('details'),summary=document.createElement('summary'),options=document.createElement('div');
  dropdown.className='session-builder-appointment-dropdown';options.className='session-builder-appointment-options';
  const appointmentTypes=configuredAppointmentTypes();
  let selected=new Set(Array.isArray(row.appointmentTypes)?row.appointmentTypes:appointmentTypes);
  const updateSummary=()=>{const count=appointmentTypes.filter(type=>selected.has(type)).length;summary.textContent=!appointmentTypes.length?'No appointment types':count===appointmentTypes.length?'All appointment types':count===0?'No appointment types selected':count+' selected';};
  updateSummary();summary.setAttribute('aria-label','Appointment types for '+row.name);dropdown.append(summary);
  for(const type of appointmentTypes){
   const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=selected.has(type);text.textContent=type;
   checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(type);else selected.delete(type);try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,appointmentTypes:[...selected]}:item));updateSummary();}catch(error){checkbox.checked=!checkbox.checked;if(checkbox.checked)selected.add(type);else selected.delete(type);byId('sessionBuilderSaveStatus').textContent=error.message;}});
   label.append(checkbox,text);options.append(label);
  }
  if(!appointmentTypes.length){const note=document.createElement('span');note.textContent='Add appointment types in Slot settings.';options.append(note);}
  dropdown.append(options);appointmentCell.append(dropdown);tr.append(appointmentCell);
  for(const mode of modes){
   const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.required=true;input.inputMode='numeric';input.value=String(row.appointmentsByMode[mode]??0);input.className='session-builder-count';input.setAttribute('aria-label',mode+' appointments for '+row.name);
   input.addEventListener('input',()=>input.setCustomValidity(''));
   input.addEventListener('change',()=>{try{const value=Number(input.value);if(!/^\d+$/.test(input.value)||!Number.isSafeInteger(value))throw Error('Enter a whole number of zero or more.');commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,appointmentsByMode:{...item.appointmentsByMode,[mode]:value}}:item));input.setCustomValidity('');}catch(error){input.setCustomValidity(error.message);input.reportValidity();}});
   td.append(input);tr.append(td);
  }
  const actions=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.className='session-builder-remove';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+row.name);
  remove.addEventListener('click',()=>{if(!canEditSessionBuilder())return;commit(sessionBuilderTypes.filter(item=>item.id!==row.id));renderSessionBuilder();});actions.append(remove);tr.append(actions);body.append(tr);
 }
 byId('sessionBuilderEmpty').hidden=sessionBuilderTypes.length>0;
 renderSessionRequirements();
 window.restoreSessionBuilderTab?.();
}
window.renderSessionBuilder=renderSessionBuilder;
window.renderSessionBuilderRequirements=renderSessionRequirements;
byId('navSessionBuilder')?.addEventListener('click',()=>{if(canEditSessionBuilder())showPage('sessionBuilder');});
byId('sessionBuilderAddForm')?.addEventListener('submit',event=>{
 event.preventDefault();if(!canEditSessionBuilder())return;
 const input=byId('sessionBuilderNewType');input.setCustomValidity('');
 try{commit([...sessionBuilderTypes,{id:crypto.randomUUID(),name:input.value.trim(),appointmentsByMode:Object.fromEntries(configuredModes().map(mode=>[mode,0])),clinicianTypes:[]}]);input.value='';renderSessionBuilder();input.focus();}
 catch(error){input.setCustomValidity(error.message);input.reportValidity();}
});
byId('sessionBuilderNewType')?.addEventListener('input',event=>event.target.setCustomValidity(''));
})();
