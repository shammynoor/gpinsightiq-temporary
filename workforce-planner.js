(function(root){
'use strict';
function calculate(demand,rows){
 const keys=['urgent','routine'],errors=[];
 for(const key of keys){
  if(!Number.isFinite(demand[key])||demand[key]<0){errors.push('Forecast unavailable for '+key+'.');continue}
  const sum=rows.reduce((n,r)=>n+(Number.isFinite(r[key])?r[key]:0),0);
  if(demand[key]>0&&Math.abs(sum-100)>0.15)errors.push(sum===0?'No historical '+key+' bookings are available to distribute the forecast.':'Historical '+key+' bookings could not be reconciled.');
 }
 const results=rows.map(r=>{
  const appts=keys.reduce((sum,k)=>sum+demand[k]*(r[k]||0)/100,0);
  const sessions=Number.isFinite(appts)&&appts===0?0:Number.isFinite(appts)&&r.perSession>0?appts/r.perSession:null;
  const wte=sessions===0?0:Number.isFinite(sessions)&&r.perWte>0?sessions/r.perWte:null;
  return {...r,appts,sessions,wte};
 });
 if(rows.some(r=>keys.some(k=>!Number.isFinite(r[k])||r[k]<0||r[k]>100)))errors.push('Allocations must be between 0 and 100%.');
 if(rows.some(r=>['perSession','perWte'].some(k=>r[k]!==null&&(!Number.isFinite(r[k])||r[k]<=0))))errors.push('Session rates must be positive, or left blank.');
 return {errors,rows:results,totalSessions:results.every(r=>Number.isFinite(r.sessions))?results.reduce((s,r)=>s+r.sessions,0):null,totalWte:results.every(r=>Number.isFinite(r.wte))?results.reduce((s,r)=>s+r.wte,0):null};
}
function historicalCareType(type,category,planningCare){
 const name=String(type||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
 if(name.startsWith('followup'))return 'followup';
 if(['visit','homevisit','homevisiting','housecall','domiciliary'].some(prefix=>name.startsWith(prefix))||String(category||'').trim().toLowerCase()==='home visiting')return 'visit';
 return planningCare;
}
function historicalRate(rows,key){const sessions=rows.reduce((sum,row)=>sum+row.sessions,0);return sessions>0?rows.reduce((sum,row)=>sum+row[key],0)/sessions:null}
function allocateProjectedNeed(total,rows,key){
 if(!Number.isFinite(total)||total<0)return rows.map(()=>null);
 const counts=rows.map(row=>Number.isFinite(row[key])&&row[key]>=0?row[key]:null);
 if(counts.some(value=>value===null))return rows.map(()=>null);
 const sum=counts.reduce((a,b)=>a+b,0);
 if(!sum)return rows.map(()=>total===0?0:null);
 return counts.map(value=>total*value/sum);
}
function averageWeeklyForecast(values){return values.length&&values.every(Number.isFinite)?values.reduce((sum,value)=>sum+value,0)/values.length:null}
const api={calculate,averageWeeklyForecast,historicalRate,historicalCareType,allocateProjectedNeed};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPWorkforcePlanner=api;
if(typeof window==='undefined')return;
const $=id=>document.getElementById(id);
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n):'—';
const typeOf=row=>{const name=effectiveClinicianType(row.clinician)||'Unassigned';return locumCategory(row)==='Locum'&&!/\blocum\b/i.test(name)?name+' · Locum':name};
function careOf(row,urgentGroups){
 const type=capacityUrgencyCategory(row.slot),category=appointmentCategoryFor(type).trim().toLowerCase();
 if(category==='urgent care')return urgentGroups.has(type)?'urgent':'';
 return appointmentCalculationRole(type)==='routine'?'routine':'';
}
function historyCareOf(row,urgentGroups){const type=capacityUrgencyCategory(row.slot);return historicalCareType(type,appointmentCategoryFor(type),careOf(row,urgentGroups))}
function loadHistory(urgentGroups){
 const today=GPCorrectness.londonDate(),clock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const weeks=GPCorrectness.completeWeeks(slotReportCoverage,today,12),weekSet=new Set(weeks);
 if(weeks.length<4)return {error:'At least four complete weeks of Slot Report coverage are needed for historical assumptions.'};
 const rows=availabilityRecords.filter(r=>r.source==='slot'&&String(r.availability).toLowerCase()==='booked'&&!excludedSlotTypes.has(r.slot)&&r.date&&weekSet.has(mondayOf(r.date))&&historyCareOf(r,urgentGroups));
 const planningRows=rows.filter(r=>careOf(r,urgentGroups));
 const planningSessions=GPSessionsHistory.calculate(planningRows,clock,r=>effectiveClinicianType(r.clinician),r=>locumCategory(r)==='Locum',excludedSlotTypes,slotReportCoverage);
 const sessions=GPSessionsHistory.calculate(rows,clock,r=>effectiveClinicianType(r.clinician),r=>locumCategory(r)==='Locum',excludedSlotTypes,slotReportCoverage);
 const valid=weeks.filter(w=>!sessions.incomplete.has(w));
 if(valid.length<4)return {error:'At least four complete weeks with clinician names and appointment times are needed. Upload or replace reports that contain the session-holder name.'};
 const validSet=new Set(valid),people=new Map();
 for(const row of rows){
  if(!validSet.has(mondayOf(row.date))||!Number.isInteger(row.minute)||(row.minute>=780&&row.minute<840))continue;
  const type=typeOf(row),care=historyCareOf(row,urgentGroups),planningCare=careOf(row,urgentGroups);
  if(!people.has(type)){const base=effectiveClinicianType(row.clinician)||'Unassigned';const group=clinicianGroupAssignments[base];people.set(type,{name:type,group:clinicianGroupNames.includes(group)?group:'Uncategorised',urgentCount:0,routineCount:0,followupCount:0,visitCount:0,planningUrgentCount:0,planningRoutineCount:0,sessions:0,planningSessions:0})}
  people.get(type)[care+'Count']+=Number(row.count)||0;
  if(planningCare)people.get(type)['planning'+(planningCare==='urgent'?'Urgent':'Routine')+'Count']+=Number(row.count)||0;
 }
 for(const week of valid)for(const [type,count] of sessions.totals.get(week)||[]){
  if(type.startsWith('Multiple clinician types'))return {error:'Some sessions have conflicting clinician types. Resolve these mappings before using the workforce estimate.'};
  if(!people.has(type))people.set(type,{name:type,group:'Uncategorised',urgentCount:0,routineCount:0,followupCount:0,visitCount:0,planningUrgentCount:0,planningRoutineCount:0,sessions:0,planningSessions:0});people.get(type).sessions+=count;
 }
 for(const week of valid)for(const [type,count] of planningSessions.totals.get(week)||[]){
  if(type.startsWith('Multiple clinician types'))return {error:'Some sessions have conflicting clinician types. Resolve these mappings before using the workforce estimate.'};
  if(people.has(type))people.get(type).planningSessions+=count;
 }
 const rowsOut=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
 const urgentTotal=rowsOut.reduce((s,r)=>s+r.planningUrgentCount,0),routineTotal=rowsOut.reduce((s,r)=>s+r.planningRoutineCount,0);
 for(const r of rowsOut){r.urgent=urgentTotal?100*r.planningUrgentCount/urgentTotal:0;r.routine=routineTotal?100*r.planningRoutineCount/routineTotal:0;r.perSession=r.planningSessions?(r.planningUrgentCount+r.planningRoutineCount)/r.planningSessions:null}
 return {rows:rowsOut,weeks:valid.length,excludedWeeks:weeks.length-valid.length,urgentTotal,routineTotal};
}
function getForecast(horizon){
 const urgent=window.getHomeUrgentForecast?.({weeks:horizon});
 const start=GPCorrectness.shift(mondayOf(GPCorrectness.londonDate()),7);
 const weeks=Array.from({length:horizon},(_,i)=>GPCorrectness.shift(start,i*7));
 const byWeek=new Map((urgent?.rows||[]).map(row=>[row.weekStart,row]));
 const u=weeks.map(week=>byWeek.get(week));
 const selected=urgent?.groups||[];
 const routineTypes=groupUrgencyNames.filter(name=>isDashboardToggleOption(name)&&appointmentCategoryFor(name).trim().toLowerCase()!=='urgent care'&&appointmentCalculationRole(name)==='routine');
 const weeklyAverage=names=>{if(!names.length)return null;const predictor=window.getHomeOverviewPredictor?.(names);return averageWeeklyForecast(weeks.map((week,i)=>predictor?.range?.(week,true,.85,i+1)?.estimate))};
 const routine=weeklyAverage(routineTypes);
 const categoryOf=name=>historicalCareType(name,appointmentCategoryFor(name),appointmentCalculationRole(name));
 const options=groupUrgencyNames.filter(isDashboardToggleOption);
 const followupTypes=options.filter(name=>categoryOf(name)==='followup'),visitTypes=options.filter(name=>categoryOf(name)==='visit');
 const routineOnly=routineTypes.filter(name=>categoryOf(name)==='routine');
 const urgentOverlap=selected.some(name=>['followup','visit'].includes(categoryOf(name)));
 const urgentAverage=averageWeeklyForecast(u.map(row=>row?.estimate));
 const projected={urgent:urgentOverlap?null:Number.isFinite(urgentAverage)?urgentAverage*horizon:null,routine:Number.isFinite(routine)&&routineOnly.length===routineTypes.length?routine*horizon:null,followup:null,visit:null};
 if(routineOnly.length!==routineTypes.length){const average=weeklyAverage(routineOnly);projected.routine=Number.isFinite(average)?average*horizon:null}
 for(const [key,names] of [['followup',followupTypes],['visit',visitTypes]]){const average=weeklyAverage(names);projected[key]=Number.isFinite(average)?average*horizon:null}
 return {urgentGroups:new Set(selected),urgent:urgentAverage,routine,projected,start:weeks[0],end:weeks.at(-1),groups:selected,urgentOverlap};
}
let model=null,horizon=4,draft=null,draftKey=null;
function cell(row,value){const el=document.createElement('td');el.textContent=value;row.append(el);return el}
function input(row,field,value,label){
 const td=document.createElement('td'),el=document.createElement('input');el.type='number';el.min='0';el.step='any';el.className='staffing-input';el.setAttribute('aria-label',label);el.value=Number.isFinite(value)?String(Math.round(value*100)/100):'';el.dataset.field=field;td.append(el);row.append(td);return el;
}
function readRows(){
 return [...$('staffingRows').querySelectorAll('tr[data-name]')].map(tr=>{
  const value=field=>{const raw=tr.querySelector('[data-field="'+field+'"]').value;return raw.trim()===''?null:Number(raw)};
  const history=model.history.get(tr.dataset.name);
  return {name:tr.dataset.name,urgent:history.urgent,routine:history.routine,perSession:value('perSession'),perWte:value('perWte')};
 });
}
function update(){
 if(!model)return;
 const rows=readRows(),result=calculate(model.demand,rows),body=$('staffingRows'),dataRows=body.querySelectorAll('tr[data-name]');
 for(const [care,field,label] of [['urgent','urgentCount','Urgent'],['routine','routineCount','Routine'],['followup','followupCount','Followup'],['visit','visitCount','Visit']]){
  const values=allocateProjectedNeed(model.projected[care],rows.map(row=>model.history.get(row.name)),field);
  for(let i=0;i<dataRows.length;i++)dataRows[i].querySelector('[data-projection="'+care+'"]').textContent=number(values[i]);
  $('staffingProjected'+label).textContent=number(model.projected[care]);
 }
 for(let i=0;i<result.rows.length;i++){
  const row=dataRows[i],item=result.rows[i];row.querySelector('[data-result="appointments"]').textContent=result.errors.length?'—':number(item.appts);
  row.querySelector('[data-result="sessions"]').textContent=result.errors.length?'—':number(item.sessions);
  row.querySelector('[data-result="wte"]').textContent=result.errors.length?'—':number(item.wte);
 }
 $('staffingTotalUrgent').textContent=number(historicalRate(model.historyRows,'urgentCount'));
 $('staffingTotalRoutine').textContent=number(historicalRate(model.historyRows,'routineCount'));
 $('staffingTotalFollowup').textContent=number(historicalRate(model.historyRows,'followupCount'));
 $('staffingTotalVisit').textContent=number(historicalRate(model.historyRows,'visitCount'));
 $('staffingTotalBookings').textContent=result.errors.length?'—':number(result.rows.reduce((sum,row)=>sum+row.appts,0));
 $('staffingTotalSessions').textContent=$('staffingSessions').textContent=result.errors.length?'—':number(result.totalSessions);
 $('staffingTotalWte').textContent=$('staffingWte').textContent=result.errors.length?'—':number(result.totalWte);
 $('staffingValidation').textContent=result.errors.join(' ')||(Number.isFinite(result.totalWte)?'':'Enter clinical sessions per WTE to calculate WTE.');
}
function render(){
 if(!isOwner)return;
 const root=$('staffingPlannerPage');if(!root||root.classList.contains('hidden'))return;
 const key=chartPreferenceKey();if(key!==draftKey){draft=null;draftKey=key}
 const forecast=getForecast(horizon),history=loadHistory(forecast.urgentGroups);
 $('staffingUrgent').textContent=number(forecast.urgent);$('staffingRoutine').textContent=number(forecast.routine);
 $('staffingDemand').textContent=Number.isFinite(forecast.urgent)&&Number.isFinite(forecast.routine)?number(forecast.urgent+forecast.routine):'—';
 $('staffingPeriod').textContent=forecast.start&&forecast.end?'Weeks beginning '+forecast.start+' to '+forecast.end+' · projected need is for the full period; staffing figures are per week.':'';
 $('staffingSource').textContent='Urgent types: '+(forecast.groups.join(', ')||'none')+'. Projected need is split by recent historical bookings. — means a forecast or historical split is unavailable. Longer forecasts are less certain.'+(forecast.urgentOverlap?' Urgent types overlap follow-up or home visits; review the urgent forecast selection.':'');
 const body=$('staffingRows');body.replaceChildren();$('staffingValidation').textContent='';
 if(history.error||!history.rows.length){model=null;for(const id of ['staffingSessions','staffingWte','staffingTotalUrgent','staffingTotalRoutine','staffingTotalFollowup','staffingTotalVisit','staffingProjectedUrgent','staffingProjectedRoutine','staffingProjectedFollowup','staffingProjectedVisit','staffingTotalBookings','staffingTotalSessions','staffingTotalWte'])$(id).textContent='—';$('staffingHistoryNote').textContent=history.error||'No matching historical bookings found.';return}
 $('staffingHistoryNote').textContent='Historical mix: '+history.weeks+' complete weeks'+(history.excludedWeeks?' ('+history.excludedWeeks+' incomplete excluded)':'')+'. Weekly staffing estimates use the existing urgent and routine forecasts. Sessions are before 1pm or from 2pm, with at least one booking.';
 const saved=draft||readChartPreferences()['staffingPlanner:assumptions']||{};
 model={demand:{urgent:forecast.urgent,routine:forecast.routine},projected:forecast.projected,historyRows:history.rows,history:new Map(history.rows.map(row=>[row.name,row]))};
 const groupNames=[...clinicianGroupNames,'Uncategorised'];
 const ordered=[...history.rows].sort((a,b)=>groupNames.indexOf(a.group)-groupNames.indexOf(b.group)||a.name.localeCompare(b.name));
 let currentGroup=null;
 for(const data of ordered){
  if(data.group!==currentGroup){currentGroup=data.group;const groupRow=document.createElement('tr'),heading=document.createElement('th');groupRow.className='staffing-group';heading.scope='rowgroup';heading.colSpan=14;heading.textContent=currentGroup;groupRow.append(heading);body.append(groupRow)}
  const tr=document.createElement('tr');tr.dataset.name=data.name;const title=document.createElement('th');title.scope='row';title.textContent=data.name;tr.append(title);
  const prior=saved[data.name]||{};
  for(const field of ['urgentCount','routineCount','followupCount','visitCount']){const td=cell(tr,''),value=document.createElement('span');value.className='staffing-history-value';value.textContent=number(historicalRate([data],field));td.append(value)}
  for(const care of ['urgent','routine','followup','visit'])cell(tr,'—').dataset.projection=care;
  input(tr,'perSession',Object.hasOwn(prior,'perSession')?prior.perSession:data.perSession,data.name+' bookings per session');
  for(const key of ['appointments','sessions'])cell(tr,'—').dataset.result=key;
  input(tr,'perWte',Object.hasOwn(prior,'perWte')?prior.perWte:null,data.name+' patient-facing sessions per WTE');
  cell(tr,'—').dataset.result='wte';
  tr.addEventListener('input',()=>{draft=Object.fromEntries(readRows().map(({name,perSession,perWte})=>[name,{perSession,perWte}]));$('staffingSaved').textContent='Changes not saved.';update()});body.append(tr);
 }
 update();
}
document.addEventListener('DOMContentLoaded',()=>{
 $('staffingHorizon')?.addEventListener('click',event=>{const button=event.target.closest('button[data-weeks]');if(!button)return;horizon=Number(button.dataset.weeks);for(const el of $('staffingHorizon').querySelectorAll('button'))el.setAttribute('aria-pressed',String(el===button));render()});
 $('staffingSave')?.addEventListener('click',()=>{
  if(!isOwner||!model)return;
  const rows=readRows(),result=calculate(model.demand,rows);
  if(result.errors.length){$('staffingSaved').textContent='Check the forecast and historical data before saving.';return}
  const saved=Object.fromEntries(rows.map(({name,perSession,perWte})=>[name,{perSession,perWte}]));
  draft=saved;writeChartPreference('staffingPlanner:assumptions',saved);$('staffingSaved').textContent='Scenario saved locally; account sync may take a moment.';
 });
});
window.renderStaffingPlanner=render;
})(typeof window!=='undefined'?window:globalThis);
