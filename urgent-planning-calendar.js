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
function renderUrgentPlanningCalendar(){
 const page=byId('urgentPlanning2Page');
 if(!page||page.classList.contains('hidden'))return;
 const today=dayView2LondonClock().date;
 const forecast=window.readUrgentDailyPlanningForecast();
 const groups=new Set(forecast?.groups||[]);
 const targets=forecast?.daily||new Map();
 const dates=[...targets.keys()].sort();
 const first=monthKey(today),last=monthKey(dates.at(-1)||today);
 const account=window.gpChartPreferences?.account?.();
 if(account!==selectedAccount){selectedAccount=account;selectedMonth=first;}
 if(!selectedMonth||selectedMonth<first||selectedMonth>last)selectedMonth=first;
 byId('urgentPlanning2Month').textContent=monthLabel.format(monthDate(selectedMonth));
 byId('urgentPlanning2Previous').disabled=selectedMonth<=first;
 byId('urgentPlanning2Next').disabled=selectedMonth>=last;
 byId('urgentPlanning2Types').textContent=groups.size?'Daily appointment types: '+[...groups].join(', '):'Select daily appointment types in Urgent Forecast → Predictions.';
 const capacity=dailyCapacity(availabilityRecords,groups);
 const grid=byId('urgentPlanning2Grid');grid.replaceChildren();
 const start=GPCorrectness.monday(selectedMonth+'-01');
 const finalDate=shift(nextMonth(selectedMonth,1)+'-01',-1);
 const end=shift(GPCorrectness.monday(finalDate),6);
 const coverage=slotReportCoverage.filter(range=>GPCorrectness.validDate(range.start)&&GPCorrectness.validDate(range.end));
 for(let date=start;date<=end;date=shift(date,1)){
  const cell=document.createElement('article');cell.className='urgent-planning-day';
  cell.classList.toggle('outside-month',monthKey(date)!==selectedMonth);
  cell.classList.toggle('is-today',date===today);
  cell.setAttribute('aria-label',fullLabel.format(new Date(date+'T12:00:00Z')));
  const time=document.createElement('time');time.dateTime=date;time.textContent=String(Number(date.slice(-2)));
  if(date===today){time.setAttribute('aria-current','date');time.append(' · Today');}
  cell.append(time);
  const target=targets.get(date);
  const actual=groups.size&&(capacity.has(date)||coverage.some(range=>range.start<=date&&range.end>=date))?capacity.get(date)||0:null;
  const values=document.createElement('dl');
  for(const [label,value] of [['Predicted need',target?.bankHoliday?'Bank holiday':target?.suggested??null],['Appointments',actual]]){
   const term=document.createElement('dt'),amount=document.createElement('dd');
   term.textContent=label;amount.textContent=typeof value==='number'?number.format(value):value??'—';
   values.append(term,amount);
  }
  cell.append(values);grid.append(cell);
 }
}
window.renderUrgentPlanningCalendar=renderUrgentPlanningCalendar;
byId('navUrgentPlanning2').addEventListener('click',()=>showPage('urgentPlanning2'));
for(const [id,offset] of [['urgentPlanning2Previous',-1],['urgentPlanning2Next',1]]){
 byId(id).addEventListener('click',()=>{selectedMonth=nextMonth(selectedMonth,offset);renderUrgentPlanningCalendar();});
}
byId('urgentPlanning2Today').addEventListener('click',()=>{selectedMonth=monthKey(dayView2LondonClock().date);renderUrgentPlanningCalendar();});
})();
