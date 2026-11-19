(function(){
'use strict';
const byId=id=>document.getElementById(id);
const shift=(date,days)=>GPCorrectness.shift(date,days);
const monthKey=date=>date.slice(0,7);
const monthDate=month=>new Date(month+'-01T12:00:00Z');
const monthLabel=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
const fullLabel=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const number=new Intl.NumberFormat('en-GB');
let selectedMonth='',selectedAccount;
function nextMonth(month,offset){
 const date=monthDate(month);date.setUTCMonth(date.getUTCMonth()+offset);
 return date.toISOString().slice(0,7);
}
function dailyCapacity(rows,groups){
 const totals=new Map();
 for(const row of rows){
  if(row.source==='signposting'||excludedSlotTypes.has(row.slot)||!groups.has(capacityUrgencyCategory(row.slot))
   ||!locumMatches(row,'dailyForecastPage')||!(row.count>0)
   ||!['booked','available','blocked','embargoed'].includes(String(row.availability||'').trim().toLowerCase()))continue;
  totals.set(row.date,(totals.get(row.date)||0)+row.count);
 }
 return totals;
}
function appointmentShade(actual,need){
 if(!Number.isFinite(actual)||!Number.isFinite(need)||need<0)return null;
 const difference=need===0?(actual===0?0:1):(actual-need)/need;
 // Stay green within 5%; blend to red below need or blue above need by 30%.
 const strength=Math.min(1,Math.max(0,(Math.abs(difference)-.05)/.25));
 const green=[35,157,99],extreme=difference<0?[204,66,72]:[40,112,210];
 return 'rgb('+green.map((v,i)=>Math.round(v+(extreme[i]-v)*strength)).join(', ')+')';
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
 const horizontalScrollbar=scroller.clientWidth<800?18:0;
 const chrome=header.getBoundingClientRect().height+6+weekdays.getBoundingClientRect().height
  +parseFloat(padding.paddingTop)+parseFloat(padding.paddingBottom)+2+horizontalScrollbar;
 const wrap=page.closest('.wrap');
 const bottom=wrap?parseFloat(getComputedStyle(wrap).paddingBottom):20;
 const available=window.innerHeight-(calendar.getBoundingClientRect().top+window.scrollY)-bottom-2;
 const height=Math.min(Math.max(window.innerHeight*.5,chrome+rows*78),Math.max(0,available));
 calendar.style.setProperty('--calendar-height',height+'px');
 calendar.classList.toggle('compact-days',(height-chrome)/rows<78);
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
 if(account!==selectedAccount){selectedAccount=account;selectedMonth=first;}
 if(!selectedMonth)selectedMonth=first;
 byId('urgentPlanning2Month').textContent=monthLabel.format(monthDate(selectedMonth));

 const capacity=dailyCapacity(availabilityRecords,groups);
 const weeklyCapacity=dailyCapacity(availabilityRecords,weeklyGroups);
 const grid=byId('urgentPlanning2Grid');grid.replaceChildren();
 const start=GPCorrectness.monday(selectedMonth+'-01');
 const finalDate=shift(nextMonth(selectedMonth,1)+'-01',-1);
 const end=shift(GPCorrectness.monday(finalDate),6);
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
  cell.append(values);grid.append(cell);
 }
 for(let date=start;date<=end;date=shift(date,1)){
  const cell=document.createElement('article');cell.className='urgent-planning-day';
  cell.classList.toggle('outside-month',monthKey(date)!==selectedMonth);
  cell.classList.toggle('is-today',date===today);
  cell.classList.toggle('is-weekend',new Date(date+'T12:00:00Z').getUTCDay()%6===0);
  cell.setAttribute('aria-label',fullLabel.format(new Date(date+'T12:00:00Z')));
  const time=document.createElement('time');time.dateTime=date;time.textContent=String(Number(date.slice(-2)));
  if(date===today)time.setAttribute('aria-current','date');
  cell.append(time);
  if(date===today){const badge=document.createElement('span');badge.className='urgent-planning-today-label';badge.textContent='Today';cell.append(badge);}
  const target=targets.get(date);
  const actual=groups.size&&(capacity.has(date)||covered(date))?capacity.get(date)||0:null;
  appendValues(cell,target?.bankHoliday?'Bank holiday':target?.suggested??null,actual);
  if(new Date(date+'T12:00:00Z').getUTCDay()===0){
   const weekStart=shift(date,-6);
   const days=Array.from({length:7},(_,i)=>shift(weekStart,i));
   const weeklyCell=document.createElement('article');weeklyCell.className='urgent-planning-day urgent-planning-week';
   weeklyCell.setAttribute('aria-label','Weekly planning appointments, '+fullLabel.format(new Date(weekStart+'T12:00:00Z'))+' to '+fullLabel.format(new Date(date+'T12:00:00Z')));
   const heading=document.createElement('div');heading.className='urgent-planning-week-range';
   const shortDate=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
   heading.textContent=shortDate(weekStart)+'–'+shortDate(date);weeklyCell.append(heading);
   // Require complete report coverage before displaying a full-week capacity total.
   const weeklyActual=weeklyGroups.size&&days.every(covered)?days.reduce((sum,day)=>sum+(weeklyCapacity.get(day)||0),0):null;
   appendValues(weeklyCell,weeklyGroups.size?weeklyTargets.get(weekStart)??null:null,weeklyActual);
  }
 }
 fitUrgentPlanningCalendar();
}
window.renderUrgentPlanningCalendar=renderUrgentPlanningCalendar;
window.addEventListener('resize',fitUrgentPlanningCalendar);
if(window.ResizeObserver){
 const observer=new ResizeObserver(fitUrgentPlanningCalendar);
 const calendar=byId('urgentPlanning2Page')?.querySelector('.urgent-planning-calendar');
 if(calendar){observer.observe(calendar.querySelector('.urgent-planning-calendar-header'));observer.observe(calendar.querySelector('.urgent-planning-weekdays'));}
 const header=document.querySelector('.dashboard-header');if(header)observer.observe(header);
}
byId('navUrgentPlanning2').addEventListener('click',()=>showPage('urgentPlanning2'));
for(const [id,offset] of [['urgentPlanning2Previous',-1],['urgentPlanning2Next',1]]){
 byId(id).addEventListener('click',()=>{selectedMonth=nextMonth(selectedMonth,offset);renderUrgentPlanningCalendar();});
}
byId('urgentPlanning2Today').addEventListener('click',()=>{selectedMonth=monthKey(dayView2LondonClock().date);renderUrgentPlanningCalendar();});
})();
