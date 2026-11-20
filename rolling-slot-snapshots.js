// Slot Reports contain aggregate counts rather than slot IDs. Split older
// contributions by appointment date when a later complete snapshot supersedes them.
(function(root){
'use strict';
function add(map,key,n){map.set(key,(map.get(key)||0)+n)}
// Contributions are decoded in the parent frame and can contain Maps from another realm.
function isMap(value){return Object.prototype.toString.call(value)==='[object Map]';}
function equalCounts(a,b){
 if(!isMap(a)||a.size!==b.size)return false;
 for(const [key,value] of a)if(b.get(key)!==value)return false;
 return true;
}
function rebuild(contribution,keep){
 const maps=Array.from({length:8},()=>new Map());
 for(const [key,count] of contribution.maps[1]){
  const [date,slot]=JSON.parse(key);if(!keep(date))continue;
  maps[1].set(key,count);
  const stat=maps[4].get(slot)||{count:0,min:date,max:date};
  stat.count+=count;if(date<stat.min)stat.min=date;if(date>stat.max)stat.max=date;maps[4].set(slot,stat);
 }
 for(const [key,count] of contribution.maps[7]){
  const [date,bookedDay,minute,slot,clinician,person,source,sessionCategory]=JSON.parse(key);if(!keep(date))continue;
  maps[7].set(key,count);
  add(maps[0],JSON.stringify(sessionCategory===undefined?[bookedDay,slot,clinician,person]:[bookedDay,slot,clinician,person,sessionCategory]),count);
  add(maps[2],JSON.stringify(sessionCategory===undefined?[bookedDay,minute,slot,clinician,person]:[bookedDay,minute,slot,clinician,person,sessionCategory]),count);
 }
 for(const [key,count] of contribution.maps[6]){
  const [slot,clinician,person,month,date,lead,sessionCategory]=JSON.parse(key);if(!keep(date))continue;
  maps[6].set(key,count);
  add(maps[5],JSON.stringify(sessionCategory===undefined?[slot,Math.floor(lead/1440),clinician,person,month]:[slot,Math.floor(lead/1440),clinician,person,month,sessionCategory]),count);
 }
 return maps;
}
function reconcile(entries){
 const snapshots=entries.filter(e=>e.contribution?.kind==='slot'&&e.contribution.snapshotType==='rolling-weekly').map(e=>{
  const from=e.contribution.snapshotFrom,at=Date.parse(e.clinicalAt);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!Number.isFinite(at))throw Error('A weekly snapshot has an invalid date; existing reports have not been changed.');
  const date=new Date(from+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==from)throw Error('A weekly snapshot has an invalid start date.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  const reportDay=new Date(parts.year+'-'+parts.month+'-'+parts.day+'T12:00:00Z');reportDay.setUTCDate(reportDay.getUTCDate()-7);
  if(reportDay.toISOString().slice(0,10)!==from)throw Error('A weekly snapshot has inconsistent coverage dates.');
  return {from,at,key:e.key};
 });
 return entries.map(entry=>{
  const c=entry.contribution;if(c?.kind!=='slot'||!snapshots.length)return entry;
  const at=Date.parse(entry.clinicalAt);
  if(!Number.isFinite(at))throw Error('A Slot Report is missing its report date; overlap cannot be resolved safely.');
  const later=snapshots.filter(s=>s.key!==entry.key&&s.at>at).sort((a,b)=>a.from.localeCompare(b.from));
  if(!later.length)return entry;
  const cutoff=later[0].from;
  if(!Array.isArray(c.maps)||c.maps.length!==8||!c.maps.every(isMap))throw Error('A saved Slot Report cannot be reconciled safely.');
  let overlaps=false;for(const key of c.maps[1].keys())if(JSON.parse(key)[0]>=cutoff){overlaps=true;break}
  if(!overlaps)return entry;
  const check=rebuild(c,()=>true);
  if(c.maps[3].size||![0,2,5].every(i=>equalCounts(c.maps[i],check[i])))throw Error('A saved Slot Report lacks the date detail needed to reconcile overlap safely. Existing reports have not been changed.');
  const maps=rebuild(c,date=>date<cutoff);
  const valid=[...maps[0].values()].reduce((a,b)=>a+b,0);
  return {...entry,contribution:{...c,maps,valid,skipped:0}};
 });
}
function validateHistoricalReplacement(original,replacement){
 if(original?.kind!=='slot'||original.snapshotType==='rolling-weekly')throw Error('Only an existing historical Slot Report can be replaced this way.');
 if(replacement?.kind!=='slot'||!isMap(original.maps?.[1])||!isMap(replacement.maps?.[1]))throw Error('The report cannot be checked safely.');
 const bounds=c=>{let first='',last='';for(const key of c.maps[1].keys()){const date=JSON.parse(key)[0];if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('The report has an invalid appointment date.');if(!first||date<first)first=date;if(date>last)last=date;}return [first,last]};
 const [first,last]=bounds(original),[newFirst,newLast]=bounds(replacement);
 if(!first||!newFirst||newFirst<first||newLast>last)throw Error('The replacement contains dates outside the original report. Existing reports are unchanged.');
 return {first,last,newFirst,newLast};
}
function validateNewFullReport(report,entries){
 if(report?.kind!=='slot'||!isMap(report.maps?.[1]))throw Error('The report cannot be checked safely.');
 const dates=new Set([...report.maps[1].keys()].map(key=>JSON.parse(key)[0]));
 if(!dates.size)throw Error('No appointment dates were found.');
 const ordered=[...dates].sort(),first=ordered[0],last=ordered.at(-1);
 for(const entry of entries){
  const c=entry.contribution;if(c?.kind!=='slot')continue;
  if(!isMap(c.maps?.[1]))throw Error('An existing report cannot be checked safely. No data was changed.');
  // A weekly snapshot is complete from its start, including removed slots.
  if(c.snapshotType==='rolling-weekly'&&(!/^\d{4}-\d{2}-\d{2}$/.test(c.snapshotFrom||'')||last>=c.snapshotFrom))throw Error('This full report overlaps the coverage of a saved weekly snapshot. No data was changed.');
  for(const key of c.maps[1].keys())if(dates.has(JSON.parse(key)[0]))throw Error('This full report overlaps an existing Slot Report. No data was changed.');
 }
 return {first,last};
}
const api={reconcile,validateHistoricalReplacement,validateNewFullReport};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPRollingSlots=api;
})(typeof window!=='undefined'?window:globalThis);
