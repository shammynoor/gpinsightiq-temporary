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
 const seen=new Map(),incomplete=new Map(),dates=new Set();
 for(const row of rows){
  if(row.source!=='slot'||String(row.availability||'').toLowerCase()!=='booked'||!(row.count>0)||excluded.has(row.slot)||!row.date)continue;
  if(row.date>date)continue;
  if(row.date===date&&Number.isFinite(row.minute)&&row.minute>=minute)continue;
  const week=weekMonday(row.date);dates.add(week);
  if(!Number.isInteger(row.minute)){incomplete.set(week,true);continue}
  if(row.minute>=780&&row.minute<840)continue;
  if(!row.person||!String(row.person).startsWith('h1:')){incomplete.set(week,true);continue}
  const period=row.minute<780?'morning':'afternoon',type=typeFor(row)||'Unassigned',locum=!!locumFor(row);
  const key=JSON.stringify([row.person,row.date,period]);const existing=seen.get(key);
  if(existing){if(existing.type!==type)existing.conflict=true;existing.locum||=locum}
  else seen.set(key,{week,type,locum,conflict:false});
 }
 if(Array.isArray(coverage))for(const week of dates){
  for(let offset=0;offset<7;offset++){
   const day=new Date(week+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);
   const iso=day.toISOString().slice(0,10);
   if(iso>=date||!coverage.some(range=>range.start<=iso&&range.end>=iso&&(!range.asOf||range.asOf>=iso))){incomplete.set(week,true);break}
  }
 }
 const totals=new Map(),types=new Set();
 for(const entry of seen.values()){
  let label=entry.conflict?'Multiple clinician types':entry.type;
  if(entry.locum&&!/\blocum\b/i.test(label))label+=' · Locum';
  types.add(label);if(!totals.has(entry.week))totals.set(entry.week,new Map());
  const row=totals.get(entry.week);row.set(label,(row.get(label)||0)+1);
 }
 return {weeks:[...dates].sort().reverse(),types:[...types].sort((a,b)=>a.localeCompare(b)),totals,incomplete};
}
function weekMonday(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}
const api={holderTokens,calculate,holderColumn};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPSessionsHistory=api;
})(typeof window!=='undefined'?window:globalThis);
