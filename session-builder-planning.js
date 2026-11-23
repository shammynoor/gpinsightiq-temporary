(function(){
'use strict';
function averageDemand(rows,weeks,{monday,classify}){
 const covered=new Set(weeks),daily=[0,0,0,0,0];let weekly=0,routine=0;
 for(const row of rows){
  if(!row.bookedDay||!Number.isFinite(row.count)||row.count<=0||!covered.has(monday(row.bookedDay)))continue;
  const kind=classify(row);if(!kind)continue;
  if(kind==='daily'){
   const dow=(new Date(row.bookedDay+'T12:00:00Z').getUTCDay()+6)%7;
   if(dow<5)daily[dow]+=row.count;
  }else if(kind==='weekly')weekly+=row.count;
  else if(kind==='routine')routine+=row.count;
 }
 if(!weeks.length)return null;
 return {daily:daily.map(n=>n/weeks.length),weekly:weekly/weeks.length,routine:routine/weeks.length,weeks:weeks.length};
}
function estimateSessions(types,modes,groups,demand){
 const rows=types.map(type=>{
  const eligible=(type.clinicianTypes||[]).filter(group=>groups.includes(group));
  const capacity=modes.reduce((sum,mode)=>sum+(type.appointmentsByMode[mode]||0),0);
  return {id:type.id,name:type.name,group:eligible.length===1?eligible[0]:'',capacity,days:[0,0,0,0,0]};
 });
 if(!demand)return {rows,error:'No complete report weeks are available for calculating demand.'};
 const need=[...demand.daily,demand.weekly,demand.routine];
 if(need.length!==7||need.some(n=>!Number.isFinite(n)||n<0))return {rows,error:'Average demand is not available.'};
 const totalNeed=need.reduce((sum,n)=>sum+n,0),usable=rows.filter(row=>row.group&&Number.isFinite(row.capacity)&&row.capacity>0);
 if(!totalNeed)return {rows,days:[0,0,0,0,0],capacity:[0,0,0,0,0],totalNeed,totalCapacity:0};
 if(!usable.length)return {rows,error:'Choose one clinician group and enter appointment counts for at least one session type.'};
 // With flexible appointments and no staff limits, maximum-capacity sessions
 // give the minimum session count. Tie-capacity types share the requirement.
 const largest=Math.max(...usable.map(row=>row.capacity));
 const days=demand.daily.map(n=>Math.ceil(n/largest));
 const minimum=Math.max(days.reduce((sum,n)=>sum+n,0),Math.ceil(totalNeed/largest));
 if(!Number.isSafeInteger(minimum))return {rows,error:'The demand or appointment counts are too large to calculate safely.'};
 let extra=minimum-days.reduce((sum,n)=>sum+n,0);
 const each=Math.floor(extra/5);for(let i=0;i<5;i++)days[i]+=each;extra-=each*5;
 while(extra-->0){let day=0;for(let i=1;i<5;i++)if(days[i]<days[day])day=i;days[day]++;}
 const leaders=usable.filter(row=>row.capacity===largest);let cursor=0;
 for(let day=0;day<5;day++){
  const base=Math.floor(days[day]/leaders.length),remaining=days[day]%leaders.length;
  for(const row of leaders)row.days[day]=base;
  for(let i=0;i<remaining;i++)leaders[(cursor+i)%leaders.length].days[day]++;
  cursor=(cursor+remaining)%leaders.length;
 }
 const capacity=days.map(n=>n*largest);
 return {rows,days,capacity,totalNeed,totalCapacity:capacity.reduce((sum,n)=>sum+n,0)};
}
window.SessionBuilderPlanning=Object.freeze({averageDemand,estimateSessions});
})();
