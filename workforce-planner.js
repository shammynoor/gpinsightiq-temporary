(function(root){
'use strict';
function calculate(demand,rows){
 const keys=['urgent','routine'],errors=[];
 for(const key of keys){
  if(!Number.isFinite(demand[key])||demand[key]<0){errors.push('Forecast unavailable for '+key+'.');continue}
  const sum=rows.reduce((n,r)=>n+(Number.isFinite(r[key])?r[key]:0),0);
  if(demand[key]>0&&Math.abs(sum-100)>0.15)errors.push(key+' allocation must add up to 100%.');
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
const api={calculate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPWorkforcePlanner=api;
if(typeof window==='undefined')return;
const $=id=>document.getElementById(id);
const number=n=>Number.isFinite(n)?new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n):'—';
const typeOf=row=>{const name=effectiveClinicianType(row.clinician)||'Unassigned';return locumCategory(row)==='Locum'&&!/\blocum\b/i.test(name)?name+' · Locum':name};
function careOf(row,urgentGroups){
 const type=capacityUrgencyCategory(row.slot),category=appointmentCategoryFor(type).trim().toLowerCase();
 if(category==='urgent care')return urgentGroups.has(type)?'urgent':'';
 return appointmentCalculationRole(type)==='routine'?'routine':'';
}
function loadHistory(urgentGroups){
 const today=GPCorrectness.londonDate(),clock=dayView2LondonClock(new Date(Number.isFinite(capacityCSVLatestModified)?Math.min(Date.now(),capacityCSVLatestModified):Date.now()));
 const weeks=GPCorrectness.completeWeeks(slotReportCoverage,today,12),weekSet=new Set(weeks);
 if(weeks.length<4)return {error:'At least four complete weeks of Slot Report coverage are needed for historical assumptions.'};
 const rows=availabilityRecords.filter(r=>r.source==='slot'&&String(r.availability).toLowerCase()==='booked'&&!excludedSlotTypes.has(r.slot)&&r.date&&weekSet.has(mondayOf(r.date))&&careOf(r,urgentGroups));
 const sessions=GPSessionsHistory.calculate(rows,clock,r=>effectiveClinicianType(r.clinician),r=>locumCategory(r)==='Locum',excludedSlotTypes,slotReportCoverage);
 const valid=weeks.filter(w=>!sessions.incomplete.has(w));
 if(valid.length<4)return {error:'At least four complete weeks with clinician names and appointment times are needed. Upload or replace reports that contain the session-holder name.'};
 const validSet=new Set(valid),people=new Map();
 for(const row of rows){
  if(!validSet.has(mondayOf(row.date))||!Number.isInteger(row.minute)||(row.minute>=780&&row.minute<840))continue;
  const type=typeOf(row),care=careOf(row,urgentGroups);
  if(!people.has(type))people.set(type,{name:type,urgentCount:0,routineCount:0,sessions:0});
  people.get(type)[care+'Count']+=Number(row.count)||0;
 }
 for(const week of valid)for(const [type,count] of sessions.totals.get(week)||[]){
  if(type.startsWith('Multiple clinician types'))return {error:'Some sessions have conflicting clinician types. Resolve these mappings before using the workforce estimate.'};
  if(!people.has(type))people.set(type,{name:type,urgentCount:0,routineCount:0,sessions:0});people.get(type).sessions+=count;
 }
 const rowsOut=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name));
 const urgentTotal=rowsOut.reduce((s,r)=>s+r.urgentCount,0),routineTotal=rowsOut.reduce((s,r)=>s+r.routineCount,0);
 for(const r of rowsOut){r.urgent=urgentTotal?100*r.urgentCount/urgentTotal:0;r.routine=routineTotal?100*r.routineCount/routineTotal:0;r.perSession=r.sessions?(r.urgentCount+r.routineCount)/r.sessions:null}
 return {rows:rowsOut,weeks:valid.length,excludedWeeks:weeks.length-valid.length,urgentTotal,routineTotal};
}
function getForecast(){
 const urgent=window.getHomeUrgentForecast?.({allRows:true});
 const start=GPCorrectness.shift(mondayOf(GPCorrectness.londonDate()),7);
 const weeks=Array.from({length:4},(_,i)=>GPCorrectness.shift(start,i*7));
 const byWeek=new Map((urgent?.rows||[]).map(row=>[row.weekStart,row]));
 const u=weeks.map(week=>byWeek.get(week));
 const selected=urgent?.groups||[];
 const routineTypes=groupUrgencyNames.filter(name=>isDashboardToggleOption(name)&&appointmentCategoryFor(name).trim().toLowerCase()!=='urgent care'&&appointmentCalculationRole(name)==='routine');
 const predictor=window.getHomeOverviewPredictor?.(routineTypes);
 const r=weeks.map((week,i)=>predictor?.range?.(week,true,.85,i+1)?.estimate);
 return {urgentGroups:new Set(selected),urgent:u.every(row=>Number.isFinite(row?.estimate))?u.reduce((a,row)=>a+row.estimate,0)/4:null,routine:r.every(Number.isFinite)?r.reduce((a,n)=>a+n,0)/4:null,start:weeks[0],end:weeks[3],groups:selected};
}
let model=null;
function cell(row,value){const el=document.createElement('td');el.textContent=value;row.append(el);return el}
function input(row,field,value,label){
 const td=document.createElement('td'),el=document.createElement('input');el.type='number';el.min='0';el.step='any';el.className='staffing-input';el.setAttribute('aria-label',label);el.value=Number.isFinite(value)?String(Math.round(value*100)/100):'';el.dataset.field=field;td.append(el);row.append(td);return el;
}
function readRows(){
 return [...$('staffingRows').querySelectorAll('tr')].map(tr=>{
  const value=field=>{const raw=tr.querySelector('[data-field="'+field+'"]').value;return raw.trim()===''?null:Number(raw)};
  return {name:tr.dataset.name,urgent:value('urgent'),routine:value('routine'),perSession:value('perSession'),perWte:value('perWte')};
 });
}
function update(){
 if(!model)return;
 const rows=readRows(),result=calculate(model.demand,rows),body=$('staffingRows');
 for(let i=0;i<result.rows.length;i++){
  const row=body.children[i],item=result.rows[i];row.querySelector('[data-result="appointments"]').textContent=result.errors.length?'—':number(item.appts);
  row.querySelector('[data-result="sessions"]').textContent=result.errors.length?'—':number(item.sessions);
  row.querySelector('[data-result="wte"]').textContent=result.errors.length?'—':number(item.wte);
 }
 $('staffingSessions').textContent=result.errors.length?'—':number(result.totalSessions);
 $('staffingWte').textContent=result.errors.length?'—':number(result.totalWte);
 $('staffingValidation').textContent=result.errors.join(' ')||'Enter patient-facing sessions per WTE for every clinician type with demand to see the WTE estimate.';
}
function render(){
 if(!isOwner)return;
 const root=$('staffingPlannerPage');if(!root||root.classList.contains('hidden'))return;
 const forecast=getForecast(),history=loadHistory(forecast.urgentGroups);
 $('staffingUrgent').textContent=number(forecast.urgent);$('staffingRoutine').textContent=number(forecast.routine);
 $('staffingDemand').textContent=Number.isFinite(forecast.urgent)&&Number.isFinite(forecast.routine)?number(forecast.urgent+forecast.routine):'—';
 $('staffingPeriod').textContent=forecast.start&&forecast.end?'Weeks beginning '+forecast.start+' to '+forecast.end:'Next four complete weeks';
 $('staffingSource').textContent='Urgent forecast selection: '+(forecast.groups.join(', ')||'none')+'. Other appointment types and non-clinical workload are not included.';
 const body=$('staffingRows');body.replaceChildren();$('staffingValidation').textContent='';
 if(history.error||!history.rows.length){model=null;$('staffingSessions').textContent='—';$('staffingWte').textContent='—';$('staffingHistoryNote').textContent=history.error||'No matching historical bookings found.';return}
 $('staffingHistoryNote').textContent='Starting mix and bookings per session: '+history.weeks+' complete recent weeks'+(history.excludedWeeks?' ('+history.excludedWeeks+' incomplete weeks excluded)':'')+'. Only urgent and routine booked appointments before 1pm or from 2pm are included; sessions without a booked appointment are not counted.';
 const saved=readChartPreferences()['staffingPlanner:assumptions']||{};
 model={demand:{urgent:forecast.urgent,routine:forecast.routine}};
 for(const data of history.rows){
  const tr=document.createElement('tr');tr.dataset.name=data.name;const title=document.createElement('th');title.scope='row';title.textContent=data.name;tr.append(title);
  const prior=saved[data.name]||{};
  input(tr,'urgent',Number.isFinite(prior.urgent)?prior.urgent:data.urgent,data.name+' urgent allocation percent');
  input(tr,'routine',Number.isFinite(prior.routine)?prior.routine:data.routine,data.name+' routine allocation percent');
  input(tr,'perSession',Number.isFinite(prior.perSession)?prior.perSession:data.perSession,data.name+' bookings per session');
  input(tr,'perWte',Number.isFinite(prior.perWte)?prior.perWte:null,data.name+' patient-facing sessions per WTE');
  for(const key of ['appointments','sessions','wte'])cell(tr,'—').dataset.result=key;
  tr.addEventListener('input',()=>{$('staffingSaved').textContent='Changes not saved.';update()});body.append(tr);
 }
 update();
}
document.addEventListener('DOMContentLoaded',()=>{
 $('staffingSave')?.addEventListener('click',()=>{
  if(!isOwner||!model)return;
  const rows=readRows(),result=calculate(model.demand,rows);
  if(result.errors.length){$('staffingSaved').textContent='Correct the allocation before saving.';return}
  const saved=Object.fromEntries(rows.map(({name,...values})=>[name,values]));
  writeChartPreference('staffingPlanner:assumptions',saved);$('staffingSaved').textContent='Scenario saved locally; account sync may take a moment.';
 });
});
window.renderStaffingPlanner=render;
})(typeof window!=='undefined'?window:globalThis);
