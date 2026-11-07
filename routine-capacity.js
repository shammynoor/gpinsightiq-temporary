/* Routine Capacity and Waiting Times — GP Insight IQ.
   Uses the same shared Slot Report aggregates and category/people mappings
   as the existing Activity/Capacity/Waiting Times screens.
   Indicative queue-clearance scenario, NOT a validated demand model. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const shift=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const monday=iso=>shift(iso,-((new Date(iso+'T12:00:00Z').getUTCDay()+6)%7));
const londonToday=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const fmt=n=>Math.round(n).toLocaleString('en-GB');
const finite=n=>Number.isFinite(n)?n:0;
const ui={target:2,disabledModes:new Set(),modeSignature:'',cached:null,signature:''};
let preferenceAccount=null;
function syncRoutineCapacityPreferences(){
 const api=window.gpChartPreferences,account=api?.account();if(account===preferenceAccount)return;
 preferenceAccount=account;
 const target=api?.read()['routineCapacity:target'];ui.target=Number.isInteger(target)&&target>=1&&target<=6?target:2;
 ui.disabledModes.clear();ui.modeSignature='';ui.cached=null;ui.signature='';
}
function isRoutine(group){return appointmentCalculationRole(group)==='routine'}
function doctorGroups(){
 return (clinicianGroupNames||[]).filter(isDoctorPlanningGroup);
}
function rowMode(slot){const assigned=consultAssignments[slot];return consultCategoryNames.includes(assigned)?assigned:(suggestConsultMode(slot)||'')}
function included(r,doctors){
 if(!r||excludedSlotTypes.has(r.slot)||!isRoutine(capacityUrgencyCategory(r.slot)))return false;
 const type=effectiveClinicianType(r.clinician,r.person);
 const group=clinicianGroupAssignments[type]||'';
 return doctors.includes(group);
}
function median(pairs){
 pairs.sort((a,b)=>a[0]-b[0]);const sum=pairs.reduce((n,p)=>n+p[1],0);
 if(!sum)return NaN;
 let n=0;for(const [v,count] of pairs){n+=count;if(n>=sum/2)return v}return pairs.at(-1)[0];
}
function setText(id,text){const el=$(id);if(el)el.textContent=text}
function empty(note){
 for(const id of ['routineCapDemand','routineCapWait','routineCapSupply'])setText(id,'—');
 setText('routineCapHelp',note);
 $('routineCapChart')?.replaceChildren();
 $('routineCapRows')?.replaceChildren();
 setText('routineCapOutcome','No estimate available.');
}
function availableModes(doctors){
 const found=new Set();
 for(const r of availabilityRecords){
  if(String(r.availability).toLowerCase()!=='booked'||!included(r,doctors))continue;
  const mode=rowMode(r.slot);if(mode&&isDashboardToggleOption(mode))found.add(mode);
 }
 return prioritySort('mode',[...found]);
}
function renderModes(modes){
 const root=$('routineCapConsult');if(!root)return;
 const signature=modes.join('|');
 if(signature===ui.modeSignature)return;
 ui.modeSignature=signature;ui.disabledModes=new Set([...ui.disabledModes].filter(n=>modes.includes(n)));if(modes.length&&ui.disabledModes.size===modes.length)ui.disabledModes.delete(modes[0]);root.replaceChildren();
 for(const name of modes){
  const label=document.createElement('label');label.className='filter-row';
  const switcher=document.createElement('span');switcher.className='switch';
  const input=document.createElement('input');input.type='checkbox';input.checked=!ui.disabledModes.has(name);
  input.setAttribute('role','switch');input.dataset.filterName=name;input.dataset.mode=name;input.setAttribute('aria-label','Include '+name);
  const track=document.createElement('span');track.className='switch-track';
  switcher.append(input,track);label.append(switcher,document.createTextNode(name));root.append(label);
  input.addEventListener('change',()=>{
   if(!input.checked&&ui.disabledModes.size>=modes.length-1){input.checked=true;return}
   if(input.checked)ui.disabledModes.delete(name);else ui.disabledModes.add(name);
   window.renderRoutineCapacity();
  });
 }
 if(!modes.length)root.textContent='No configured consultation modes';
}
function modelData(){
 if(typeof records==='undefined'||typeof availabilityRecords==='undefined'||typeof waitingTrendRecords==='undefined')return {error:'Appointment data has not loaded.'};
 const doctors=doctorGroups();
 if(!doctors.length)return {error:'Please enable a doctor group for routine capacity in People Settings and assign GP clinician types to it.'};
 const modes=availableModes(doctors);renderModes(modes);
 if(!modes.length)return {error:'No booked routine doctor appointments with mapped consultation modes.'};
 const allowed=r=>included(r,doctors)&&!ui.disabledModes.has(rowMode(r.slot))&&modes.includes(rowMode(r.slot));
 const allWeeks=GPCorrectness.completeWeeks(slotReportCoverage,londonToday(),Number($('routineCapHistory')?.value||52));
 if(allWeeks.length<8)return {error:'At least eight complete covered weeks of routine doctor history are needed.'};
 const includedWeeks=new Set(allWeeks),start=allWeeks[0],end=shift(allWeeks.at(-1),6);
 const appts=new Map(),bookings=new Map(),leads=[];
 const oldest=start;
 for(const r of availabilityRecords){
  if(String(r.availability).toLowerCase()!=='booked'||r.date<start||r.date>end||!includedWeeks.has(monday(r.date))||!allowed(r))continue;
  const key=monday(r.date);appts.set(key,(appts.get(key)||0)+r.count);

 }
 for(const r of records){
  if(r.bookedDay<start||r.bookedDay>end||!includedWeeks.has(monday(r.bookedDay))||!allowed(r))continue;
  const key=monday(r.bookedDay);bookings.set(key,(bookings.get(key)||0)+r.count);
 }
 for(const r of waitingTrendRecords){
  if(r.appointmentDate<start||r.appointmentDate>end||!includedWeeks.has(monday(r.appointmentDate))||!allowed(r)||!Number.isFinite(r.leadMinutes)||r.leadMinutes<0)continue;
  leads.push([r.leadMinutes/10080,r.count]);
 }
 if(!oldest||!leads.length)return {error:'Not enough routine doctor appointments with valid booking-to-appointment times.'};
 if(allWeeks.length<8)return {error:'At least eight complete weeks of routine doctor history are needed.'};
 const delivered=allWeeks.reduce((total,w)=>total+(appts.get(w)||0),0)/allWeeks.length;
 const demand=allWeeks.reduce((total,w)=>total+(bookings.get(w)||0),0)/allWeeks.length;
 const wait=median(leads);
 if(!(demand>0&&delivered>0&&Number.isFinite(wait)))return {error:'Insufficient complete booking, capacity or waiting-time information.'};
 return {demand,capacity:delivered,wait,count:allWeeks.length,start:oldest,end,
    isProxy:true,daysObserved:leads.reduce((a,b)=>a+b[1],0)};
}
function capacityFor(model,target,horizon){
 // Approximate reduction in waiting workload = weekly served demand ×
 // reduction in weeks of median wait. Distributed over planning horizon.
 // Ongoing demand is always maintained; allowing more waiting never means
 // the practice can safely supply fewer appointments than demand.
 return Math.ceil(Math.max(model.capacity,model.demand*(1+Math.max(0,model.wait-target)/horizon)));
}
function svgEl(tag,attrs,text){
 const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [k,v] of Object.entries(attrs||{}))e.setAttribute(k,String(v));
 if(text!==undefined)e.textContent=String(text);return e;
}
function drawChart(model,horizon){
 const root=$('routineCapChart');if(!root)return;root.replaceChildren();
 const width=900,height=250,pad={l:68,r:28,t:24,b:49};
 const values=Array.from({length:6},(_,i)=>capacityFor(model,i+1,horizon));
 const lo=Math.max(0,Math.floor(Math.min(model.capacity,...values)/25)*25-25);
 const hi=Math.ceil(Math.max(model.capacity,...values)/25)*25+25;
 const y=v=>pad.t+(hi-v)/(hi-lo)*(height-pad.t-pad.b);
 const x=i=>pad.l+i*(width-pad.l-pad.r)/5;
 const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':'Estimated weekly routine doctor appointments required for waiting times of one to six weeks'});
 svg.style.width='100%';svg.style.display='block';
 for(let j=0;j<=4;j++){
  const value=lo+(hi-lo)*j/4,yy=y(value);
  svg.append(svgEl('line',{x1:pad.l,y1:yy,x2:width-pad.r,y2:yy,stroke:'#e3ebf2','stroke-width':1}));
  svg.append(svgEl('text',{x:pad.l-12,y:yy+4,'text-anchor':'end',fill:'#72879b','font-size':12},fmt(value)));
 }
 const cur=y(model.capacity);
 svg.append(svgEl('line',{x1:pad.l,y1:cur,x2:width-pad.r,y2:cur,stroke:'#a6b9c9','stroke-dasharray':'6 5','stroke-width':1.4}));
 svg.append(svgEl('text',{x:width-pad.r,y:Math.max(12,cur-8),'text-anchor':'end',fill:'#70869c','font-size':12},'Current capacity'));
 const path=values.map((v,i)=>(i?'L':'M')+x(i)+' '+y(v)).join(' ');
 svg.append(svgEl('path',{d:path,stroke:'#2577ad','stroke-width':3,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}));
 for(let i=0;i<values.length;i++){
  const isSelected=ui.target===i+1;
  svg.append(svgEl('circle',{cx:x(i),cy:y(values[i]),r:isSelected?7:5,stroke:'#2577ad','stroke-width':2.5,fill:isSelected?'#2577ad':'white'}));
  svg.append(svgEl('text',{x:x(i),y:y(values[i])-13,'text-anchor':'middle',fill:'#254d69','font-size':13,'font-weight':isSelected?750:600},fmt(values[i])));
  svg.append(svgEl('text',{x:x(i),y:height-21,'text-anchor':'middle',fill:'#71869a','font-size':12},(i+1)+' week'+(i?'s':'')));
 }
 root.append(svg);
}
function renderRows(model,horizon){
 const root=$('routineCapRows');if(!root)return;root.replaceChildren();
 for(let target=1;target<=6;target++){
  const capacity=capacityFor(model,target,horizon),difference=capacity-Math.round(model.capacity);
  const row=document.createElement('tr');row.tabIndex=0;row.setAttribute('role','button');
  row.setAttribute('aria-label','Explore target '+target+' weeks');
  if(target===ui.target)row.className='routine-capacity-selected';
  for(const text of [target+' week'+(target===1?'':'s'),fmt(capacity),(difference>0?'+':'')+fmt(difference)]){
   const cell=document.createElement('td');cell.textContent=text;row.append(cell);
  }
  row.addEventListener('click',()=>{ui.target=target;window.gpChartPreferences?.write('routineCapacity:target',target);renderRows(model,horizon);drawChart(model,horizon)});
  row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click()}});
  root.append(row);
 }
 const needed=capacityFor(model,ui.target,horizon),extra=needed-Math.round(model.capacity);
 const qualifier=model.wait<=ui.target?'Maintain the observed booking rate; no queue reduction is modelled.':
  'Indicative additional capacity to reduce the observed median wait.';
 setText('routineCapOutcome','To aim for a '+ui.target+'-week wait over '+horizon+' weeks: '+fmt(needed)+' appointments/week ('+(extra>0?'+':'')+fmt(extra)+' vs current delivered capacity). '+qualifier);
}
window.renderRoutineCapacity=function(){
 const page=$('routineCapacityPage');if(!page||page.classList.contains('hidden'))return;
 try{
  syncRoutineCapacityPreferences();
  const model=modelData();if(model.error){empty(model.error);return}
  const horizon=Number($('routineCapHorizon')?.value||12);
  setText('routineCapDemand',fmt(model.demand));
  setText('routineCapWait',model.wait.toFixed(1)+' weeks');
  setText('routineCapSupply',fmt(model.capacity));
  setText('routineCapHelp','Observed '+model.count+' complete weeks ('+model.start+' to '+model.end+') · '+fmt(model.daysObserved)+' appointments with lead times. Booking demand counts served requests only.');
  drawChart(model,horizon);renderRows(model,horizon);
 }catch(e){
  console.error('Routine capacity error',e);
  empty('Unable to calculate routine capacity. Check appointment and category data.');
 }
};
document.addEventListener('DOMContentLoaded',()=>{
 $('routineCapHorizon')?.addEventListener('change',window.renderRoutineCapacity);
 $('routineCapHistory')?.addEventListener('change',window.renderRoutineCapacity);
});
})();