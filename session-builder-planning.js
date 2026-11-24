(function(){
'use strict';
function historicalCareKind(category,role,planningMode){if(String(category||'').toLowerCase().replace(/[^a-z]/g,'')==='homevisiting')return 'homeVisit';if(role==='routine')return 'routine';if(role==='urgent')return planningMode==='weekly'?'weekly':'sameDay';return null;}
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
function shareSubject(rule){return rule.shareSubject||{kind:'group',name:rule.clinicianGroup};}
function shareDenominators(rule){return Array.isArray(rule.denominatorSelections)?rule.denominatorSelections:rule.denominator==='pair'?[{kind:'group',name:rule.clinicianGroup},{kind:'group',name:rule.comparisonGroup}]:[];}
function matchesClinician(row,ref){return ref.kind==='group'?row.group===ref.name:ref.kind==='type'&&row.clinician===ref.name;}
function sharePool(rule){if(['urgent','all','selected'].includes(rule.appointmentPool))return rule.appointmentPool;const groups=shareDenominators(rule);return groups.length===2&&groups.some(ref=>ref.kind==='group'&&/urgent\s*care/i.test(ref.name||''))?'urgent':'all';}
function estimateSessions(types,modes,groups,demand,rules=[],options={}){
 const constrained=!!options.clinicians,clinicianCounts=Object.create(null),clinicianLimits=options.clinicianLimits||{};
 const originalTypes=types;
 if(constrained){types=types.flatMap(type=>{const selected=Array.isArray(type.eligibleClinicians)?type.eligibleClinicians:[];const valid=selected.filter(name=>Object.hasOwn(options.clinicians,name)&&groups.includes(options.clinicians[name]));return valid.length?valid.map(name=>({...type,id:JSON.stringify([type.id,name]),sourceId:type.id,clinician:name,clinicianTypes:[options.clinicians[name]]})):[{...type,id:JSON.stringify([type.id,null]),sourceId:type.id,clinician:null,clinicianTypes:[]}];});}
 const eligibleType=(type,pool)=>{const names=pool==='sameDay'?(demand?.eligibleDailyTypes||demand?.types?.sameDay||[]):(demand?.types?.[pool]||[]);return !options.respectTypes||!Array.isArray(type.appointmentTypes)||!names.length||names.some(name=>type.appointmentTypes.includes(name));};
 const rows=types.map(type=>{let sameDay=0,homeVisit=0;for(const mode of modes){const n=type.appointmentsByMode[mode]||0;if(isHomeVisit(mode))homeVisit+=n;else sameDay+=n;}const eligible=(type.clinicianTypes||[]).filter(group=>groups.includes(group));const allCapacity=sameDay+homeVisit,allows=Object.fromEntries(['sameDay','homeVisit','weekly','routine'].map(pool=>[pool,eligibleType(type,pool)]));return {id:type.id,sourceId:type.sourceId||type.id,clinician:type.clinician||null,name:type.name,group:eligible.length===1?eligible[0]:'',sameDay:allows.sameDay?sameDay:0,homeVisit:allows.homeVisit?homeVisit:0,capacity:allCapacity,appointmentTypes:type.appointmentTypes,poolCapacity:{weekly:allows.weekly?(options.respectTypes?sameDay:allCapacity):0,routine:allows.routine?(options.respectTypes?sameDay:allCapacity):0,planned:sameDay},days:[0,0,0,0,0],weekly:0,routine:0,planned:0,periods:{morning:Array(5).fill(0),afternoon:Array(5).fill(0)}};});
 if(!demand)return {rows,error:'No complete report weeks are available for calculating demand.'};
 const values=[...demand.sameDay,...demand.homeVisit,demand.weekly,demand.routine];
 if(values.length!==12||values.some(n=>!Number.isFinite(n)||n<0))return {rows,error:'Average demand is not available.'};
 const active=rules.filter(rule=>rule.enabled),hard=active.filter(rule=>rule.strength==='must');
 const periods=rule=>rule.scope==='both'?['morning','afternoon']:[rule.scope];
 const ruleDays=rule=>rule.scope==='week'?[rule.days[0]]:rule.days;
 const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday'];
 const issues=rule=>{
  if(!['minimum','share','mix'].includes(rule.kind)||!['morning','afternoon','both','day','week'].includes(rule.scope)||!Array.isArray(rule.days)||!rule.days.length||rule.days.some(d=>!Number.isInteger(d)||d<1||d>5)||!Number.isFinite(rule.minimum)||rule.minimum<0)return 'Invalid planning rule.';
  if(rule.kind==='minimum'){
   const matches=rows.filter(row=>row.sourceId===rule.sessionTypeId);
   if(!Number.isInteger(rule.minimum)||rule.minimum<1)return 'Minimum sessions must be a positive whole number.';
   if(!matches.some(row=>row.group))return 'A required session type is missing or needs an eligible clinician group or clinician. Check Planning Rules.';
  }else{
   const subject=shareSubject(rule),denominators=rule.kind==='mix'?[]:shareDenominators(rule),valid=ref=>ref&&['group','type'].includes(ref.kind)&&typeof ref.name==='string'&&(ref.kind==='group'?groups.includes(ref.name):!!options.clinicians&&Object.hasOwn(options.clinicians,ref.name));
   if(rule.minimum>100||!valid(subject)||denominators.length>2||denominators.some(ref=>!valid(ref)))return 'A clinician-share rule has an invalid clinician selection. Check Planning Rules.';
   if((rule.kind==='mix'||sharePool(rule)==='selected')&&(!Array.isArray(rule.appointmentTypes)||!rule.appointmentTypes.length))return 'Choose at least one appointment type for the rule.';
   if(rule.comparison&&!['atLeast','atMost','exact'].includes(rule.comparison))return 'Invalid percentage comparison.';
   if(denominators.length){const universe=constrained?Object.entries(options.clinicians).map(([clinician,group])=>({clinician,group})):groups.map(group=>({group}));if(universe.some(row=>matchesClinician(row,subject)&&!denominators.some(ref=>matchesClinician(row,ref))))return 'The share denominator must include the selected clinician or group. Check Planning Rules.';}
  }
  return '';
 };
 for(const rule of hard){const error=issues(rule);if(error)return {rows,error};}
 const usable=rows.filter(row=>row.group&&row.capacity>0&&Number.isFinite(row.capacity));
 if(!usable.length&&values.some(n=>n>0))return {rows,error:'Choose one clinician group and enter appointment counts for at least one session type.'};
 // Sessions are assigned once to a capacity pool and to an AM/PM period.
 // Weekly and routine pools never contribute to daily appointment capacity.
 const placements=[],unmetDemand=[];
 const count=(row,day,period)=>period==='day'?row.periods.morning[day]+row.periods.afternoon[day]:row.periods[period][day];
 const dayShort=['Mon','Tue','Wed','Thu','Fri'];
 const available=(row,day,period)=>{if(!constrained)return true;const pattern=clinicianLimits[row.clinician]?.workingPattern;return !Array.isArray(pattern)||pattern.includes(dayShort[day]+' '+(period==='morning'?'AM':'PM'));};
 const choosePeriod=(day,row)=>{const morning=!row||available(row,day,'morning'),afternoon=!row||available(row,day,'afternoon');if(!morning&&!afternoon)return null;if(!morning)return 'afternoon';if(!afternoon)return 'morning';return rows.reduce((s,r)=>s+r.periods.morning[day],0)<=rows.reduce((s,r)=>s+r.periods.afternoon[day],0)?'morning':'afternoon';};
 const availableSlot=(row,start=0)=>{for(let i=0;i<5;i++){const day=(start+i)%5,period=choosePeriod(day,row);if(period)return {day,period};}return null;};
 const room=row=>!constrained?Infinity:row.clinician?Math.max(0,(clinicianLimits[row.clinician]?.max??Infinity)-(clinicianCounts[row.clinician]||0)):0;
 const ruleSlot=(row,day,period,rule)=>{if(period==='week'){for(const d of rule.days){const p=choosePeriod(d-1,row);if(p)return {day:d-1,period:p};}return null;}const p=period==='day'?choosePeriod(day,row):available(row,day,period)?period:null;return p?{day,period:p}:null;};
 const countForRule=(row,rule,day,period)=>period==='week'?rule.days.reduce((sum,d)=>sum+count(row,d-1,'day'),0):count(row,day,period);
 const add=(row,day,period,pool,n,forcedType=null,forcedPool=null)=>{
  if(!n)return true;if(room(row)<n||!period||!available(row,day,period))return false;if(constrained)clinicianCounts[row.clinician]=(clinicianCounts[row.clinician]||0)+n;row.periods[period][day]+=n;
  if(pool==='daily')row.days[day]+=n;else row[pool]+=n;
  placements.push({id:row.id,sourceId:row.sourceId,clinician:row.clinician,day,period,pool,count:n,forcedType,forcedPool});return true;
 };
 if(constrained){
  if(!demand.byType)return {rows,error:'A detailed demand forecast is required to apply clinician limits.'};
  for(const [name,limit] of Object.entries(clinicianLimits)){if(!Object.hasOwn(options.clinicians,name))continue;const minimum=limit.min||0;if(!minimum)continue;const candidates=rows.filter(row=>row.clinician===name).sort((a,b)=>b.capacity-a.capacity);if(!candidates.length)return {rows,error:'No eligible session type is configured for '+name+' (minimum '+minimum+' sessions).'};for(let i=0;i<minimum;i++){const candidate=candidates.find(row=>room(row)>0&&availableSlot(row,i%5));if(!candidate)return {rows,error:'The minimum sessions for '+name+' cannot be met with the clinician maximum and working pattern.'};const {day,period}=availableSlot(candidate,i%5),pool=(candidate.sameDay>0&&demand.sameDay.some(n=>n>0))||(candidate.homeVisit>0&&demand.homeVisit.some(n=>n>0))?'daily':candidate.poolCapacity.routine>0&&demand.routine>0?'routine':candidate.poolCapacity.weekly>0&&demand.weekly>0?'weekly':'daily';add(candidate,day,period,pool,1);}}
 }
 // Seed required minima first. Shared scopes use the existing count, so duplicate
 // rules and whole-day rules cannot accidentally add the same obligation twice.
 for(const rule of hard.filter(rule=>rule.kind==='minimum').sort((a,b)=>(a.scope==='day')-(b.scope==='day'))){
  const candidates=rows.filter(row=>row.sourceId===rule.sessionTypeId&&row.group);
  for(const d of ruleDays(rule))for(const scope of periods(rule)){
   const day=d-1,missing=Math.max(0,rule.minimum-candidates.reduce((sum,row)=>sum+countForRule(row,rule,day,scope),0));
   for(let i=0;i<missing;i++){const row=candidates.filter(row=>room(row)>0&&ruleSlot(row,day,scope,rule)).sort((a,b)=>room(b)-room(a))[0];if(!row)return {rows,error:'Required sessions cannot be scheduled within clinician maximums and working patterns. Check Planning Rules and Clinician Setup.'};const slot=ruleSlot(row,day,scope,rule);add(row,slot.day,slot.period,'daily',1);}
  }
 }
 let approximate=false,flowForBreakdown=null;
 if(options.respectTypes&&demand.byType){
  // Flow allocates each appointment at most once, only to sessions that offer its type.
  const flow=(pool,day,counts)=>{
   const entries=pool==='sameDay'?[['Same-day urgent',demand.sameDay[day]]].filter(([,value])=>value>1e-8):Object.entries(demand.byType[pool]||{}).map(([name,value])=>[name,Array.isArray(value)?value[day]:value]).filter(([,value])=>value>1e-8);
   const n=usable.length,m=entries.length,size=n+m+2,source=n+m,sink=source+1,graph=Array.from({length:size},()=>[]),links=Array.from({length:n},()=>Array(m).fill(null));
   const edge=(a,b,cap)=>{const x={to:b,cap,rev:graph[b].length},y={to:a,cap:0,rev:graph[a].length};graph[a].push(x);graph[b].push(y);return x;};
   for(let i=0;i<n;i++){
    const row=usable[i],capacity=pool==='sameDay'?row.sameDay:pool==='homeVisit'?row.homeVisit:row.poolCapacity[pool];
    edge(source,i,(counts[i]||0)*capacity);
    for(let j=0;j<m;j++)if(pool==='sameDay'?row.sameDay>0:!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(entries[j][0]))links[i][j]=edge(i,n+j,entries[j][1]);
   }
   entries.forEach(([,need],j)=>edge(n+j,sink,need));let total=0;
   while(true){const seen=Array(size).fill(null),queue=[source];seen[source]=[-1,-1];for(let q=0;q<queue.length&&!seen[sink];q++){const a=queue[q];for(let i=0;i<graph[a].length;i++){const e=graph[a][i];if(e.cap>1e-8&&!seen[e.to]){seen[e.to]=[a,i];queue.push(e.to);}}}if(!seen[sink])break;let amount=Infinity;for(let v=sink;v!==source;){const [a,i]=seen[v];amount=Math.min(amount,graph[a][i].cap);v=a;}for(let v=sink;v!==source;){const [a,i]=seen[v],e=graph[a][i];e.cap-=amount;graph[v][e.rev].cap+=amount;v=a;}total+=amount;}
   return {allocations:links.map(row=>Object.fromEntries(row.map((link,j)=>[entries[j][0],link?graph[link.to][link.rev].cap:0]).filter(([,value])=>value>1e-8))),covered:total,need:entries.reduce((sum,[,v])=>sum+v,0),missing:entries.map(([name],j)=>({name,amount:graph[n+j].find(e=>e.to===sink)?.cap||0})).filter(entry=>entry.amount>1e-8)};
  };
  flowForBreakdown=flow;
  const allocate=(pools,day,initial,place,canPlace)=>{
   const counts=initial.slice();
   for(let iteration=0;iteration<10000;iteration++){
    const states=pools.map(pool=>flow(pool,day,counts));if(states.every(state=>state.need-state.covered<1e-7))return null;
    let best=-1,gain=0;
    for(let i=0;i<usable.length;i++){if(room(usable[i])<1||!canPlace(usable[i]))continue;counts[i]++;const score=pools.reduce((sum,pool,j)=>sum+flow(pool,day,counts).covered-states[j].covered,0);counts[i]--;if(score>gain+1e-8){gain=score;best=i;}}
    if(best<0){states.forEach((state,i)=>state.missing.forEach(item=>unmetDemand.push({pool:pools[i],day,...item})));return null;}
    counts[best]++;place(usable[best]);
   }
   return 'Demand is too large to calculate a session plan. Check session capacities.';
  };
  for(let day=0;day<5;day++){
   const error=allocate(['sameDay','homeVisit'],day,usable.map(row=>row.days[day]),row=>add(row,day,choosePeriod(day,row),'daily',1),row=>!!choosePeriod(day,row));if(error)return {rows,error};
  }
  for(const pool of ['weekly','routine']){let index=0;const error=allocate([pool],0,usable.map(row=>row[pool]),row=>{const slot=availableSlot(row,index++%5);add(row,slot.day,slot.period,pool,1);},row=>!!availableSlot(row));if(error)return {rows,error};}
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
 const buildBreakdown=()=>{
 const appointmentBreakdown={};
 if(flowForBreakdown){
  const addBreakdown=(id,day,period,name,value)=>{if(value<=1e-8)return;const periods=appointmentBreakdown[id]||(appointmentBreakdown[id]=Array.from({length:5},()=>({morning:{},afternoon:{}})));const cell=periods[day][period];cell[name]=(cell[name]||0)+value;};
  const splitWhole=(total,weights)=>{
   const positive=weights.filter(([,value])=>value>1e-8),sum=positive.reduce((n,[,value])=>n+value,0);
   if(!sum)return [['Unallocated',total]];
   const parts=positive.map(([name,weight])=>{const exact=total*weight/sum,whole=Math.floor(exact);return {name,whole,fraction:exact-whole};});
   let remainder=total-parts.reduce((n,part)=>n+part.whole,0);parts.sort((a,b)=>b.fraction-a.fraction||a.name.localeCompare(b.name));
   for(let i=0;i<remainder;i++)parts[i%parts.length].whole++;return parts.map(part=>[part.name,part.whole]);
  };
  const distribute=(pool,day)=>{
   const daily=pool==='sameDay'||pool==='homeVisit',counts=usable.map(row=>daily?row.days[day]:row[pool]),result=flowForBreakdown(pool,day,counts);
   usable.forEach((row,index)=>{
    if(!counts[index])return;
    const capacity=pool==='sameDay'?row.sameDay:pool==='homeVisit'?row.homeVisit:row.poolCapacity[pool];if(!capacity)return;
    const targetPlacements=placements.filter(p=>p.id===row.id&&p.pool===(daily?'daily':pool)&&(!daily||p.day===day));
    let weights=pool==='sameDay'?Object.entries(demand.byType.sameDay||{}).filter(([type])=>!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(type)).map(([type,days])=>[type,days[day]]):Object.entries(result.allocations[index]);
    if(pool==='sameDay'&&!weights.some(([,value])=>value>1e-8))weights=(demand.eligibleDailyTypes||demand.types?.sameDay||[]).filter(name=>!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(name)).map(name=>[name,1]);
    if(!weights.some(([,value])=>value>1e-8)&&pool!=='sameDay')weights=Object.entries(demand.byType[pool]||{}).filter(([name])=>!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(name)).map(([name,value])=>[name,Array.isArray(value)?value[day]:value]);
    for(const placement of targetPlacements){const selected=placement.forcedType&&placement.forcedPool===pool?[[placement.forcedType,1]]:weights;for(const [name,value] of splitWhole(placement.count*capacity,selected))addBreakdown(row.id,placement.day,placement.period,name,value);}
   });
  };
  for(let day=0;day<5;day++){distribute('sameDay',day);distribute('homeVisit',day);}
  distribute('weekly',0);distribute('routine',0);distribute('planned',0);
 }
 return appointmentBreakdown;
 };
 let appointmentBreakdown=buildBreakdown();
 const selectedNames=rule=>rule.appointmentPool==='selected'||rule.kind==='mix'?new Set(rule.appointmentTypes||[]):sharePool(rule)==='urgent'?new Set([...(demand.eligibleDailyTypes||demand.types?.sameDay||[]),...(demand.types?.weekly||[])]):null;
 const matchesDenominator=(row,rule)=>{const refs=shareDenominators(rule);return !refs.length||refs.some(ref=>matchesClinician(row,ref));};
 const share=(rule,day,period)=>{
  let numerator=0,denominator=0;const names=selectedNames(rule),days=period==='week'?rule.days.map(d=>d-1):[day],parts=period==='week'||period==='day'?['morning','afternoon']:[period];
  for(const row of rows){
   const allocated=days.flatMap(d=>parts.flatMap(p=>Object.entries(appointmentBreakdown[row.id]?.[d]?.[p]||{})));
   const all=flowForBreakdown?allocated.reduce((n,[name,value])=>n+(name==='Unallocated'?0:value),0):days.reduce((n,d)=>n+count(row,d,period==='week'?'day':period)*row.capacity,0);
   const chosen=flowForBreakdown?allocated.reduce((n,[name,value])=>n+(name!=='Unallocated'&&(!names||names.has(name))?value:0),0):all;
   if(rule.kind==='mix'){if(matchesClinician(row,shareSubject(rule))){numerator+=chosen;denominator+=all;}}
   else{if(matchesClinician(row,shareSubject(rule)))numerator+=chosen;if(matchesDenominator(row,rule))denominator+=chosen;}
  }
  const delta=numerator*100-rule.minimum*denominator,comparison=rule.comparison||'atLeast';
  // An appointment-mix rule applies only when the clinician has appointments
  // in this period. It must not invent a session on an empty or unavailable morning.
  const noAppointments=rule.kind==='mix'&&denominator===0;
  return {numerator,denominator,delta,ok:noAppointments||denominator>0&&(comparison==='atMost'?delta<=1e-7:comparison==='exact'?Math.abs(delta)<=1e-7:delta>=-1e-7)||rule.minimum===0&&comparison==='atLeast'};
 };
 const poolFor=name=>options.appointmentPools?.[name]|| (demand.types?.homeVisit?.includes(name)?'homeVisit':demand.types?.weekly?.includes(name)?'weekly':demand.types?.routine?.includes(name)?'routine':(demand.eligibleDailyTypes||demand.types?.sameDay||[]).includes(name)?'sameDay':null);
 const percentages=hard.filter(rule=>rule.kind==='share'||rule.kind==='mix');let repaired=false,added=0;
 // Reposition an existing weekly-pool session before adding another one. Weekly
 // demand is unchanged, and clinician limits continue to count the same session.
 const moveExistingMixSession=(rule,day,period,state)=>{
  if(rule.kind!=='mix'||!flowForBreakdown)return false;
  const needMore=state.delta<0,selected=new Set(rule.appointmentTypes||[]);
  for(const placement of placements){
   if(!['routine','weekly','planned'].includes(placement.pool)||placement.count!==1)continue;
   const row=rows.find(item=>item.id===placement.id);if(!row||!matchesClinician(row,shareSubject(rule)))continue;
   const slot=ruleSlot(row,day,period,rule);if(!slot||slot.day===placement.day&&slot.period===placement.period)continue;
   const current=appointmentBreakdown[row.id]?.[placement.day]?.[placement.period]||{};
   const useful=Object.entries(current).some(([name,value])=>value>0&&name!=='Unallocated'&&(needMore?selected.has(name):!selected.has(name)));
   if(!useful)continue;
   const protectedStates=percentages.flatMap(other=>ruleDays(other).flatMap(d=>periods(other).filter(p=>other!==rule||d-1!==day||p!==period).map(p=>({other,day:d-1,period:p,ok:share(other,d-1,p).ok}))));
   const oldDay=placement.day,oldPeriod=placement.period;
   row.periods[oldPeriod][oldDay]--;row.periods[slot.period][slot.day]++;placement.day=slot.day;placement.period=slot.period;appointmentBreakdown=buildBreakdown();
   const next=share(rule,day,period),improved=needMore?next.delta>state.delta+1e-7:next.delta<state.delta-1e-7;
   const preserved=protectedStates.every(item=>!item.ok||share(item.other,item.day,item.period).ok);
   // Moving a session must not break a minimum-session rule at its old location.
   const minima=hard.filter(item=>item.kind==='minimum').every(item=>ruleDays(item).every(d=>periods(item).every(p=>rows.filter(r=>r.sourceId===item.sessionTypeId).reduce((sum,r)=>sum+countForRule(r,item,d-1,p),0)>=item.minimum)));
   if(improved&&preserved&&minima)return true;
   row.periods[slot.period][slot.day]--;row.periods[oldPeriod][oldDay]++;placement.day=oldDay;placement.period=oldPeriod;appointmentBreakdown=buildBreakdown();
  }
  return false;
 };
 for(let pass=0;pass<100;pass++){
  let changed=false;
  for(const rule of percentages)for(const d of ruleDays(rule))for(const period of periods(rule)){
   const day=d-1,state=share(rule,day,period);if(state.ok)continue;
   if(moveExistingMixSession(rule,day,period,state)){changed=true;repaired=true;continue;}
   const comparison=rule.comparison||'atLeast',needMore=state.denominator===0||state.delta<0,needSubject=rule.kind==='mix'||needMore;
   const candidates=usable.filter(row=>room(row)>0&&ruleSlot(row,day,period,rule)&&(needSubject?matchesClinician(row,shareSubject(rule)):matchesDenominator(row,rule)&&!matchesClinician(row,shareSubject(rule))));
   let best=null;
   for(const row of candidates){
    let types=(Array.isArray(row.appointmentTypes)?row.appointmentTypes:[...new Set([...Object.keys(options.appointmentPools||{}),...Object.values(demand.types||{}).flat()])]).filter(name=>poolFor(name));
    if(rule.kind==='mix')types=types.filter(name=>needMore?(rule.appointmentTypes||[]).includes(name):!(rule.appointmentTypes||[]).includes(name));
    else if(rule.appointmentPool==='selected')types=types.filter(name=>(rule.appointmentTypes||[]).includes(name));
    else if(sharePool(rule)==='urgent')types=types.filter(name=>(demand.eligibleDailyTypes||[]).includes(name)||(demand.types?.weekly||[]).includes(name));
    for(const name of types){const pool=poolFor(name),capacity=pool==='homeVisit'?row.homeVisit:pool==='sameDay'?row.sameDay:row.poolCapacity[pool];if(capacity>0&&(!best||capacity>best.capacity))best={row,name,pool,capacity};}
   }
   // Legacy all/urgent rules can use a session without a type-specific override.
   if(!best&&rule.kind==='share'&&rule.appointmentPool!=='selected'){
    const urgent=sharePool(rule)==='urgent',row=candidates.filter(r=>urgent?r.sameDay>0:r.capacity>0).sort((a,b)=>(urgent?b.sameDay-a.sameDay:b.capacity-a.capacity))[0];if(row)best={row,pool:'sameDay',name:null,capacity:urgent?row.sameDay:row.capacity};
   }
   if(!best||added>=10000)continue;
   const slot=ruleSlot(best.row,day,period,rule);if(!slot)continue;
   const isDaily=best.pool==='sameDay'||best.pool==='homeVisit';
   add(best.row,slot.day,slot.period,isDaily?'daily':best.pool,1,best.name,best.pool);if(flowForBreakdown)appointmentBreakdown=buildBreakdown();added++;changed=true;repaired=true;
  }
  if(!changed)break;
 }
 if(flowForBreakdown)appointmentBreakdown=buildBreakdown();
 const ruleResults=active.map(rule=>{
  const error=issues(rule),failures=[],measurements=[];
  if(error)failures.push(error);
  else for(const d of ruleDays(rule))for(const period of periods(rule)){
   const day=d-1;
   if(rule.kind==='minimum'){
    const matching=rows.filter(row=>row.sourceId===rule.sessionTypeId),actual=matching.reduce((sum,row)=>sum+countForRule(row,rule,day,period),0);
    if(actual<rule.minimum)failures.push(dayNames[day]+' '+period+': '+actual+' of '+rule.minimum+' '+(matching[0]?.name||'required')+' sessions.');
   }else{const state=share(rule,day,period);measurements.push({day,period,numerator:state.numerator,denominator:state.denominator});if(!state.ok){
    let reason='';
    if(rule.kind==='mix'){
     const eligible=usable.filter(row=>matchesClinician(row,shareSubject(rule))&&(rule.appointmentTypes||[]).some(name=>(!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(name))&&poolFor(name)));
     if(!eligible.length)reason=' No session type is eligible for both this clinician and the selected appointment type.';
     else if(!eligible.some(row=>ruleSlot(row,day,period,rule)))reason=' The clinician is not available for an eligible session in this period.';
     else if(!eligible.some(row=>room(row)>0))reason=' The eligible clinician has reached their weekly session maximum; review the limit or other required sessions.';
    }
    const target=({atLeast:'at least',atMost:'at most',exact:'exactly'}[rule.comparison||'atLeast']);
    failures.push((period==='week'?'Week':dayNames[day]+' '+period)+': '+shareSubject(rule).name+' appointment mix does not meet the '+target+' '+rule.minimum+'% target.'+reason);
   }}
  }
  return {id:rule.id,kind:rule.kind,strength:rule.strength,ok:!failures.length,failures,...(rule.kind==='share'||rule.kind==='mix'?{appointmentPool:sharePool(rule),clinicianGroup:shareSubject(rule).name,minimum:rule.minimum,comparison:rule.comparison||'atLeast',measurements}: {})};
 });
 const unmet=ruleResults.filter(result=>result.strength==='must'&&!result.ok);
 if(unmet.length)return {rows,ruleResults,error:'No plan found that meets all required rules. '+unmet[0].failures[0]+' Review conflicting rules or available session types.'};
 const unassignedDailyTypes=options.respectTypes&&demand.byType?Object.entries(demand.byType.sameDay||{}).filter(([name,values])=>values.some(value=>value>1e-8)&&!usable.some(row=>row.sameDay>0&&(!Array.isArray(row.appointmentTypes)||row.appointmentTypes.includes(name)))).map(([name])=>name):[];
 const sum=fn=>rows.reduce((s,row)=>s+fn(row),0);
 const days=Array.from({length:5},(_,day)=>sum(row=>row.days[day]));
 const capacitySameDay=days.map((_,day)=>sum(row=>row.days[day]*row.sameDay)),capacityHomeVisit=days.map((_,day)=>sum(row=>row.days[day]*row.homeVisit));
 let visibleRows=rows,visibleBreakdown=appointmentBreakdown;
 if(constrained){
  visibleRows=originalTypes.map(type=>{const parts=rows.filter(row=>row.sourceId===type.id),sum=fn=>parts.reduce((n,row)=>n+fn(row),0);return {id:type.id,name:type.name,group:[...new Set(parts.map(row=>row.group).filter(Boolean))].join(' · '),capacity:sum(row=>row.capacity),days:Array.from({length:5},(_,day)=>sum(row=>row.days[day])),weekly:sum(row=>row.weekly),routine:sum(row=>row.routine),planned:sum(row=>row.planned),periods:{morning:Array.from({length:5},(_,day)=>sum(row=>row.periods.morning[day])),afternoon:Array.from({length:5},(_,day)=>sum(row=>row.periods.afternoon[day]))}};});
  visibleBreakdown={};for(const row of rows){const source=appointmentBreakdown[row.id];if(!source)continue;const target=visibleBreakdown[row.sourceId]||(visibleBreakdown[row.sourceId]=Array.from({length:5},()=>({morning:{},afternoon:{}})));for(let day=0;day<5;day++)for(const period of ['morning','afternoon'])for(const [name,value] of Object.entries(source[day][period]))target[day][period][name]=(target[day][period][name]||0)+value;}
 }
 return {rows:visibleRows,clinicianCounts,days,capacitySameDay,capacityHomeVisit,weeklySessions:sum(row=>row.weekly),routineSessions:sum(row=>row.routine),weeklyCapacity:sum(row=>row.weekly*row.poolCapacity.weekly),routineCapacity:sum(row=>row.routine*row.poolCapacity.routine),plannedCapacity:sum(row=>row.planned*row.poolCapacity.planned),placements,appointmentBreakdown:visibleBreakdown,unmetDemand,unassignedDailyTypes,ruleResults,ruleAdjusted:repaired,totalNeed:values.reduce((s,n)=>s+n,0),totalCapacity:sum(row=>row.days.reduce((s,n)=>s+n,0)*(row.sameDay+row.homeVisit)+row.weekly*row.poolCapacity.weekly+row.routine*row.poolCapacity.routine+row.planned*row.poolCapacity.planned),approximate};
}
window.SessionBuilderPlanning=Object.freeze({averageDemand,estimateSessions,isHomeVisit,isIncludedAppointmentType,historicalCareKind,vectorSessions,sharePool,shareSubject,shareDenominators});
})();
