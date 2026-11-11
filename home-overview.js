(function(){
'use strict';
// Read-only practice home. Uses the same imported records, slot mappings and
// weekday/seasonal predictor as the detailed dashboard. No patient identifiers.
const $=id=>document.getElementById(id);
const historyWeeks=13;
const insightVersion='home-insights-v2';
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
const setInsight=(section,index,title,description)=>{
 const card=$( 'homePage')?.querySelector('.iq-home-'+section+' .iq-home-insights');
 const item=card?.querySelectorAll('.iq-home-insight')[index];
 if(!item)return;
 item.querySelector('strong').textContent=title;
 item.querySelector('small').textContent=description;
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
 legend.textContent='● Booked appointments   ·   ○ Forecast (indicative range)';
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
  if(forecastLine.length>1)svg.append(svgElement('path',{d:forecastLine.map((point,i)=>(i?'L':'M')+point.join(' ')).join(' '),fill:'none',stroke:colour,'stroke-width':2.6,'stroke-dasharray':'7 6'}));
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
   svg.append(svgElement('path',{d:'M'+x+' '+ypos(row.low)+'V'+ypos(row.high)+' M'+(x-5)+' '+ypos(row.low)+'H'+(x+5)+' M'+(x-5)+' '+ypos(row.high)+'H'+(x+5),stroke:colour,'stroke-width':2,fill:'none'}));
  }
  const dot=svgElement('circle',{cx:x,cy:ypos(row.estimate),r:4.7,stroke:colour,fill:'#fff','stroke-width':2});
  dot.append(svgElement('title',{},fmtDate(row.weekStart)+': '+integer(row.estimate)+' predicted'+(Number.isFinite(row.low)?' (indicative range '+integer(row.low)+'–'+integer(row.high)+')':'')));
  svg.append(dot);
 });
 root.append(svg);
}
const insightCards={
 seasonalDemand:['acute',0,'Seasonal demand'],
 extraCapacity:['acute',1,'Extra capacity'],
 unusedCapacity:['acute',2,'Unused capacity'],
 routineDemand:['routine',0,'Demand trend'],
 waitingTimes:['routine',1,'Waiting times'],
 forwardAvailability:['routine',2,'Forward availability']
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
 if(section==='acute'){
  const desc=meanForecast===null?'Not enough booked appointment history for a reliable four-week forecast.':
   change===null?'Urgent capacity is forecast for the next four weeks. Recent bookings are insufficient for a trend comparison.':
   'Urgent bookings are forecast to '+(change>=0?'rise':'fall')+' by about '+Math.abs(Math.round(change))+'% over the next four weeks.';
  setInsight('acute',0,'Seasonal demand',desc+(yoy!==null?Math.abs(Math.round(yoy))===0?' Recent bookings are similar to the same weeks last year.':' Recent bookings are '+Math.abs(Math.round(yoy))+'% '+(yoy>=0?'above':'below')+' the same weeks last year.':' A reliable last-year comparison is not available.'));
  metrics.forecast=reportableChange(change,recentMean,meanForecast);
  metrics.acuteYear=reportableChange(yoy,sumWeeks(currentWeeks),sumWeeks(lastYearWeeks));
  const start=shift(latestCompleteWeek,-21),end=shift(latestCompleteWeek,6);
  const counts=new Map(),missed=new Map();
  const clock=capacitySnapshotClock();
  let extra=0,unfilled=0;
  for(const row of availabilityRecords){
   if(!allowed(row)||careFor(row.slot)!=='acute'||row.date<start||row.date>end)continue;
   const n=weight(row),group=clinicianGroup(row);
   if(isExtraAppointmentType(capacityUrgencyCategory(row.slot))&&String(row.availability).toLowerCase()==='booked'){
    extra+=n;counts.set(group,(counts.get(group)||0)+n);
   }
   if(String(row.availability).toLowerCase()==='available'&&isMissedAvailableSlot(row,clock)){
    unfilled+=n;missed.set(group,(missed.get(group)||0)+n);
   }
  }
  const first=(map)=>[...map].sort((a,b)=>b[1]-a[1])[0];
  const topExtra=first(counts),topMissed=first(missed);
  metrics.extra=reportableCount(extra);
  metrics.unused=clock===null?null:reportableCount(unfilled);
  const configuredExtra=groups.some(isExtraAppointmentType);
  setInsight('acute',1,'Extra capacity',extra>0&&metrics.extra===null?
   'Booked urgent Extra slots were below the reporting threshold over the last four complete weeks.':extra>0?
   integer(extra)+' urgent Extra slots were booked over the last four complete weeks'+(topExtra&&topExtra[0]!=='Unassigned'?', most often by '+topExtra[0]:'')+'.':
   configuredExtra?'No booked urgent Extra slots were identified in the last four complete weeks.':'Map the Extra appointment type under Urgent Care in Slot Settings.');
  setInsight('acute',2,'Unused capacity',clock===null?'A dated Slot Report is needed to identify previously unfilled appointments.':
   unfilled>0?integer(unfilled)+' urgent slots remained unfilled in the latest report snapshot'+(topMissed&&topMissed[0]!=='Unassigned'?', most often in '+topMissed[0]:'')+'.':
   'No previously unfilled urgent slots were identified in the latest imported snapshot.');
 }else{
  let desc=previous!==null?(Math.round(previous)===0?'Routine bookings are similar to the preceding four weeks.':'Routine bookings are '+Math.abs(Math.round(previous))+'% '+(previous>=0?'higher':'lower')+' than the preceding four weeks.'):'Routine bookings are available, but the previous period has insufficient data for comparison.';
  if(yoy!==null)desc+=Math.round(yoy)===0?' They are similar to the same period last year.':' They are '+Math.abs(Math.round(yoy))+'% '+(yoy>=0?'above':'below')+' the same period last year.';
  setInsight('routine',0,'Demand trend',desc);
  metrics.routineTrend=reportableChange(previous,sumWeeks(currentWeeks),sumWeeks(previousWeeks));
  metrics.routineYear=reportableChange(yoy,sumWeeks(currentWeeks),sumWeeks(lastYearWeeks));
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
  setInsight('routine',1,'Waiting times',latest===null?'Not enough recent routine appointments to calculate a reliable median waiting time.':
   older===null?'Median routine booking-to-appointment wait is '+roundWeeks(latest)+'; an earlier comparison is unavailable.':
   'Median routine waits '+(latest<=older?'fell':'rose')+' from '+roundWeeks(older)+' to '+roundWeeks(latest)+' in the most recent four weeks.');
  const future=availabilityRecords.filter(r=>allowed(r)&&careFor(r.slot)==='routine'&&r.date>=today&&String(r.availability).toLowerCase()==='available'&&weight(r)>0);
  const allSlots=future.reduce((n,r)=>n+weight(r),0);
  const finalDate=future.reduce((last,r)=>r.date>last?r.date:last,'');
  metrics.wait=latest===null?null:Math.round(latest*10)/10;
  metrics.priorWait=latest===null||older===null?null:Math.round(older*10)/10;
  metrics.available=reportableCount(allSlots);
  metrics.horizon=metrics.available===null||!finalDate?null:Math.ceil((isoDay(finalDate)-isoDay(today))/604800000);
  setInsight('routine',2,'Forward availability',finalDate?
   integer(allSlots)+' routine slots are currently marked available in the uploaded diary, with the latest on '+fmtDate(finalDate)+'. This is the diary horizon, not a predicted run-out date.':
   'No future available routine slots were identified in the latest import. Check the Slot Report coverage before interpreting this as a shortage.');
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
    for(let i=0;i<3;i++)setInsight(care,i,['Activity','Capacity','Outlook'][i],'Upload appointment reports to enable this insight.');
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
