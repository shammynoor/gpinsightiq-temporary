(function(root){
'use strict';
const holderColumn='Full Name of the Session Holder of the Session';
async function holderTokens(parsed,practiceId,cryptoApi=globalThis.crypto){
 const indexes=parsed.columns.flatMap((name,i)=>name.trim().toLowerCase()===holderColumn.toLowerCase()?[i]:[]);
 if(indexes.length>1)throw Error('The Slot Report contains more than one session holder name column.');
 const tokens=new Map();if(!indexes.length)return tokens;
 const i=indexes[0],names=new Set(parsed.rows.map(row=>String(row[i]||'').trim()).filter(Boolean));
 await Promise.all([...names].map(async name=>{
  const normalized=name.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('en-GB');
  const bytes=new TextEncoder().encode(JSON.stringify(['gp-insight-session-holder-v1',practiceId,normalized]));
  const digest=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes));
  tokens.set(name,'h1:'+[...digest].map(x=>x.toString(16).padStart(2,'0')).join(''));
 }));
 return tokens;
}
function calculate(rows,{date,minute},typeFor,locumFor,excluded=new Set(),coverage=null){
 const seen=new Map(),incomplete=new Map(),dates=new Set(),yearWeeks=new Map(),missingYears=new Set(),observedYears=new Set();
 for(const row of rows){
  if(row.source!=='slot'||String(row.availability||'').toLowerCase()!=='booked'||!(row.count>0)||excluded.has(row.slot)||!row.date)continue;
  if(row.date>date)continue;
  if(row.date===date&&Number.isFinite(row.minute)&&row.minute>=minute)continue;
  const week=weekMonday(row.date),year=row.date.slice(0,4);dates.add(week);
  if(!yearWeeks.has(year))yearWeeks.set(year,new Set());yearWeeks.get(year).add(week);
  if(!Number.isInteger(row.minute)){incomplete.set(week,true);missingYears.add(year);continue}
  if(row.minute>=780&&row.minute<840)continue;
  if(!row.person||!String(row.person).startsWith('h1:')){incomplete.set(week,true);missingYears.add(year);continue}
  observedYears.add(year);
  const period=row.minute<780?'morning':'afternoon',type=typeFor(row)||'Unassigned',locum=!!locumFor(row);
  const key=JSON.stringify([row.person,row.date,period]);const existing=seen.get(key);
  if(existing){if(existing.type!==type)existing.conflict=true;existing.locum||=locum}
  else seen.set(key,{week,year,type,locum,conflict:false});
 }
 if(Array.isArray(coverage))for(const week of dates){
  for(let offset=0;offset<7;offset++){
   const day=new Date(week+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);
   const iso=day.toISOString().slice(0,10);
   if(iso>=date||!coverage.some(range=>range.start<=iso&&range.end>=iso&&(!range.asOf||range.asOf>=iso))){incomplete.set(week,true);break}
  }
 }
 const totals=new Map(),types=new Set(),yearWeekTotals=new Map(),annualByType=new Map();
 for(const entry of seen.values()){
  let label=entry.conflict?'Multiple clinician types':entry.type;
  if(entry.locum&&!/\blocum\b/i.test(label))label+=' · Locum';
  types.add(label);if(!totals.has(entry.week))totals.set(entry.week,new Map());
  const row=totals.get(entry.week);row.set(label,(row.get(label)||0)+1);
  if(!yearWeekTotals.has(entry.year))yearWeekTotals.set(entry.year,new Map());
  const yearly=yearWeekTotals.get(entry.year);if(!yearly.has(entry.week))yearly.set(entry.week,new Map());
  const breakdown=yearly.get(entry.week);breakdown.set(label,(breakdown.get(label)||0)+1);
  if(entry.conflict||entry.type==='Unassigned'){missingYears.add(entry.year);continue}
  if(!annualByType.has(entry.year))annualByType.set(entry.year,new Map());
  const annual=annualByType.get(entry.year);annual.set(entry.type,(annual.get(entry.type)||0)+1);
 }
 return {weeks:[...dates].sort().reverse(),types:[...types].sort((a,b)=>a.localeCompare(b)),totals,incomplete,yearWeeks,yearWeekTotals,annualByType,missingYears,observedYears};
}
// Count booked appointments by appointment date; session-holder names and session times are not required.
function appointmentHistory(rows,{date,minute},typeFor,locumFor,careFor,excluded=new Set(),coverage=null){
 const types=new Set(),yearWeeks=new Map(),yearWeekTotals=new Map(),incomplete=new Set();
 for(const row of rows){
  if(row.source!=='slot'||String(row.availability||'').toLowerCase()!=='booked'||!(row.count>0)||excluded.has(row.slot)||!row.date||row.date>date)continue;
  const week=weekMonday(row.date),year=row.date.slice(0,4),care=careFor(row);
  if(!care)continue;
  if(!yearWeeks.has(year))yearWeeks.set(year,new Set());yearWeeks.get(year).add(week);
  if(row.date===date&&(!Number.isFinite(row.minute)||row.minute>=minute)){incomplete.add(week);continue}
  let type=typeFor(row)||'Unassigned';if(locumFor(row)&&!/\blocum\b/i.test(type))type+=' · Locum';types.add(type);
  if(!yearWeekTotals.has(year))yearWeekTotals.set(year,new Map());
  const byWeek=yearWeekTotals.get(year);if(!byWeek.has(week))byWeek.set(week,new Map());
  const byCare=byWeek.get(week);if(!byCare.has(care))byCare.set(care,new Map());
  const byType=byCare.get(care);byType.set(type,(byType.get(type)||0)+Number(row.count));
 }
 if(Array.isArray(coverage))for(const weeks of yearWeeks.values())for(const week of weeks){
  for(let offset=0;offset<7;offset++){
   const day=new Date(week+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);const iso=day.toISOString().slice(0,10);
   if(iso>=date||!coverage.some(range=>range.start<=iso&&range.end>=iso&&(!range.asOf||range.asOf>=iso))){incomplete.add(week);break}
  }
 }
 return {types:[...types].sort((a,b)=>a.localeCompare(b)),yearWeeks,yearWeekTotals,incomplete};
}
function weekMonday(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}
function weeklySessionValue(result,year,type,coverageFraction,manual,workingWeeks=48){
 const automatic=result.observedYears.has(year)&&!result.missingYears.has(year)&&coverageFraction>0;
 if(!automatic)return {automatic:false,value:manual,total:null};
 const total=result.annualByType.get(year)?.get(type)||0;
 return {automatic:true,value:total/(workingWeeks*coverageFraction),total};
}
const api={holderTokens,calculate,appointmentHistory,holderColumn,weeklySessionValue};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPSessionsHistory=api;
})(typeof window!=='undefined'?window:globalThis);
