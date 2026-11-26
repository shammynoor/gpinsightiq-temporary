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
function calculateAchievable(rows){
 const keys=['urgent','routine','followup','visit'],empty=Object.fromEntries(keys.map(key=>[key,null]));
 if(!rows.length)return {values:empty,totalSessions:null,reason:'No clinician types are available.'};
 rows=rows.map(row=>({...row,weeklySessions:row.weeklySessions==null?0:row.weeklySessions}));
 if(rows.some(row=>!Number.isFinite(row.weeklySessions)||row.weeklySessions<0))return {values:empty,totalSessions:null,reason:'Sessions must be zero or more.'};
 const totals=Object.fromEntries(keys.map(key=>[key,0]));
 for(const row of rows){
  if(row.weeklySessions===0)continue;
  if(!row.history||!(row.history.sessions>0))return {values:empty,totalSessions:rows.reduce((s,r)=>s+r.weeklySessions,0),reason:'Historical bookings per session are unavailable for at least one clinician type with planned sessions.'};
  for(const key of keys){const rate=historicalRate([row.history],key+'Count');if(!Number.isFinite(rate))return {values:empty,totalSessions:rows.reduce((s,r)=>s+r.weeklySessions,0),reason:'Historical booking rates are unavailable for at least one clinician type.'};totals[key]+=row.weeklySessions*rate}
 }
 return {values:totals,totalSessions:rows.reduce((s,r)=>s+r.weeklySessions,0),reason:''};
}
function compareNeed(achievable,need){
 if(!Number.isFinite(achievable))return {kind:'unavailable',amount:null};
 if(!Number.isFinite(need))return {kind:'noForecast',amount:null};
 const difference=Math.round((achievable-need)*10)/10;
 return difference<0?{kind:'shortfall',amount:-difference}:difference>0?{kind:'surplus',amount:difference}:{kind:'met',amount:0};
}
function averageWeeklyForecast(values){return values.length&&values.every(Number.isFinite)?values.reduce((sum,value)=>sum+value,0)/values.length:null}
const api={calculate,averageWeeklyForecast,historicalRate,historicalCareType,allocateProjectedNeed,calculateAchievable,compareNeed};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPWorkforcePlanner=api;
if(typeof window==='undefined')return;
const $=id=>document.getElementById(id);
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n):'—';
function careOf(row,urgentGroups){
 const type=capacityUrgencyCategory(row.slot),category=canonicalAppointmentCategoryFor(type).trim().toLowerCase();
 if(category==='urgent care')return urgentGroups.has(type)?'urgent':'';
 return appointmentCalculationRole(type)==='routine'?'routine':'';
}
function historyCareOf(row,urgentGroups){const type=capacityUrgencyCategory(row.slot);return historicalCareType(type,canonicalAppointmentCategoryFor(type),careOf(row,urgentGroups))}
function loadHistory(urgentGroups){
 const today=GPCorrectness.londonDate(),clock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const weeks=GPCorrectness.completeWeeks(slotReportCoverage,today,12),weekSet=new Set(weeks);
 if(weeks.length<4)return {error:'At least four complete weeks of Slot Report coverage are needed for historical assumptions.'};
 const allRows=availabilityRecords.filter(r=>r.source==='slot'&&String(r.availability).toLowerCase()==='booked'&&!excludedSlotTypes.has(r.slot)&&r.date&&weekSet.has(mondayOf(r.date)));
 const typeFor=r=>effectiveClinicianType(r.clinician),locumFor=r=>locumCategory(r)==='Locum';
 // Qualify each clinic using every booked appointment, before filtering the care types displayed below.
 const allSessions=GPSessionsHistory.calculate(allRows,clock,typeFor,locumFor,excludedSlotTypes,slotReportCoverage,workforceSessionMinimum());
 const rows=allRows.filter(r=>historyCareOf(r,urgentGroups)),planningRows=rows.filter(r=>careOf(r,urgentGroups));
 const planningSessions=GPSessionsHistory.calculate(planningRows,clock,typeFor,locumFor,excludedSlotTypes,slotReportCoverage,1,allSessions.sessionKeys,allSessions.sessionLabels);
 const sessions=GPSessionsHistory.calculate(rows,clock,typeFor,locumFor,excludedSlotTypes,slotReportCoverage,1,allSessions.sessionKeys,allSessions.sessionLabels);
 const valid=weeks.filter(w=>!allSessions.incomplete.has(w));
 if(valid.length<4)return {error:'At least four complete weeks with clinician names and appointment times are needed. Upload or replace reports that contain the session-holder name.'};
 const validSet=new Set(valid),people=new Map();
 for(const row of rows){
  const session=GPSessionsHistory.sessionKey(row);
  if(!validSet.has(mondayOf(row.date))||!session||!sessions.sessionKeys.has(session))continue;
  const type=sessions.sessionLabels.get(session),care=historyCareOf(row,urgentGroups),planningCare=careOf(row,urgentGroups);
  if(type.startsWith('Multiple clinician types'))return {error:'Some sessions have conflicting clinician types. Resolve these mappings before using the workforce estimate.'};
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
 const routineTypes=groupUrgencyNames.filter(name=>isDashboardToggleOption(name)&&canonicalAppointmentCategoryFor(name).trim().toLowerCase()!=='urgent care'&&appointmentCalculationRole(name)==='routine');
 const weeklyAverage=names=>{if(!names.length)return null;const predictor=window.getHomeOverviewPredictor?.(names);return averageWeeklyForecast(weeks.map((week,i)=>predictor?.range?.(week,true,.85,i+1)?.estimate))};
 const routine=weeklyAverage(routineTypes);
 const categoryOf=name=>historicalCareType(name,canonicalAppointmentCategoryFor(name),appointmentCalculationRole(name));
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
 const td=document.createElement('td'),el=document.createElement('input');el.type='number';el.min='0';el.step='any';el.className='staffing-input';el.setAttribute('aria-label',label);el.value=Number.isFinite(value)?String(Math.round(value*100)/100):'';el.dataset.field=field;if(field==='weeklySessions')el.placeholder='0';td.append(el);row.append(td);return el;
}
function readRows(){
 return [...$('staffingRows').querySelectorAll('tr[data-name]')].map(tr=>{
  const raw=tr.querySelector('[data-field="weeklySessions"]').value;
  return {name:tr.dataset.name,weeklySessions:raw.trim()===''?null:Number(raw),history:model.history.get(tr.dataset.name)};
 });
}
function update(){
 if(!model)return;
 const rows=readRows(),result=calculateAchievable(rows);
 for(const [key,label] of [['urgent','Urgent'],['routine','Routine'],['followup','Followup'],['visit','Visit']]){
  const value=result.values[key],indicator=$('staffingGap'+label),comparison=compareNeed(value,model.need[key]);
  $('staffingAchievable'+label).textContent=number(value);indicator.className='staffing-gap '+comparison.kind;
  indicator.textContent=comparison.kind==='shortfall'?'⚠ '+number(comparison.amount)+' below need':comparison.kind==='surplus'?number(comparison.amount)+' above need':comparison.kind==='met'?'Meets need':comparison.kind==='noForecast'?'Forecast unavailable':'Capacity unavailable';
 }
 $('staffingTotalSessions').textContent=number(result.totalSessions);
 $('staffingValidation').textContent=result.reason||'Blank sessions count as zero. Achievable appointments use unrounded historical rates.';
}
function render(){
 if(!isOwner)return;
 const root=$('staffingPlannerPage');if(!root||root.classList.contains('hidden'))return;
 const key=chartPreferenceKey();if(key!==draftKey){draft=null;draftKey=key}
 const forecast=getForecast(horizon),history=loadHistory(forecast.urgentGroups);
 $('staffingPeriod').textContent=forecast.start&&forecast.end?'Average per week · weeks beginning '+forecast.start+' to '+forecast.end:'';
 for(const [key,label] of [['urgent','Urgent'],['routine','Routine'],['followup','Followup'],['visit','Visit']])$('staffingProjected'+label).textContent=number(Number.isFinite(forecast.projected[key])?forecast.projected[key]/horizon:null);
 $('staffingForecastNote').textContent=forecast.urgentOverlap?'Urgent forecast selection overlaps with follow-up or home visits; review the urgent forecast selection.':'— means a forecast is unavailable.';
 const body=$('staffingRows');body.replaceChildren();$('staffingValidation').textContent='';
 if(history.error||!history.rows.length){model=null;for(const id of ['staffingTotalUrgent','staffingTotalRoutine','staffingTotalFollowup','staffingTotalVisit','staffingTotalSessions','staffingAchievableUrgent','staffingAchievableRoutine','staffingAchievableFollowup','staffingAchievableVisit'])$(id).textContent='—';for(const label of ['Urgent','Routine','Followup','Visit']){const el=$('staffingGap'+label);el.className='staffing-gap unavailable';el.textContent='Capacity unavailable'}$('staffingHistoryNote').textContent=history.error||'No matching historical bookings found.';return}
 $('staffingHistoryNote').textContent='Based on '+history.weeks+' complete recent weeks'+(history.excludedWeeks?' ('+history.excludedWeeks+' incomplete excluded)':'')+'. Sessions: before 1pm or from 2pm, with at least '+workforceSessionMinimum()+' booked '+(workforceSessionMinimum()===1?'appointment':'appointments')+'.';
 const saved=draft||readChartPreferences()['staffingPlanner:weeklySessions']||{};
 model={historyRows:history.rows,history:new Map(history.rows.map(row=>[row.name,row])),need:Object.fromEntries(Object.entries(forecast.projected).map(([key,total])=>[key,Number.isFinite(total)?total/horizon:null]))};
 const groupNames=[...clinicianGroupNames,'Uncategorised'];
 const ordered=[...history.rows].sort((a,b)=>groupNames.indexOf(a.group)-groupNames.indexOf(b.group)||a.name.localeCompare(b.name));
 let currentGroup=null;
 for(const data of ordered){
  if(data.group!==currentGroup){currentGroup=data.group;const groupRow=document.createElement('tr'),heading=document.createElement('th');groupRow.className='staffing-group';heading.scope='rowgroup';heading.colSpan=6;heading.textContent=currentGroup;groupRow.append(heading);body.append(groupRow)}
  const tr=document.createElement('tr');tr.dataset.name=data.name;const title=document.createElement('th');title.scope='row';title.textContent=data.name;tr.append(title);
  for(const field of ['urgentCount','routineCount','followupCount','visitCount']){const td=cell(tr,''),value=document.createElement('span');value.className='staffing-history-value';value.textContent=number(historicalRate([data],field));td.append(value)}
  const prior=saved[data.name];input(tr,'weeklySessions',Number.isFinite(prior)?prior:null,data.name+' planned sessions per week');
  tr.addEventListener('input',()=>{draft=Object.fromEntries(readRows().map(({name,weeklySessions})=>[name,weeklySessions]));$('staffingSaved').textContent='Changes not saved.';update()});body.append(tr);
 }
 for(const [key,label] of [['urgentCount','Urgent'],['routineCount','Routine'],['followupCount','Followup'],['visitCount','Visit']])$('staffingTotal'+label).textContent=number(historicalRate(model.historyRows,key));
 update();
}
document.addEventListener('DOMContentLoaded',()=>{
 $('staffingHorizon')?.addEventListener('click',event=>{const button=event.target.closest('button[data-weeks]');if(!button)return;horizon=Number(button.dataset.weeks);for(const el of $('staffingHorizon').querySelectorAll('button'))el.setAttribute('aria-pressed',String(el===button));render()});
 $('staffingSave')?.addEventListener('click',()=>{
  if(!isOwner||!model)return;
  const rows=readRows();
  if(rows.some(row=>row.weeklySessions!==null&&(!Number.isFinite(row.weeklySessions)||row.weeklySessions<0))){$('staffingSaved').textContent='Sessions must be zero or more.';return}
  const saved=Object.fromEntries(rows.map(({name,weeklySessions})=>[name,weeklySessions]));
  draft=saved;writeChartPreference('staffingPlanner:weeklySessions',saved);$('staffingSaved').textContent='Scenario saved locally; account sync may take a moment.';
 });
});
window.renderStaffingPlanner=render;
})(typeof window!=='undefined'?window:globalThis);
