(function(){
'use strict';
// Appointment eligibility starts as a transportation problem. Additional rules
// are independently audited and, when needed, repaired with fixed session counts.
// Every proposed improvement must still pass the full model's independent audit.
function improve({slots,allocations,variables,constraints,values,demand,limits,active,audit,accept,deadline}){
 const clinicianNames=new Set(slots.map(slot=>slot.clinician));
 const sessionIds=new Set(slots.map(slot=>slot.id)),slotOnly=new Map(Object.entries(constraints).map(([id,bounds])=>[id,{bounds,terms:[],onlySlots:true}]));
 for(const [id,data]of Object.entries(variables))for(const [key,coefficient]of Object.entries(data))if(coefficient&&slotOnly.has(key)){const row=slotOnly.get(key);row.terms.push([id,coefficient]);if(!sessionIds.has(id))row.onlySlots=false;}
 const sessionChecks=[...slotOnly.values()].filter(row=>row.onlySlots);
 const counts=Object.fromEntries(slots.map(slot=>[slot.id,Math.round(values[slot.id]||0)]));
 const bySlot=new Map(slots.map(slot=>[slot.id,allocations.filter(a=>a.slot===slot)]));
 const groups=[];
 const addGroup=(pool,day,name,need)=>{if(need>0)groups.push({pool,day,name,need:Math.ceil(need)});};
 for(let day=0;day<5;day++){addGroup('sameDay',day,null,demand.sameDay[day]);addGroup('homeVisit',day,null,demand.homeVisit[day]);}
 for(const pool of ['weekly','routine']){
  let sum=0;for(const [name,need]of Object.entries(demand.byType?.[pool]||{})){const n=Math.ceil(need);addGroup(pool,null,name,n);sum+=n;}
  addGroup(pool,null,null,Math.max(0,Math.ceil(demand[pool]||0)-sum));
 }
 addGroup('planned',null,null,demand.planned||0);
 const required=groups.reduce((sum,g)=>sum+g.need,0);
 function withinClinicianLimits(candidate){
  const totals={};for(const slot of slots){const n=candidate[slot.id]||0;if(!Number.isSafeInteger(n)||n<0)return false;totals[slot.clinician]=(totals[slot.clinician]||0)+n;}
  return Object.entries(limits).filter(([name])=>clinicianNames.has(name)).every(([name,limit])=>(totals[name]||0)>=(limit.min||0)&&(limit.max==null||(totals[name]||0)<=limit.max))&&sessionChecks.every(({bounds,terms})=>{const n=terms.reduce((sum,[id,coefficient])=>sum+(candidate[id]||0)*coefficient,0);return (bounds.min==null||n>=bounds.min-1e-5)&&(bounds.max==null||n<=bounds.max+1e-5)&&(bounds.equal==null||Math.abs(n-bounds.equal)<=1e-5);});
 }
 function repair(candidate){
  if(Date.now()>=deadline||!window.solver?.Solve)return null;
  const copyConstraints=Object.fromEntries(Object.entries(constraints).map(([id,bounds])=>[id,{...bounds}])),copyVariables=Object.fromEntries(Object.entries(variables).map(([id,data])=>[id,{...data}]));
  let sequence=0;for(const slot of slots){let id;do{id='fixedPolish'+sequence++;}while(Object.hasOwn(copyConstraints,id));copyConstraints[id]={equal:candidate[slot.id]||0};copyVariables[slot.id][id]=1;}
  try{const result=window.solver.Solve({optimize:'polish',opType:'min',constraints:copyConstraints,variables:copyVariables,ints:Object.fromEntries(allocations.map(a=>[a.id,1])),options:{timeout:Math.min(40,Math.max(1,deadline-Date.now())),tolerance:0,nodeSelection:'depth-first',branching:'most-fractional'}},1e-8,true),solution=result.generateSolutionSet();return result.feasible&&result.bounded&&audit(solution)?solution:null;}catch(error){return null;}
 }
 function allocate(candidate){
  if(!withinClinicianLimits(candidate))return null;
  const modes=[];
  for(const slot of slots)if(candidate[slot.id])for(const home of [false,true]){
   const capacity=Math.floor(candidate[slot.id]*(home?slot.home:slot.nonHome)+1e-7);if(!capacity)continue;
   const choices=bySlot.get(slot.id).filter(a=>(a.pool==='homeVisit')===home);if(!choices.length)return null;
   modes.push({slot,capacity,choices});
  }
  const source=modes.length+groups.length,sink=source+1,graph=Array.from({length:sink+1},()=>[]),links=[];
  const edge=(a,b,capacity)=>{const e={to:b,cap:capacity,rev:graph[b].length};graph[a].push(e);graph[b].push({to:a,cap:0,rev:graph[a].length-1});return e;};
  modes.forEach((mode,i)=>{edge(source,i,mode.capacity);for(const a of mode.choices)groups.forEach((group,j)=>{if(a.pool===group.pool&&(group.day==null||a.slot.day===group.day)&&(group.name==null||group.name===a.name)){const e=edge(i,modes.length+j,Math.min(mode.capacity,group.need));links.push({a,e,capacity:e.cap});}});});
  groups.forEach((group,j)=>edge(modes.length+j,sink,group.need));let total=0;
  while(total<required){
   const previous=Array(graph.length).fill(null),queue=[source];previous[source]=[];
   for(let q=0;q<queue.length&&!previous[sink];q++)for(let i=0;i<graph[queue[q]].length;i++){const e=graph[queue[q]][i];if(e.cap>0&&!previous[e.to]){previous[e.to]=[queue[q],i];queue.push(e.to);}}
   if(!previous[sink])return null;let amount=Infinity;
   for(let node=sink;node!==source;node=previous[node][0])amount=Math.min(amount,graph[previous[node][0]][previous[node][1]].cap);
   for(let node=sink;node!==source;node=previous[node][0]){const e=graph[previous[node][0]][previous[node][1]];e.cap-=amount;graph[node][e.rev].cap+=amount;}total+=amount;
  }
  const result=Object.fromEntries(Object.keys(variables).map(id=>[id,0]));Object.assign(result,candidate);
  for(const {a,e,capacity}of links)result[a.id]+=capacity-e.cap;
  const poolTotals={sameDay:[0,0,0,0,0],homeVisit:[0,0,0,0,0],weekly:0,routine:0,planned:0};
  for(const a of allocations)if(['sameDay','homeVisit'].includes(a.pool))poolTotals[a.pool][a.slot.day]+=result[a.id];else poolTotals[a.pool]+=result[a.id];
  for(const mode of modes){const spare=mode.capacity-mode.choices.reduce((n,a)=>n+result[a.id],0);if(!spare)continue;
   const score=a=>{const daily=['sameDay','homeVisit'].includes(a.pool),need=daily?demand[a.pool][a.slot.day]:demand[a.pool]||0,provided=daily?poolTotals[a.pool][a.slot.day]:poolTotals[a.pool];return need>0?provided/need:Infinity;};
   const chosen=mode.choices.slice().sort((a,b)=>score(a)-score(b))[0];result[chosen.id]+=spare;if(['sameDay','homeVisit'].includes(chosen.pool))poolTotals[chosen.pool][chosen.slot.day]+=spare;else poolTotals[chosen.pool]+=spare;
  }
  for(const slot of slots){const daily=bySlot.get(slot.id).filter(a=>a.pool==='sameDay');if(daily.length<2)continue;const total=daily.reduce((n,a)=>n+result[a.id],0),weights=daily.map(a=>Math.max(0,demand.byType?.sameDay?.[a.name]?.[slot.day]||0)),sum=weights.reduce((a,b)=>a+b,0),shares=daily.map((a,i)=>({a,target:total*(sum?weights[i]/sum:1/daily.length)}));let remainder=total;for(const share of shares){result[share.a.id]=Math.floor(share.target+1e-9);remainder-=result[share.a.id];}shares.sort((a,b)=>(b.target-Math.floor(b.target))-(a.target-Math.floor(a.target)));for(let i=0;i<remainder;i++)result[shares[i%shares.length].a.id]++;}
  // Soft distribution rules use continuous slack. Recompute it after changing
  // counts: leaving it at zero would turn an unmet preference into a hard veto.
  for(const [id,data]of Object.entries(variables))if(data.balance===1){
   let needed=0;
   for(const [key,coefficient]of Object.entries(data)){
    const bounds=constraints[key];if(!bounds||!coefficient)continue;
    const total=slotOnly.get(key).terms.reduce((sum,[other,term])=>sum+(other===id?0:(result[other]||0))*term,0);
    if(coefficient>0&&bounds.min!=null)needed=Math.max(needed,(bounds.min-total)/coefficient);
    if(coefficient<0&&bounds.max!=null)needed=Math.max(needed,(bounds.max-total)/coefficient);
   }
   result[id]=needed;
  }
  return audit(result)?result:repair(candidate);
 }
 const costly=slots.slice().sort((a,b)=>b.rate-a.rate||(counts[b.id]||0)-(counts[a.id]||0));
 let changed=true,attempts=0;
 function prune(){let removed=false;for(const slot of costly)while(counts[slot.id]>0&&Date.now()<deadline&&attempts++<5000){counts[slot.id]--;const proposal=allocate(counts);if(!proposal){counts[slot.id]++;break;}accept(proposal);removed=true;}return removed;}
 while(changed&&Date.now()<deadline&&attempts<5000){
  changed=prune();
  for(const expensive of costly){if(!counts[expensive.id]||Date.now()>=deadline||attempts>=5000)continue;
   const alternatives=slots.filter(s=>s.id!==expensive.id&&s.rate<=expensive.rate&&(s.nonHome>0||s.home>0||s.sourceId===expensive.sourceId)).sort((a,b)=>(b.sourceId===expensive.sourceId)-(a.sourceId===expensive.sourceId)||(b.day===expensive.day)-(a.day===expensive.day)||a.rate/(a.nonHome+a.home)-b.rate/(b.nonHome+b.home)).slice(0,24);
   let swapped=false;
   for(const cheap of alternatives){if(swapped||Date.now()>=deadline)break;
    const max=Math.min(4,Math.ceil((expensive.nonHome+expensive.home)/Math.max(.001,cheap.nonHome+cheap.home))+1);
    for(let n=1;n<=max&&n*cheap.rate<=expensive.rate+1e-7&&Date.now()<deadline&&attempts++<5000;n++){
     const oldCapacity=slots.reduce((sum,slot)=>sum+Math.floor(counts[slot.id]*slot.nonHome+1e-7)+Math.floor(counts[slot.id]*slot.home+1e-7),0);
     counts[expensive.id]--;counts[cheap.id]+=n;const newCapacity=slots.reduce((sum,slot)=>sum+Math.floor(counts[slot.id]*slot.nonHome+1e-7)+Math.floor(counts[slot.id]*slot.home+1e-7),0);
     const improves=n*cheap.rate<expensive.rate-1e-7||newCapacity<oldCapacity,proposal=improves?allocate(counts):null;
     if(proposal){accept(proposal);changed=true;swapped=true;break;}counts[expensive.id]++;counts[cheap.id]-=n;
    }
   }
  }
 }
 if(Date.now()<deadline)prune();
}
window.SessionBuilderCostPolish=Object.freeze({improve});
})();
