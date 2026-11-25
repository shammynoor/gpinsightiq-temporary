(function(){
'use strict';
const byId=id=>document.getElementById(id);
const configuredModes=()=>consultCategoryNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
const configuredAppointmentTypes=()=>groupUrgencyNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
const configuredGroups=()=>clinicianGroupNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
const configuredClinicians=()=>clinicianCategoryNames.filter(name=>name&&name!=='Uncategorised'&&isDashboardToggleOption(name));
const clinicianGroup=name=>configuredGroups().includes(clinicianGroupAssignments[name])?clinicianGroupAssignments[name]:'Uncategorised';
const selectedClinicians=row=>Array.isArray(row.eligibleClinicians)?row.eligibleClinicians:configuredClinicians().filter(name=>(row.clinicianTypes||[]).includes(clinicianGroup(name)));
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
  if(row.eligibleClinicians!==undefined&&(!Array.isArray(row.eligibleClinicians)||row.eligibleClinicians.some(type=>typeof type!=='string'||!type.trim())||new Set(row.eligibleClinicians.map(type=>type.trim().toLocaleLowerCase('en-GB'))).size!==row.eligibleClinicians.length))throw Error('Choose each eligible clinician type only once.');
  if(row.appointmentTypes!==undefined&&(!Array.isArray(row.appointmentTypes)||row.appointmentTypes.some(type=>typeof type!=='string'||!type.trim())||new Set(row.appointmentTypes.map(type=>type.trim().toLocaleLowerCase('en-GB'))).size!==row.appointmentTypes.length))throw Error('Choose each appointment type only once.');
  ids.add(row.id);names.add(name);
 }
 return true;
}
window.validateSessionBuilderTypes=validateRows;
function reconcileRows(rows){
 const modes=configuredModes();
 // Keep saved assignments even if settings are temporarily unavailable or a category is hidden.
 return rows.map(row=>({...row,appointmentsByMode:{...row.appointmentsByMode,...Object.fromEntries(modes.filter(mode=>!Object.hasOwn(row.appointmentsByMode,mode)).map(mode=>[mode,0]))},clinicianTypes:[...(row.clinicianTypes||[])]}));
}
window.syncSessionBuilderSettings=()=>{if(canEditSessionBuilder())sessionBuilderTypes=reconcileRows(sessionBuilderTypes);};
window.renameSessionBuilderSetting=(kind,oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderTypes=sessionBuilderTypes.map(row=>kind==='consult'
  ?{...row,appointmentsByMode:Object.fromEntries(Object.entries(row.appointmentsByMode).map(([mode,count])=>[mode===oldName?newName:mode,count]))}
  :kind==='clinicianGroups'?{...row,clinicianTypes:(row.clinicianTypes||[]).map(name=>name===oldName?newName:name)}:kind==='appointmentTypes'&&Array.isArray(row.appointmentTypes)?{...row,appointmentTypes:row.appointmentTypes.map(name=>name===oldName?newName:name)}:row);
 if(kind==='clinicianGroups')window.renameSessionBuilderRuleGroup?.(oldName,newName);
 if(kind==='appointmentTypes')window.renameSessionBuilderRuleAppointmentType?.(oldName,newName);
};
function commit(rows){
 if(!canEditSessionBuilder())throw Error('Practice administrator access is required.');
 validateRows(rows);sessionBuilderTypes=reconcileRows(rows);markCategoryDirty(250);try{renderSessionRequirements();}catch(error){console.error('Session requirements could not be updated',error);const status=byId('sessionBuilderPlanStatus');if(status)status.textContent='Could not update session requirements: '+error.message;}
}
let demandCache=null;
function readAverageDemand(){
 const today=dayView2LondonClock().date,current=GPCorrectness.monday(today),start=GPCorrectness.shift(current,-364),end=GPCorrectness.shift(current,-1);
 const history=historicalBookingRecords();
 const planningModes=window.gpChartPreferences?.read()?.forecastPlanningModes||{};
 const roles=new Map(groupUrgencyNames.filter(isDashboardToggleOption).map(name=>[name,{role:appointmentCalculationRole(name),category:appointmentCategoryFor(name).toLowerCase().replace(/[^a-z]/g,'')}]));
 const key=JSON.stringify([start,end,window.gpChartPreferences?.account?.(),[...roles],planningModes,[...excludedSlotTypes].sort(),assignments,groupUrgencyAssignments,consultAssignments,consultCategoryNames,typeof practiceSettings==='undefined'?null:practiceSettings,byId('dailyForecastHistory')?.value]);
 if(demandCache?.history===history&&demandCache.coverage===slotReportCoverage&&demandCache.key===key)return demandCache.result;
 const weeks=GPCorrectness.completeWeeks(slotReportCoverage,today,52).filter(week=>week>=start&&week<current);
 const demand=window.SessionBuilderPlanning.averageDemand(history,weeks,{monday:GPCorrectness.monday,classify:row=>{
  if(row.source==='signposting'||excludedSlotTypes.has(row.slot)||String(row.status||'').toLowerCase()!=='booked')return null;
  const name=capacityUrgencyCategory(row.slot),info=roles.get(name);if(!info||!window.SessionBuilderPlanning.isIncludedAppointmentType(name))return null;
  const kind=window.SessionBuilderPlanning.historicalCareKind(info.category,info.role,planningModes[name]);
  return kind?{kind,name}:null;
 }});
 if(demand)demand.eligiblePlannedTypes=[...roles].filter(([name,info])=>window.SessionBuilderPlanning.isIncludedAppointmentType(name)&&info.category==='plannedcare').map(([name])=>name);
 if(demand)demand.eligibleDailyTypes=[...roles].filter(([name,info])=>window.SessionBuilderPlanning.isIncludedAppointmentType(name)&&info.role==='urgent'&&info.category!=='homevisiting'&&planningModes[name]!=='weekly').map(([name])=>name);
 const forecast=window.getSessionBuilderUrgentForecast?.();
 if(demand&&forecast?.weeks?.length){
  const count=forecast.weeks.length;
  const projected=Object.fromEntries(forecast.dailyGroups.map(name=>[name,Array.from({length:5},(_,day)=>forecast.weeks.reduce((sum,week)=>sum+(week.daily[day][name]||0),0)/count)]));
  demand.urgentForecastDaily=Array.from({length:5},(_,day)=>Object.values(projected).reduce((sum,days)=>sum+days[day],0));
  demand.byType.sameDay=projected;
  demand.sameDay=[...demand.urgentForecastDaily];
  demand.weekly=forecast.weeks.reduce((sum,week)=>sum+Object.values(week.weekly).reduce((a,b)=>a+b,0),0)/count;
  demand.byType.weekly=Object.fromEntries(forecast.weeklyGroups.map(name=>[name,forecast.weeks.reduce((sum,week)=>sum+(week.weekly[name]||0),0)/count]));
  demand.types.sameDay=[...forecast.dailyGroups];demand.types.homeVisit=Object.keys(demand.byType.homeVisit);demand.types.weekly=[...forecast.weeklyGroups];demand.eligibleDailyTypes=[...forecast.dailyGroups];
 }
 const result={demand,start,end,weeks:weeks.length,forecast};demandCache={history,coverage:slotReportCoverage,key,result};return result;
}
let requirementsRun=0,requirementsSolving=false,requirementsRenderedKey=null,requirementsCurrentKey=null,requirementsHasPlan=false;
function setPlannerBusy(busy){
 requirementsSolving=busy;
 const button=byId('sessionBuilderResetPlanner'),spinner=byId('sessionBuilderSolveSpinner'),label=byId('sessionBuilderResetLabel'),root=byId('sessionBuilderRequirements');
 if(button)button.disabled=busy;if(spinner)spinner.hidden=!busy;if(label)label.textContent=busy?'Solving…':'Reset planner';root?.setAttribute('aria-busy',String(busy));
}
async function renderSessionRequirements(settings={}){
 const reset=settings.reset===true;
 const root=byId('sessionBuilderRequirements');if(!root)return;
 if(!canEditSessionBuilder()){root.hidden=true;return;}root.hidden=false;
 const history=readAverageDemand(),demand=history.demand;
 const format=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
 const fmt=value=>Number.isFinite(value)?format.format(value):'—';
 const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 const historyText=history.forecast?'Urgent need: average forecast for the next 26 weeks, excluding bank holiday weeks · '+history.forecast.weeks.length+' weeks used · '+(history.forecast.listAdjusted?'adjusted to current list size.':'list-size adjustment unavailable.')+' Routine, planned-care and home-visiting need use averages from the last 52 completed weeks ('+history.weeks+' complete covered weeks).':'Urgent forecast unavailable. Check report history and practice list-size settings.';
 const clinicianMap=Object.fromEntries(configuredClinicians().map(name=>[name,clinicianGroup(name)]));
 const configuredTypes=sessionBuilderTypes.map(row=>({...row,eligibleClinicians:selectedClinicians(row)}));
 const appointmentPools=Object.fromEntries(groupUrgencyNames.map(name=>{const category=appointmentCategoryFor(name).trim().toLowerCase(),mode=window.gpChartPreferences?.read()?.forecastPlanningModes?.[name];return [name,category==='home visiting'?'homeVisit':category==='planned care'?'planned':appointmentCalculationRole(name)==='routine'?'routine':category==='urgent care'?(mode==='weekly'?'weekly':'sameDay'):null];}));
 const wholeDayLimits=Object.fromEntries(Object.entries(sessionBuilderClinicianLimits).map(([name,limit])=>[name,{...limit,...(Array.isArray(limit.workingPattern)?{workingPattern:['Mon','Tue','Wed','Thu','Fri'].flatMap(day=>limit.workingPattern.some(period=>period.startsWith(day+' '))?[day+' AM',day+' PM']:[])}:{})}]));
 const dailyRules=typeof sessionBuilderRules==='undefined'?[]:sessionBuilderRules.map(rule=>({...rule,scope:rule.scope==='week'?'week':'day'}));
 const args=[configuredTypes,configuredModes(),[...configuredGroups(),'Uncategorised'],history.forecast?demand:null,dailyRules,{respectTypes:true,optimizeCost:true,clinicians:clinicianMap,clinicianLimits:wholeDayLimits,appointmentPools}];
 const key=JSON.stringify(args);requirementsCurrentKey=key;
 const solveStatus=byId('sessionBuilderSolveStatus');
 if(!reset&&(requirementsRenderedKey!==null||requirementsSolving)){
  if(!requirementsSolving&&solveStatus&&key!==requirementsRenderedKey)solveStatus.textContent='Settings or demand changed. Click Reset planner to recalculate.';
  return;
 }
 let estimate={rows:[],noPlan:true};
 const costLimits=args[5].clinicianLimits;
 if(reset){
  if(requirementsSolving)return;
  const run=++requirementsRun;args[5]={...args[5],solveRequest:run};
  setPlannerBusy(true);if(solveStatus)solveStatus.textContent='Solving planner — allowing up to 30 seconds…';
  try{estimate=await (window.SessionBuilderOptimisation?.estimateAsync?window.SessionBuilderOptimisation.estimateAsync(...args):window.SessionBuilderPlanning.estimateSessions(...args));}
  catch(error){estimate={rows:[],error:'Could not calculate workforce costs. Refresh the page and try again.'};}
  finally{if(run===requirementsRun)setPlannerBusy(false);}
  if(run!==requirementsRun||estimate.cancelled||!canEditSessionBuilder())return;
  if(!history.forecast)estimate.error='Urgent forecast unavailable. Check report history and practice list-size settings.';
  window.SessionBuilderDiagnostics?.render(estimate.diagnostics,estimate);
  if(estimate.error&&requirementsHasPlan){
   const warning=byId('sessionBuilderPlanWarning');if(warning){warning.hidden=false;warning.textContent='Reset unsuccessful: '+estimate.error+' The previous plan is retained and may not match the current settings.';}
   if(solveStatus)solveStatus.textContent='Reset failed — previous plan still shown. Click Reset planner to try again.';
   return;
  }
  requirementsRenderedKey=key;requirementsHasPlan=!estimate.error;
 }
 const unavailable=!!estimate.error||!!estimate.noPlan;
 if(unavailable)estimate.rows=configuredTypes.map(row=>({id:row.id,name:row.name,group:[...new Set((row.eligibleClinicians||[]).map(name=>clinicianMap[name]).filter(Boolean))].join(' · '),periods:{morning:[0,0,0,0,0],afternoon:[0,0,0,0,0]}}));
 byId('sessionBuilderHistory').textContent=historyText;
 if(solveStatus)solveStatus.textContent=estimate.noPlan?'Click Reset planner to calculate the plan.':key!==requirementsCurrentKey?'Settings changed during solving. Click Reset planner to apply them.':estimate.error?(estimate.errorCode==='TIMEOUT'?'Timed out before a verified plan was returned. Click Reset planner to try again.':'No plan found. Click Reset planner to try again.'):estimate.optimisationTimedOut?'Valid plan found; optimisation timed out. Minimum cost is not proven.':estimate.optimisationInterrupted?'Valid plan retained after optimisation stopped. Minimum cost is not proven.':'Planner solved. Click Reset planner to solve again.';
 const warning=byId('sessionBuilderPlanWarning');
 if(warning){
  const missing=estimate.unmetDemand||[],totals=new Map();
  for(const item of missing){const key=item.name+' ('+({sameDay:'daily urgent',homeVisit:'home visit',weekly:'weekly urgent',routine:'routine',planned:'planned care'}[item.pool]||item.pool)+')';totals.set(key,(totals.get(key)||0)+item.amount);}
  warning.hidden=!estimate.error&&!totals.size&&!estimate.optimisationTimedOut&&!estimate.optimisationInterrupted;
  warning.textContent=estimate.error?'Session plan unavailable: '+estimate.error:totals.size?'Incomplete plan — unmet demand: '+[...totals].map(([name,amount])=>name+' '+fmt(amount)+'/week').join(', ')+'. Check eligible clinicians, their working patterns and maximum sessions, appointment types and consultation-mode capacity. The tables below show the demand that could be allocated.':estimate.optimisationTimedOut?'Valid plan found; optimisation timed out. Showing the best verified plan returned. Minimum cost is not proven.':estimate.optimisationInterrupted?'Optimisation stopped. Showing the best verified plan returned. Minimum cost is not proven.':'';
 }
 const body=byId('sessionBuilderPlanBody');body.replaceChildren();
 function addCells(parent,label,values,group=''){
  const tr=document.createElement('tr'),heading=document.createElement('th');heading.scope='row';heading.textContent=label;
  if(group){const note=document.createElement('span');note.className='session-builder-plan-group';note.textContent=group;heading.append(note);}tr.append(heading);
  for(const value of values){const td=document.createElement('td');td.textContent=fmt(value);tr.append(td);}parent.append(tr);return tr;
 }
 function mergeSplit(target,split){for(const [name,value] of Object.entries(split||{}))target[name]=(target[name]||0)+value;return target;}
 function appendSplit(cell,split){
  const detail=document.createElement('span');detail.className='session-builder-appointment-split';
  for(const [name,value] of Object.entries(split||{}).sort((a,b)=>b[1]-a[1])){
   if(value<0.05)continue;const item=document.createElement('span');item.className='session-builder-split-item';item.style.color=urgencyGroupColour(name);item.textContent=name+' '+fmt(value);detail.append(item);
  }
  if(detail.children.length)cell.append(detail);
 }
 const money=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:0,maximumFractionDigits:2});
 const shareFormat=new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}),rowCosts=[];
 const currentClinicians=new Set(configuredClinicians());
 function renderCost(cell,cost){
  cell.className='session-builder-workforce-cost';
  cell.textContent=cost.complete?money.format(cost.pence/100):'Incomplete';
  const detail=document.createElement('span');detail.className='session-builder-cost-detail';
  if(!cost.complete){const known=document.createElement('span');known.textContent='Known cost: '+money.format(cost.pence/100);detail.append(known);}
  for(const part of cost.parts){
   const line=document.createElement('span');line.textContent=part.name+' · '+shareFormat.format(part.sessions)+' sessions/week · '+(part.missing?'rate needed':money.format(part.pence/100)+'/year');detail.append(line);
  }
  if(cost.unassigned){const line=document.createElement('span');line.textContent='Choose eligible clinician types';detail.append(line);}
  cell.append(detail);
 }
 const grandSplit={};
 for(const row of estimate.rows){
  const cells=[];for(let day=0;day<5;day++)cells.push(unavailable?null:row.periods.morning[day]+row.periods.afternoon[day]);
  const rowSplit={};if(!unavailable)for(let day=0;day<5;day++)for(const period of ['morning','afternoon'])mergeSplit(rowSplit,estimate.appointmentBreakdown?.[row.id]?.[day]?.[period]);
  mergeSplit(grandSplit,rowSplit);
  const appointmentTotal=Object.values(rowSplit).reduce((sum,value)=>sum+value,0);
  const tr=addCells(body,row.name,[...cells,null,unavailable?null:cells.reduce((a,b)=>a+b,0),unavailable?null:appointmentTotal],row.group||'Choose eligible clinicians');
  if(!unavailable){
   for(let day=0;day<5;day++){
    const split={};for(const period of ['morning','afternoon'])mergeSplit(split,estimate.appointmentBreakdown?.[row.id]?.[day]?.[period]);
    appendSplit(tr.children[1+day],split);
   }
   appendSplit(tr.children[8],rowSplit);
   const definition=configuredTypes.find(type=>type.id===row.id);
   const eligible=(definition?.eligibleClinicians||[]).filter(name=>currentClinicians.has(name));
   const cost=estimate.costOptimised?window.SessionBuilderCosting.allocated(estimate.placements,row.id,costLimits):window.SessionBuilderCosting.equalSplit(cells.reduce((a,b)=>a+b,0),eligible,costLimits);
   rowCosts.push(cost);renderCost(tr.children[6],cost);
  }
 }
 if(!estimate.rows.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=9;cell.textContent='Add session types above to calculate the requirement.';row.append(cell);body.append(row);}
 const foot=byId('sessionBuilderPlanFoot');foot.replaceChildren();
 const totals=[];for(let day=0;day<5;day++)totals.push(unavailable?null:estimate.rows.reduce((sum,row)=>sum+row.periods.morning[day]+row.periods.afternoon[day],0));
 const totalAppointments=Object.values(grandSplit).reduce((sum,value)=>sum+value,0);
 const totalRow=addCells(foot,'Total',[...totals,null,unavailable?null:totals.reduce((a,b)=>a+b,0),unavailable?null:totalAppointments]);
 if(!unavailable){appendSplit(totalRow.children[8],grandSplit);renderCost(totalRow.children[6],window.SessionBuilderCosting.total(rowCosts));}
 const summary=byId('sessionBuilderCapacityBody');summary.replaceChildren();
 const capacityRow=(label,daily,weekly,{home=false,provided=false}={})=>{
  const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=label;tr.className=home?'capacity-home':'';if(home&&!provided)tr.className+=' capacity-visits-start';if(provided)tr.className+=' capacity-provided';th.className='capacity-label';tr.append(th);
  daily.forEach((value,index)=>{
   const td=document.createElement('td');td.textContent=fmt(value);
   td.className='capacity-day-end';
   if(index===4)td.className+=' capacity-daily-last';
   tr.append(td);
  });
  weekly.forEach(value=>{const td=document.createElement('td');td.className='capacity-weekly';td.textContent=fmt(value);tr.append(td);});
  summary.append(tr);return tr;
 };
 const dailyNeed=history.forecast?demand?.urgentForecastDaily||Array(5).fill(null):Array(5).fill(null);
 capacityRow('Appointments needed',dailyNeed,[history.forecast?demand?.weekly:null,demand?.routine,demand?.planned]);
 const providedDays=unavailable?Array(5).fill(null):estimate.capacitySameDay||Array(5).fill(null);
 capacityRow('Appointments provided',providedDays,[unavailable?null:estimate.weeklyCapacity,unavailable?null:estimate.routineCapacity,unavailable?null:estimate.plannedCapacity],{provided:true});
 capacityRow('Home visits needed',demand?.homeVisit||Array(5).fill(null),[null,null,null],{home:true});
 capacityRow('Home visits provided',unavailable?Array(5).fill(null):estimate.capacityHomeVisit||Array(5).fill(null),[null,null,null],{home:true,provided:true});
 const normal=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const [key,pool,preferred,fallback] of [['daily','sameDay','sameday','#e94e70'],['weekly','weekly','within3days','#d9b425'],['routine','routine','routine','#76b79e'],['planned','planned','followup','#aab8cb'],['home','homeVisit','visit','#efc0a6']]){
  const names=Object.keys(appointmentPools).filter(name=>appointmentPools[name]===pool),name=names.find(name=>normal(name)===preferred)||names[0];
  root.style?.setProperty?.('--capacity-'+key,name&&typeof urgencyGroupColour==='function'?urgencyGroupColour(name):fallback);
 }
 const shareSummary=(estimate.ruleResults||[]).filter(result=>result.kind==='share'&&result.strength==='must'&&result.appointmentPool==='urgent').map(result=>{const values=result.measurements.filter(m=>m.denominator>0).map(m=>m.numerator/m.denominator*100);return values.length?result.clinicianGroup+' urgent share '+fmt(Math.min(...values))+'–'+fmt(Math.max(...values))+'% ('+({atLeast:'at least',atMost:'at most',exact:'exactly'}[result.comparison]||'at least')+' '+fmt(result.minimum)+'%)':result.clinicianGroup+' urgent share has no appointments to measure';});
 const clinicianSummary=Object.entries(estimate.clinicianCounts||{}).filter(([,count])=>count>0).map(([name,count])=>name+': '+count).join(' · ');
 const caption=byId('sessionBuilderPlanStatus');
 caption.textContent=estimate.noPlan?'Click Reset planner to calculate a costed session plan.':estimate.error||('Sessions are allocated to minimise annual workforce cost. Costs use the clinician types actually assigned. Sessions may contain a mix of eligible appointment types. Small coloured figures show planned appointment slots by type; daily urgent slots use the forecast appointment mix. Same-day urgent demand is pooled; eligible daily urgent sessions can contribute. Planned care demand is pooled; any session eligible for a planned-care appointment type can cover it. Other demand is assigned to eligible sessions. Weekly clinician minimums, maximums, working patterns and required planning rules are enforced. Productive appointment capacity is combined across matching sessions before rounding down after leave and sickness; allocations round fractional need up. Predicted need remains an average. Session counts and costs are contracted weekly commitments. Every productive slot in a selected session is allocated to an eligible appointment type. Provision may exceed predicted need.'+(clinicianSummary?' Clinician sessions/week: '+clinicianSummary+'.':'')+(estimate.plannedCapacity>0?' Planned care slots: '+fmt(estimate.plannedCapacity)+' per week.':'')+(estimate.unassignedDailyTypes?.length?' No session is eligible for '+estimate.unassignedDailyTypes.join(', ')+': their forecast remains in pooled urgent need but no slots are labelled for those types.':'')+(shareSummary.length?' '+shareSummary.join('; ')+'.':'')+(estimate.ruleAdjusted?' Clinician-share rules use a feasible estimate; the session count may not be minimal.':'')+(estimate.approximate?' The displayed plan meets the checked constraints, but the solver has not proven that its cost is the lowest possible.':'')+(estimate.ruleResults?.length?' Required rules checked: '+estimate.ruleResults.filter(r=>r.strength==='must').length+'. Preferences not met: '+estimate.ruleResults.filter(r=>r.strength==='prefer'&&!r.ok).length+'.':''));
}
function renderSessionBuilder(){
 const page=byId('sessionBuilderPage'),body=byId('sessionBuilderBody');if(!page||!body)return;
 if(!canEditSessionBuilder()){page.classList.add('hidden');body.replaceChildren();return;}
 window.syncSessionBuilderSettings();
 const modes=configuredModes(),head=byId('sessionBuilderHead');head.replaceChildren();
 for(const label of ['Session type','Eligible clinicians','Appointment types',...modes,'Actions']){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
 byId('sessionBuilderTable').style.minWidth=Math.max(950,800+modes.length*120)+'px';
 byId('sessionBuilderModeNotice').hidden=modes.length>0;
 body.replaceChildren();
 for(const row of sessionBuilderTypes){
  const tr=document.createElement('tr');tr.dataset.sessionId=row.id;
  const nameCell=document.createElement('td'),name=document.createElement('input');name.type='text';name.value=row.name;name.maxLength=120;name.required=true;name.className='session-builder-name';name.setAttribute('aria-label','Session type '+row.name);
  name.addEventListener('input',()=>name.setCustomValidity(''));
  name.addEventListener('change',()=>{try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,name:name.value.trim()}:item));name.value=name.value.trim();name.setCustomValidity('');renderSessionBuilder();}catch(error){name.setCustomValidity(error.message);name.reportValidity();}});
  nameCell.append(name);tr.append(nameCell);
  const eligibleCell=document.createElement('td'),clinicianDropdown=document.createElement('details'),clinicianSummary=document.createElement('summary'),clinicianOptions=document.createElement('div');
  clinicianDropdown.className='session-builder-appointment-dropdown';clinicianOptions.className='session-builder-appointment-options';
  const allClinicians=configuredClinicians(),selected=new Set(selectedClinicians(row));
  const updateClinicians=()=>{const count=allClinicians.filter(name=>selected.has(name)).length;clinicianSummary.textContent=count===0?'Choose clinicians':count===1?[...selected].find(name=>allClinicians.includes(name)):count+' clinicians selected';};
  updateClinicians();clinicianSummary.setAttribute('aria-label','Eligible clinicians for '+row.name);clinicianDropdown.append(clinicianSummary);
  for(const group of [...configuredGroups(),'Uncategorised']){
   const members=allClinicians.filter(name=>clinicianGroup(name)===group);if(!members.length)continue;
   const heading=document.createElement('strong');heading.className='session-builder-clinician-group-heading';heading.textContent=group;clinicianOptions.append(heading);
   for(const type of members){
    const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=selected.has(type);text.textContent=type;
    checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(type);else selected.delete(type);try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,eligibleClinicians:[...selected]}:item));updateClinicians();}catch(error){checkbox.checked=!checkbox.checked;if(checkbox.checked)selected.add(type);else selected.delete(type);byId('sessionBuilderSaveStatus').textContent=error.message;}});
    label.append(checkbox,text);clinicianOptions.append(label);
   }
  }
  if(!allClinicians.length){const note=document.createElement('span');note.textContent='Add clinician types in People settings.';clinicianOptions.append(note);}
  clinicianDropdown.append(clinicianOptions);eligibleCell.append(clinicianDropdown);tr.append(eligibleCell);
  const appointmentCell=document.createElement('td'),dropdown=document.createElement('details'),summary=document.createElement('summary'),options=document.createElement('div');
  dropdown.className='session-builder-appointment-dropdown';options.className='session-builder-appointment-options';
  const appointmentTypes=configuredAppointmentTypes();
  let appointmentSelected=new Set(Array.isArray(row.appointmentTypes)?row.appointmentTypes:appointmentTypes);
  const updateSummary=()=>{const count=appointmentTypes.filter(type=>appointmentSelected.has(type)).length;summary.textContent=!appointmentTypes.length?'No appointment types':count===appointmentTypes.length?'All appointment types':count===0?'No appointment types selected':count+' selected';};
  updateSummary();summary.setAttribute('aria-label','Appointment types for '+row.name);dropdown.append(summary);
  for(const type of appointmentTypes){
   const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=appointmentSelected.has(type);text.textContent=type;
   checkbox.addEventListener('change',()=>{if(checkbox.checked)appointmentSelected.add(type);else appointmentSelected.delete(type);try{commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,appointmentTypes:[...appointmentSelected]}:item));updateSummary();}catch(error){checkbox.checked=!checkbox.checked;if(checkbox.checked)appointmentSelected.add(type);else appointmentSelected.delete(type);byId('sessionBuilderSaveStatus').textContent=error.message;}});
   label.append(checkbox,text);options.append(label);
  }
  if(!appointmentTypes.length){const note=document.createElement('span');note.textContent='Add appointment types in Slot settings.';options.append(note);}
  dropdown.append(options);appointmentCell.append(dropdown);tr.append(appointmentCell);
  for(const mode of modes){
   const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.required=true;input.inputMode='numeric';input.value=String(row.appointmentsByMode[mode]??0);input.className='session-builder-count';input.setAttribute('aria-label',mode+' appointments for '+row.name);
   input.addEventListener('input',()=>{input.setCustomValidity('');const value=Number(input.value);if(/^\d+$/.test(input.value)&&Number.isSafeInteger(value))commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,appointmentsByMode:{...item.appointmentsByMode,[mode]:value}}:item));});
   input.addEventListener('change',()=>{try{const value=Number(input.value);if(!/^\d+$/.test(input.value)||!Number.isSafeInteger(value))throw Error('Enter a whole number of zero or more.');if(sessionBuilderTypes.find(item=>item.id===row.id)?.appointmentsByMode[mode]!==value)commit(sessionBuilderTypes.map(item=>item.id===row.id?{...item,appointmentsByMode:{...item.appointmentsByMode,[mode]:value}}:item));input.setCustomValidity('');}catch(error){input.setCustomValidity(error.message);input.reportValidity();}});
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
byId('sessionBuilderResetPlanner')?.addEventListener('click',()=>canEditSessionBuilder()?renderSessionRequirements({reset:true}):undefined);
byId('navSessionBuilder')?.addEventListener('click',()=>{if(canEditSessionBuilder())showPage('sessionBuilder');});
byId('sessionBuilderAddForm')?.addEventListener('submit',event=>{
 event.preventDefault();if(!canEditSessionBuilder())return;
 const input=byId('sessionBuilderNewType');input.setCustomValidity('');
 try{commit([...sessionBuilderTypes,{id:crypto.randomUUID(),name:input.value.trim(),appointmentsByMode:Object.fromEntries(configuredModes().map(mode=>[mode,0])),clinicianTypes:[],eligibleClinicians:[]}]);input.value='';renderSessionBuilder();input.focus();}
 catch(error){input.setCustomValidity(error.message);input.reportValidity();}
});
byId('sessionBuilderNewType')?.addEventListener('input',event=>event.target.setCustomValidity(''));
})();
