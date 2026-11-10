(function(){
'use strict';
// Read-only practice home. Uses the same imported records, slot mappings and
// weekday/seasonal predictor as the detailed dashboard. No patient identifiers.
const $=id=>document.getElementById(id);
const isoDay=(value)=>new Date(value+'T12:00:00Z');
const shift=(date,days)=>{const d=isoDay(date);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const monday=date=>shift(date,-((isoDay(date).getUTCDay()+6)%7));
const fmtDate=date=>isoDay(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const fmtLong=date=>isoDay(date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const integer=value=>Math.round(value).toLocaleString('en-GB');
const percent=value=>(value>=0?'+':'')+Math.round(value)+'%';
const weight=row=>Number.isFinite(Number(row.count))?Math.max(0,Number(row.count)):0;
const careFor=slot=>{
 const name=capacityUrgencyCategory(slot);
 if(!name||!isDashboardToggleOption(name))return '';
 const type=appointmentCalculationRole(name);
 return type==='urgent'?'acute':type==='routine'?'routine':'';
};
const allowed=row=>row&&!excludedSlotTypes.has(row.slot)&&careFor(row.slot);
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
function renderChart(section,history,forecast,colour){
 const root=$('homePage')?.querySelector('.iq-home-'+section+' .iq-home-plot');if(!root)return;
 root.replaceChildren();
 if(!history.some(v=>v!==null)){
  const empty=document.createElement('p');empty.className='iq-home-chart-empty';
  empty.textContent='No recent booked appointment data for this category.';
  root.append(empty);return;
 }
 const legend=document.createElement('div');legend.className='iq-home-legend';
 legend.textContent='● Booked appointments   ·   ○ Forecast (indicative range)';
 root.append(legend);
 const values=[...history.filter(Number.isFinite),...forecast.filter(Boolean).flatMap(x=>[x.estimate,x.high,x.low].filter(Number.isFinite))];
 const ymax=Math.max(1,...values)*1.12;
 const svg=svgElement('svg',{viewBox:'0 0 728 155',class:'iq-home-chart-svg',role:'img','aria-label':(section==='acute'?'Acute':'Routine')+' appointments over recent complete weeks and next four weeks with predicted uncertainty'});
 const xpos=i=>30+i*83;
 const ypos=v=>110-Math.min(1,Math.max(0,v/ymax))*91;
 svg.append(svgElement('line',{x1:17,y1:110,x2:710,y2:110,stroke:'#d9e5ef','stroke-width':1.5}));
 svg.append(svgElement('line',{x1:361,y1:12,x2:361,y2:114,stroke:'#8baec5','stroke-width':1.5,'stroke-dasharray':'4 5'}));
 // Each series is a separate line: missing or sparse weeks never become zero.
 let current=[];
 const addPath=()=>{if(current.length>1)svg.append(svgElement('path',{d:current.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' '),fill:'none',stroke:colour,'stroke-width':3.5,'stroke-linecap':'round','stroke-linejoin':'round'}));current=[]};
 for(let i=0;i<history.length;i++){const value=history[i];if(value===null){addPath();continue}current.push([xpos(i),ypos(value)])}addPath();
 const last=history[history.length-1];
 const projected=forecast.map((item,i)=>item&&Number.isFinite(item.estimate)?{x:xpos(5+i),...item}:null);
 const allProjected=projected.filter(Boolean);
 const begin=last!==null?[[xpos(4),ypos(last)]]:[];
 const dotted=[...begin,...allProjected.map(x=>[x.x,ypos(x.estimate)])];
 if(dotted.length>1)svg.append(svgElement('path',{d:dotted.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' '),fill:'none',stroke:colour,'stroke-width':2.6,'stroke-dasharray':'7 6'}));
 for(let i=0;i<history.length;i++)if(history[i]!==null){svg.append(svgElement('circle',{cx:xpos(i),cy:ypos(history[i]),r:5.3,fill:colour,stroke:'#fff','stroke-width':1.8}));}
 for(const row of allProjected){
  if(Number.isFinite(row.low)&&Number.isFinite(row.high)){
   svg.append(svgElement('path',{d:'M'+row.x+' '+ypos(row.low)+'V'+ypos(row.high)+' M'+(row.x-6)+' '+ypos(row.low)+'H'+(row.x+6)+' M'+(row.x-6)+' '+ypos(row.high)+'H'+(row.x+6),stroke:colour,'stroke-width':2,fill:'none'}));
  }
  const dot=svgElement('circle',{cx:row.x,cy:ypos(row.estimate),r:5.6,stroke:colour,fill:'#fff','stroke-width':2.3});
  dot.append(svgElement('title',{},'Predicted '+integer(row.estimate)+(Number.isFinite(row.low)?' (indicative range '+integer(row.low)+'–'+integer(row.high)+')':'')));
  svg.append(dot);
 }
 const stamps=[...history.map((_,i)=>shift(window.iqHomeOverviewHistoryWeekStart,i*7)),...forecast.map(x=>x?.weekStart||'')];
 for(let i=0;i<stamps.length;i++)if(stamps[i])svg.append(svgElement('text',{x:xpos(i),y:139,'text-anchor':'middle',fill:'#2f526e','font-size':11,'font-family':'Arial, sans-serif'},fmtDate(stamps[i])));
 root.append(svg);
}
function renderCare(section,options){
 const {history,forecast,groups,bookingMap,latestCompleteWeek,earliestBooked,today}=options;
 const care=section==='acute'?'acute':'routine',groupSet=new Set(groups);
 const values=history.map(x=>x===null?0:x);
 const currentFour=history.slice(1);
 const completeCurrent=currentFour.filter(v=>v!==null);
 const recentMean=completeCurrent.length>=3?completeCurrent.reduce((a,b)=>a+b,0)/completeCurrent.length:null;
 const predicted=forecast.filter(x=>x&&Number.isFinite(x.estimate));
 const meanForecast=predicted.length===4?predicted.reduce((a,b)=>a+b.estimate,0)/4:null;
 const change=recentMean!==null&&meanForecast!==null?signedTrend(meanForecast,recentMean):null;
 setOutlook(section,change!==null?percent(change):'—',change===null?'Forecast unavailable':'next 4 weeks');
 renderChart(section,history,forecast,section==='acute'?'#f03265':'#0b9c7f');
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
  const start=shift(latestCompleteWeek,-21),end=shift(latestCompleteWeek,6);
  const counts=new Map(),missed=new Map();
  const clock=capacitySnapshotClock();
  let extra=0,unfilled=0;
  for(const row of availabilityRecords){
   if(!allowed(row)||careFor(row.slot)!=='acute'||row.date<start||row.date>end)continue;
   const n=weight(row),group=clinicianGroup(row);
   if(String(capacityAssignments[row.slot]||'').toLowerCase()==='extra'&&String(row.availability).toLowerCase()==='booked'){
    extra+=n;counts.set(group,(counts.get(group)||0)+n);
   }
   if(String(row.availability).toLowerCase()==='available'&&isMissedAvailableSlot(row,clock)){
    unfilled+=n;missed.set(group,(missed.get(group)||0)+n);
   }
  }
  const first=(map)=>[...map].sort((a,b)=>b[1]-a[1])[0];
  const topExtra=first(counts),topMissed=first(missed);
  const configuredExtra=Object.values(capacityAssignments).some(x=>String(x).trim().toLowerCase()==='extra');
  setInsight('acute',1,'Extra capacity',extra>0?
   integer(extra)+' urgent Extra slots were booked over the last four complete weeks'+(topExtra&&topExtra[0]!=='Unassigned'?', most often by '+topExtra[0]:'')+'.':
   configuredExtra?'No booked Extra urgent slots were identified in the last four complete weeks.':'Extra slot types have not been configured; map them in Slot Settings.');
  setInsight('acute',2,'Unused capacity',clock===null?'A dated Slot Report is needed to identify previously unfilled appointments.':
   unfilled>0?integer(unfilled)+' urgent slots remained unfilled in the latest report snapshot'+(topMissed&&topMissed[0]!=='Unassigned'?', most often in '+topMissed[0]:'')+'.':
   'No previously unfilled urgent slots were identified in the latest imported snapshot.');
 }else{
  let desc=previous!==null?(Math.round(previous)===0?'Routine bookings are similar to the preceding four weeks.':'Routine bookings are '+Math.abs(Math.round(previous))+'% '+(previous>=0?'higher':'lower')+' than the preceding four weeks.'):'Routine bookings are available, but the previous period has insufficient data for comparison.';
  if(yoy!==null)desc+=Math.round(yoy)===0?' They are similar to the same period last year.':' They are '+Math.abs(Math.round(yoy))+'% '+(yoy>=0?'above':'below')+' the same period last year.';
  setInsight('routine',0,'Demand trend',desc);
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
   for(const care of ['acute','routine']){
    setOutlook(care,'—','No appointment data');
    renderChart(care,[null,null,null,null,null],[],care==='acute'?'#f03265':'#0b9c7f');
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
  window.iqHomeOverviewHistoryWeekStart=shift(latestCompleteWeek,-28);
  const nextWeek=shift(presentMonday,7);
  const slots=all.filter(allowed);
  const groupNames={acute:[],routine:[]};
  for(const name of groupUrgencyNames.filter(isDashboardToggleOption)){
   const kind=appointmentCalculationRole(name);
   if(kind==='urgent')groupNames.acute.push(name);
   if(kind==='routine')groupNames.routine.push(name);
  }
  for(const care of ['acute','routine']){
   const weekCounts=new Map();
   for(const row of slots){
    if(careFor(row.slot)!==care||!row.bookedDay||row.bookedDay>=date)continue;
    const mondayKey=row.bookedWeek||monday(row.bookedDay);
    weekCounts.set(mondayKey,(weekCounts.get(mondayKey)||0)+weight(row));
   }
   const history=Array.from({length:5},(_,i)=>{const w=shift(latestCompleteWeek,(i-4)*7);return weekCounts.has(w)?weekCounts.get(w):null});
   const predictor=window.getHomeOverviewPredictor?.(groupNames[care],care==='acute'?'urgent':'routine');
   const projection=Array.from({length:4},(_,i)=>{
    const weekStart=shift(nextWeek,i*7);
    const range=predictor?.range?.(weekStart,true);
    return range?{...range,weekStart}:null;
   });
   renderCare(care,{history,forecast:projection,groups:groupNames[care],bookingMap:weekCounts,latestCompleteWeek,earliestBooked,today:date});
  }
  if(caveat){
   const totalRecords=slots.length;
   const earliest=slots.reduce((min,r)=>r.bookedDay&&(!min||r.bookedDay<min)?r.bookedDay:min,'');
   const current=slots.reduce((max,r)=>r.bookedDay&&r.bookedDay<date&&r.bookedDay>max?r.bookedDay:max,'');
   caveat.textContent=(earliest?'Forecast models fitted using all uploaded booking history ('+fmtLong(earliest)+' to '+fmtLong(current)+'). ':'')+
    'Charts show the latest five complete weeks and next four weeks. Error bars reflect indicative historical forecasting variation, not formal confidence intervals. Booking activity is a proxy for demand; capacity status comes from the latest imported slot reports.';
  }
 }catch(error){
  console.error('Home overview calculations could not be completed',error);
  const note=home.querySelector('.iq-home-caveat');if(note)note.textContent='Could not calculate the home overview from the imported data. Detailed pages remain available.';
  for(const care of ['acute','routine']){setOutlook(care,'—','Unavailable');renderChart(care,[null,null,null,null,null],[],care==='acute'?'#f03265':'#0b9c7f');}
 }finally{rendering=false}
}
window.updateHomeOverview=update;
})();
