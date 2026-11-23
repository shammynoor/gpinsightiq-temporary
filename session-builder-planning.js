(function(){
'use strict';
function isIncludedAppointmentType(name){return String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'')!=='111referral';}
function isHomeVisit(mode){const name=String(mode).toLowerCase().replace(/[^a-z0-9]/g,'');return /homevis|domiciliary/.test(name)||['visit','visits','hv'].includes(name);}
function averageDemand(rows,weeks,{monday,classify}){
 const covered=new Set(weeks),sameDay=[0,0,0,0,0],homeVisit=[0,0,0,0,0],types={sameDay:new Set(),homeVisit:new Set(),weekly:new Set(),routine:new Set()},byType={sameDay:{},homeVisit:{},weekly:{},routine:{}};let weekly=0,routine=0;
 for(const row of rows){
  if(!row.bookedDay||!Number.isFinite(row.count)||row.count<=0||!covered.has(monday(row.bookedDay)))continue;
  const classification=classify(row),kind=typeof classification==='string'?classification:classification?.kind;if(!kind)continue;
  if(classification?.name&&types[kind]){const name=classification.name,dow=(new Date(row.bookedDay+'T12:00:00Z').getUTCDay()+6)%7;if(kind==='weekly'||kind==='routine'){types[kind].add(name);byType[kind][name]=(byType[kind][name]||0)+row.count;}else if(dow<5){types[kind].add(name);const days=byType[kind][name]||(byType[kind][name]=[0,0,0,0,0]);days[dow]+=row.count;}}
  if(['sameDay','daily','homeVisit'].includes(kind)){const dow=(new Date(row.bookedDay+'T12:00:00Z').getUTCDay()+6)%7;if(dow<5)(kind==='homeVisit'?homeVisit:sameDay)[dow]+=row.count;}
  else if(kind==='weekly')weekly+=row.count;else if(kind==='routine')routine+=row.count;
 }
 if(!weeks.length)return null;
 return {sameDay:sameDay.map(n=>n/weeks.length),homeVisit:homeVisit.map(n=>n/weeks.length),weekly:weekly/weeks.length,routine:routine/weeks.length,weeks:weeks.length,types:Object.fromEntries(Object.entries(types).map(([k,v])=>[k,[...v]])),byType:Object.fromEntries(Object.entries(byType).map(([kind,entries])=>[kind,Object.fromEntries(Object.entries(entries).map(([name,value])=>[name,Array.isArray(value)?value.map(n=>n/weeks.length):value/weeks.length]))]))};
}
function vectorSessions(types,needSame,needHome){
 const same=Math.ceil(needSame),home=Math.ceil(needHome),zero=()=>Array(types.length).fill(0);
 if(!same&&!home)return {counts:zero()};
 const maxSame=Math.max(0,...types.map(t=>t.sameDay)),maxHome=Math.max(0,...types.map(t=>t.homeVisit));
 if(same&&!maxSame||home&&!maxHome)return {error:same&&!maxSame?'No eligible session type covers all daily urgent appointment types with demand. Separate eligibility within a pool is not yet modelled.':'No eligible session type covers all home-visit appointment types with demand. Separate eligibility within a pool is not yet modelled.'};
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
function estimateSessions(types,modes,groups,demand,rules=[],options={}){
 const eligibleType=(type,pool)=>!options.respectTypes||!Array.isArray(type.appointmentTypes)||(!(demand?.types?.[pool]||[]).length||(demand.types[pool]).some(name=>type.appointmentTypes.includes(name)));
 const rows=types.map(type=>{let sameDay=0,homeVisit=0;for(const mode of modes){const n=type.appointmentsByMode[mode]||0;if(isHomeVisit(mode))homeVisit+=n;else sameDay+=n;}const eligible=(type.clinicianTypes||[]).filter(group=>groups.includes(group));const allCapacity=sameDay+homeVisit,allows=Object.fromEntries(['sameDay','homeVisit','weekly','routine'].map(pool=>[pool,eligibleType(type,pool)]));return {id:type.id,name:type.name,group:eligible.length===1?eligible[0]:'',sameDay:allows.sameDay?sameDay:0,homeVisit:allows.homeVisit?homeVisit:0,capacity:allCapacity,appointmentTypes:type.appointmentTypes,poolCapacity:{weekly:allows.weekly?(options.respectTypes?sameDay:allCapacity):0,routine:allows.routine?(options.respectTypes?sameDay:allCapacity):0},days:[0,0,0,0,0],weekly:0,routine:0,periods:{morning:Array(5).fill(0),afternoon:Array(5).fill(0)}};});
 if(!demand)return {rows,error:'No complete report weeks are available for calculating demand.'};
 const values=[...demand.sameDay,...demand.homeVisit,demand.weekly,demand.routine];
 if(values.length!==12||values.some(n=>!Number.isFinite(n)||n<0))return {rows,error:'Average demand is not available.'};
 const active=rules.filter(rule=>rule.enabled),hard=active.filter(rule=>rule.strength==='must');
 const periods=rule=>rule.scope==='both'?['morning','afternoon']:[rule.scope];
 const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday'];
 const issues=rule=>{
  if(!['minimum','share'].includes(rule.kind)||!['morning','afternoon','both','day'].includes(rule.scope)||!Array.isArray(rule.days)||!rule.days.length||rule.days.some(d=>!Number.isInteger(d)||d<1||d>5)||!Number.isFinite(rule.minimum)||rule.minimum<0)return 'Invalid planning rule.';
  if(rule.kind==='minimum'){
   const row=rows.find(row=>row.id===rule.sessionTypeId);
   if(!Number.isInteger(rule.minimum)||rule.minimum<1)return 'Minimum sessions must be a positive whole number.';
   if(!row||!row.group)return 'A required session type is missing or needs one clinician group. Check Planning Rules.';
  }else if(rule.minimum>100||!groups.includes(rule.clinicianGroup)||!['all','pair'].includes(rule.denominator)||rule.denominator==='pair'&&(!groups.includes(rule.comparisonGroup)||rule.comparisonGroup===rule.clinicianGroup))return 'A clinician-share rule has invalid groups or percentage. Check Planning Rules.';
  return '';
 };
 for(const rule of hard){const error=issues(rule);if(error)return {rows,error};}
 const usable=rows.filter(row=>row.group&&row.capacity>0&&Number.isFinite(row.capacity));
 if(!usable.length&&values.some(n=>n>0))return {rows,error:'Choose one clinician group and enter appointment counts for at least one session type.'};
 // Sessions are assigned once to a capacity pool and to an AM/PM period.
 // Weekly and routine pools never contribute to daily appointment capacity.
 const placements=[],unmetDemand=[];
 const count=(row,day,period)=>period==='day'?row.periods.morning[day]+row.periods.afternoon[day]:row.periods[period][day];
 const choosePeriod=day=>rows.reduce((s,r)=>s+r.periods.morning[day],0)<=rows.reduce((s,r)=>s+r.periods.afternoon[day],0)?'morning':'afternoon';
 const add=(row,day,period,pool,n)=>{
  if(!n)return;row.periods[period][day]+=n;
  if(pool==='daily')row.days[day]+=n;else row[pool]+=n;
  placements.push({id:row.id,day,period,pool,count:n});
 };
 // Seed required minima first. Shared scopes use the existing count, so duplicate
 // rules and whole-day rules cannot accidentally add the same obligation twice.
 for(const rule of hard.filter(rule=>rule.kind==='minimum').sort((a,b)=>(a.scope==='day')-(b.scope==='day'))){
  const row=rows.find(row=>row.id===rule.sessionTypeId);
  for(const d of rule.days)for(const scope of periods(rule)){
   const day=d-1,missing=Math.max(0,rule.minimum-count(row,day,scope));
   add(row,day,scope==='day'?choosePeriod(day):scope,'daily',missing);
  }
 }
 let approximate=false;
 if(options.respectTypes&&demand.byType){
  // Flow allocates each appointment at most once, only to sessions that offer its type.
  const flow=(pool,day,counts)=>{
   const entries=Object.entries(demand.byType[pool]||{}).map(([name,value])=>[name,Array.isArray(value)?value[day]:value]).filter(([,value])=>value>1e-8);
   const n=usable.length,m=entries.length,size=n+m+2,source=n+m,sink=source+1,graph=Array.from({length:size},()=>[]);
   const edge=(a,b,cap)=>{const x={to:b,cap,rev:graph[b].length},y={to:a,cap:0,rev:graph[a].length};graph[a].push(x);graph[b].push(y);};
   for(let i=0;i<n;i++){
    const row=usable[i],capacity=pool==='sameDay'?row.sameDay:pool==='homeVisit'?row.homeVisit:row.poolCapacity[pool];
    edge(source,i,(counts[i]||0)*capacity);
    for(let j=0;j<m;j++)if(!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(entries[j][0]))edge(i,n+j,1e12);
   }
   entries.forEach(([,need],j)=>edge(n+j,sink,need));let total=0;
   while(true){const seen=Array(size).fill(null),queue=[source];seen[source]=[-1,-1];for(let q=0;q<queue.length&&!seen[sink];q++){const a=queue[q];for(let i=0;i<graph[a].length;i++){const e=graph[a][i];if(e.cap>1e-8&&!seen[e.to]){seen[e.to]=[a,i];queue.push(e.to);}}}if(!seen[sink])break;let amount=Infinity;for(let v=sink;v!==source;){const [a,i]=seen[v];amount=Math.min(amount,graph[a][i].cap);v=a;}for(let v=sink;v!==source;){const [a,i]=seen[v],e=graph[a][i];e.cap-=amount;graph[v][e.rev].cap+=amount;v=a;}total+=amount;}
   return {covered:total,need:entries.reduce((sum,[,v])=>sum+v,0),missing:entries.map(([name],j)=>({name,amount:graph[n+j].find(e=>e.to===sink)?.cap||0})).filter(entry=>entry.amount>1e-8)};
  };
  const allocate=(pools,day,initial,place)=>{
   const counts=initial.slice();
   for(let iteration=0;iteration<10000;iteration++){
    const states=pools.map(pool=>flow(pool,day,counts));if(states.every(state=>state.need-state.covered<1e-7))return null;
    let best=-1,gain=0;
    for(let i=0;i<usable.length;i++){counts[i]++;const score=pools.reduce((sum,pool,j)=>sum+flow(pool,day,counts).covered-states[j].covered,0);counts[i]--;if(score>gain+1e-8){gain=score;best=i;}}
    if(best<0){states.forEach((state,i)=>state.missing.forEach(item=>unmetDemand.push({pool:pools[i],day,...item})));return null;}
    counts[best]++;place(usable[best]);
   }
   return 'Demand is too large to calculate a session plan. Check session capacities.';
  };
  for(let day=0;day<5;day++){
   const error=allocate(['sameDay','homeVisit'],day,usable.map(row=>row.days[day]),row=>add(row,day,choosePeriod(day),'daily',1));if(error)return {rows,error};
  }
  for(const pool of ['weekly','routine']){let index=0;const error=allocate([pool],0,usable.map(()=>0),row=>{const day=index++%5;add(row,day,choosePeriod(day),pool,1);});if(error)return {rows,error};}
  approximate=true;
 }else{
 for(let day=0;day<5;day++){
  const same=rows.reduce((s,r)=>s+r.days[day]*r.sameDay,0),home=rows.reduce((s,r)=>s+r.days[day]*r.homeVisit,0);
  const result=vectorSessions(usable,Math.max(0,demand.sameDay[day]-same),Math.max(0,demand.homeVisit[day]-home));
  if(result.error)return {rows,error:result.error};approximate||=!!result.approximate;
  usable.forEach((row,i)=>{for(let n=0;n<result.counts[i];n++)add(row,day,choosePeriod(day),'daily',1);});
 }
 for(const field of ['weekly','routine'])if(demand[field]>0){
  const max=Math.max(0,...usable.map(row=>row.poolCapacity[field]));if(!max)return {rows,error:'No eligible session type covers all '+(field==='weekly'?'weekly urgent':'routine')+' appointment types with demand. Separate eligibility within a pool is not yet modelled.'};
  const leaders=usable.filter(row=>row.poolCapacity[field]===max),n=Math.ceil(demand[field]/max);
  // Spread weekly pools across weekdays without claiming a daily demand forecast.
  for(let i=0;i<n;i++){const day=i%5;add(leaders[i%leaders.length],day,choosePeriod(day),field,1);}
 }
 }
 const share=(rule,day,period)=>{
  let numerator=0,denominator=0;
  for(const row of rows){
   const capacity=count(row,day,period)*row.capacity;
   if(row.group===rule.clinicianGroup)numerator+=capacity;
   if(rule.denominator==='all'||[rule.clinicianGroup,rule.comparisonGroup].includes(row.group))denominator+=capacity;
  }
  return {numerator,denominator,ok:rule.minimum===0||denominator>0&&numerator*100+1e-7>=rule.minimum*denominator};
 };
 // Repair appointment-share constraints by adding target-group capacity. This
 // is a bounded feasible-plan heuristic, not a workforce optimum.
 const shares=hard.filter(rule=>rule.kind==='share');let repaired=false,added=0;
 for(let pass=0;pass<100;pass++){
  let changed=false;
  for(const rule of shares)for(const d of rule.days)for(const period of periods(rule)){
   const day=d-1,state=share(rule,day,period);if(state.ok)continue;
   const candidates=usable.filter(row=>row.group===rule.clinicianGroup).sort((a,b)=>b.capacity-a.capacity);
   const row=candidates[0];if(!row)continue;
   const required=rule.minimum===100?(state.denominator===state.numerator?1:Infinity):Math.max(1,Math.ceil((rule.minimum*state.denominator-100*state.numerator)/((100-rule.minimum)*row.capacity)-1e-10));
   if(!Number.isFinite(required)||added+required>10000)continue;
   add(row,day,period==='day'?choosePeriod(day):period,'daily',required);added+=required;changed=true;repaired=true;
  }
  if(!changed)break;
 }
 const ruleResults=active.map(rule=>{
  const error=issues(rule),failures=[];
  if(error)failures.push(error);
  else for(const d of rule.days)for(const period of periods(rule)){
   const day=d-1;
   if(rule.kind==='minimum'){
    const row=rows.find(row=>row.id===rule.sessionTypeId),actual=count(row,day,period);
    if(actual<rule.minimum)failures.push(dayNames[day]+' '+period+': '+actual+' of '+rule.minimum+' '+row.name+' sessions.');
   }else if(!share(rule,day,period).ok)failures.push(dayNames[day]+' '+period+': '+rule.clinicianGroup+' appointment share is below '+rule.minimum+'%.');
  }
  return {id:rule.id,strength:rule.strength,ok:!failures.length,failures};
 });
 const unmet=ruleResults.filter(result=>result.strength==='must'&&!result.ok);
 if(unmet.length)return {rows,ruleResults,error:'No plan found that meets all required rules. '+unmet[0].failures[0]+' Review conflicting rules or available session types.'};
 const sum=fn=>rows.reduce((s,row)=>s+fn(row),0);
 const days=Array.from({length:5},(_,day)=>sum(row=>row.days[day]));
 const capacitySameDay=days.map((_,day)=>sum(row=>row.days[day]*row.sameDay)),capacityHomeVisit=days.map((_,day)=>sum(row=>row.days[day]*row.homeVisit));
 return {rows,days,capacitySameDay,capacityHomeVisit,weeklySessions:sum(row=>row.weekly),routineSessions:sum(row=>row.routine),weeklyCapacity:sum(row=>row.weekly*row.poolCapacity.weekly),routineCapacity:sum(row=>row.routine*row.poolCapacity.routine),placements,unmetDemand,ruleResults,ruleAdjusted:repaired,totalNeed:values.reduce((s,n)=>s+n,0),totalCapacity:sum(row=>row.days.reduce((s,n)=>s+n,0)*(row.sameDay+row.homeVisit)+row.weekly*row.poolCapacity.weekly+row.routine*row.poolCapacity.routine),approximate};
}
window.SessionBuilderPlanning=Object.freeze({averageDemand,estimateSessions,isHomeVisit,isIncludedAppointmentType,vectorSessions});
})();
