(function(){
'use strict';
// Read-only practice home. Uses the same imported records, slot mappings and
// weekday/seasonal predictor as the detailed dashboard. No patient identifiers.
const $=id=>document.getElementById(id);
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
const waitDays=value=>value.toLocaleString('en-GB',{maximumFractionDigits:1})+(value===1?' day':' days');
// Retain verified practice-specific context when cached AI text replaces the supporting sentence.
const insightCopy=new WeakMap();
const setInsight=(section,index,title,description,emphasis,context='')=>{
 const card=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-insights');
 const item=card?.querySelectorAll('.iq-home-insight')[index];
 if(!item)return;
 item.querySelector('strong').textContent=title;
 if(emphasis!==undefined)insightCopy.set(item,{emphasis,context});
 const details=insightCopy.get(item)||{emphasis:[],context:''};
 const copy=item.querySelector('small');
 const content=[details.context,description].filter(Boolean).join(' ');
 const terms=[...new Set(details.emphasis.filter(Boolean))].sort((a,b)=>b.length-a.length);
 copy.replaceChildren();
 if(!terms.length){copy.textContent=content;return}
 const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[]\]/g,'\$&'));
 const pattern=new RegExp(escaped.join('|'),'gi');
 let offset=0;
 for(const match of content.matchAll(pattern)){
  copy.append(document.createTextNode(content.slice(offset,match.index)));
  const highlight=document.createElement('b');
  highlight.textContent=match[0];
  copy.append(highlight);
  offset=match.index+match[0].length;
 }
 copy.append(document.createTextNode(content.slice(offset)));
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
  empty.textContent='No booked appointment data for this chart range.';
  root.append(empty);return;
 }
 const legend=document.createElement('div');legend.className='iq-home-legend';
 legend.textContent='● Bookings (list size adjusted, low smoothing)   ··· Forecast with indicative range';
 root.append(legend);
 const svg=svgElement('svg',{viewBox:'0 0 728 191',class:'iq-home-chart-svg',role:'img','aria-label':(section==='acute'?'Acute':'Routine')+' weekly appointments. '+history.length+' complete weeks and four forecast weeks. Shared scale from zero to '+integer(axis.top)+' appointments.'});
 const left=58,right=706,bottom=136,top=14;
 // Use calendar spacing even when the latest uploaded booking week is older.
 const firstForecast=Math.round((isoDay(forecast[0].weekStart)-isoDay(historyStart))/604800000);
 const spacing=(right-left)/(firstForecast+forecast.length-1);
 const xpos=i=>left+i*spacing;
 const ypos=v=>bottom-Math.min(1,Math.max(0,v/axis.top))*(bottom-top);
 const axisNumber=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
 for(let tick=0;tick<=4;tick++){
  const value=tick*axis.step,y=ypos(value);
  svg.append(svgElement('line',{x1:left,y1:y,x2:right,y2:y,stroke:'#d9e5ef','stroke-width':tick===0?1.5:1}));
  svg.append(svgElement('text',{x:left-8,y:y+4,'text-anchor':'end',fill:'#2f526e','font-size':12,'font-family':'Arial, sans-serif'},axisNumber.format(value)));
 }
 const divider=xpos(firstForecast-.5);
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
 const monthLabel=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'});
 const label=(x,y,text)=>svg.append(svgElement('text',{x,y,'text-anchor':'middle',fill:'#2f526e','font-size':11,'font-family':'Arial, sans-serif'},text));
 const years=new Map();
 let lastMonth='',lastLabelX=-Infinity;
 for(let i=0;i<firstForecast+forecast.length;i++){
  const date=shift(historyStart,i*7),x=xpos(i),month=date.slice(0,7),year=date.slice(0,4);
  if(!years.has(year))years.set(year,[x,x]);
  years.get(year)[1]=x;
  if(month!==lastMonth){
   const monthIndex=Number(date.slice(5,7))-1;
   if((i===0||monthIndex%2===0)&&x-lastLabelX>=36){
    label(x,157,monthLabel.format(isoDay(date)));
    lastLabelX=x;
   }
   lastMonth=month;
  }
  const value=history[i];
  if(!Number.isFinite(value))continue;
  const dot=svgElement('circle',{cx:x,cy:ypos(value),r:2.5,fill:colour,stroke:'#fff','stroke-width':.65});
  dot.append(svgElement('title',{},fmtLong(date)+': '+integer(value)+ ' adjusted and smoothed bookings'));
  svg.append(dot);
 }
 for(const [year,[from,to]] of years){
  const a=Math.max(left,from-spacing/2),b=Math.min(right,to+spacing/2);
  if(b-a<27)continue;
  svg.append(svgElement('line',{x1:a+2,y1:166,x2:b-2,y2:166,stroke:'#bacbd9','stroke-width':1}));
  label((a+b)/2,182,year);
 }
 forecast.forEach((row,i)=>{
  if(!row)return;
  const x=xpos(firstForecast+i);
  if(!Number.isFinite(row.estimate))return;
  if(Number.isFinite(row.low)&&Number.isFinite(row.high)){
   const cap=Math.min(5,spacing*.39);
   const bar=svgElement('path',{d:'M'+x+' '+ypos(row.low)+'V'+ypos(row.high)+' M'+(x-cap)+' '+ypos(row.low)+'H'+(x+cap)+' M'+(x-cap)+' '+ypos(row.high)+'H'+(x+cap),stroke:colour,'stroke-width':Math.min(2,spacing*.4),fill:'none'});
   bar.append(svgElement('title',{},fmtLong(row.weekStart)+': '+integer(row.estimate)+' predicted (indicative range '+integer(row.low)+'–'+integer(row.high)+')'));
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
function renderSavedInsights(state,row=state.saved){
 if(!row||row.snapshot!==state.snapshot||!Object.keys(insightCards).every(key=>row.bullets?.[key]===null||typeof row.bullets?.[key]==='string'))return false;
 for(const [key,args] of Object.entries(insightCards)){
  if(key!=='waitingTimes'&&row.bullets[key]!==null)setInsight(...args,row.bullets[key]);
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
 const timeLabel=row=>{
  const time=new Date(row?.generated_at);
  return row?.generated_at&&Number.isFinite(time.valueOf())
   ? ' · '+new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'medium',timeZone:'Europe/London'}).format(time)
   : '';
 };
 const visibleCopy=()=>Array.from(home.querySelectorAll('.iq-home-insight-copy small'),node=>node.textContent).join('\n');
 void (async()=>{
  try{
   const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
   state.snapshot=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
   state.saved=await bridge.readHomeInsights();
   if(aiState===state&&renderSavedInsights(state)){
    status.textContent='AI insights last generated'+timeLabel(state.saved);
   }
  }catch{
   if(aiState===state&&bridge.manage)status.textContent='Saved AI insights could not be loaded.';
  }finally{
   if(aiState===state)button.disabled=!state.snapshot;
  }
 })();
 button.onclick=async()=>{
  if(aiState!==state||state.busy||!state.snapshot)return;
  state.busy=true;button.disabled=true;status.textContent='Generating insights…';
  try{
   const row=await bridge.regenerateHomeInsights(period,metrics);
   if(aiState!==state)return;
   const before=visibleCopy();
   if(!renderSavedInsights(state,row))throw Error('The response did not match the current dashboard figures. Try regenerating again.');
   state.saved=row;
   status.textContent=(visibleCopy()===before?'AI insights regenerated. The wording is unchanged.':'AI insights updated.')+timeLabel(row);
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
function mappedConsultMode(row){
 const mode=consultAssignments[row.slot];
 return mode&&consultCategoryNames.includes(mode)?mode:'';
}
function routineSegment(row){
 const group=clinicianGroup(row),mode=mappedConsultMode(row);
 return hasGroup(group)&&mode?JSON.stringify([group,mode]):'';
}
function renderCare(section,options,metrics){
 const {history,adjustedHistory,forecast,groups,bookingMap,latestCompleteWeek,today,axis,historyStart,holidayWeeks}=options;
 const currentFour=adjustedHistory.slice(-4).filter((_,i)=>!holidayWeeks.has(shift(latestCompleteWeek,(i-3)*7)));
 const recentMean=currentFour.length>=2&&currentFour.every(Number.isFinite)?currentFour.reduce((a,b)=>a+b,0)/currentFour.length:null;
 const regularForecast=forecast.filter(row=>!holidayWeeks.has(row.weekStart));
 const predicted=regularForecast.filter(row=>Number.isFinite(row.estimate));
 const completeForecast=predicted.length>0&&predicted.length===regularForecast.length;
 const meanForecast=completeForecast?predicted.reduce((a,b)=>a+b.estimate,0)/predicted.length:null;
 const change=recentMean!==null&&meanForecast!==null?signedTrend(meanForecast,recentMean):null;
 setOutlook(section,change!==null?percent(change):'—',change===null?'Comparison unavailable':'Next 4 weeks vs last 4 complete weeks, excluding bank holidays');
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
 let seasonPosition='';
 if(fourComplete&&recentTotal>=30&&seasonalTotals.length>=2){
  const position=recentTotal<Math.min(...seasonalTotals)?'Below':recentTotal>Math.max(...seasonalTotals)?'Above':'Within';
  seasonPosition=position.toLowerCase()+' the historical seasonal range';
 }
 const seasonDetail=seasonPosition?'Recent bookings were '+seasonPosition+' for the same four weeks across '+seasonalTotals.length+' prior years.':
  'There is too little comparable history to judge seasonal variation.';
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
 const unusedContext=hotspot?topMissed+' had the most unfilled slots ('+integer(topCount)+').':'';
 const unusedEmphasis=hotspot?[topMissed,integer(topCount)+' unfilled slots','('+integer(topCount)+')']:
  unused===null?[]:[integer(unused)+' unfilled slots',integer(unused)+' slots'];
 const unusedDetail=unused===null?(clock?'No reportable unused slots in the last four complete weeks.':'A dated Slot Report is needed to measure unused capacity.'):
  integer(unused)+' slots were still available after their start time in the last four complete weeks.';
 const yearChange=reportableChange(yoy,recentTotal,sumWeeks(lastYearWeeks));
 const yearDetail=yearChange===null?'':' Recent bookings were '+describeChange(yearChange)+' compared with the same weeks last year.';
 if(section==='acute'){
  metrics.forecast=reportableChange(change,recentMean,meanForecast);
  metrics.acuteYear=yearChange;
  const forecastDetail=metrics.forecast===null?'The four-week forecast comparison is unavailable.':
   'Next four weeks forecast '+describeChange(metrics.forecast)+' compared with the last four complete weeks, excluding bank holidays.';
  setInsight('acute',0,'Seasonal demand',forecastDetail+yearDetail,[seasonPosition,metrics.forecast===null?'':describeChange(metrics.forecast)],seasonDetail);
  const extra=[...extras.values()].reduce((total,n)=>total+n,0);
  const [topExtra,extraCount]=largestGroup(extras);
  metrics.extra=reportableCount(extra);
  const extraDetail=metrics.extra===null?(groups.some(isExtraAppointmentType)?'No reportable Extra bookings in the last four complete weeks.':'Map Extra slots under Urgent Care in Slot Settings.'):
   integer(extra)+' urgent Extra slots were booked over the last four complete weeks.';
  const extraGroup=showGroup(topExtra,extraCount,extra);
  setInsight('acute',1,'Extra capacity',extraDetail,[metrics.extra===null?'':integer(extra)+' urgent Extra slots',extraGroup?topExtra:''],
   extraGroup?topExtra+' booked the most Extra slots ('+integer(extraCount)+').':'');
  metrics.unused=unused;
  setInsight('acute',2,'Unused capacity',unusedDetail,unusedEmphasis,unusedContext);
  const peak=completeForecast?predicted.reduce((highest,row)=>row.estimate>highest.estimate?row:highest):null;
  metrics.peak=peak?reportableCount(peak.estimate):null;
  metrics.peakChange=metrics.peak===null?null:reportableChange(signedTrend(peak.estimate,recentMean),peak.estimate,recentMean);
  setInsight('acute',3,'Peak demand',metrics.peak===null?'More booking history is needed to identify the busiest forecast week.':
   integer(metrics.peak)+' urgent bookings forecast'+(metrics.peakChange===null?'.':', '+describeChange(metrics.peakChange)+' compared with the recent weekly average.'),
   metrics.peak===null?[]:[fmtDate(peak.weekStart),integer(metrics.peak)+' urgent bookings'],
   metrics.peak===null?'':'The busiest forecast week begins '+fmtDate(peak.weekStart)+'.');
 }else{
  metrics.routineTrend=reportableChange(previous,recentTotal,sumWeeks(previousWeeks));
  metrics.routineYear=yearChange;
  const recent=metrics.routineTrend===null?'The previous four weeks have insufficient comparable data.':
   'Bookings are '+describeChange(metrics.routineTrend)+' compared with the previous four weeks.';
  setInsight('routine',0,'Demand trend',recent+yearDetail,[seasonPosition,metrics.routineTrend===null?'':describeChange(metrics.routineTrend)],seasonDetail);
  const recentStart=shift(today,-28),previousStart=shift(today,-56);
  const now=[],before=[],waitSegments=new Map();
  let nowCount=0,beforeCount=0;
  for(const row of waitingTrendRecords){
   if(!allowed(row)||careFor(row.slot)!=='routine'||!row.appointmentDate||row.appointmentDate>=today||row.appointmentDate<previousStart||!Number.isFinite(row.leadMinutes)||row.leadMinutes<0)continue;
   const n=weight(row);if(!n)continue;
   // Keep the existing overall comparison for appointments booked at least a day ahead.
   if(row.leadMinutes>=1440){
    const weeks=row.leadMinutes/10080;
    if(row.appointmentDate>=recentStart){now.push([weeks,n]);nowCount+=n}
    else{before.push([weeks,n]);beforeCount+=n}
   }
   if(row.appointmentDate<recentStart)continue;
   const type=effectiveClinicianType(row.clinician);
   const mode=mappedConsultMode(row);
   if(!hasGroup(type)||!mode)continue;
   const key=JSON.stringify([type,mode]);
   if(!waitSegments.has(key))waitSegments.set(key,{label:type+' · '+mode,values:[],count:0});
   const segment=waitSegments.get(key);
   segment.values.push([row.leadMinutes/1440,n]);
   segment.count+=n;
  }
  const latest=nowCount>=30?median(now):null,older=beforeCount>=30?median(before):null;
  metrics.wait=latest===null?null:Math.round(latest*10)/10;
  metrics.priorWait=latest===null||older===null?null:Math.round(older*10)/10;
  const reportable=[...waitSegments.values()].filter(segment=>segment.count>=30)
   .map(segment=>({label:segment.label,days:Math.round(median(segment.values)*10)/10}))
   .sort((a,b)=>a.days-b.days||a.label.localeCompare(b.label));
  const shortest=reportable[0],longest=reportable.at(-1);
  let waitComparison='Too few clinician type and consultation mode combinations to compare median waits.';
  const waitEmphasis=[];
  if(reportable.length>=2){
   const gap=Math.round((longest.days-shortest.days)*10)/10;
   if(gap>0){
    waitComparison='Over the last 28 days, median waits ranged from '+waitDays(shortest.days)+' for '+shortest.label+
     ' to '+waitDays(longest.days)+' for '+longest.label+' — a gap of '+waitDays(gap)+'.';
    waitEmphasis.push(waitDays(shortest.days)+' for '+shortest.label,waitDays(longest.days)+' for '+longest.label,'gap of '+waitDays(gap));
   }else{
    waitComparison='Over the last 28 days, the reportable clinician type and consultation mode combinations all had a similar median wait of '+waitDays(shortest.days)+'.';
    waitEmphasis.push(waitDays(shortest.days));
   }
  }
  const waitSummary=metrics.wait===null?'':'For appointments booked at least a day ahead, the overall median was '+roundWeeks(metrics.wait)+
   (metrics.priorWait===null?'.':', compared with '+roundWeeks(metrics.priorWait)+' in the preceding 28 days.');
  // The local comparison remains the main insight. Older cached AI copy uses the overall median.
  setInsight('routine',1,'Waiting times',reportable.length<2?waitSummary:'',waitEmphasis,waitComparison);
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
   risk?[group+' · '+mode,coverLabel]:[],
   risk?group+' · '+mode+' has the shortest reportable cover: '+coverLabel+' at the last four complete weeks’ booking pace if no more slots are released.':'');
  metrics.routineUnused=unused;
  setInsight('routine',3,'Unused capacity',unusedDetail,unusedEmphasis,unusedContext);
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
    for(const [section,index,title] of Object.values(insightCards))if(section===care)setInsight(care,index,title,'Upload appointment reports to enable this insight.',[]);
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
  // Include only complete weeks inside the one-year window.
  const boundary=isoDay(shift(latestCompleteWeek,7));
  boundary.setUTCFullYear(boundary.getUTCFullYear()-1);
  const boundaryDay=boundary.toISOString().slice(0,10);
  const firstMonday=monday(boundaryDay);
  const historyStart=firstMonday===boundaryDay?firstMonday:shift(firstMonday,7);
  const historyWeeks=Math.round((isoDay(latestCompleteWeek)-isoDay(historyStart))/604800000)+1;
  const nextWeek=shift(presentMonday,7);
  const holidayWeeks=new Set();
  const lastForecastWeek=shift(nextWeek,21);
  for(let year=Number(historyStart.slice(0,4));year<=Number(shift(lastForecastWeek,6).slice(0,4));year++){
   for(const holiday of englandWalesBankHolidays(year))holidayWeeks.add(monday(holiday));
  }
  const adjustCount=createListSizeAdjuster(true);
  const weekDates=Array.from({length:historyWeeks},(_,i)=>shift(historyStart,i*7));
  const slots=all.filter(allowed);
  const groupNames={acute:[],routine:[]};
  for(const name of groupUrgencyNames.filter(isDashboardToggleOption)){
   const care=appointmentCare(name);
   if(care)groupNames[care].push(name);
  }
  const metrics={},series=[];
  for(const care of ['acute','routine']){
   const weekCounts=new Map(),adjustedCounts=new Map();
   for(const row of slots){
    if(careFor(row.slot)!==care||!row.bookedDay||row.bookedDay>=date)continue;
    const mondayKey=row.bookedWeek||monday(row.bookedDay);
    const count=weight(row);
    addCount(weekCounts,mondayKey,count);
    if(mondayKey>=historyStart&&mondayKey<=latestCompleteWeek&&!holidayWeeks.has(mondayKey)){
     addCount(adjustedCounts,mondayKey,adjustCount(row.bookedDay,count));
    }
   }
   const adjustedHistory=weekDates.map(week=>adjustedCounts.get(week)??null);
   const history=GPCorrectness.smoothDemandSeries(weekDates.map((date,i)=>({date,count:adjustedHistory[i]})),{level:1})
    .map((point,i)=>adjustedHistory[i]===null?null:point.smoothed);
   const predictor=window.getHomeOverviewPredictor?.(groupNames[care],care==='acute'?'urgent':'routine');
   const projection=Array.from({length:4},(_,i)=>{
    const weekStart=shift(nextWeek,i*7);
    const range=holidayWeeks.has(weekStart)?null:predictor?.range?.(weekStart,true);
    return {...range,weekStart};
   });
   series.push({care,history,adjustedHistory,forecast:projection,groups:groupNames[care],bookingMap:weekCounts});
  }
  const axis=sharedAxis(series);
  for(const item of series)renderCare(item.care,{...item,axis,historyStart,latestCompleteWeek,today:date,holidayWeeks},metrics);
  showAiInsights(home,date,metrics);
  if(caveat){
   const earliest=slots.reduce((min,r)=>r.bookedDay&&(!min||r.bookedDay<min)?r.bookedDay:min,'');
   caveat.textContent=(earliest?'Forecast models fitted using all uploaded booking history ('+fmtLong(earliest)+' to ' +fmtLong(latestBooked)+'). ':'')+
    'Both charts show one year of weekly bookings and the next four forecast weeks on a shared scale. Bank holiday weeks are omitted. Bookings are adjusted to the latest recorded practice list size and lightly smoothed. Error bars show indicative forecast variation.';
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
