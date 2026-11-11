(function(){
'use strict';
// Read-only practice home. Uses the same imported records, slot mappings and
// weekday/seasonal predictor as the detailed dashboard. No patient identifiers.
const $=id=>document.getElementById(id);
const historyWeeks=13;
const insightVersion='home-insights-v3';
const isoDay=(value)=>new Date(value+'T12:00:00Z');
const shift=(date,days)=>{const d=isoDay(date);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const monday=date=>shift(date,-((isoDay(date).getUTCDay()+6)%7));
const fmtDate=date=>isoDay(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const fmtLong=date=>isoDay(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const integer=value=>Math.round(value).toLocaleString('en-GB');
const percent=value=>(value>=0?'+':'')+Math.round(value)+'%';
const weight=row=>Number.isFinite(Number(row.count))?Math.max(0,Number(row.count)):0;
const appointmentCare=type=>{
 if(!type||!isDashboardToggleOption(type))return '';
 if(appointmentCategoryFor(type).trim().toLowerCase()==='urgent care')return 'acute';
 return appointmentCalculationRole(type)==='routine'?'routine':'';
};
const careFor=slot=>appointmentCare(capacityUrgencyCategory(slot));
const allowed=row=>row&&!excludedSlotTypes.has(row.slot)&&careFor(row.slot);
const isExtraAppointmentType=type=>['extra','urgentextra'].includes(String(type).toLowerCase().replace(/[^a-z0-9]/g,''));
const clinicianGroup=row=>{
 const type=effectiveClinicianType(row.clinician)||'';
 return clinicianGroupAssignments[type]||type||'Unassigned';
};
const median=pairs=>{
 if(!pairs.length)return null;
 pairs.sort((a,b)=>a[0]-b[0]);
 const total=pairs.reduce((n,p)=>n+p[1],0);
 if(total<=0)return null;
 let n=0;for(const [v,count] of pairs){n+=count;if(n>=total/2)return v}
 return pairs.at(-1)[0];
};
const roundWeeks=value=>value.toFixed(1)+' weeks';
const setInsight=(section,index,title,description,lead,context)=>{
 const card=$( 'homePage')?.querySelector('.iq-home-'+section+' .iq-home-insights');
 const item=card?.querySelectorAll('.iq-home-insight')[index];
 if(!item)return;
 item.querySelector('strong').textContent=title;
 const copy=item.querySelector('small');
 if(lead!==undefined){
  const highlight=document.createElement('b');
  highlight.textContent=lead;
  const detail=document.createElement('span');
  copy.replaceChildren(highlight,detail);
  if(context)copy.append(document.createTextNode(' '+context));
 }
 (copy.querySelector('span')||copy).textContent=description;
};
const setOutlook=(section,text,detail)=>{
 const badge=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-outlook');
 if(!badge)return;
 badge.querySelector('strong').textContent=text;
 badge.querySelector('small').textContent=detail;
};
const signedTrend=(newValue,oldValue)=>{
 if(!(oldValue>0))return null;
 return (newValue/oldValue-1)*100;
};
function svgElement(tag,attrs={},text){
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));
 if(text!==undefined)node.textContent=text;
 return node;
}
function sharedAxis(series){
 let peak=0;
 for(const {history,forecast} of series){
  for(const value of history)if(Number.isFinite(value))peak=Math.max(peak,value);
  for(const row of forecast){
   for(const value of [row?.estimate,row?.low,row?.high])if(Number.isFinite(value))peak=Math.max(peak,value);
  }
 }
 const target=Math.max(1,peak*1.05/4);
 const magnitude=10**Math.floor(Math.log10(target));
 const step=[1,2,2.5,5,10].map(n=>n*magnitude).find(n=>n>=target);
 return {step,top:step*4};
}
function renderChart(section,history,forecast,colour,axis,historyStart){
 const root=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-plot');if(!root)return;
 root.replaceChildren();
 if(!history.some(Number.isFinite)&&!forecast.some(item=>Number.isFinite(item?.estimate))){
  const empty=document.createElement('p');empty.className='iq-home-chart-empty';
  empty.textContent='No recent booked appointment data for this category.';
  root.append(empty);return;
 }
 const legend=document.createElement('div');legend.className='iq-home-legend';
 legend.textContent='● Booked appointments   ··· Forecast with indicative range';
 root.append(legend);
 const svg=svgElement('svg',{viewBox:'0 0 728 155',class:'iq-home-chart-svg',role:'img','aria-label':(section==='acute'?'Acute':'Routine')+' weekly appointments. '+historyWeeks+' complete weeks and four forecast weeks. Shared scale from zero to '+integer(axis.top)+' appointments.'});
 const left=58,right=706,bottom=111,top=14;
 const firstForecast=history.length+1; // Leave space for the current, incomplete week.
 const xpos=i=>left+i*(right-left)/(firstForecast+forecast.length-1);
 const ypos=v=>bottom-Math.min(1,Math.max(0,v/axis.top))*(bottom-top);
 const axisNumber=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
 for(let tick=0;tick<=4;tick++){
  const value=tick*axis.step,y=ypos(value);
  svg.append(svgElement('line',{x1:left,y1:y,x2:right,y2:y,stroke:'#d9e5ef','stroke-width':tick===0?1.5:1}));
  svg.append(svgElement('text',{x:left-8,y:y+4,'text-anchor':'end',fill:'#2f526e','font-size':12,'font-family':'Arial, sans-serif'},axisNumber.format(value)));
 }
 const divider=xpos(history.length);
 svg.append(svgElement('line',{x1:divider,y1:top,x2:divider,y2:bottom,stroke:'#8baec5','stroke-width':1.5,'stroke-dasharray':'4 5'}));
 let current=[];
 const addPath=()=>{
  if(current.length>1)svg.append(svgElement('path',{d:current.map((point,i)=>(i?'L':'M')+point.join(' ')).join(' '),fill:'none',stroke:colour,'stroke-width':3,'stroke-linecap':'round'}));
  current=[];
 };
 history.forEach((value,i)=>{if(value===null)addPath();else current.push([xpos(i),ypos(value)]);});addPath();
 const last=history.at(-1);
 let forecastLine=Number.isFinite(last)?[[xpos(history.length-1),ypos(last)]]:[];
 const addForecastPath=()=>{
  if(forecastLine.length>1)svg.append(svgElement('path',{d:forecastLine.map((point,i)=>(i?'L':'M')+point.join(' ')).join(' '),fill:'none',stroke:colour,'stroke-width':2.6,'stroke-dasharray':'1 6','stroke-linecap':'round'}));
  forecastLine=[];
 };
 forecast.forEach((item,i)=>{if(Number.isFinite(item?.estimate))forecastLine.push([xpos(firstForecast+i),ypos(item.estimate)]);else addForecastPath();});addForecastPath();
 const dateLabel=(x,date)=>svg.append(svgElement('text',{x,y:139,'text-anchor':'middle',fill:'#2f526e','font-size':11,'font-family':'Arial, sans-serif'},fmtDate(date)));
 history.forEach((value,i)=>{
  const date=shift(historyStart,i*7),x=xpos(i);
  if(i%2===0)dateLabel(x,date);
  if(value===null)return;
  const dot=svgElement('circle',{cx:x,cy:ypos(value),r:4.2,fill:colour,stroke:'#fff','stroke-width':1.4});
  dot.append(svgElement('title',{},fmtDate(date)+': '+integer(value)+' booked appointments'));svg.append(dot);
 });
 forecast.forEach((row,i)=>{
  if(!row)return;
  const x=xpos(firstForecast+i);
  if(i===0||i===forecast.length-1)dateLabel(x,row.weekStart);
  if(!Number.isFinite(row.estimate))return;
  if(Number.isFinite(row.low)&&Number.isFinite(row.high)){
   const bar=svgElement('path',{d:'M'+x+' '+ypos(row.low)+'V'+ypos(row.high)+' M'+(x-5)+' '+ypos(row.low)+'H'+(x+5)+' M'+(x-5)+' '+ypos(row.high)+'H'+(x+5),stroke:colour,'stroke-width':2,fill:'none'});
   bar.append(svgElement('title',{},fmtDate(row.weekStart)+': '+integer(row.estimate)+' predicted (indicative range '+integer(row.low)+'–'+integer(row.high)+')'));
   svg.append(bar);
  }
 });
 root.append(svg);
}
const insightCards={
 seasonalDemand:['acute',0,'Seasonal demand'],
 extraCapacity:['acute',1,'Extra capacity'],
 unusedCapacity:['acute',2,'Unused capacity'],
 forecastPeak:['acute',3,'Peak demand'],
 routineDemand:['routine',0,'Demand trend'],
 waitingTimes:['routine',1,'Waiting times'],
 forwardAvailability:['routine',2,'Forward availability'],
 routineUnused:['routine',3,'Unused capacity']
};
let aiState=null;
function renderSavedInsights(state){
 const row=state.saved;
 if(!row||row.snapshot!==state.snapshot||!Object.keys(insightCards).every(key=>row.bullets?.[key]===null||typeof row.bullets?.[key]==='string'))return false;
 for(const [key,args] of Object.entries(insightCards)){
  if(row.bullets[key]!==null)setInsight(...args,row.bullets[key]);
 }
 return true;
}
function showAiInsights(home,period,metrics){
 const button=$('iqRegenerateInsights'),status=$('iqInsightStatus');
 const bridge=window.parent===window?null:window.parent.DarwinAnalytics;
 if(!bridge?.readHomeInsights||Object.values(metrics).every(value=>value===null)){
  aiState=null;button.hidden=true;status.textContent='';
  return;
 }
 button.hidden=!bridge.manage;
 const signature=JSON.stringify([period,metrics,insightVersion]);
 if(aiState?.bridge===bridge&&aiState.signature===signature){
  renderSavedInsights(aiState);
  return;
 }
 const state={bridge,signature,snapshot:null,saved:null,busy:false};
 aiState=state;
 button.disabled=true;
 status.textContent='';
 const apply=()=>{
  if(aiState!==state||home.classList.contains('hidden'))return;
  if(!renderSavedInsights(state)){status.textContent='';return;}
  status.textContent=Object.values(state.saved.bullets).includes(null)?'AI-generated and standard insights':'AI-generated insights';
 };
 void (async()=>{
  try{
   const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
   state.snapshot=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
   state.saved=await bridge.readHomeInsights();
   apply();
  }catch{
   if(aiState===state&&bridge.manage)status.textContent='Saved AI insights could not be loaded.';
  }finally{
   if(aiState===state)button.disabled=false;
  }
 })();
 button.onclick=async()=>{
  if(aiState!==state||state.busy||!state.snapshot)return;
  state.busy=true;button.disabled=true;status.textContent='Generating insights…';
  try{
   state.saved=await bridge.regenerateHomeInsights(period,metrics);
   apply();
  }catch(error){
   if(aiState===state)status.textContent=error.message||'AI insights could not be generated.';
  }finally{
   state.busy=false;
   if(aiState===state)button.disabled=false;
  }
 };
}

const reportableCount=n=>n>=10?Math.round(n):null;
const reportableChange=(change,first,second)=>Number.isFinite(change)&&first>=30&&second>=30?Math.round(change):null;
const describeChange=n=>n===0?'roughly unchanged':Math.abs(n)+'% '+(n>0?'higher':'lower');
const addCount=(map,key,n)=>map.set(key,(map.get(key)||0)+n);
const largestGroup=map=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||[];
const hasGroup=group=>Boolean(group)&&!/^(unassigned|uncategorised|unknown)$/i.test(group);
const showGroup=(group,n,total)=>hasGroup(group)&&n>=10&&(total===n||total-n>=10);
function routineSegment(row){
 const group=clinicianGroup(row);
 const mode=consultAssignments[row.slot];
 return hasGroup(group)&&mode&&consultCategoryNames.includes(mode)?JSON.stringify([group,mode]):'';
}
function renderCare(section,options,metrics){
 const {history,forecast,groups,bookingMap,latestCompleteWeek,today,axis,historyStart}=options;
 const currentFour=history.slice(-4);
 const completeCurrent=currentFour.filter(v=>v!==null);
 const recentMean=completeCurrent.length>=3?completeCurrent.reduce((a,b)=>a+b,0)/completeCurrent.length:null;
 const predicted=forecast.filter(x=>x&&Number.isFinite(x.estimate));
 const meanForecast=predicted.length===4?predicted.reduce((a,b)=>a+b.estimate,0)/4:null;
 const change=recentMean!==null&&meanForecast!==null?signedTrend(meanForecast,recentMean):null;
 setOutlook(section,change!==null?percent(change):'—',change===null?'Forecast unavailable':'next 4 weeks');
 renderChart(section,history,forecast,section==='acute'?'#f03265':'#0b9c7f',axis,historyStart);
 const sumWeeks=weeks=>weeks.reduce((sum,w)=>sum+(bookingMap.get(w)||0),0);
 const currentWeeks=Array.from({length:4},(_,i)=>shift(latestCompleteWeek,-(3-i)*7));
 const previousWeeks=currentWeeks.map(w=>shift(w,-28));
 const lastYearWeeks=currentWeeks.map(w=>shift(w,-364));
 const hasWeeks=weeks=>weeks.filter(w=>bookingMap.has(w)).length>=3;
 const yoy=hasWeeks(currentWeeks)&&hasWeeks(lastYearWeeks)?signedTrend(sumWeeks(currentWeeks),sumWeeks(lastYearWeeks)):null;
 const previous=hasWeeks(currentWeeks)&&hasWeeks(previousWeeks)?signedTrend(sumWeeks(currentWeeks),sumWeeks(previousWeeks)):null;
 const recentTotal=sumWeeks(currentWeeks);
 const seasonalTotals=[364,728,1092].map(days=>currentWeeks.map(w=>shift(w,-days)))
  .filter(weeks=>weeks.every(w=>bookingMap.has(w))&&sumWeeks(weeks)>=30).map(sumWeeks);
 const fourComplete=currentWeeks.every(w=>bookingMap.has(w));
 let seasonLead='Seasonal pattern unclear';
 if(fourComplete&&recentTotal>=30&&seasonalTotals.length>=2){
  const position=recentTotal<Math.min(...seasonalTotals)?'Below':recentTotal>Math.max(...seasonalTotals)?'Above':'Within';
  seasonLead=position+' the historical seasonal range';
 }
 const seasonDetail=seasonLead==='Seasonal pattern unclear'?'Too little comparable history to judge seasonal variation.':
  'Seasonal benchmark: the same four weeks in '+seasonalTotals.length+' prior years.';
 const start=currentWeeks[0],end=shift(latestCompleteWeek,6);
 const clock=capacitySnapshotClock();
 const missed=new Map(),extras=new Map(),future=new Map(),bookedBySegment=new Map();
 const todayClock=dayView2LondonClock();
 for(const row of availabilityRecords){
  if(!allowed(row)||careFor(row.slot)!==section||!row.date)continue;
  const status=String(row.availability).toLowerCase();
  const n=weight(row);if(!n)continue;
  if(row.date>=start&&row.date<=end){
   if(section==='acute'&&status==='booked'&&isExtraAppointmentType(capacityUrgencyCategory(row.slot)))addCount(extras,clinicianGroup(row),n);
   if(status==='available'&&isMissedAvailableSlot(row,clock))addCount(missed,clinicianGroup(row),n);
  }
  if(section==='routine'&&status==='available'&&(row.date>today||(row.date===today&&Number.isFinite(row.minute)&&row.minute>=todayClock.minute))){
   const segment=routineSegment(row);
   if(segment)addCount(future,segment,n);
  }
 }
 const unusedTotal=[...missed.values()].reduce((total,n)=>total+n,0);
 const unused=clock?reportableCount(unusedTotal):null;
 const [topMissed,topCount]=largestGroup(missed);
 // Showing the overall and group counts together can disclose a small remainder.
 const hotspot=unused!==null&&showGroup(topMissed,topCount,unusedTotal);
 const unusedLead=hotspot?topMissed+': '+integer(topCount)+' unfilled slots':
  unused===null?'Unused capacity unavailable':integer(unused)+' unfilled slots';
 const unusedDetail=unused===null?(clock?'No reportable unused slots in the last four complete weeks.':'A dated Slot Report is needed to measure unused capacity.'):
  (hotspot?integer(unused)+' across all groups. ':'')+'These slots were still available after their start time in the latest snapshot.';
 const yearChange=reportableChange(yoy,recentTotal,sumWeeks(lastYearWeeks));
 const yearDetail=yearChange===null?'':' Recent bookings were '+describeChange(yearChange)+' compared with the same weeks last year.';
 if(section==='acute'){
  metrics.forecast=reportableChange(change,recentMean,meanForecast);
  metrics.acuteYear=yearChange;
  const forecastDetail=metrics.forecast===null?'The four-week forecast comparison is unavailable.':
   'Next four weeks forecast '+describeChange(metrics.forecast)+' compared with recent bookings.';
  setInsight('acute',0,'Seasonal demand',forecastDetail+yearDetail,seasonLead,seasonDetail);
  const extra=[...extras.values()].reduce((total,n)=>total+n,0);
  const [topExtra,extraCount]=largestGroup(extras);
  metrics.extra=reportableCount(extra);
  const extraLead=metrics.extra===null?'Extra usage unavailable':integer(metrics.extra)+' urgent Extra slots booked';
  const extraDetail=metrics.extra===null?(groups.some(isExtraAppointmentType)?'No reportable Extra bookings in the last four complete weeks.':'Map Extra slots under Urgent Care in Slot Settings.'):
   'Across the last four complete weeks.';
  setInsight('acute',1,'Extra capacity',extraDetail,extraLead,showGroup(topExtra,extraCount,extra)?topExtra+' used the most ('+integer(extraCount)+').':'');
  metrics.unused=unused;
  setInsight('acute',2,'Unused capacity',unusedDetail,unusedLead);
  const peak=predicted.length===4?predicted.reduce((highest,row)=>row.estimate>highest.estimate?row:highest):null;
  metrics.peak=peak?reportableCount(peak.estimate):null;
  metrics.peakChange=metrics.peak===null?null:reportableChange(signedTrend(peak.estimate,recentMean),peak.estimate,recentMean);
  setInsight('acute',3,'Peak demand',metrics.peak===null?'More booking history is needed to identify the busiest forecast week.':
   integer(metrics.peak)+' urgent bookings forecast'+(metrics.peakChange===null?'.':', '+describeChange(metrics.peakChange)+' compared with the recent weekly average.'),
   metrics.peak===null?'Forecast peak unavailable':'Busiest forecast week begins '+fmtDate(peak.weekStart));
 }else{
  metrics.routineTrend=reportableChange(previous,recentTotal,sumWeeks(previousWeeks));
  metrics.routineYear=yearChange;
  const recent=metrics.routineTrend===null?'The previous four weeks have insufficient comparable data.':
   'Bookings are '+describeChange(metrics.routineTrend)+' compared with the previous four weeks.';
  setInsight('routine',0,'Demand trend',recent+yearDetail,seasonLead,seasonDetail);
  const todayIso=today;
  const lastDate=shift(todayIso,-1);
  const recentStart=shift(todayIso,-28),previousStart=shift(todayIso,-56);
  const now=[],before=[];let nowCount=0,beforeCount=0;
  for(const row of waitingTrendRecords){
   if(!allowed(row)||careFor(row.slot)!=='routine'||!row.appointmentDate||row.appointmentDate>lastDate||!Number.isFinite(row.leadMinutes)||row.leadMinutes<1440)continue;
   const days=row.leadMinutes/10080; // minutes -> weeks
   const n=weight(row);if(!n)continue;
   if(row.appointmentDate>=recentStart){now.push([days,n]);nowCount+=n}
   else if(row.appointmentDate>=previousStart){before.push([days,n]);beforeCount+=n}
  }
  const latest=nowCount>=30?median(now):null,older=beforeCount>=30?median(before):null;
  metrics.wait=latest===null?null:Math.round(latest*10)/10;
  metrics.priorWait=latest===null||older===null?null:Math.round(older*10)/10;
  const waitLead=metrics.wait===null?'Median wait unavailable':metrics.wait.toFixed(1)+' weeks median wait';
  setInsight('routine',1,'Waiting times',metrics.wait===null?'Too few routine appointments for a reliable median.':
   metrics.priorWait===null?'Calculated from routine appointments in the latest 28 days.':
   'The previous 28-day median was '+roundWeeks(metrics.priorWait)+'.',waitLead);
  for(const row of records){
   if(!allowed(row)||careFor(row.slot)!=='routine'||!row.bookedDay||row.bookedDay<start||row.bookedDay>end)continue;
   const segment=routineSegment(row);
   if(segment)addCount(bookedBySegment,segment,weight(row));
  }
  const risks=[];
  if(fourComplete&&clock){
   for(const [segment,slots] of future){
    const booked=bookedBySegment.get(segment)||0;
    if(slots>=10&&booked>=30)risks.push({segment,slots,booked,cover:4*slots/booked});
   }
  }
  risks.sort((a,b)=>a.cover-b.cover||b.booked-a.booked||a.segment.localeCompare(b.segment));
  const risk=risks[0];
  metrics.riskSlots=risk?reportableCount(risk.slots):null;
  const [group,mode]=risk?JSON.parse(risk.segment):[];
  const coverLabel=risk?(risk.cover<1?'less than a week':roundWeeks(Math.round(risk.cover*10)/10)):'';
  setInsight('routine',2,'Forward availability',risk?
   integer(risk.slots)+' slots available in the uploaded diary.':
   'Too little matched booking and diary data to estimate cover by clinician group and consultation mode.',
   risk?group+' · '+mode+' has '+coverLabel+' of cover':'Availability risk unavailable',
   risk?'Lowest reportable cover at the last four complete weeks’ booking pace, if no more slots are released. Slot Report: '+fmtDate(clock.date)+'.':'');
  metrics.routineUnused=unused;
  setInsight('routine',3,'Unused capacity',unusedDetail,unusedLead);
 }
}
let rendering=false;
function update(){
 const home=$('homePage');if(!home||home.classList.contains('hidden')||rendering)return;
 rendering=true;
 try{
  const caveat=home.querySelector('.iq-home-caveat');
  const all=Array.isArray(records)?records:[];
  const date=typeof todayLondon==='string'?todayLondon:new Date().toISOString().slice(0,10);
  if(!all.length){
   showAiInsights(home,date,{});
   for(const care of ['acute','routine']){
    setOutlook(care,'—','No appointment data');
    renderChart(care,[],[],care==='acute'?'#f03265':'#0b9c7f');
    for(const [section,index,title] of Object.values(insightCards))if(section===care)setInsight(care,index,title,'Upload appointment reports to enable this insight.','');
   }
   if(caveat)caveat.textContent='No appointment records are available. Upload Slot Reports and check slot mappings.';
   return;
  }
  const availableDays=all.map(r=>r.bookedDay).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<date).sort();
  const earliestBooked=availableDays[0],latestBooked=availableDays.at(-1);
  if(!earliestBooked||!latestBooked)throw Error('No completed booking days found.');
  const presentMonday=monday(date);
  let latestCompleteWeek=shift(presentMonday,-7);
  const fullWeeks=new Set(all.filter(r=>r.bookedDay<date&&r.bookedWeek<presentMonday).map(r=>r.bookedWeek));
  while(latestCompleteWeek>earliestBooked&&!fullWeeks.has(latestCompleteWeek))latestCompleteWeek=shift(latestCompleteWeek,-7);
  const historyStart=shift(latestCompleteWeek,(1-historyWeeks)*7);
  const nextWeek=shift(presentMonday,7);
  const slots=all.filter(allowed);
  const groupNames={acute:[],routine:[]};
  for(const name of groupUrgencyNames.filter(isDashboardToggleOption)){
   const care=appointmentCare(name);
   if(care)groupNames[care].push(name);
  }
  const metrics={},series=[];
  for(const care of ['acute','routine']){
   const weekCounts=new Map();
   for(const row of slots){
    if(careFor(row.slot)!==care||!row.bookedDay||row.bookedDay>=date)continue;
    const mondayKey=row.bookedWeek||monday(row.bookedDay);
    weekCounts.set(mondayKey,(weekCounts.get(mondayKey)||0)+weight(row));
   }
   const history=Array.from({length:historyWeeks},(_,i)=>weekCounts.get(shift(historyStart,i*7))??null);
   const predictor=window.getHomeOverviewPredictor?.(groupNames[care],care==='acute'?'urgent':'routine');
   const projection=Array.from({length:4},(_,i)=>{
    const weekStart=shift(nextWeek,i*7);
    const range=predictor?.range?.(weekStart,true);
    return {...range,weekStart};
   });
   series.push({care,history,forecast:projection,groups:groupNames[care],bookingMap:weekCounts});
  }
  const axis=sharedAxis(series);
  for(const item of series)renderCare(item.care,{...item,axis,historyStart,latestCompleteWeek,today:date},metrics);
  showAiInsights(home,date,metrics);
  if(caveat){
   const totalRecords=slots.length;
   const earliest=slots.reduce((min,r)=>r.bookedDay&&(!min||r.bookedDay<min)?r.bookedDay:min,'');
   const current=slots.reduce((max,r)=>r.bookedDay&&r.bookedDay<date&&r.bookedDay>max?r.bookedDay:max,'');
   caveat.textContent=(earliest?'Forecast models fitted using all uploaded booking history ('+fmtLong(earliest)+' to '+fmtLong(current)+'). ':'')+
    'Charts share a scale and show the latest thirteen complete weeks and next four forecast weeks. Error bars reflect indicative historical forecasting variation, not formal confidence intervals. Booking activity is a proxy for demand; capacity status comes from the latest imported slot reports.';
  }
 }catch(error){
  showAiInsights(home,'',{});
  console.error('Home overview calculations could not be completed',error);
  const note=home.querySelector('.iq-home-caveat');if(note)note.textContent='Could not calculate the home overview from the imported data. Detailed pages remain available.';
  for(const care of ['acute','routine']){setOutlook(care,'—','Unavailable');renderChart(care,[],[],care==='acute'?'#f03265':'#0b9c7f');}
 }finally{rendering=false}
}
window.updateHomeOverview=update;
})();
