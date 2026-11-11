(function(){
'use strict';
// Read-only practice home. Uses the same imported records, slot mappings and
// weekday/seasonal predictor as the detailed dashboard. No patient identifiers.
const $=id=>document.getElementById(id);
const insightVersion='home-insights-v8';
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
const peakForecastWeeks=9;
const waitDays=value=>value.toLocaleString('en-GB',{maximumFractionDigits:1})+(value===1?' day':' days');
const insightCopy=new WeakMap();
const insightCards={
 acute:['seasonalDemand','extraCapacity','unusedCapacity','forecastPeak'],
 routine:['routineDemand','waitingTimes','forwardAvailability','routineUnused']
};
function appendEmphasis(node,text,terms){
 const lower=text.toLowerCase();
 let offset=0;
 while(offset<text.length){
  let start=text.length,match='';
  for(const term of terms){
   const index=lower.indexOf(term.toLowerCase(),offset);
   if(index>=0&&(index<start||(index===start&&term.length>match.length))){
    start=index;match=term;
   }
  }
  node.append(document.createTextNode(text.slice(offset,start)));
  if(!match)break;
  const highlight=document.createElement('b');
  highlight.textContent=text.slice(start,start+match.length);
  node.append(highlight);
  offset=start+match.length;
 }
}
function setInsight(section,index,title,bullets,emphasis=[],labels={}){
 const card=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-insights');
 const item=card?.querySelectorAll('.iq-home-insight')[index];
 if(!item)return;
 item.querySelector('strong').textContent=title;
 const details={key:insightCards[section][index],bullets:bullets.filter(Boolean),emphasis:emphasis.filter(Boolean),labels};
 insightCopy.set(item,details);
 paintInsight(item,details);
}
function paintInsight(item,{bullets,emphasis,labels},generated){
 const list=document.createElement('span');
 list.setAttribute('role','list');
 for(const bullet of generated?.length?generated:bullets){
  const line=document.createElement('span');
  line.setAttribute('role','listitem');
  const text=generated?.length?bullet.replace(/\{([A-Za-z]+)\}/g,(_,key)=>labels[key]||''):bullet;
  appendEmphasis(line,text,emphasis);
  list.append(line);
 }
 item.querySelector('small').replaceChildren(list);
}
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
function renderChart(section,history,forecast,colour,axis,historyStart,adjustedHistory=history){
 const root=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-plot');if(!root)return;
 root.replaceChildren();
 if(!history.some(Number.isFinite)&&!forecast.some(item=>Number.isFinite(item?.estimate))){
  const empty=document.createElement('p');empty.className='iq-home-chart-empty';
  empty.textContent='No booked appointment data for this chart range.';
  root.append(empty);return;
 }
 const observed=adjustedHistory.filter(Number.isFinite);
 const average=observed.length?observed.reduce((sum,value)=>sum+value,0)/observed.length:null;
 const legend=document.createElement('div');legend.className='iq-home-legend';
 const legendItems=[['Bookings','iq-home-dot'],['Forecast','iq-home-legend-line']];
 if(average!==null)legendItems.push(['Average','iq-home-legend-line is-average']);
 for(const [text,className] of legendItems){
  const item=document.createElement('span'),symbol=document.createElement('i');
  symbol.className=className;symbol.setAttribute('aria-hidden','true');
  item.append(symbol,text);legend.append(item);
 }
 root.append(legend);
 const averageLabel=average===null?'':' Historical weekly average: '+integer(average)+' list-size-adjusted bookings.';
 const svg=svgElement('svg',{viewBox:'0 0 728 207',class:'iq-home-chart-svg',role:'img','aria-label':(section==='acute'?'Acute':'Routine')+' weekly appointments. '+history.length+' complete weeks and four forecast weeks. Shared scale from zero to '+integer(axis.top)+' appointments.'+averageLabel});
 const left=58,right=706,bottom=152,top=14;
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
 if(average!==null){
  const y=ypos(average);
  const line=svgElement('line',{class:'iq-home-average-line',x1:left,y1:y,x2:right,y2:y,stroke:'#496278','stroke-width':1.5,'stroke-dasharray':'1 5','stroke-linecap':'round'});
  line.append(svgElement('title',{},'Historical weekly average: '+integer(average)+' adjusted bookings'));
  svg.append(line);
 }
 const drawTrend=(points,projection=false)=>{
  if(points.length<2)return;
  const path=points.map(([x,y],i)=>{
   if(i===0)return 'M'+x+' '+y;
   const [previousX,previousY]=points[i-1],gap=x-previousX;
   if(gap<=spacing*1.5)return 'L'+x+' '+y;
   // Ease across skipped weeks without adding markers or values at those dates.
   return 'C'+(previousX+gap/3)+' '+previousY+' '+(x-gap/3)+' '+y+' '+x+' '+y;
  }).join(' ');
  const attrs={d:path,fill:'none',stroke:colour,'stroke-width':projection?2.6:3,'stroke-linecap':'round','stroke-linejoin':'round'};
  if(projection)attrs['stroke-dasharray']='1 6';
  svg.append(svgElement('path',attrs));
 };
 const historyPoints=history.flatMap((value,i)=>Number.isFinite(value)?[[xpos(i),ypos(value)]]:[]);
 drawTrend(historyPoints);
 const forecastPoints=forecast.flatMap((row,i)=>Number.isFinite(row?.estimate)?[[xpos(firstForecast+i),ypos(row.estimate)]]:[]);
 if(forecastPoints.length)drawTrend(historyPoints.slice(-1).concat(forecastPoints),true);
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
    label(x,173,monthLabel.format(isoDay(date)));
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
  svg.append(svgElement('line',{x1:a+2,y1:182,x2:b-2,y2:182,stroke:'#bacbd9','stroke-width':1}));
  label((a+b)/2,198,year);
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
let aiState=null;
function renderSavedInsights(state,row=state.saved){
 const cards=Object.values(insightCards).flat();
 if(!row||row.snapshot!==state.snapshot||!cards.every(key=>Array.isArray(row.bullets?.[key])&&
  row.bullets[key].length<=3&&row.bullets[key].every(line=>typeof line==='string')))return false;
 for(const item of document.querySelectorAll('#homePage .iq-home-insight')){
  const details=insightCopy.get(item);
  if(details)paintInsight(item,details,row.bullets[details.key]);
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
 const signature=JSON.stringify([period,Object.entries(metrics).sort(([a],[b])=>a<b?-1:a>b?1:0),insightVersion]);
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
 const visibleCopy=()=>Array.from(home.querySelectorAll('.iq-home-insight-copy [role=listitem]'),node=>node.textContent).join('\n');
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
   const row=await bridge.regenerateHomeInsights(period,metrics,insightVersion);
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
const describeChange=n=>Math.abs(n)+'% '+(n>0?'more':'fewer');
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
// Compare four-week periods only where dated Slot Reports cover every working week.
function capacityComparisons(weeklyCounts,current,latestWeek,coveredWeeks){
 const none={year:null,average:null,previous:null};
 if(current===null)return none;
 const periodTotal=end=>{
  const weeks=Array.from({length:4},(_,i)=>shift(end,-7*i));
  return weeks.every(week=>coveredWeeks.has(week))
   ?weeks.reduce((sum,week)=>sum+(weeklyCounts.get(week)||0),0):null;
 };
 if(periodTotal(latestWeek)===null)return none;
 const history=Array.from({length:13},(_,i)=>periodTotal(shift(latestWeek,-28*(i+1))));
 const available=history.filter(value=>value!==null);
 const average=available.length>=10?available.reduce((sum,value)=>sum+value,0)/available.length:null;
 const change=baseline=>baseline>=10?Math.round(signedTrend(current,baseline)):null;
 return {year:change(history.at(-1)),average:change(average),previous:change(history[0])};
}

function reportableShare(part,total){
 if(part===null||total<=0||total-part<10)return null;
 return Math.round(1000*part/total)/10||null;
}

function capacityComparisonLine(comparison){
 const benchmarks=[
  [comparison.year,'the weekly average for the same period last year'],
  [comparison.average,'the weekly average over the preceding year'],
  [comparison.previous,'the weekly average for the preceding four weeks']
 ];
 const match=benchmarks.find(([value])=>value!==null);
 if(!match)return '';
 const [value,label]=match;
 return value===0?'The recent weekly average was in line with '+label+'.':
  'Over the last four weeks, we averaged '+describeChange(value)+' slots per week than '+label+'.';
}
function renderCare(section,options,metrics){
 const {history,adjustedHistory,forecast,groups,bookingMap,latestCompleteWeek,today,axis,historyStart,holidayWeeks,peakForecast,coveredCapacityWeeks}=options;
 const currentFour=adjustedHistory.slice(-4).filter((_,i)=>!holidayWeeks.has(shift(latestCompleteWeek,(i-3)*7)));
 const recentMean=currentFour.length>=2&&currentFour.every(Number.isFinite)?currentFour.reduce((a,b)=>a+b,0)/currentFour.length:null;
 const regularForecast=forecast.filter(row=>!holidayWeeks.has(row.weekStart));
 const predicted=regularForecast.filter(row=>Number.isFinite(row.estimate));
 const completeForecast=predicted.length>0&&predicted.length===regularForecast.length;
 const meanForecast=completeForecast?predicted.reduce((a,b)=>a+b.estimate,0)/predicted.length:null;
 const change=recentMean!==null&&meanForecast!==null?signedTrend(meanForecast,recentMean):null;
 setOutlook(section,change!==null?percent(change):'—',change===null?'Comparison unavailable':'Next 4 weeks vs last 4 weeks');
 renderChart(section,history,forecast,section==='acute'?'#f03265':'#0b9c7f',axis,historyStart,adjustedHistory);
 const sumWeeks=weeks=>weeks.reduce((sum,w)=>sum+(bookingMap.get(w)||0),0);
 const currentWeeks=Array.from({length:4},(_,i)=>shift(latestCompleteWeek,-(3-i)*7));
 const previousWeeks=currentWeeks.map(w=>shift(w,-28));
 const lastYearWeeks=currentWeeks.map(w=>shift(w,-364));
 const observedAverage=weeks=>{
  const reported=weeks.filter(week=>bookingMap.has(week));
  return reported.length>=3?sumWeeks(reported)/reported.length:null;
 };
 const currentAverage=observedAverage(currentWeeks);
 const yearAverage=observedAverage(lastYearWeeks);
 const previousAverage=observedAverage(previousWeeks);
 const yoy=currentAverage!==null?signedTrend(currentAverage,yearAverage):null;
 const previous=currentAverage!==null?signedTrend(currentAverage,previousAverage):null;
 const recentTotal=sumWeeks(currentWeeks);
 const seasonalTotals=[364,728,1092].map(days=>currentWeeks.map(w=>shift(w,-days)))
  .filter(weeks=>weeks.every(w=>bookingMap.has(w))&&sumWeeks(weeks)>=30).map(sumWeeks);
 const fourComplete=currentWeeks.every(w=>bookingMap.has(w));
 let seasonPosition='',seasonIndex=null;
 if(fourComplete&&recentTotal>=30&&seasonalTotals.length>=2){
  const position=recentTotal<Math.min(...seasonalTotals)?'Below':recentTotal>Math.max(...seasonalTotals)?'Above':'Within';
  seasonPosition=position.toLowerCase()+' the usual range';
  seasonIndex={Below:-1,Within:0,Above:1}[position];
 }
 const seasonDetail=seasonPosition?'Recent bookings were '+seasonPosition+' for this time of year.':'';
 const start=currentWeeks[0],end=shift(latestCompleteWeek,6);
 const clock=capacitySnapshotClock();
 const missed=new Map(),extras=new Map(),future=new Map(),bookedBySegment=new Map();
 const missedByWeek=new Map(),extrasByWeek=new Map();
 let bookedCapacity=0;
 const todayClock=dayView2LondonClock();
 for(const row of availabilityRecords){
  if(row.source==='signposting'||!allowed(row)||careFor(row.slot)!==section||!row.date)continue;
  const status=String(row.availability).toLowerCase();
  const n=weight(row);if(!n)continue;
  const inCurrent=row.date>=start&&row.date<=end;
  if(inCurrent&&status==='booked')bookedCapacity+=n;
  const isExtra=section==='acute'&&status==='booked'&&isExtraAppointmentType(capacityUrgencyCategory(row.slot));
  const isUnused=status==='available'&&isMissedAvailableSlot(row,clock);
  if(isExtra||isUnused){
   const week=monday(row.date);
   if(isExtra){
    if(inCurrent)addCount(extras,clinicianGroup(row),n);
    if(coveredCapacityWeeks.has(week))addCount(extrasByWeek,week,n);
   }
   if(isUnused){
    if(inCurrent)addCount(missed,clinicianGroup(row),n);
    if(coveredCapacityWeeks.has(week))addCount(missedByWeek,week,n);
   }
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
 const unusedContext=hotspot?topMissed+' had the most ('+integer(topCount)+').':'';
 const unusedEmphasis=[unused===null?'':integer(unused)+' slots',hotspot?topMissed:'',hotspot?'('+integer(topCount)+')':''];
 const unusedComparison=capacityComparisons(missedByWeek,unused,latestCompleteWeek,coveredCapacityWeeks);
 const unusedShare=reportableShare(unused,bookedCapacity+unusedTotal);
 const unusedBullets=unused===null?[clock?'No unused slots to report for the last four weeks.':'A dated Slot Report is needed.']:[
  integer(unused)+' slots went unused over the last four weeks.',
  capacityComparisonLine(unusedComparison)||(unusedShare===null?'':unusedShare+'% of slots with a booked or unused outcome went unused.'),
  unusedContext
 ];
 const yearChange=reportableChange(yoy,recentTotal,sumWeeks(lastYearWeeks));
 const yearDetail=yearChange===null?null:yearChange===0?'Our recent weekly average was similar to the average for the same period last year.':
  'Over the last four weeks, we averaged '+describeChange(yearChange)+' '+(section==='acute'?'urgent':'routine')+' bookings per week than the average for the same period last year.';
 const seasonalComparison=yearDetail||seasonDetail;
 const recentWeeks=adjustedHistory.slice(-8).filter(Number.isFinite);
 const low=Math.min(...recentWeeks),high=Math.max(...recentWeeks);
 const variation=recentWeeks.length>=4&&low>=30?Math.round((high/low-1)*100):null;
 if(section==='acute'){
  metrics.forecast=reportableChange(change,recentMean,meanForecast);
  metrics.acuteYear=yearChange;
  metrics.acuteTrend=reportableChange(previous,recentTotal,sumWeeks(previousWeeks));
  metrics.acuteSeason=yearChange===null?seasonIndex:null;
  metrics.acuteVariation=variation;
  const forecastDetail=metrics.forecast===null?'There’s too little data for a four-week comparison.':
   metrics.forecast===0?'We expect urgent bookings over the next four weeks to stay close to the recent average.':
   'We expect to see '+describeChange(metrics.forecast)+' urgent bookings over the next four weeks than the recent average.';
  setInsight('acute',0,'Seasonal demand',[forecastDetail,seasonalComparison],
   [seasonPosition,metrics.forecast?describeChange(metrics.forecast):'',yearChange?describeChange(yearChange):'']);
  const extra=[...extras.values()].reduce((total,n)=>total+n,0);
  const [topExtra,extraCount]=largestGroup(extras);
  metrics.extra=reportableCount(extra);
  const extraComparison=capacityComparisons(extrasByWeek,metrics.extra,latestCompleteWeek,coveredCapacityWeeks);
  metrics.extraShare=reportableShare(metrics.extra,bookedCapacity);
  metrics.extraYear=extraComparison.year;
  metrics.extraAverage=extraComparison.average;
  metrics.extraPrevious=extraComparison.previous;
  const extraGroup=showGroup(topExtra,extraCount,extra);
  metrics.extraGroupCount=extraGroup?Math.round(extraCount):null;
  const extraBullets=metrics.extra===null?[groups.some(isExtraAppointmentType)?'No Extra bookings to report for the last four weeks.':'Map Extra slots under Urgent Care in Slot Settings.']:[
   integer(extra)+' urgent Extra slots were booked in the last four weeks.',
   capacityComparisonLine(extraComparison)||(metrics.extraShare===null?'':metrics.extraShare+'% of booked urgent slots were Extra slots.'),
   extraGroup?topExtra+' booked the most ('+integer(extraCount)+').':''
  ];
  setInsight('acute',1,'Extra capacity',extraBullets,[metrics.extra===null?'':integer(extra)+' urgent Extra slots',extraGroup?topExtra:''],{extraGroup:extraGroup?topExtra:''});
  metrics.unused=unused;
  metrics.unusedShare=unusedShare;
  metrics.unusedYear=unusedComparison.year;
  metrics.unusedAverage=unusedComparison.average;
  metrics.unusedPrevious=unusedComparison.previous;
  metrics.unusedGroupCount=hotspot?Math.round(topCount):null;
  setInsight('acute',2,'Unused capacity',unusedBullets,unusedEmphasis,{unusedGroup:hotspot?topMissed:''});
  const peak=peakForecast.length&&peakForecast.every(row=>Number.isFinite(row.estimate))
   ?peakForecast.reduce((highest,row)=>row.estimate>highest.estimate?row:highest):null;
  metrics.peak=peak?reportableCount(peak.estimate):null;
  metrics.peakChange=metrics.peak===null?null:reportableChange(signedTrend(peak.estimate,recentMean),peak.estimate,recentMean);
  const peakDate=peak?fmtDate(peak.weekStart):'';
  setInsight('acute',3,'Peak demand',metrics.peak===null?['There’s too little data to pick the busiest week.']:[
   'Over the next nine weeks, we expect the busiest week to start '+peakDate+'.',
   'We expect to see about '+integer(metrics.peak)+' urgent bookings that week.',
   metrics.peakChange?'That’s '+describeChange(metrics.peakChange)+' than a recent week on average.':
    metrics.peakChange===0?'That’s close to the recent weekly average.':''
  ],[peakDate,metrics.peak===null?'':integer(metrics.peak)+' urgent bookings',metrics.peakChange?describeChange(metrics.peakChange):''],{peakWeek:peakDate});
 }else{
  metrics.routineTrend=reportableChange(previous,recentTotal,sumWeeks(previousWeeks));
  metrics.routineYear=yearChange;
  metrics.routineForecast=reportableChange(change,recentMean,meanForecast);
  metrics.routineSeason=yearChange===null?seasonIndex:null;
  metrics.routineVariation=variation;
  const recent=metrics.routineTrend===null?'There’s too little data to compare with the previous four weeks.':
   metrics.routineTrend===0?'Average weekly routine bookings held steady across the two four-week periods.':
   'Over the last four weeks, we averaged '+describeChange(metrics.routineTrend)+' routine bookings per week than in the preceding four weeks.';
  setInsight('routine',0,'Demand trend',[recent,seasonalComparison],
   [seasonPosition,metrics.routineTrend?describeChange(metrics.routineTrend):'',yearChange?describeChange(yearChange):'']);
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
   if(!waitSegments.has(key))waitSegments.set(key,{label:type+' ('+mode+')',values:[],count:0});
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
  const middleGroups=reportable.filter(segment=>segment.days>shortest.days&&segment.days<longest.days);
  const middle=middleGroups[Math.floor(middleGroups.length/2)];
  let waitBullets=['There’s too little data to compare waits by clinician type and appointment mode.'];
  const waitEmphasis=[];
  if(reportable.length>=2){
   const gap=Math.round((longest.days-shortest.days)*10)/10;
   if(gap>0){
    waitBullets=[
     'Over the last 28 days, we’ve seen the longest median wait for '+longest.label+' at '+waitDays(longest.days)+'.',
     shortest.label+' had the shortest median wait at '+waitDays(shortest.days)+', a gap of '+waitDays(gap)+'.',
     middle?middle.label+' sat between them at '+waitDays(middle.days)+'.':''
    ];
    waitEmphasis.push(waitDays(longest.days),waitDays(shortest.days),waitDays(gap),middle?waitDays(middle.days):'');
   }else{
    waitBullets=['The median wait was about '+waitDays(shortest.days)+' across the groups we could compare.',
     'That’s based on the last 28 days.'];
    waitEmphasis.push(waitDays(shortest.days));
   }
  }else if(metrics.wait!==null){
   waitBullets.unshift('The median wait was '+roundWeeks(metrics.wait)+' for appointments booked at least a day ahead.');
   waitEmphasis.push(roundWeeks(metrics.wait));
   if(metrics.priorWait!==null)waitBullets.push('It was '+roundWeeks(metrics.priorWait)+' in the previous 28 days.');
  }
  const hasWaitRange=reportable.length>=2&&longest.days>shortest.days;
  metrics.longWait=hasWaitRange?longest.days:null;
  metrics.shortWait=hasWaitRange?shortest.days:null;
  metrics.waitGap=hasWaitRange?Math.round((longest.days-shortest.days)*10)/10:null;
  metrics.middleWait=middle?.days??null;
  setInsight('routine',1,'Waiting times',waitBullets,waitEmphasis,
   {longestGroup:hasWaitRange?longest.label:'',shortestGroup:hasWaitRange?shortest.label:'',middleGroup:middle?.label||''});
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
  metrics.riskCoverDays=risk&&risk.cover<1?Math.max(.1,Math.round(risk.cover*70)/10):null;
  metrics.riskCover=risk&&risk.cover>=1?Math.round(risk.cover*10)/10:null;
  const coverLabel=metrics.riskCoverDays!==null?waitDays(metrics.riskCoverDays):metrics.riskCover!==null?roundWeeks(metrics.riskCover):'';
  const segmentLabel=risk?group+' ('+mode+')':'';
  setInsight('routine',2,'Forward availability',risk?[
   segmentLabel+' has the least cover.',
   integer(risk.slots)+' slots are open in the diary.',
   'That’s about '+coverLabel+' at the recent booking pace if no more slots are released.'
  ]:['There’s too little data to see which slots may run out first.'],
   risk?[segmentLabel,coverLabel,integer(risk.slots)+' slots']:[],{riskGroup:segmentLabel});
  metrics.routineUnused=unused;
  metrics.routineUnusedShare=unusedShare;
  metrics.routineUnusedYear=unusedComparison.year;
  metrics.routineUnusedAverage=unusedComparison.average;
  metrics.routineUnusedPrevious=unusedComparison.previous;
  metrics.routineUnusedGroupCount=hotspot?Math.round(topCount):null;
  setInsight('routine',3,'Unused capacity',unusedBullets,unusedEmphasis,{routineUnusedGroup:hotspot?topMissed:''});
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
    for(const card of home.querySelectorAll('.iq-home-'+care+' .iq-home-insight'))card.querySelector('small').textContent='Upload appointment reports to see this insight.';
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
  const lastForecastWeek=shift(nextWeek,(peakForecastWeeks-1)*7);
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
   const projection=Array.from({length:care==='acute'?peakForecastWeeks:4},(_,i)=>{
    const weekStart=shift(nextWeek,i*7);
    const range=holidayWeeks.has(weekStart)?null:predictor?.range?.(weekStart,true);
    return {...range,weekStart};
   });
   series.push({care,history,adjustedHistory,forecast:projection.slice(0,4),peakForecast:projection.filter(row=>!holidayWeeks.has(row.weekStart)),groups:groupNames[care],bookingMap:weekCounts});
  }
  const coverage=typeof slotReportCoverage==='undefined'?[]:slotReportCoverage;
  const datedCoverage=coverage.filter(range=>GPCorrectness.validDate(range.asOf));
  const coveredCapacityWeeks=new Set(GPCorrectness.completeWeeks(datedCoverage,shift(latestCompleteWeek,7),56)
   .filter(week=>coverage.every(range=>
    range.end<week||range.start>shift(week,6)||range.asOf>(range.end<shift(week,6)?range.end:shift(week,6)))));
  const axis=sharedAxis(series);
  for(const item of series)renderCare(item.care,{...item,axis,historyStart,latestCompleteWeek,today:date,holidayWeeks,coveredCapacityWeeks},metrics);
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
