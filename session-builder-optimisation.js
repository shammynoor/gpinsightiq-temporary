(function(){
'use strict';
let cached=null,pending=null,completed=null;
function estimateAsync(...args){
 if(typeof Worker==='undefined')return Promise.resolve(estimate(...args));
 const key=JSON.stringify(args);if(completed?.key===key)return Promise.resolve(completed.result);if(pending?.key===key)return pending.promise;
 if(pending){pending.worker.terminate();clearTimeout(pending.timer);pending.resolve({cancelled:true,rows:[]});pending=null;}
 let resolve;const promise=new Promise(r=>resolve=r),worker=new Worker('session-builder-cost-worker.js?v=soft-bands-allocation-v1');
 const job={key,worker,promise,resolve};pending=job;
 const finish=result=>{worker.terminate();clearTimeout(job.timer);if(pending===job)pending=null;completed={key,result};resolve(result);};
 worker.onmessage=event=>finish(event.data);worker.onerror=()=>finish({rows:[],error:'The background cost optimiser failed to load. Refresh the page.'});
 job.timer=setTimeout(()=>finish({rows:[],error:'Cost optimisation exceeded the calculation limit. Review the settings and try again.'}),11000);
 worker.postMessage(args);return promise;
}
function estimate(types,modes,groups,demand,rules=[],options={}){
 const key=JSON.stringify([types,modes,groups,demand,rules,options]);
 if(cached?.key===key)return cached.result;
 const result=solve(types,modes,groups,demand,rules,options);cached={key,result};return result;
}
function solve(types,modes,groups,demand,rules,options){
 const deadline=Date.now()+10000;
 const fail=error=>({rows:[],error,costOptimised:true});
 if(!demand)return fail('Demand is unavailable for cost optimisation.');
 if(!window.solver?.Solve)return fail('The cost optimisation solver could not load. Refresh the page.');
 const api=window.SessionBuilderPlanning,clinicians=options.clinicians||{},limits=options.clinicianLimits||{};
 const values=[...demand.sameDay,...demand.homeVisit,demand.weekly,demand.routine,demand.planned||0];
 if(values.length!==13||values.some(n=>!Number.isFinite(n)||n<0))return fail('Average demand is invalid.');
 const configured=new Map(Object.entries(options.appointmentPools||{}));
 for(const pool of ['sameDay','homeVisit','weekly','routine','planned'])for(const name of demand.types?.[pool]||[])if(!configured.has(name))configured.set(name,pool);
 for(const name of demand.eligibleDailyTypes||[])if(!configured.has(name))configured.set(name,'sameDay');
 for(const name of demand.eligiblePlannedTypes||[])configured.set(name,'planned');
 const plannedLabel='Planned care',normal=name=>configured.get(name)==='planned'?plannedLabel:name;
 const hard=rules.filter(r=>r.enabled&&r.strength==='must'),active=rules.filter(r=>r.enabled);
 const periods=['morning','afternoon'],daysShort=['Mon','Tue','Wed','Thu','Fri'];
 const candidates=[],missing=new Set();
 for(const type of types)for(const name of [...new Set(type.eligibleClinicians||[])]){
  if(!Object.hasOwn(clinicians,name)||!groups.includes(clinicians[name]))continue;
  const limit=limits[name]||{},pattern=limit.workingPattern;
  if(limit.max===0||Array.isArray(pattern)&&!pattern.length)continue;
  if(typeof limit.annualRate!=='number'||!Number.isFinite(limit.annualRate)||limit.annualRate<0){missing.add(name);continue;}
  const allowed=[...configured].filter(([name,pool])=>['sameDay','homeVisit','weekly','routine','planned'].includes(pool)&&(!Array.isArray(type.appointmentTypes)||type.appointmentTypes.includes(name)));
  let nonHome=0,home=0;for(const mode of modes){const count=type.appointmentsByMode?.[mode]||0;if(!Number.isSafeInteger(count)||count<0)return fail('Appointment capacities must be non-negative whole numbers.');if(api.isHomeVisit(mode))home+=count;else nonHome+=count;}
  const leave=limit.annualLeaveWeeks??5,sickness=limit.sicknessPercent??0;
  if(!Number.isFinite(leave)||leave<0||leave>52||!Number.isFinite(sickness)||sickness<0||sickness>100)return fail('Invalid leave or sickness settings for '+name+'.');
  const availability=(52-leave)/52*(1-sickness/100);
  candidates.push({sourceId:type.id,name:type.name,clinician:name,group:clinicians[name],rate:limit.annualRate,nonHome:Math.floor(nonHome*availability+1e-7),home:Math.floor(home*availability+1e-7),allowed});
 }
 if(missing.size)return fail('Enter an annualised sessional rate in Clinician Setup for: '+[...missing].join(', ')+'. Missing rates cannot be treated as free.');
 for(const [name,limit] of Object.entries(limits))if(Object.hasOwn(clinicians,name)){
  if((limit.min||0)<0||limit.max!=null&&limit.max<(limit.min||0))return fail('Invalid session limits for '+name+'.');
  if(limit.min>0&&!candidates.some(c=>c.clinician===name))return fail('No available eligible session can meet the minimum for '+name+'. Check working patterns and session eligibility.');
 }
 const slots=[],allocations=[],constraints={},variables={},ints={},model={optimize:'cost',opType:'min',constraints,variables,ints,options:{timeout:2500,tolerance:0,presolve:true,nodeSelection:'hybrid',branching:'pseudocost'}};
 let sequence=0;const constraint=bound=>{const id='c'+sequence++;constraints[id]=bound;return id;};
 const variable=(data,integer=false)=>{const id='v'+sequence++;variables[id]=data;if(integer)ints[id]=1;return id;};
 const coefficient=(id,c,value)=>{if(value)variables[id][c]=(variables[id][c]||0)+value;};
 const minCapacity=Math.min(...candidates.flatMap(c=>[c.nonHome,c.home]).filter(n=>n>0),1);
 const limitSum=Object.values(limits).reduce((n,l)=>n+(l.min||0),0),ruleSum=hard.filter(r=>r.kind==='minimum').reduce((n,r)=>n+r.minimum*(r.scope==='both'?2:1)*(r.scope==='week'?1:r.days.length),0);
 const bound=Math.max(1,Math.ceil(values.reduce((a,b)=>a+b,0)/minCapacity)+limitSum+ruleSum+10);
 if(bound>10000)return fail('Demand is too large for interactive cost optimisation. Check session capacities.');
 const workforce=new Map();
 for(const [name] of Object.entries(clinicians)){const l=limits[name]||{};workforce.set(name,constraint({min:l.min||0,max:l.max??bound}));}
 const needConstraints={sameDay:demand.sameDay.map(n=>constraint({min:Math.ceil(n)})),homeVisit:demand.homeVisit.map(n=>constraint({min:Math.ceil(n)})),weekly:constraint({min:Math.ceil(demand.weekly)}),routine:constraint({min:Math.ceil(demand.routine)}),planned:constraint({min:Math.ceil(demand.planned||0)})};
 // Preserve type eligibility for weekly urgent/routine demand. Planned care and
 // daily urgent demand are pooled, matching the planner's existing definitions.
 const typedNeed=new Map();
 for(const pool of ['weekly','routine'])for(const [name,need] of Object.entries(demand.byType?.[pool]||{}))typedNeed.set(pool+'|'+name,constraint({min:Math.ceil(need)}));
 const addAllocation=(slot,name,pool,capacityConstraint)=>{
  const id=variable({cost:0},true);coefficient(id,capacityConstraint,1);
  const need=pool==='sameDay'||pool==='homeVisit'?needConstraints[pool][slot.day]:needConstraints[pool];if(need)coefficient(id,need,1);
  const typed=typedNeed.get(pool+'|'+name);if(typed)coefficient(id,typed,1);
  const allocation={id,slot,name,pool};allocations.push(allocation);return allocation;
 };
 for(const candidate of candidates)for(let day=0;day<5;day++)for(const period of periods){
  const pattern=limits[candidate.clinician]?.workingPattern;if(Array.isArray(pattern)&&!pattern.includes(daysShort[day]+' '+(period==='morning'?'AM':'PM')))continue;
  const id=variable({cost:candidate.rate/1000},true);coefficient(id,workforce.get(candidate.clinician),1);
  const slot={...candidate,id,day,period};slots.push(slot);
  const nonHome=constraint({max:0}),home=constraint({max:0});coefficient(id,nonHome,-candidate.nonHome);coefficient(id,home,-candidate.home);
  const choices=[...new Map(candidate.allowed.map(([name,pool])=>[pool==='planned'?plannedLabel:name,{name:normal(name),pool}])).values()];
  for(const choice of choices)if(choice.pool==='homeVisit'?candidate.home>0:candidate.nonHome>0)addAllocation(slot,choice.name,choice.pool,choice.pool==='homeVisit'?home:nonHome);
  // Capacity after leave/sickness is an expectation. Integer appointments cannot
  // exceed it; spare whole slots are added to the display after allocation.
  const daily=allocations.filter(a=>a.slot===slot&&a.pool==='sameDay');
  const weights=daily.map(a=>Math.max(0,demand.byType?.sameDay?.[a.name]?.[day]||0)),sum=weights.reduce((a,b)=>a+b,0);
  if(daily.length>1)for(let i=0;i<daily.length-1;i++){
   // Forecast proportions are targets, not a requirement for fractional slots.
   const share=sum?weights[i]/sum:1/daily.length,c=constraint({min:-1,max:1});
   for(const allocation of daily)coefficient(allocation.id,c,(allocation===daily[i]?1:0)-share);
  }
 }
 if(Object.keys(variables).length>6000)return fail('This plan is too large for interactive cost optimisation. Reduce unused session types or clinician choices.');
 const subject=r=>api.shareSubject(r),matches=(slot,ref)=>ref?.kind==='group'?slot.group===ref.name:ref?.kind==='type'&&slot.clinician===ref.name;
 const scopes=rule=>rule.scope==='week'?[{days:rule.days.map(d=>d-1),periods}]:rule.days.flatMap(d=>(rule.scope==='both'?periods:[rule.scope]).map(p=>({days:[d-1],periods:p==='day'?periods:[p]})));
 const inScope=(slot,scope)=>scope.days.includes(slot.day)&&scope.periods.includes(slot.period);
 const selected=(r,a)=>r.kind==='mix'||r.appointmentPool==='selected'?(r.appointmentTypes||[]).map(normal).includes(a.name):api.sharePool(r)==='urgent'?a.pool==='sameDay'||a.pool==='weekly':true;
 const ruleExpressions=[],distributionPenalties=[];
 for(const rule of active){
  if(!['minimum','share','mix','distribution'].includes(rule.kind)||!['morning','afternoon','both','day','week'].includes(rule.scope)||!Array.isArray(rule.days)||!rule.days.length||rule.days.some(d=>!Number.isInteger(d)||d<1||d>5)||!Number.isFinite(rule.minimum)||rule.minimum<0)return fail('Invalid Planning Rule. Review the enabled rules.');
  if(rule.kind==='distribution'){
   if(!window.SessionBuilderDistribution)return fail('The weekly distribution rules could not load. Refresh the page.');
   const issue=window.SessionBuilderDistribution.issue(rule,[...configured.keys()]);if(issue)return fail('Weekly distribution: '+issue);
   const names=new Set(rule.appointmentTypes.map(normal)),chosen=allocations.filter(a=>names.has(a.name)),weekly=chosen.map(a=>a.id),targets=window.SessionBuilderDistribution.targets(rule);
   for(let day=0;day<5;day++){
    const daily=chosen.filter(a=>a.slot.day===day).map(a=>a.id),tolerance=rule.days.includes(day+1)?(rule.distributionTolerance??5):0,target=targets[day+1],lower=Math.max(0,(target-tolerance)/100),upper=Math.min(1,(target+tolerance)/100);
    ruleExpressions.push({rule,distribution:true,day,numerator:daily,denominator:weekly,target,tolerance,lower,upper});
    const upperConstraint=constraint({max:0}),lowerConstraint=constraint({min:0});
    for(const id of daily){coefficient(id,upperConstraint,1);coefficient(id,lowerConstraint,1);}
    for(const id of weekly){coefficient(id,upperConstraint,-upper);coefficient(id,lowerConstraint,-lower);}
    if(rule.strength==='prefer'){
     const slack=variable({cost:0,balance:1});distributionPenalties.push(slack);
     coefficient(slack,upperConstraint,-1);coefficient(slack,lowerConstraint,1);
    }
   }
   continue;
  }
  if(rule.kind==='minimum'&&(!Number.isInteger(rule.minimum)||rule.minimum<1||!types.some(t=>t.id===rule.sessionTypeId)))return fail('A minimum-session rule refers to a missing session type or invalid minimum.');
  if(rule.kind!=='minimum'){
   const refs=[subject(rule),...api.shareDenominators(rule)],valid=ref=>ref?.kind==='group'?groups.includes(ref.name):ref?.kind==='type'&&Object.hasOwn(clinicians,ref.name);
   if(refs.some(ref=>!valid(ref))||rule.minimum>100||!['atLeast','atMost','exact'].includes(rule.comparison||'atLeast'))return fail('A percentage rule has invalid clinician selections or bounds.');
   if((rule.kind==='mix'||rule.appointmentPool==='selected')&&!(rule.appointmentTypes||[]).length)return fail('Choose appointment types for the percentage rule.');
   const refsDen=api.shareDenominators(rule);
   if(rule.kind==='share'&&refsDen.length&&Object.entries(clinicians).some(([clinician,group])=>matches({clinician,group},subject(rule))&&!refsDen.some(ref=>matches({clinician,group},ref))))return fail('The share denominator must include the selected clinician or group.');
  }
  for(const scope of scopes(rule)){
   const expression={rule,scope,terms:[],numerator:[],denominator:[]};ruleExpressions.push(expression);
   if(rule.kind==='minimum')expression.terms=slots.filter(s=>s.sourceId===rule.sessionTypeId&&inScope(s,scope)).map(s=>[s.id,1]);
   else for(const a of allocations){
    if(a.pool==='unused'||!inScope(a.slot,scope))continue;
    const isSubject=matches(a.slot,subject(rule)),refs=api.shareDenominators(rule),isDen=!refs.length||refs.some(ref=>matches(a.slot,ref));
    const numerator=isSubject&&selected(rule,a),denominator=rule.kind==='mix'?isSubject:isDen&&selected(rule,a);
    if(numerator)expression.numerator.push(a.id);if(denominator)expression.denominator.push(a.id);
    const coefficient=(numerator?1:0)-rule.minimum/100*(denominator?1:0);if(coefficient)expression.terms.push([a.id,coefficient]);
   }
   if(rule.strength!=='must')continue;
   const comparison=rule.comparison||'atLeast',bound=rule.kind==='minimum'?{min:rule.minimum}:comparison==='atMost'?{max:0}:comparison==='exact'?{equal:0}:{min:0},id=constraint(bound);
   for(const [variable,value] of expression.terms)coefficient(variable,id,value);
   if(rule.kind==='share'&&!(rule.minimum===0&&comparison==='atLeast')){const positive=constraint({min:1});for(const variable of expression.denominator)coefficient(variable,positive,1);}
  }
 }
 const primaryBudget=Math.max(1,deadline-Date.now()-(distributionPenalties.length?2000:0));model.options.timeout=primaryBudget;
 let result,start=Date.now();
 try{result=window.solver.Solve(model,1e-8,true);}catch(error){return fail('Cost optimisation could not complete. Review the plan settings or try again.');}
 let solution=result?.generateSolutionSet?.()||{},elapsed=Date.now()-start;
 const costTimeLimited=elapsed>=primaryBudget-25;
 const audit=values=>{
  const totals=Object.fromEntries(Object.keys(constraints).map(c=>[c,0]));
  for(const [id,data] of Object.entries(variables)){
   const n=values[id]||0;if(!Number.isFinite(n)||n< -1e-6||ints[id]&&Math.abs(n-Math.round(n))>1e-6)return false;
   for(const [c,coefficient] of Object.entries(data))if(Object.hasOwn(totals,c))totals[c]+=n*coefficient;
  }
  return Object.entries(constraints).every(([id,b])=>{const n=totals[id],e=1e-5;return (b.min==null||n>=b.min-e)&&(b.max==null||n<=b.max+e)&&(b.equal==null||Math.abs(n-b.equal)<=e);});
 };
 if(!result?.feasible||!result.bounded||!audit(solution))return fail('No valid costed plan was found within the calculation limit. Check clinician minimums/maximums, working patterns, session eligibility and required rules. No invalid plan is shown.');
 const annualCost=slots.reduce((n,s)=>n+Math.round(solution[s.id]||0)*s.rate,0);
 // A second objective reduces sessions without increasing the best annual cost.
 const costBound=constraint({max:annualCost/1000+1e-7});
 const sessionIds=new Set(slots.map(s=>s.id));
 for(const [id,data] of Object.entries(variables)){coefficient(id,costBound,data.cost||0);data.sessions=sessionIds.has(id)?1:0;}
 const refine=(objective,budget)=>{
  if(deadline-Date.now()<=25)return false;
  model.optimize=objective;model.options.timeout=Math.min(budget,Math.max(1,deadline-Date.now()));
  try{const nextResult=window.solver.Solve(model,1e-8,true),next=nextResult.generateSolutionSet();if(nextResult.feasible&&nextResult.bounded&&audit(next)){solution=next;return true;}}catch(error){/* Retain the audited incumbent. */}
  return false;
 };
 // Balance preferred distributions only within the best annual cost found.
 // A third pass can reduce sessions without undoing that balance.
 if(distributionPenalties.length&&refine('balance',Math.min(2000,Math.max(1,deadline-Date.now())))){
  const bestBalance=distributionPenalties.reduce((n,id)=>n+(solution[id]||0),0),balanceBound=constraint({max:bestBalance+1e-7});
  for(const id of distributionPenalties)coefficient(id,balanceBound,1);
 }
 refine('sessions',1500);
 const rows=types.map(t=>({id:t.id,name:t.name,group:[...new Set((t.eligibleClinicians||[]).map(n=>clinicians[n]).filter(Boolean))].join(' · '),days:[0,0,0,0,0],weekly:0,routine:0,planned:0,periods:{morning:[0,0,0,0,0],afternoon:[0,0,0,0,0]}})),rowById=new Map(rows.map(r=>[r.id,r]));
 const clinicianCounts={},placements=[],appointmentBreakdown={},capacitySameDay=[0,0,0,0,0],capacitySameDayByPeriod={morning:[0,0,0,0,0],afternoon:[0,0,0,0,0]},capacityHomeVisit=[0,0,0,0,0];let weeklyCapacity=0,routineCapacity=0,plannedCapacity=0,totalCapacity=0;
 for(const slot of slots){const count=Math.round(solution[slot.id]||0);if(!count)continue;const row=rowById.get(slot.sourceId);row.periods[slot.period][slot.day]+=count;row.days[slot.day]+=count;clinicianCounts[slot.clinician]=(clinicianCounts[slot.clinician]||0)+count;placements.push({id:slot.sourceId,sourceId:slot.sourceId,clinician:slot.clinician,day:slot.day,period:slot.period,pool:'mixed',count});totalCapacity+=Math.floor(count*slot.nonHome+1e-7)+Math.floor(count*slot.home+1e-7);}
 for(const a of allocations){const n=Math.round(solution[a.id]||0);if(!n)continue;const target=appointmentBreakdown[a.slot.sourceId]||(appointmentBreakdown[a.slot.sourceId]=Array.from({length:5},()=>({morning:{},afternoon:{}}))),cell=target[a.slot.day][a.slot.period];cell[a.name]=(cell[a.name]||0)+n;
  if(a.pool==='sameDay'){capacitySameDay[a.slot.day]+=n;capacitySameDayByPeriod[a.slot.period][a.slot.day]+=n;}else if(a.pool==='homeVisit')capacityHomeVisit[a.slot.day]+=n;else if(a.pool==='weekly')weeklyCapacity+=n;else if(a.pool==='routine')routineCapacity+=n;else if(a.pool==='planned')plannedCapacity+=n;
 }
 for(const slot of slots){
  const count=Math.round(solution[slot.id]||0);if(!count)continue;
  const capacity=Math.floor(count*slot.nonHome+1e-7)+Math.floor(count*slot.home+1e-7),used=allocations.filter(a=>a.slot===slot).reduce((n,a)=>n+Math.round(solution[a.id]||0),0),unused=capacity-used;
  if(unused>0){const target=appointmentBreakdown[slot.sourceId]||(appointmentBreakdown[slot.sourceId]=Array.from({length:5},()=>({morning:{},afternoon:{}}))),cell=target[slot.day][slot.period];cell.Unallocated=(cell.Unallocated||0)+unused;}
 }
 const ruleResults=active.map(rule=>{
  const failures=[],measurements=[];
  for(const expression of ruleExpressions.filter(e=>e.rule===rule)){
   if(expression.distribution){
    const numerator=expression.numerator.reduce((n,id)=>n+Math.round(solution[id]||0),0),denominator=expression.denominator.reduce((n,id)=>n+Math.round(solution[id]||0),0);
    if(numerator<expression.lower*denominator-1e-5||numerator>expression.upper*denominator+1e-5)failures.push(daysShort[expression.day]+': outside the '+expression.target+'% target ±'+expression.tolerance+' percentage points.');
    measurements.push({day:expression.day,numerator,denominator,target:expression.target,tolerance:expression.tolerance});continue;
   }
   const value=expression.terms.reduce((n,[id,c])=>n+(solution[id]||0)*c,0),numerator=expression.numerator.reduce((n,id)=>n+(solution[id]||0),0),denominator=expression.denominator.reduce((n,id)=>n+(solution[id]||0),0),comparison=rule.comparison||'atLeast';
   const ok=rule.kind==='minimum'?value>=rule.minimum-1e-5:(comparison==='atMost'?value<=1e-5:comparison==='exact'?Math.abs(value)<=1e-5:value>=-1e-5)&&(rule.kind==='mix'||denominator>1e-6||rule.minimum===0&&comparison==='atLeast');
   if(!ok)failures.push('Target not met for '+expression.scope.days.map(d=>daysShort[d]).join(', ')+' '+expression.scope.periods.join('/'));
   measurements.push({numerator,denominator});
  }
  return {id:rule.id,kind:rule.kind,strength:rule.strength,ok:!failures.length,failures,measurements,minimum:rule.minimum,comparison:rule.comparison||'atLeast',appointmentPool:api.sharePool(rule),clinicianGroup:api.shareSubject(rule)?.name};
 });
 const cost=slots.reduce((n,s)=>n+Math.round(solution[s.id]||0)*s.rate,0);
 return {rows,placements,clinicianCounts,appointmentBreakdown,capacitySameDay,capacitySameDayByPeriod,capacityHomeVisit,weeklyCapacity,routineCapacity,plannedCapacity,totalCapacity,totalNeed:values.reduce((a,b)=>a+b,0),days:Array.from({length:5},(_,d)=>rows.reduce((n,r)=>n+r.days[d],0)),unmetDemand:[],ruleResults,unassignedDailyTypes:[],costOptimised:true,annualCost:cost,approximate:costTimeLimited,ruleAdjusted:false};
}
window.SessionBuilderOptimisation=Object.freeze({estimate,estimateAsync});
})();
