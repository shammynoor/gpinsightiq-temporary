(function(){
'use strict';
function isHomeVisit(mode){const name=String(mode).toLowerCase().replace(/[^a-z0-9]/g,'');return /homevis|domiciliary/.test(name)||['visit','visits','hv'].includes(name);}
function averageDemand(rows,weeks,{monday,classify}){
 const covered=new Set(weeks),sameDay=[0,0,0,0,0],homeVisit=[0,0,0,0,0];let weekly=0,routine=0;
 for(const row of rows){
  if(!row.bookedDay||!Number.isFinite(row.count)||row.count<=0||!covered.has(monday(row.bookedDay)))continue;
  const kind=classify(row);if(!kind)continue;
  if(['sameDay','daily','homeVisit'].includes(kind)){const dow=(new Date(row.bookedDay+'T12:00:00Z').getUTCDay()+6)%7;if(dow<5)(kind==='homeVisit'?homeVisit:sameDay)[dow]+=row.count;}
  else if(kind==='weekly')weekly+=row.count;else if(kind==='routine')routine+=row.count;
 }
 if(!weeks.length)return null;
 return {sameDay:sameDay.map(n=>n/weeks.length),homeVisit:homeVisit.map(n=>n/weeks.length),weekly:weekly/weeks.length,routine:routine/weeks.length,weeks:weeks.length};
}
function vectorSessions(types,needSame,needHome){
 const same=Math.ceil(needSame),home=Math.ceil(needHome),zero=()=>Array(types.length).fill(0);
 if(!same&&!home)return {counts:zero()};
 const maxSame=Math.max(0,...types.map(t=>t.sameDay)),maxHome=Math.max(0,...types.map(t=>t.homeVisit));
 if(same&&!maxSame||home&&!maxHome)return {error:same&&!maxSame?'No eligible session type provides same-day appointment capacity.':'No eligible session type provides home-visit capacity.'};
 if(!same||!home){const field=same?'sameDay':'homeVisit',capacity=same?maxSame:maxHome,n=Math.ceil((same||home)/capacity),leaders=types.map((t,i)=>t[field]===capacity?i:-1).filter(i=>i>=0),counts=zero();for(let j=0;j<leaders.length;j++)counts[leaders[j]]=Math.floor(n/leaders.length)+(j<n%leaders.length?1:0);return {counts};}
 const candidates=[];
 for(const homeFirst of [false,true]){
  const counts=zero(),first=homeFirst?'homeVisit':'sameDay',second=homeFirst?'sameDay':'homeVisit';
  const firstNeed=homeFirst?home:same,secondNeed=homeFirst?same:home;
  const a=types.reduce((best,t,i)=>t[first]>types[best][first]?i:best,0);counts[a]=Math.ceil(firstNeed/types[a][first]);
  const b=types.reduce((best,t,i)=>t[second]>types[best][second]?i:best,0);counts[b]+=Math.ceil(Math.max(0,secondNeed-counts[a]*types[a][second])/types[b][second]);candidates.push(counts);
 }
 types.forEach((type,i)=>{if(type.sameDay&&type.homeVisit){const counts=zero();counts[i]=Math.ceil(Math.max(same/type.sameDay,home/type.homeVisit));candidates.push(counts);}});
 candidates.sort((a,b)=>a.reduce((s,n)=>s+n,0)-b.reduce((s,n)=>s+n,0));
 const fallback=candidates[0],upper=fallback.reduce((s,n)=>s+n,0),smallHome=home<=same,goal=smallHome?home:same,otherGoal=smallHome?same:home;
 // Exact integer dynamic programming on the smaller appointment dimension.
 // At a fixed session count, only the greatest coverage of the other dimension
 // matters. Large inputs use a feasible capacity-led fallback to keep UI responsive.
 if(!Number.isSafeInteger(upper)||goal>5000||upper>1000||goal*upper*types.length>1000000)return {counts:fallback,approximate:true};
 let prev=new Float64Array(goal+1).fill(-1),paths=Array(goal+1).fill(null);prev[0]=0;
 for(let n=1;n<=upper;n++){
  const next=new Float64Array(goal+1).fill(-1),nextPaths=Array(goal+1).fill(null);
  for(let a=0;a<=goal;a++)if(prev[a]>=0)for(let i=0;i<types.length;i++){
   const type=types[i],first=smallHome?type.homeVisit:type.sameDay,second=smallHome?type.sameDay:type.homeVisit;
   const b=Math.min(goal,a+first),value=Math.min(otherGoal,prev[a]+second);
   if(value>next[b]){next[b]=value;nextPaths[b]={type:i,previous:paths[a]};}
  }
  if(next[goal]>=otherGoal){const counts=zero();for(let node=nextPaths[goal];node;node=node.previous)counts[node.type]++;return {counts};}
  prev=next;paths=nextPaths;
 }
 return {counts:fallback,approximate:true};
}
function estimateSessions(types,modes,groups,demand){
 const rows=types.map(type=>{let sameDay=0,homeVisit=0;for(const mode of modes){const n=type.appointmentsByMode[mode]||0;if(isHomeVisit(mode))homeVisit+=n;else sameDay+=n;}const eligible=(type.clinicianTypes||[]).filter(group=>groups.includes(group));return {id:type.id,name:type.name,group:eligible.length===1?eligible[0]:'',sameDay,homeVisit,capacity:sameDay+homeVisit,days:[0,0,0,0,0],weekly:0,routine:0};});
 if(!demand)return {rows,error:'No complete report weeks are available for calculating demand.'};
 const values=[...demand.sameDay,...demand.homeVisit,demand.weekly,demand.routine];
 if(values.length!==12||values.some(n=>!Number.isFinite(n)||n<0))return {rows,error:'Average demand is not available.'};
 const usable=rows.filter(row=>row.group&&row.capacity>0&&Number.isFinite(row.capacity));
 if(!usable.length&&values.some(n=>n>0))return {rows,error:'Choose one clinician group and enter appointment counts for at least one session type.'};
 let approximate=false;
 for(let day=0;day<5;day++){const result=vectorSessions(usable,demand.sameDay[day],demand.homeVisit[day]);if(result.error)return {rows,error:result.error};approximate||=!!result.approximate;usable.forEach((row,i)=>row.days[day]=result.counts[i]);}
 for(const field of ['weekly','routine'])if(demand[field]>0){const max=Math.max(...usable.map(row=>row.capacity)),leaders=usable.filter(row=>row.capacity===max),n=Math.ceil(demand[field]/max);leaders.forEach((row,i)=>row[field]=Math.floor(n/leaders.length)+(i<n%leaders.length?1:0));}
 const sum=fn=>rows.reduce((s,row)=>s+fn(row),0);
 const days=Array.from({length:5},(_,day)=>sum(row=>row.days[day]));
 const capacitySameDay=days.map((_,day)=>sum(row=>row.days[day]*row.sameDay)),capacityHomeVisit=days.map((_,day)=>sum(row=>row.days[day]*row.homeVisit));
 return {rows,days,capacitySameDay,capacityHomeVisit,weeklySessions:sum(row=>row.weekly),routineSessions:sum(row=>row.routine),weeklyCapacity:sum(row=>row.weekly*row.capacity),routineCapacity:sum(row=>row.routine*row.capacity),totalNeed:values.reduce((s,n)=>s+n,0),totalCapacity:sum(row=>(row.days.reduce((s,n)=>s+n,0)+row.weekly+row.routine)*row.capacity),approximate};
}
window.SessionBuilderPlanning=Object.freeze({averageDemand,estimateSessions,isHomeVisit,vectorSessions});
})();
