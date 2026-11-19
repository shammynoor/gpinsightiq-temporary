(function(){
'use strict';
const byId=id=>document.getElementById(id);
const shift=(date,days)=>GPCorrectness.shift(date,days);
const monthKey=date=>date.slice(0,7);
const monthDate=month=>new Date(month+'-01T12:00:00Z');
const monthLabel=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
const fullLabel=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const number=new Intl.NumberFormat('en-GB');
let selectedMonth='',selectedAccount,openDay=null;
function nextMonth(month,offset){
 const date=monthDate(month);date.setUTCMonth(date.getUTCMonth()+offset);
 return date.toISOString().slice(0,7);
}
function includedCapacity(row,groups){
 return row.source!=='signposting'&&!excludedSlotTypes.has(row.slot)&&groups.has(capacityUrgencyCategory(row.slot))
  &&locumMatches(row,'dailyForecastPage')&&row.count>0
  &&['booked','available','blocked','embargoed'].includes(String(row.availability||'').trim().toLowerCase());
}
function dailyCapacity(rows,groups){
 const totals=new Map();
 for(const row of rows){
  if(!includedCapacity(row,groups))continue;
  totals.set(row.date,(totals.get(row.date)||0)+row.count);
 }
 return totals;
}
function dayAppointmentMix(rows,groups,date){
 const clinicians=new Map(),modes=new Map([['Face-to-face',0],['Phone',0]]);let total=0;
 for(const row of rows){
  if(row.date!==date||!includedCapacity(row,groups))continue;
  const clinician=clinicianGroupAssignments[effectiveClinicianType(row.clinician,row.person)]||'Unassigned';
  const mode=consultCategoryNames.includes(consultAssignments[row.slot])?consultAssignments[row.slot]:(suggestConsultMode(row.slot)||'Unassigned');
  const normal=mode.toLowerCase().replace(/[^a-z0-9]/g,'');
  const label=['facetoface','f2f','inperson'].includes(normal)?'Face-to-face'
   :['phone','telephone','telephoneconsultation','phoneconsultation'].includes(normal)?'Phone':mode;
  total+=row.count;clinicians.set(clinician,(clinicians.get(clinician)||0)+row.count);modes.set(label,(modes.get(label)||0)+row.count);
 }
 return {total,clinicians,modes};
}
// Largest remainders keep each displayed percentage split at exactly 100.0%.
function percentageSplit(counts,total){
 if(!(total>0))return [];
 const entries=[...counts].map(([label,count],i)=>({label,count,i,exact:count/total*1000,units:Math.floor(count/total*1000)}));
 const remaining=1000-entries.reduce((sum,row)=>sum+row.units,0);
 const ranked=[...entries].sort((a,b)=>(b.exact-b.units)-(a.exact-a.units)||a.i-b.i);
 for(let i=0;i<remaining;i++)ranked[i%ranked.length].units++;
 return entries.map(({label,count,units})=>({label,count,percent:units/10}));
}
function renderDayDetails(groups,known){
 const panel=byId('urgentPlanning2DayDetails');panel.replaceChildren();panel.hidden=!openDay;
 if(!openDay)return;
 const header=document.createElement('div');header.className='urgent-planning-detail-header';
 const title=document.createElement('h3');title.id='urgentPlanning2DayTitle';title.textContent=fullLabel.format(new Date(openDay+'T12:00:00Z'));
 const close=document.createElement('button');close.type='button';close.className='urgent-planning-detail-close';close.textContent='Close';
 close.addEventListener('click',()=>{const date=openDay;openDay=null;renderUrgentPlanningCalendar();byId('urgentPlanning2Grid').querySelector('[data-date="'+date+'"]')?.focus();});
 header.append(title,close);panel.append(header);
 const mix=dayAppointmentMix(availabilityRecords,groups,openDay);
 if(!known||!mix.total){const empty=document.createElement('p');empty.className='urgent-planning-detail-empty';empty.textContent=!groups.size?'No daily appointment types are selected.':!known?'No appointment report coverage for this day.':'No appointments for the selected daily types on this day.';panel.append(empty);return;}
 const body=document.createElement('div');body.className='urgent-planning-detail-mix';
 for(const [label,counts] of [['Clinician mix',new Map([...mix.clinicians].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])))],['Consultation type',mix.modes]]){
  const section=document.createElement('section'),heading=document.createElement('h4');heading.textContent=label;section.append(heading);
  const split=percentageSplit(counts,mix.total);
  if(label==='Consultation type'){
   const bar=document.createElement('div');bar.className='urgent-planning-consult-bar';bar.setAttribute('role','img');bar.setAttribute('aria-label',split.map(row=>row.label+' '+row.percent+'%').join(', '));
   for(const row of split){const segment=document.createElement('span');segment.className=row.label==='Face-to-face'?'mix-face':row.label==='Phone'?'mix-phone':'mix-other';segment.style.width=row.percent+'%';bar.append(segment);}section.append(bar);
  }
  const values=document.createElement('div');values.className=label==='Clinician mix'?'urgent-planning-clinician-mix':'urgent-planning-consult-mix';
  for(const row of split){const item=document.createElement('div'),name=document.createElement('span'),value=document.createElement('strong');name.textContent=row.label;value.textContent=number.format(row.percent)+'%';item.append(name,value);values.append(item);}section.append(values);body.append(section);
 }
 panel.append(body);
}
function appointmentShade(actual,need){
 if(!Number.isFinite(actual)||!Number.isFinite(need)||need<0)return null;
 const difference=need===0?(actual===0?0:1):(actual-need)/need;
 // Match the approved preview: distinct crimson, emerald and silver-blue cards.
 if(Math.abs(difference)<=.05)return 'rgb(35, 153, 106)';
 const strength=Math.min(1,Math.max(0,(Math.abs(difference)-.05)/.25));
 const start=difference<0?[220,124,139]:[153,184,210];
 const end=difference<0?[184,42,69]:[83,128,168];
 return 'rgb('+start.map((v,i)=>Math.round(v+(end[i]-v)*strength)).join(', ')+')';
}
function fitUrgentPlanningCalendar(){
 const page=byId('urgentPlanning2Page');
 if(!page||page.classList.contains('hidden'))return;
 const calendar=page.querySelector('.urgent-planning-calendar');
 const header=calendar.querySelector('.urgent-planning-calendar-header');
 const weekdays=calendar.querySelector('.urgent-planning-weekdays');
 const rows=Number(byId('urgentPlanning2Grid').style.getPropertyValue('--calendar-week-rows'))||6;
 const padding=getComputedStyle(calendar);
 const scroller=calendar.querySelector('.urgent-planning-calendar-scroll');
 const horizontalScrollbar=scroller.clientWidth<760?18:0;
 const chrome=header.getBoundingClientRect().height+6+weekdays.getBoundingClientRect().height
  +parseFloat(padding.paddingTop)+parseFloat(padding.paddingBottom)+2+horizontalScrollbar;
 const wrap=page.closest('.wrap');
 const bottom=wrap?parseFloat(getComputedStyle(wrap).paddingBottom):20;
 const detail=byId('urgentPlanning2DayDetails');
 const detailHeight=detail&&!detail.hidden?detail.getBoundingClientRect().height+10:0;
 const available=window.innerHeight-(calendar.getBoundingClientRect().top+window.scrollY)-bottom-2-detailHeight;
 const height=Math.min(Math.max(window.innerHeight*.5,chrome+rows*84),Math.max(chrome+rows*54,available));
 calendar.style.setProperty('--calendar-height',height+'px');
 calendar.classList.toggle('compact-days',(height-chrome)/rows<84);
}
function renderUrgentPlanningCalendar(){
 const page=byId('urgentPlanning2Page');
 if(!page||page.classList.contains('hidden'))return;
 const today=dayView2LondonClock().date;
 const forecast=window.readUrgentDailyPlanningForecast();
 const groups=new Set(forecast?.groups||[]);
 const targets=forecast?.daily||new Map();
 const weeklyGroups=new Set(forecast?.weeklyGroups||[]);
 const weeklyTargets=forecast?.weekly||new Map();
 const first=monthKey(today);
 const account=window.gpChartPreferences?.account?.();
 if(account!==selectedAccount){selectedAccount=account;selectedMonth=first;openDay=null;}
 if(!selectedMonth)selectedMonth=first;
 byId('urgentPlanning2Month').textContent=monthLabel.format(monthDate(selectedMonth));

 const capacity=dailyCapacity(availabilityRecords,groups);
 const weeklyCapacity=dailyCapacity(availabilityRecords,weeklyGroups);
 const grid=byId('urgentPlanning2Grid');grid.replaceChildren();
 const start=GPCorrectness.monday(selectedMonth+'-01');
 const finalDate=shift(nextMonth(selectedMonth,1)+'-01',-1);
 const end=shift(GPCorrectness.monday(finalDate),6);
 if(openDay&&(openDay<today||openDay<start||openDay>end))openDay=null;
 const weekRows=Math.floor((Date.parse(end)-Date.parse(start))/604800000)+1;
 grid.style.setProperty('--calendar-week-rows',String(weekRows));
 const coverage=slotReportCoverage.filter(range=>GPCorrectness.validDate(range.start)&&GPCorrectness.validDate(range.end));
 const covered=date=>coverage.some(range=>range.start<=date&&range.end>=date);
 function appendValues(cell,need,actual){
  const shade=appointmentShade(actual,typeof need==='number'?need:null);
  if(shade)cell.style.setProperty('--appointment-shade',shade);
  const values=document.createElement('dl');
  for(const [label,value] of [['Need',need],['Appts',actual]]){
   const term=document.createElement('dt'),amount=document.createElement('dd');
   term.textContent=label;amount.textContent=typeof value==='number'?number.format(value):value??'—';
   const row=document.createElement('div');
   row.className='urgent-planning-value'+(label==='Appts'?' urgent-planning-appointments':'');
   if(typeof value==='string')row.classList.toggle('is-text',true);
   row.append(term,amount);values.append(row);
  }
  cell.append(values);
 }
 for(let date=start;date<=end;date=shift(date,1)){
  const weekend=new Date(date+'T12:00:00Z').getUTCDay()%6===0;
  const interactive=!weekend&&date>=today;
  const cell=document.createElement(interactive?'button':'article');cell.className='urgent-planning-day';
  if(interactive){
   cell.type='button';cell.dataset.date=date;cell.setAttribute('aria-expanded',String(openDay===date));cell.setAttribute('aria-controls','urgentPlanning2DayDetails');
   cell.addEventListener('click',()=>{openDay=openDay===date?null:date;renderUrgentPlanningCalendar();grid.querySelector('[data-date="'+date+'"]')?.focus();});
  }
  cell.classList.toggle('day-open',openDay===date);
  cell.classList.toggle('outside-month',monthKey(date)!==selectedMonth);
  cell.classList.toggle('is-today',date===today);
  cell.classList.toggle('is-weekend',weekend);
  cell.setAttribute('aria-label',fullLabel.format(new Date(date+'T12:00:00Z')));
  const time=document.createElement('time');time.dateTime=date;time.textContent=String(Number(date.slice(-2)));
  if(date===today)time.setAttribute('aria-current','date');
  cell.append(time);
  if(date===today){const badge=document.createElement('span');badge.className='urgent-planning-today-label';badge.textContent='Today';cell.append(badge);}
  if(!weekend&&date>=today){
   const target=targets.get(date);
   const actual=groups.size&&(capacity.has(date)||covered(date))?capacity.get(date)||0:null;
   appendValues(cell,target?.bankHoliday?'Bank holiday':target?.suggested??null,actual);
  }
  grid.append(cell);
  if(new Date(date+'T12:00:00Z').getUTCDay()===0){
   const weekStart=shift(date,-6);
   const days=Array.from({length:7},(_,i)=>shift(weekStart,i));
   const weeklyCell=document.createElement('article');weeklyCell.className='urgent-planning-day urgent-planning-week';
   weeklyCell.setAttribute('aria-label','Weekly planning appointments, '+fullLabel.format(new Date(weekStart+'T12:00:00Z'))+' to '+fullLabel.format(new Date(date+'T12:00:00Z')));
   const heading=document.createElement('div');heading.className='urgent-planning-week-range';
   const shortDate=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
   heading.textContent=shortDate(weekStart)+'–'+shortDate(date);weeklyCell.append(heading);
   // Require complete report coverage before displaying a full-week capacity total.
   if(date>=today){
    const weeklyActual=weeklyGroups.size&&days.every(covered)?days.reduce((sum,day)=>sum+(weeklyCapacity.get(day)||0),0):null;
    appendValues(weeklyCell,weeklyGroups.size?weeklyTargets.get(weekStart)??null:null,weeklyActual);
   }
   grid.append(weeklyCell);
  }
 }
 renderDayDetails(groups,openDay&&(capacity.has(openDay)||covered(openDay)));
 fitUrgentPlanningCalendar();
}
window.renderUrgentPlanningCalendar=renderUrgentPlanningCalendar;
window.addEventListener('resize',fitUrgentPlanningCalendar);
if(window.ResizeObserver){
 const observer=new ResizeObserver(fitUrgentPlanningCalendar);
 const calendar=byId('urgentPlanning2Page')?.querySelector('.urgent-planning-calendar');
 if(calendar){observer.observe(calendar.querySelector('.urgent-planning-calendar-header'));observer.observe(calendar.querySelector('.urgent-planning-weekdays'));}
 const header=document.querySelector('.dashboard-header');if(header)observer.observe(header);
 const detail=byId('urgentPlanning2DayDetails');if(detail)observer.observe(detail);
}
byId('navUrgentPlanning2').addEventListener('click',()=>showPage('urgentPlanning2'));
for(const [id,offset] of [['urgentPlanning2Previous',-1],['urgentPlanning2Next',1]]){
 byId(id).addEventListener('click',()=>{selectedMonth=nextMonth(selectedMonth,offset);openDay=null;renderUrgentPlanningCalendar();});
}
byId('urgentPlanning2Today').addEventListener('click',()=>{selectedMonth=monthKey(dayView2LondonClock().date);openDay=null;renderUrgentPlanningCalendar();});
})();
