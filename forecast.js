(function(){
const $=id=>document.getElementById(id);
function forecastLocalDate(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return p.year+'-'+p.month+'-'+p.day;
}

const yearStyles=document.createElement('style');yearStyles.textContent='.forecast-year-band{position:absolute;top:0;bottom:0;background:rgba(70,115,155,.035);border-left:1px solid #d0dae5;pointer-events:none;z-index:0}.forecast-year-alt{background:rgba(70,115,155,.1)}.forecast-year-band span{position:absolute;top:2px;left:8px;font-size:12px;font-weight:bold;color:#526f86}.forecast-history-column{position:relative;z-index:1}.forecast-season-line{z-index:3}.forecast-prediction-band{fill-opacity:.12}';yearStyles.textContent+='.forecast-stacked-bar{display:flex;flex-direction:column-reverse;overflow:hidden;background:transparent!important}.forecast-bar-segment{width:100%;flex-shrink:0;min-height:0} .forecast-y-axis{position:sticky;left:0;top:0;width:0;align-self:stretch;z-index:5;pointer-events:none}.forecast-y-tick{position:absolute;left:0;transform:translateY(-50%);display:block;min-width:34px;padding:2px 4px;background:rgba(255,255,255,.88);font-size:10px;text-align:right;color:#47647b;font-variant-numeric:tabular-nums}';document.head.append(yearStyles);
const shift=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const monday=d=>shift(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));
const isDaily=n=>appointmentCalculationRole(n)==='urgent';
const disabled={daily:new Set(),weekly:new Set()};
const urgencyPlanningMode=new Map();
let forecastPreferenceAccount=null;
function syncForecastPreferences(){
 const api=window.gpChartPreferences,account=api?.account();if(!account||account===forecastPreferenceAccount)return;
 forecastPreferenceAccount=account;urgencyPlanningMode.clear();disabled.daily.clear();disabled.weekly.clear();urgencyExplicitlyEnabled.clear();
 const saved=api.read();
 for(const [name,mode] of Object.entries(saved.forecastPlanningModes||{}))if(mode==='daily'||mode==='weekly')urgencyPlanningMode.set(name,mode);
 for(const [name,enabled] of Object.entries(saved.forecastEnabledGroups||{})){
  if(enabled){if(!isDaily(name))urgencyExplicitlyEnabled.add(name)}
  else disabled.daily.add(name);
 }
}
function saveForecastPreferences(){
 const api=window.gpChartPreferences;if(!api?.account())return;
 const modes=Object.fromEntries(urgencyPlanningMode),enabled={};
 for(const name of forecastUrgencyNames())enabled[name]=forecastUrgencyEnabled(name);
 api.write('forecastPlanningModes',modes);api.write('forecastEnabledGroups',enabled);
}
function render(mode){
 syncForecastPreferences();
const prefix=mode==='daily'?'dailyForecast':'weeklyForecast',root=$(prefix+'Chart'),filter=$(prefix+'Filters');if(!root||!filter)return;
const names=prioritySort('urgency',groupUrgencyNames.filter(isDashboardToggleOption)).filter(n=>isDaily(n)===(mode==='daily'));
if(filter.dataset.names!==names.join('|')){filter.dataset.names=names.join('|');filter.replaceChildren();for(const n of names){const row=document.createElement('label');row.className='filter-row';const sw=document.createElement('span');sw.className='switch';const inp=document.createElement('input');inp.type='checkbox';inp.checked=!disabled[mode].has(n);const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',urgencyGroupColour(n));sw.append(inp,track);row.append(sw,document.createTextNode(n));filter.append(row);inp.addEventListener('change',()=>{inp.checked?disabled[mode].delete(n):disabled[mode].add(n);scheduleForecastFilterRefresh(mode)})}}
root.replaceChildren();if(!records.length){root.textContent='Load appointment data to generate a forecast.';return}
const selected=names.filter(n=>!disabled[mode].has(n));if(!selected.length){root.textContent='Select at least one Appointment Types.';return}
const today=forecastLocalDate(),latest=records.reduce((x,r)=>r.bookedDay&&r.bookedDay>x?r.bookedDay:x,'');
const end=latest&&latest<today?latest:shift(today,-1),weeks=Number($(prefix+'History').value),start=shift(end,1-weeks*7);
const byDate=new Map(),allDates=new Set();
for(const r of records){if(!r.bookedDay||r.bookedDay>end||excludedSlotTypes.has(r.slot))continue;allDates.add(r.bookedDay);const n=capacityUrgencyCategory(r.slot);if(!selected.includes(n))continue;const k=r.bookedDay+'|'+n;byDate.set(k,(byDate.get(k)||0)+r.count)}
const earliest=[...allDates].sort()[0]||start;
const dates=[];for(let d=earliest;d<=end;d=shift(d,1))dates.push(d);
const recentDays=dates.filter(d=>d>=start);
const fullWeeks=[];for(let d=monday(start);d<=end;d=shift(d,7))if(d>=start&&shift(d,6)<=end)fullWeeks.push(d);
const dayOfWeek=d=>new Date(d+'T12:00:00Z').getUTCDay();
const yearPosition=d=>{const dt=new Date(d+'T12:00:00Z');const year=dt.getUTCFullYear();return (Date.UTC(year,dt.getUTCMonth(),dt.getUTCDate())-Date.UTC(year,0,1))/86400000};
const seasonDistance=(a,b)=>{const diff=Math.abs(yearPosition(a)-yearPosition(b));return Math.min(diff,365-diff)};
const ageDays=d=>(Date.parse(end+'T12:00:00Z')-Date.parse(d+'T12:00:00Z'))/86400000;
const weightedMean=(values,weights)=>{const sum=weights.reduce((a,b)=>a+b,0);return sum?values.reduce((a,v,i)=>a+v*weights[i],0)/sum:0};
const weightedQuantile=(values,weights,q)=>{const pairs=values.map((v,i)=>[v,weights[i]]).sort((a,b)=>a[0]-b[0]);const total=weights.reduce((a,b)=>a+b,0);let cumulative=0;for(const [v,w] of pairs){cumulative+=w;if(cumulative>=q*total)return v}return pairs.length?pairs[pairs.length-1][0]:0};
const predictCategory=(target,n)=>{
 const weekday=dayOfWeek(target);
 const candidates=dates.filter(d=>d>=start&&dayOfWeek(d)===weekday);
 const values=candidates.map(d=>byDate.get(d+'|'+n)||0);
 if(!values.length)return {n,mean:0,low:0,high:0,samples:0};
 const recentWeights=candidates.map(d=>Math.exp(-ageDays(d)/Math.max(35,weeks*3.5)));
 const baseline=weightedMean(values,recentWeights);
 if(mode!=='daily'){
  const weekly=fullWeeks.map(w=>Array.from({length:7},(_,j)=>byDate.get(shift(w,j)+'|'+n)||0).reduce((a,b)=>a+b,0));
  const mean=weekly.length?weekly.reduce((a,b)=>a+b,0)/weekly.length:0;
  const sorted=[...weekly].sort((a,b)=>a-b);
  return {n,mean,low:sorted[Math.floor((sorted.length-1)*.1)]||0,high:sorted[Math.ceil((sorted.length-1)*.9)]||0,samples:weekly.length};
 }
 // Seasonal factor uses same-weekday observations from all available years, including prior years.
 // A 45-day seasonal bandwidth avoids spurious month-boundary jumps.
 const seasonalDays=dates.filter(d=>dayOfWeek(d)===weekday);
 const seasonalValues=seasonalDays.map(d=>byDate.get(d+'|'+n)||0);
 const seasonalWeights=seasonalDays.map(d=>Math.exp(-.5*(seasonDistance(d,target)/45)**2));
 const seasonalEffective=(seasonalWeights.reduce((a,b)=>a+b,0)**2)/(seasonalWeights.reduce((a,b)=>a+b*b,0)||1);
 const seasonMean=weightedMean(seasonalValues,seasonalWeights);
 const globalMean=seasonalValues.reduce((a,b)=>a+b,0)/seasonalValues.length;
 // Shrink the seasonal adjustment toward neutral when comparable historical data are sparse.
 const seasonalStrength=Math.min(.65,Math.max(0,(seasonalEffective-3)/(seasonalEffective+8)));
 const factor=globalMean>0?Math.max(.65,Math.min(1.5,1+seasonalStrength*(seasonMean/globalMean-1))):1;
 // A modest trend term compares the newer and older halves of the recent window.
 const half=Math.floor(candidates.length/2),old=values.slice(0,half),newer=values.slice(half);
 const olderAvg=old.length?old.reduce((a,b)=>a+b,0)/old.length:baseline;
 const newerAvg=newer.length?newer.reduce((a,b)=>a+b,0)/newer.length:baseline;
 const trend=olderAvg>0?Math.max(.85,Math.min(1.15,1+.25*(newerAvg/olderAvg-1))):1;
 const mean=Math.max(0,baseline*factor*trend);
 // Weighted residual quantiles: indicative 70% prediction interval, widened for sparse data.
 const residuals=values.map(v=>v-baseline);
 const lo=weightedQuantile(residuals,recentWeights,.1),hi=weightedQuantile(residuals,recentWeights,.9);
 const spread=Math.sqrt(Math.max(mean,1))*1.28;
 const low=Math.max(0,mean+Math.min(lo,-spread)*Math.max(1,Math.sqrt(8/values.length)));
 const high=Math.max(mean,mean+Math.max(hi,spread)*Math.max(1,Math.sqrt(8/values.length)));
 return {n,mean,low,high,samples:values.length,seasonFactor:factor};
};
const rows=[];for(let i=0;i<(mode==='daily'?14:8);i++){
 const day=mode==='daily'?shift(end,i+1):shift(monday(end),7*(i+1));
 const parts=selected.map(n=>predictCategory(day,n));
 rows.push({day,parts,total:parts.reduce((x,p)=>x+p.mean,0),low:parts.reduce((x,p)=>x+p.low,0),high:parts.reduce((x,p)=>x+p.high,0)});
}
const legend=document.createElement('div');legend.className='forecast-legend';for(const n of selected){const item=document.createElement('span');const dot=document.createElement('i');dot.className='forecast-dot';dot.style.backgroundColor=urgencyGroupColour(n);item.append(dot,document.createTextNode(n));legend.append(item)}root.append(legend);
const max=Math.max(1,...rows.map(r=>r.high));for(const r of rows){const line=document.createElement('div');line.className='forecast-line';const label=document.createElement('span');label.textContent=new Date(r.day+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:mode==='daily'?'short':undefined,day:'numeric',month:'short',timeZone:'UTC'});const track=document.createElement('div');track.className='forecast-track';for(const p of r.parts){const seg=document.createElement('div');seg.style.width=(100*p.mean/max)+'%';seg.style.backgroundColor=urgencyGroupColour(p.n);seg.title=p.n+': '+p.mean.toFixed(1);track.append(seg)}const value=document.createElement('strong');value.textContent=Math.round(r.total).toLocaleString('en-GB');value.title='Indicative 70% prediction interval: '+Math.round(r.low)+'–'+Math.round(r.high);const bounds=document.createElement('span');bounds.className='forecast-bounds';bounds.textContent=Math.round(r.low)+'–'+Math.round(r.high);bounds.title='Indicative 70% prediction interval';const numbers=document.createElement('div');numbers.className='forecast-numbers';numbers.append(value,bounds);line.append(label,track,numbers);root.append(line)}
const note=document.createElement('p');note.className='muted';note.textContent='Historical booking data to '+end+'. '+(mode==='daily'?'Daily forecast combines recency-weighted weekday averages, a season-of-year adjustment where historical coverage permits, and a restrained recent trend. The smaller figures are indicative 70% prediction intervals, estimated from historical variation; these are not calibrated confidence guarantees.':'Weekly forecasts use complete historical Monday–Sunday weeks; the smaller figures show an indicative historical 10th–90th percentile range.')+' Zero-booking days included. Bank holidays and changes in service provision are not explicitly modelled.';root.append(note);
}
function forecastUrgencyNames(){return prioritySort('urgency',groupUrgencyNames.filter(isDashboardToggleOption))}
function forecastUrgencyEnabled(name){return !disabled.daily.has(name)&&(isDaily(name)||urgencyExplicitlyEnabled.has(name))}
const urgencyExplicitlyEnabled=new Set();
let forecastFilterRefreshTimer=null;
function scheduleForecastFilterRefresh(mode){
 clearTimeout(forecastFilterRefreshTimer);
 forecastFilterRefreshTimer=setTimeout(()=>{
  forecastFilterRefreshTimer=null;
  if(mode==='weekly')render('weekly');
  else renderHistoricalWeekday();
 },140);
}
function setForecastUrgencyEnabled(name,enabled){
 if(enabled){disabled.daily.delete(name);if(!isDaily(name))urgencyExplicitlyEnabled.add(name)}
 else{disabled.daily.add(name);urgencyExplicitlyEnabled.delete(name)}
 saveForecastPreferences();
 scheduleForecastFilterRefresh('daily');
}
function renderDailyUrgencyFilters(){
 const root=$('dailyForecastFilters');if(!root)return;
 const names=forecastUrgencyNames();
 const existing=[...root.querySelectorAll('input[data-forecast-name]')];
 if(existing.length===names.length&&names.every(name=>existing.some(input=>input.dataset.forecastName===name))){
  for(const input of existing){
   input.checked=forecastUrgencyEnabled(input.dataset.forecastName);
  }
  return;
 }
 root.replaceChildren();
 for(const name of names){
  const label=document.createElement('label');label.className='filter-row';
  const sw=document.createElement('span');sw.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.dataset.forecastName=name;input.checked=forecastUrgencyEnabled(name);
  const track=document.createElement('span');track.className='switch-track';track.style.setProperty('--switch-on',urgencyGroupColour(name));
  sw.append(input,track);label.append(sw,document.createTextNode(name));root.append(label);
  input.addEventListener('change',()=>setForecastUrgencyEnabled(name,input.checked));
 }
}
function renderUrgencyPlanningModes(){
 const root=$('dailyForecastModeControls');if(!root)return;
 root.replaceChildren();
 for(const name of forecastUrgencyNames().filter(forecastUrgencyEnabled)){
  const row=document.createElement('div');row.className='forecast-mode-row';
  const heading=document.createElement('span');heading.className='forecast-mode-name';const dot=document.createElement('i');dot.className='forecast-mode-colour-dot';dot.style.backgroundColor=urgencyGroupColour(name);dot.setAttribute('aria-hidden','true');heading.append(dot,document.createTextNode(name));
  const switchLabel=document.createElement('div');switchLabel.className='forecast-basis-switch';
  const daily=document.createElement('span');daily.textContent='Daily';
  const control=document.createElement('span');control.className='switch';
  const input=document.createElement('input');input.type='checkbox';
  input.setAttribute('role','switch');
  input.checked=urgencyPlanningMode.get(name)==='weekly';
  input.setAttribute('aria-label',name+': weekly totals when on, daily totals when off');
  const track=document.createElement('span');track.className='switch-track';
  control.append(input,track);
  const weekly=document.createElement('span');weekly.textContent='Weekly';
  switchLabel.append(daily,control,weekly);
  input.addEventListener('change',()=>{urgencyPlanningMode.set(name,input.checked?'weekly':'daily');saveForecastPreferences();renderHistoricalWeekday()});
  enhanceTimeGroupingToggle(switchLabel);
  row.append(heading,switchLabel);root.append(row);
 }
}
function forecastHorizonWeeks(){
 const value=Number($('dailyForecastHorizon')?.value??14);
 return Number.isFinite(value)?Math.min(14,Math.max(3,Math.round(value))):14;
}
function updateForecastHorizonLabels(){
 const weeks=forecastHorizonWeeks();
 $('dailyForecastHorizon')?.style.setProperty('--forecast-horizon-progress',String((weeks-3)/11*100)+'%');
 const title=$('dailyForecastHorizonTitle'),value=$('dailyForecastHorizonValue');
 if(title)title.textContent=String(weeks);
 if(value)value.textContent=String(weeks);
}
let forecastSuggestionRows=[],forecastSuggestionBody=null;
const forecastRenderCache={predictions:null,analytics:null};
function applyForecastHorizon(){
 if(!forecastSuggestionBody||!forecastSuggestionBody.isConnected)return false;
 forecastSuggestionBody.replaceChildren(...forecastSuggestionRows.slice(0,forecastHorizonWeeks()));return true;
}
function changeForecastHorizon(){
 updateForecastHorizonLabels();
 // Horizon changes reveal already calculated weeks; no CSV scan or model refit.
 if(!applyForecastHorizon())renderHistoricalWeekday();
}
function forecastHistoryPolicy(panel,selectedWeekday){
 // Suggestion models never inherit the day currently inspected in analytics.
 const weekday=panel==='analytics'?Number(selectedWeekday):1;
 const special=weekday===6||weekday===7;
 return {weekday,special,excludeHolidayWeeks:!special};
}
function renderHistoricalWeekday(){
 updateForecastHorizonLabels();
 syncForecastPreferences();
 const root=$('dailyForecastHistoryChart'),summary=$('dailyForecastHistorySummary'),select=$('dailyForecastWeekday');
 if(!root||!summary||!select)return;
 const panel=$('forecastAnalyticsPanel')?.classList.contains('hidden')?'predictions':'analytics';
 const {weekday,special,excludeHolidayWeeks}=forecastHistoryPolicy(panel,select.value);
 const signature=JSON.stringify([ensureAnalyticsRoles(),forecastLocalDate(),window.gpChartPreferences?.account?.(),$('dailyForecastHistory')?.value,panel==='analytics'?weekday:null,$('dailyForecastAdjustListSize')?.checked,forecastUrgencyNames().map(name=>[name,forecastUrgencyEnabled(name),urgencyPlanningMode.get(name)]),[...excludedSlotTypes].sort(),typeof assignments==='undefined'?null:assignments,typeof groupUrgencyAssignments==='undefined'?null:groupUrgencyAssignments,typeof practiceSettings==='undefined'?null:practiceSettings,panel==='analytics'?(root.parentElement.classList.contains('forecast-chart-frame')?root.parentElement.clientWidth:root.clientWidth):null]);
 const cached=forecastRenderCache[panel];
 if(cached?.records===records&&cached.signature===signature){if(panel==='predictions')applyForecastHorizon();return;}
 if(panel==='analytics')root.replaceChildren();renderDailyUrgencyFilters();renderUrgencyPlanningModes();
 const today=forecastLocalDate(),end=shift(today,-1);
 const earliestBooking=records.reduce((min,r)=>r.bookedDay&&(!min||r.bookedDay<min)?r.bookedDay:min,null);
 const start=special?(earliestBooking||shift(end,-365)):shift(end,1-7*Number($('dailyForecastHistory')?.value||52));
 const holidayDates=new Set();for(let year=Number((earliestBooking||start).slice(0,4))-1;year<=Number(end.slice(0,4))+6;year++)for(const holiday of englandWalesBankHolidays(year))holidayDates.add(holiday);
 const workingDay=d=>{const dow=new Date(d+'T12:00:00Z').getUTCDay();return dow>=1&&dow<=5&&!holidayDates.has(d)};
 const adjacentWorkingDay=(holiday,direction)=>{let d=shift(holiday,direction);while(!workingDay(d))d=shift(d,direction);return d};
 const eventDates=direction=>[...new Set([...holidayDates].map(h=>adjacentWorkingDay(h,direction)))].sort();
 const groups=forecastUrgencyNames().filter(forecastUrgencyEnabled);
 const adjust=$('dailyForecastAdjustListSize')?.checked===true;const populationMonths=adjust?practiceMonths():[];const referencePopulation=populationMonths.length?listSizeAtMonth(populationMonths[populationMonths.length-1]):null;
 const populationCache=new Map();const normalise=(day,count)=>{if(!adjust||!referencePopulation)return count;const month=day.slice(0,7);if(!populationCache.has(month))populationCache.set(month,listSizeAtMonth(month));return count*referencePopulation/Math.max(1,populationCache.get(month))};
 const totals=new Map(),parts=new Map(),allWeekdayTotals=new Map();
 const selectedGroups=new Set(groups),weekdayByDate=new Map();
 for(const r of records){
  if(!r.bookedDay||r.bookedDay<(earliestBooking||start)||r.bookedDay>end||excludedSlotTypes.has(r.slot))continue;
  const urgency=capacityUrgencyCategory(r.slot);
  if(!selectedGroups.has(urgency))continue;
  if(!weekdayByDate.has(r.bookedDay))weekdayByDate.set(r.bookedDay,new Date(r.bookedDay+'T12:00:00Z').getUTCDay());
  const dow=weekdayByDate.get(r.bookedDay);if(dow>=1&&dow<=5)allWeekdayTotals.set(r.bookedDay,(allWeekdayTotals.get(r.bookedDay)||0)+(Number(r.count)||0));
  const k=r.bookedDay;
  totals.set(k,(totals.get(k)||0)+(Number(r.count)||0));
  if(!parts.has(k))parts.set(k,new Map());
  const detail=parts.get(k);detail.set(urgency,(detail.get(urgency)||0)+(Number(r.count)||0));
 }
 const holidayWeeks=new Set();if(excludeHolidayWeeks){for(let year=Number(start.slice(0,4))-1;year<=Number(end.slice(0,4))+1;year++)for(const holiday of englandWalesBankHolidays(year))holidayWeeks.add(monday(holiday))}
 const days=[];let skippedHolidayDays=0;
 if(special){for(const d of eventDates(weekday===6?-1:1))if(d>=start&&d<=end)days.push(d)}
 else for(let d=start;d<=end;d=shift(d,1))if(new Date(d+'T12:00:00Z').getUTCDay()===weekday){if(excludeHolidayWeeks&&holidayWeeks.has(monday(d))){skippedHolidayDays++;continue}days.push(d)}
 if(!records.length||!groups.length||!days.length){summary.textContent=!days.length?'No matching weekdays remain after excluding bank holiday weeks.':'No historical booking data or matching Appointment Types are available.';return}
 const values=days.map(d=>normalise(d,totals.get(d)||0));
 const average=values.reduce((a,b)=>a+b,0)/values.length;
 const sd=Math.sqrt(values.reduce((a,b)=>a+(b-average)**2,0)/values.length);
 const n=days.length, origin=Date.parse(days[0]+'T12:00:00Z');
 const tOf=d=>(Date.parse(d+'T12:00:00Z')-origin)/86400000/365.2425;
 const featureCache=new Map();
 const features=(d,harmonic)=>{const key=d+':'+harmonic;if(featureCache.has(key))return featureCache.get(key);const t=tOf(d),v=[1,t];if(harmonic)v.push(Math.cos(2*Math.PI*t),Math.sin(2*Math.PI*t));featureCache.set(key,v);return v};
 // Fit an annual harmonic plus linear trend where at least one year of observations is available.
 // Shorter windows use a trend-only model, avoiding a poorly identified seasonal cycle.
 function fitModel(xDays,y){
  const harmonic=!special&&xDays.length>=42,degree=harmonic?4:2;
  const m=Array.from({length:degree},()=>Array(degree+1).fill(0));
  for(let i=0;i<xDays.length;i++){const x=features(xDays[i],harmonic);for(let j=0;j<degree;j++){for(let k=0;k<degree;k++)m[j][k]+=x[j]*x[k];m[j][degree]+=x[j]*y[i]}}
  // Small ridge on the trend and harmonic coefficients stabilises short/noisy samples.
  for(let j=1;j<degree;j++)m[j][j]+=j===1?.02:.1;
  for(let i=0;i<degree;i++){let best=i;for(let j=i+1;j<degree;j++)if(Math.abs(m[j][i])>Math.abs(m[best][i]))best=j;[m[i],m[best]]=[m[best],m[i]];const pivot=m[i][i];if(Math.abs(pivot)<1e-9)return null;for(let k=i;k<=degree;k++)m[i][k]/=pivot;for(let j=0;j<degree;j++)if(j!==i){const factor=m[j][i];for(let k=i;k<=degree;k++)m[j][k]-=factor*m[i][k]}}
  const c=m.map(row=>row[degree]);return d=>Math.max(0,features(d,harmonic).reduce((sum,v,i)=>sum+v*c[i],0));
 }
 // Refit the same annual seasonal/trend model independently for each weekday.
 // The table uses a forward calendar horizon, not the last observed weekday plus three weeks.
 const needsRoot=$('dailyForecastNeedsTable');
 if(needsRoot&&!$('forecastPredictionsPanel')?.classList.contains('hidden')){
  needsRoot.replaceChildren();
  const nextMonday=shift(today,(8-new Date(today+'T12:00:00Z').getUTCDay())%7);
  const table=document.createElement('table');table.className='forecast-needs-table';
  const head=document.createElement('thead'),heading=document.createElement('tr');
  const dailyGroups=groups.filter(name=>(urgencyPlanningMode.get(name)||'daily')==='daily'),weeklyGroups=groups.filter(name=>urgencyPlanningMode.get(name)==='weekly');
  const hasWeekly=weeklyGroups.length>0;
  const colgroup=document.createElement('colgroup');
  const widths=hasWeekly?[14,12,12,12,12,12,13,13]:[16,14,14,14,14,14,14];
  for(const width of widths){const col=document.createElement('col');col.style.width=width+'%';colgroup.append(col)}
  table.append(colgroup);
  const groupHeader=document.createElement('tr');
  const blank=document.createElement('th');blank.className='forecast-needs-group-header';groupHeader.append(blank);
  const dailyHeader=document.createElement('th');dailyHeader.colSpan=5;dailyHeader.className='forecast-needs-group-header';dailyHeader.textContent='Daily targets based on: '+(dailyGroups.length?dailyGroups.join(', '):'None selected');groupHeader.append(dailyHeader);
  if(hasWeekly){const weeklyHeader=document.createElement('th');weeklyHeader.className='forecast-needs-group-header';weeklyHeader.textContent='Weekly allocation of: '+weeklyGroups.join(', ');groupHeader.append(weeklyHeader)}
  const totalHeader=document.createElement('th');totalHeader.className='forecast-needs-group-header';totalHeader.textContent='Total of all allocations';groupHeader.append(totalHeader);
  head.append(groupHeader);
  for(const name of ['Week beginning','Monday','Tuesday','Wednesday','Thursday','Friday',...(hasWeekly?['Weekly allocation']:[]),'Total']){
   const th=document.createElement('th');th.textContent=name;heading.append(th);
  }
  head.append(heading);table.append(head);
  const body=document.createElement('tbody');
  // Build the fitting calendar once, shared by every urgency and error calculation.
  const fittingDays=new Map(Array.from({length:5},(_,i)=>[i+1,[]]));
  for(let d=start;d<=end;d=shift(d,1)){
   const dow=new Date(d+'T12:00:00Z').getUTCDay();
   if(fittingDays.has(dow)&&!(excludeHolidayWeeks&&holidayWeeks.has(monday(d))))fittingDays.get(dow).push(d);
  }
  const forecasts=new Map();
  for(const name of groups){
   const byWeekday=new Map();
   for(let dow=1;dow<=5;dow++){
    const sampleDays=fittingDays.get(dow);
    const sampleValues=sampleDays.map(d=>normalise(d,(parts.get(d)||new Map()).get(name)||0));
    byWeekday.set(dow,sampleDays.length>=12?fitModel(sampleDays,sampleValues):null);
   }
   forecasts.set(name,byWeekday);
  }
  // Holiday-adjacent forecasts use every available working-day observation, irrespective
  // of the normal historical window and automatic bank-holiday-week exclusions.
  const adjacentTypes=new Map();
  for(const d of eventDates(-1))adjacentTypes.set(d,'before');
  for(const d of eventDates(1))if(!adjacentTypes.has(d))adjacentTypes.set(d,'after');
  const specialForecasts=new Map(),specialErrors=new Map();
  const quantileNeeds=(numbers,p)=>{if(!numbers.length)return 0;const sorted=[...numbers].sort((a,b)=>a-b),pos=(sorted.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo)};
  for(const type of ['before','after']){
   const sampleDays=[...adjacentTypes].filter(([d,t])=>t===type&&d>=(earliestBooking||start)&&d<=end).map(([d])=>d);
   const byGroup=new Map();
   for(const name of groups){
    const vals=sampleDays.map(d=>normalise(d,(parts.get(d)||new Map()).get(name)||0));
    // Sparse annual holiday events do not support reliable extrapolated linear trends.
    // Use a recency-weighted historical level instead; avoid unstable near-zero forecasts.
    const weights=sampleDays.map(d=>Math.exp(-Math.max(0,(Date.parse(end+'T12:00:00Z')-Date.parse(d+'T12:00:00Z'))/86400000)/(365.2425*3)));
    const weightSum=weights.reduce((a,b)=>a+b,0);
    const level=weightSum?vals.reduce((sum,v,i)=>sum+v*weights[i],0)/weightSum:undefined;
    byGroup.set(name,level===undefined?null:()=>Math.max(0,level));
   }
   specialForecasts.set(type,byGroup);
   const errors=[];
   for(const d of sampleDays){
    const estimates=dailyGroups.map(name=>byGroup.get(name)?.(d));
    if(estimates.some(v=>v==null))continue;
    const observed=dailyGroups.reduce((sum,name)=>sum+normalise(d,(parts.get(d)||new Map()).get(name)||0),0);
    errors.push(observed-estimates.reduce((a,b)=>a+b,0));
   }
   specialErrors.set(type,[quantileNeeds(errors,.15),quantileNeeds(errors,.85)]);
  }
  const predict=(name,dow,day)=>{const type=adjacentTypes.get(day);return type?(specialForecasts.get(type)?.get(name)?.(day)??undefined):forecasts.get(name)?.get(dow)?.(day)};
  // Empirical 70% uncertainty from the residuals of each day's combined selected groups.
  const dailyErrors=new Map();
  for(let dow=1;dow<=5;dow++){
   const errors=[];
   for(const d of fittingDays.get(dow)){
    const estimates=dailyGroups.map(name=>forecasts.get(name)?.get(dow)?.(d));
    if(estimates.some(v=>v===undefined))continue;
    const observed=dailyGroups.reduce((sum,name)=>sum+normalise(d,(parts.get(d)||new Map()).get(name)||0),0);
    errors.push(observed-estimates.reduce((sum,v)=>sum+v,0));
   }
   dailyErrors.set(dow,[quantileNeeds(errors,.15),quantileNeeds(errors,.85)]);
  }
  const weeklyErrors=[];
  if(weeklyGroups.length){
   for(let w=monday(start);shift(w,6)<=end;w=shift(w,7)){
    if(excludeHolidayWeeks&&holidayWeeks.has(w))continue;
    let observed=0,estimated=0,valid=true;
    for(let dow=1;dow<=5;dow++){
     const d=shift(w,dow-1);
     for(const name of weeklyGroups){
      const p=forecasts.get(name)?.get(dow)?.(d);if(p===undefined){valid=false;break}
      estimated+=p;observed+=normalise(d,(parts.get(d)||new Map()).get(name)||0);
     }
     if(!valid)break;
    }
    if(valid)weeklyErrors.push(observed-estimated);
   }
  }
  const weeklyErrorBounds=[quantileNeeds(weeklyErrors,.15),quantileNeeds(weeklyErrors,.85)];
  const addForecastCell=(cell,prediction,bounds)=>{
   const number=document.createElement('div');number.className='forecast-needs-number';number.textContent=String(Math.ceil(prediction));
   const range=document.createElement('div');range.className='forecast-needs-interval';
   range.textContent='('+Math.max(0,Math.floor(prediction+bounds[0]))+'–'+Math.max(0,Math.ceil(prediction+bounds[1]))+')';
   range.title='Indicative 70% prediction interval';cell.append(number,range);
  };
  const bankHolidayNames=new Map();
  const holidayLabel=(year)=>{
   const date=(month,day)=>new Date(Date.UTC(year,month-1,day,12));
   const iso=d=>d.toISOString().slice(0,10);
   const move=(d,offset)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+offset);return x};
   const firstMonday=month=>move(date(month,1),(8-date(month,1).getUTCDay())%7);
   const lastMonday=month=>{const last=new Date(Date.UTC(year,month,0,12));return move(last,-((last.getUTCDay()+6)%7))};
   const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
   const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
   const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7;
   const m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
   const easter=date(Math.floor(n/31),n%31+1);
   const add=(d,name)=>bankHolidayNames.set(iso(d),name);
   add(move(easter,-2),'Good Friday');add(move(easter,1),'Easter Monday');
   const newYear=date(1,1),newDay=newYear.getUTCDay();
   add(move(newYear,newDay===6?2:newDay===0?1:0),newDay===0||newDay===6?"New Year's Day (substitute)":"New Year's Day");
   add(firstMonday(5),'Early May bank holiday');add(lastMonday(5),'Spring bank holiday');add(lastMonday(8),'Summer bank holiday');
   const christmas=date(12,25),boxing=date(12,26);
   const christmasDay=christmas.getUTCDay(),boxingDay=boxing.getUTCDay();
   add(move(christmas,christmasDay===6||christmasDay===0?2:0),christmasDay===6||christmasDay===0?'Christmas Day (substitute)':'Christmas Day');
   add(move(boxing,boxingDay===6||boxingDay===0?2:0),boxingDay===6||boxingDay===0?'Boxing Day (substitute)':'Boxing Day');
  };
  for(let year=Number(today.slice(0,4));year<=Number(today.slice(0,4))+2;year++)holidayLabel(year);
  const bankHolidayDates=new Set();for(let year=Number(today.slice(0,4));year<=Number(today.slice(0,4))+2;year++)for(const day of englandWalesBankHolidays(year))bankHolidayDates.add(day);
  for(let week=0;week<14;week++){
   const weekStart=shift(nextMonday,week*7),tr=document.createElement('tr'),weekCell=document.createElement('th');
   weekCell.scope='row';weekCell.textContent=new Date(weekStart+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
   tr.append(weekCell);
   let dailyTotal=0,dailyValid=true;
   for(let dow=1;dow<=5;dow++){
    const day=shift(weekStart,dow-1),predictions=dailyGroups.map(name=>predict(name,dow,day)),td=document.createElement('td');
    const adjacent=adjacentTypes.get(day);if(adjacent&&!bankHolidayDates.has(day)){td.classList.add(adjacent==='before'?'forecast-needs-before-holiday':'forecast-needs-after-holiday')}
    if(bankHolidayDates.has(day)){td.className='forecast-needs-bank-holiday';const main=document.createElement('div');main.textContent='Bank holiday';const detail=document.createElement('div');detail.className='forecast-needs-holiday-name';detail.textContent=bankHolidayNames.get(day)||'Public holiday';td.append(main,detail);td.title=day+': '+detail.textContent;}
    else if(!dailyGroups.length){td.textContent='—';td.title='No Appointment Types are set to daily totals';}
    else if(predictions.some(value=>value===undefined)){td.textContent='—';dailyValid=false;td.title='At least 12 observed weekdays are needed for a prediction';}
    else{
     const prediction=predictions.reduce((a,b)=>a+b,0),suggested=Math.ceil(prediction);
     td.title=day+': predicted '+prediction.toFixed(1)+' bookings; suggested minimum '+suggested+' appointment slots';
     if(adjacent){const label=document.createElement('div');label.className='forecast-needs-adjacent-label';label.textContent=adjacent==='before'?'Day before bank holiday':'Day after bank holiday';td.append(label)}
     addForecastCell(td,prediction,adjacent?specialErrors.get(adjacent):dailyErrors.get(dow));dailyTotal+=suggested;
    }
    tr.append(td);
   }
   let weeklyTotal=0,weeklyValid=true;
   if(hasWeekly){
    const weeklyCell=document.createElement('td');weeklyCell.className='forecast-weekly-total-cell';
    let weeklyPrediction=0;
    for(let dow=1;dow<=5;dow++){
     const day=shift(weekStart,dow-1);if(bankHolidayDates.has(day))continue;
     for(const name of weeklyGroups){
      const estimate=predict(name,dow,day);
      if(estimate===undefined){weeklyValid=false;break}
      weeklyPrediction+=estimate;
     }
     if(!weeklyValid)break;
    }
    if(weeklyValid){weeklyTotal=Math.ceil(weeklyPrediction);addForecastCell(weeklyCell,weeklyPrediction,weeklyErrorBounds)}
    else weeklyCell.textContent='—';
    tr.append(weeklyCell);
   }
   const totalCell=document.createElement('td');totalCell.className='forecast-allocation-total';
   if(dailyValid&&weeklyValid)totalCell.textContent=String(dailyTotal+weeklyTotal);
   else totalCell.textContent='—';
   totalCell.title='Sum of daily appointment recommendations plus weekly allocation';
   tr.append(totalCell);
   body.append(tr);
  }
  forecastSuggestionRows=[...body.children];forecastSuggestionBody=body;
  table.append(body);needsRoot.append(table);applyForecastHorizon();

 }
 if($('forecastAnalyticsPanel')?.classList.contains('hidden')){forecastRenderCache.predictions={records,signature};return;}
 const fittedModel=special?(n?(()=>{const weights=days.map(d=>Math.exp(-Math.max(0,(Date.parse(end+'T12:00:00Z')-Date.parse(d+'T12:00:00Z'))/86400000)/(365.2425*3)));const total=weights.reduce((a,b)=>a+b,0);const level=total?values.reduce((a,v,i)=>a+v*weights[i],0)/total:0;return ()=>Math.max(0,level)})():null):(n>=12?fitModel(days,values):null);
 const future=special?eventDates(weekday===6?-1:1).filter(d=>d>today).slice(0,13):Array.from({length:13},(_,i)=>shift(days[days.length-1],7*(i+1)));
 const historicalFit=fittedModel?days.map(d=>fittedModel(d)):[];
 const projected=fittedModel?future.map(d=>fittedModel(d)):[];
 // Expanding-window, forward-looking back-tests measure actual prediction errors.
 // Hold out successive observations up to 13 weeks ahead; do not use in-sample residuals.
 const backtestErrors=[];
 if(fittedModel&&n>=28){
  const minimum=Math.max(16,Math.min(52,Math.floor(n*.5)));
  for(let cut=minimum;cut<n;cut+=Math.max(1,Math.floor((n-minimum)/32))){
   const trained=fitModel(days.slice(0,cut),values.slice(0,cut));
   if(!trained)continue;
   for(let horizon=1;horizon<=13&&cut+horizon<=n;horizon+=3)backtestErrors.push({h:horizon,e:values[cut+horizon-1]-trained(days[cut+horizon-1])});
  }
 }
 const residuals=fittedModel?values.map((v,i)=>v-historicalFit[i]):[];
 const quantile=(items,q)=>{const sorted=[...items].sort((a,b)=>a-b);if(!sorted.length)return 0;const pos=(sorted.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo)};
 const empirical=backtestErrors.length>=16;
 const errors=empirical?backtestErrors.map(x=>x.e):residuals;
 const lowerError=quantile(errors,.15),upperError=quantile(errors,.85);
 const intervals=projected.map((value,i)=>{
  // Signed quantiles retain asymmetric uncertainty; inflate modestly for longer horizons.
  const factor=empirical?Math.sqrt((1+(i+1)/26)/(1+7/26)):Math.sqrt(1+(i+1)/13);
  const lo=lowerError*factor,hi=upperError*factor;
  return {low:Math.max(0,value+Math.min(lo,0)),high:Math.max(value,value+Math.max(hi,0))};
 });
 // Scale to the displayed weekday and its projected interval, with modest headroom.
 const dataMaximum=Math.max(1,...values,...historicalFit,...projected,...intervals.map(v=>v.high));
 const targetMaximum=dataMaximum*1.08;
 const magnitude=Math.pow(10,Math.floor(Math.log10(targetMaximum/5)));
 const tickStep=([1,2,2.5,5,10].map(v=>v*magnitude).find(v=>v>=targetMaximum/5)||10*magnitude);
 const max=Math.ceil(targetMaximum/tickStep)*tickStep;
 const tickCount=Math.round(max/tickStep);
 let frame=root.parentElement;
 if(!frame.classList.contains('forecast-chart-frame')){frame=document.createElement('div');frame.className='forecast-chart-frame';root.before(frame);frame.append(root);}
 frame.querySelector(':scope > .forecast-y-axis')?.remove();
 const allDays=days.concat(future),columns=[],fragment=document.createDocumentFragment();
 const selectedWeeks=Number($('dailyForecastHistory')?.value||52);
 const widthRatio=special?Math.max(1,n/104):Math.max(1,selectedWeeks/104);
 const availableWidth=Math.max(40,root.clientWidth-8);
 const columnGap=Math.min(2,availableWidth/(allDays.length*5));
 const columnWidth=Math.max(.1,(availableWidth*widthRatio-(allDays.length-1)*columnGap)/allDays.length);
 root.style.columnGap=columnGap+'px';root.style.setProperty('--forecast-bar-gap',columnGap+'px');
 root.style.setProperty('--forecast-column-width',columnWidth+'px');
 root.style.overflowX=widthRatio===1?'hidden':'auto';
 root.dataset.axisMaximum=String(max);root.dataset.dataMaximum=String(dataMaximum);

 for(let i=0;i<allDays.length;i++){
  const d=allDays[i],isFuture=i>=n,value=isFuture?0:values[i],col=document.createElement('div');
  col.className='forecast-history-column'+(isFuture?' forecast-future-column':'');
  const bar=document.createElement('div');bar.className='forecast-history-bar forecast-stacked-bar';bar.style.height=(value/max*340)+'px';
  if(!isFuture&&value>0){
   const detail=parts.get(d)||new Map();
   for(const name of groups){
    const raw=detail.get(name)||0;if(raw<=0)continue;
    const segment=document.createElement('div');segment.className='forecast-bar-segment';
    segment.style.height=(raw/(totals.get(d)||1)*100)+'%';segment.style.backgroundColor=urgencyGroupColour(name);
    segment.title=name+': '+raw+' bookings';bar.append(segment);
   }
  }
  const date=document.createElement('div');date.className='forecast-history-date';date.setAttribute('aria-hidden','true');
  if(isFuture){const j=i-n;col.title=d+': projected '+projected[j].toFixed(1)+' bookings (70% prediction interval '+intervals[j].low.toFixed(1)+'–'+intervals[j].high.toFixed(1)+')'}
  else {const detail=parts.get(d)||new Map();col.title=d+': '+value.toFixed(1)+(adjust?' list-size adjusted':'')+' bookings'+groups.map(name=>'\\n'+name+': '+(detail.get(name)||0)).join('')}
  col.append(bar,date);fragment.append(col);columns.push(col);
 }
 root.append(fragment);
 // A labelled Y-axis shares exactly the same baseline and scale as the bars and forecast.
 const baselineY=columns[0].offsetTop+columns[0].offsetHeight-41;
 const axis=document.createElement('div');axis.className='forecast-y-axis';
 for(let i=0;i<=tickCount;i++){
  const label=document.createElement('span');label.className='forecast-y-tick';
  label.textContent=String(Math.round(i*tickStep*100)/100);
  label.style.top=(baselineY-i*tickStep/max*340)+'px';
  axis.append(label);
 }
 const axisTitle=document.createElement('span');axisTitle.className='forecast-y-title';axisTitle.textContent=adjust?'Appointments (adjusted)':'Appointments';axis.append(axisTitle);frame.prepend(axis);
 // Month labels use actual month boundaries and thin out to avoid collisions.
 const monthRuns=[];
 for(let i=0;i<allDays.length;i++){
  const month=allDays[i].slice(0,7),last=monthRuns.at(-1);
  if(last?.month===month)last.end=i;else monthRuns.push({month,start:i,end:i});
 }
 let previousLabel=-Infinity;
 for(const run of monthRuns){
  const first=columns[run.start],last=columns[run.end];
  const centre=(first.offsetLeft+last.offsetLeft+last.offsetWidth)/2;
  if(centre-previousLabel<48)continue;
  const label=document.createElement('span');label.className='forecast-month-tick';
  label.textContent=new Date(run.month+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'});
  label.style.left=centre+'px';label.style.top=(baselineY+9)+'px';root.append(label);previousLabel=centre;
 }
 // Alternating calendar-year bands use real year boundaries, including the projected weeks.
 const yearRuns=[];for(let i=0;i<allDays.length;i++){const year=allDays[i].slice(0,4);if(!yearRuns.length||yearRuns[yearRuns.length-1].year!==year)yearRuns.push({year,start:i,end:i});else yearRuns[yearRuns.length-1].end=i}
 for(let j=0;j<yearRuns.length;j++){
  const run=yearRuns[j],first=columns[run.start],last=columns[run.end];
  const band=document.createElement('div');band.className='forecast-year-band'+(j%2?' forecast-year-alt':'');
  band.style.left=first.offsetLeft+'px';band.style.width=(last.offsetLeft+last.offsetWidth-first.offsetLeft)+'px';
  const tag=document.createElement('span');tag.textContent=run.year;if(parseFloat(band.style.width)<40)tag.hidden=true;band.append(tag);root.append(band);
 }
 if(fittedModel){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','forecast-season-line');svg.setAttribute('aria-label','Seasonal regression, thirteen-week projection and 70 percent prediction interval');
  const width=Math.max(root.clientWidth,columns.at(-1).offsetLeft+columns.at(-1).offsetWidth+4),height=root.clientHeight;svg.style.width=width+'px';svg.style.height=height+'px';svg.setAttribute('viewBox','0 0 '+width+' '+height);
  const ns='http://www.w3.org/2000/svg',x=i=>columns[i].offsetLeft+columns[i].offsetWidth/2;
  const baseline=baselineY;
  const y=v=>baseline-v/max*340;
  const poly=(points,cls)=>{const el=document.createElementNS(ns,'polyline');el.setAttribute('class',cls);el.setAttribute('points',points.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' '));svg.append(el)};
  poly(historicalFit.map((v,i)=>[x(i),y(v)]),'forecast-historical-fit');
  const boundary=historicalFit.length-1;
  poly([[x(boundary),y(historicalFit[boundary])],...projected.map((v,i)=>[x(n+i),y(v)])],'forecast-projection-line');
  const upperPoints=intervals.map((v,i)=>[x(n+i),y(v.high)]),lowerPoints=intervals.map((v,i)=>[x(n+i),y(v.low)]).reverse();
  const band=document.createElementNS(ns,'polygon');band.setAttribute('class','forecast-prediction-band');band.setAttribute('points',upperPoints.concat(lowerPoints).map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' '));svg.insertBefore(band,svg.firstChild);
  root.append(svg);
 }
 summary.textContent=n+' observed '+select.options[select.selectedIndex].text+'s · '+start+' to '+end+' · Mean '+average.toFixed(1)+' · SD '+sd.toFixed(1)+'. Bars show actual demand; solid pink line is fitted '+(n>=42?'annual seasonal regression plus trend':'linear trend (insufficient observations for annual seasonality)')+'. Dashed pink line projects 13 weeks; shaded area is an indicative 70% prediction interval based on '+(empirical?'expanding-window historical back-testing':'historical residuals (limited data for back-testing)')+'.'+(special?' All available historical working days adjacent to England and Wales bank holidays are included; bank holiday weeks are included automatically.':(excludeHolidayWeeks?' Bank holiday weeks excluded from fitting.':' Bank holiday weeks included.'))+(adjust?(referencePopulation?' Historical counts adjusted to latest recorded list size.':' No list-size data available; showing raw counts.'):'')+(special?' Projection dates correspond to upcoming working days adjacent to bank holidays; service changes are not modelled.':' Future bank holidays and service changes are not separately modelled.');
 forecastRenderCache.analytics={records,signature};

}
function selectForecastTab(tab){
 window.gpChartPreferences?.write('forecastActiveTab',tab);
 const predictions=tab==='predictions';
 $('forecastPredictionsPanel')?.classList.toggle('hidden',!predictions);
 $('forecastAnalyticsPanel')?.classList.toggle('hidden',predictions);
 for(const [id,selected] of [['forecastPredictionsTab',predictions],['forecastAnalyticsTab',!predictions]]){
  const button=$(id);if(button){button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected))}
 }
 // Chart dimensions require a visible container before SVG measurements.
 requestAnimationFrame(renderHistoricalWeekday);
}
window.refreshForecastCharts=()=>{forecastRenderCache.analytics=null;forecastRenderCache.predictions=null;if(!$('dailyForecastPage')?.classList.contains('hidden'))renderHistoricalWeekday();if(!$('weeklyForecastPage')?.classList.contains('hidden'))render('weekly')};
function open(mode){window.gpChartPreferences?.restore?.();window.closeDashboardMenus?.();for(const p of ['dailyForecastPage','weeklyForecastPage'])$(p)?.classList.toggle('hidden',p!==(mode==='daily'?'dailyForecastPage':'weeklyForecastPage'));for(const p of ['workforceNeedPage','routineCapacityPage','homePage','chartPage','waitingTimesPage','waitingOverTimePage','categoryPage','availabilityPage','routineAvailabilityPage','dayView2Page','bookingTimesPage','signpostingPage','peoplePage','practiceSettingsPage','personalSettingsPage'])$(p)?.classList.add('hidden');document.querySelectorAll('.dashboard-nav button.active').forEach(b=>b.classList.remove('active'));$('nav'+(mode==='daily'?'Daily':'Weekly')+'Forecast')?.classList.add('active');if(mode==='daily'){const tab=window.gpChartPreferences?.read().forecastActiveTab;selectForecastTab(tab==='analytics'?'analytics':'predictions');}else render(mode)}
let forecastResizeTimer;window.addEventListener('resize',()=>{clearTimeout(forecastResizeTimer);forecastResizeTimer=setTimeout(()=>{if(!$('dailyForecastPage')?.classList.contains('hidden')&&!$('forecastAnalyticsPanel')?.classList.contains('hidden'))renderHistoricalWeekday();},120);});
document.addEventListener('DOMContentLoaded',()=>{$('dailyForecastHorizon')?.addEventListener('input',changeForecastHorizon);$('forecastPredictionsTab')?.addEventListener('click',()=>selectForecastTab('predictions'));$('forecastAnalyticsTab')?.addEventListener('click',()=>selectForecastTab('analytics'));document.querySelectorAll('.dashboard-nav button').forEach(b=>{if(b.id!=='navDailyForecast'&&b.id!=='navWeeklyForecast'&&b.id!=='navForecastMenu'&&!b.matches('#navDemandMenu,#navAvailabilityMenu,#navSettingsCog,#headerMenuToggle,#navWorkforceMenu'))b.addEventListener('click',()=>{$('dailyForecastPage')?.classList.add('hidden');$('weeklyForecastPage')?.classList.add('hidden')})});$('dailyForecastWeekday')?.addEventListener('change',renderHistoricalWeekday);$('dailyForecastAdjustListSize')?.addEventListener('change',renderHistoricalWeekday);$('dailyForecastHistory')?.addEventListener('change',renderHistoricalWeekday);for(const mode of ['daily','weekly']){$('nav'+(mode==='daily'?'Daily':'Weekly')+'Forecast')?.addEventListener('click',()=>open(mode));$(mode+'ForecastHistory')?.addEventListener('change',()=>{if(mode==='daily')renderHistoricalWeekday();else render(mode)})}});
})();