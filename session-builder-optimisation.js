(function(){
'use strict';
let cached=null,pending=null,completed=null;
const solveBudget=options=>[10,30,60].includes(options?.solveTimeSeconds)?options.solveTimeSeconds*1000:30000;
function isVerifiedPlan(plan){
 return !!plan&&plan.verifiedPlan===true&&!plan.error&&Number.isFinite(plan.annualCost)&&plan.annualCost>=0&&Array.isArray(plan.rows)&&Array.isArray(plan.placements)&&Array.isArray(plan.ruleResults)&&plan.ruleResults.every(r=>r.strength!=='must'||r.ok||r.adjustedForClinicianSetup)&&Array.isArray(plan.unmetDemand)&&!plan.unmetDemand.length&&['capacitySameDay','capacityHomeVisit'].every(key=>Array.isArray(plan[key])&&plan[key].length===5&&plan[key].every(n=>Number.isSafeInteger(n)&&n>=0))&&['weeklyCapacity','routineCapacity','plannedCapacity','totalCapacity'].every(key=>Number.isSafeInteger(plan[key])&&plan[key]>=0)&&plan.capacitySameDay.reduce((a,b)=>a+b,0)+plan.capacityHomeVisit.reduce((a,b)=>a+b,0)+plan.weeklyCapacity+plan.routineCapacity+plan.plannedCapacity===plan.totalCapacity;
}
function betterPlan(plan,previous){
 if(!previous)return true;
 const rank=p=>[Math.round(p.annualCost*100),p.totalCapacity,p.placements.reduce((n,s)=>n+s.count,0),p.capacitySameDay.reduce((a,b)=>a+b,0)+p.capacityHomeVisit.reduce((a,b)=>a+b,0)+p.weeklyCapacity+p.routineCapacity+p.plannedCapacity,p.ruleResults.filter(r=>r.strength==='prefer').reduce((n,r)=>n+r.failures.length,0)];
 const a=rank(plan),b=rank(previous);for(let i=0;i<a.length;i++){if(a[i]<b[i])return true;if(a[i]>b[i])return false;}return true;
}
function retainedPlan(plan,timedOut=false){return {...plan,approximate:true,optimisationTimedOut:timedOut,optimisationInterrupted:!timedOut};}
function estimateAsync(...args){
 const onProgress=typeof args[6]==='function'?args.pop():null;
 if(typeof Worker==='undefined')return Promise.resolve({rows:[],error:'This browser cannot run the background integer optimiser. Use a browser with Web Worker support and try again.'});
 const timeBudget=solveBudget(args[5]);
 const key=JSON.stringify(args);if(completed?.key===key)return Promise.resolve(completed.result);if(pending?.key===key)return pending.promise;
 if(pending){pending.done=true;pending.worker.terminate();clearTimeout(pending.timer);pending.resolve({cancelled:true,rows:[]});pending=null;}
 let resolve;const promise=new Promise(r=>resolve=r),worker=new Worker('session-builder-cost-worker.js?v=optimised-planner-controls-v1');
 const job={key,worker,promise,resolve,best:null,done:false,diagnostics:window.SessionBuilderDiagnostics?.analyse(...args)};pending=job;
 const finish=result=>{
  if(job.done||pending!==job)return;
  if(!result?.error&&!isVerifiedPlan(result))result={rows:[],error:'The optimiser did not return a verified plan. Click Reset planner to try again.'};
  if(result?.error)result={...result,diagnostics:result.diagnostics||job.diagnostics};
  if(result.error&&job.best)result=retainedPlan(job.best,result.errorCode==='TIMEOUT');
  else if(isVerifiedPlan(result)&&job.best&&!betterPlan(result,job.best))result={...job.best,approximate:true,optimisationTimedOut:!!result.optimisationTimedOut,optimisationInterrupted:!!result.optimisationInterrupted};
  job.done=true;worker.terminate();clearTimeout(job.timer);pending=null;completed={key,result};resolve(result);
 };
 worker.onmessage=event=>{
  if(job.done||pending!==job)return;
  const message=event.data;
  if(message?.type==='ready'){if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('session-builder-solve-ready'));clearTimeout(job.timer);job.timer=setTimeout(()=>finish({rows:[],errorCode:'TIMEOUT',error:'Optimisation timed out before returning a verified plan. This does not prove the settings are infeasible. Click Reset planner to try again.'}),timeBudget+1000);return;}
  if(message?.type==='diagnostics'){job.diagnostics=message.diagnostics;return;}
  if(message?.type==='incumbent'){if(isVerifiedPlan(message.result)&&betterPlan(message.result,job.best)){job.best=message.result;try{onProgress?.(message.result);}catch(error){/* Progress observers cannot affect the solve. */}}return;}
  finish(message?.type==='complete'?message.result:message);
 };
 worker.onerror=()=>finish({rows:[],error:'The background optimiser stopped before returning a verified plan. Click Reset planner to try again.'});
 job.timer=setTimeout(()=>finish({rows:[],errorCode:'TIMEOUT',error:'Optimisation timed out before returning a verified plan. This does not prove the settings are infeasible. Click Reset planner to try again.'}),timeBudget+1000);
 worker.postMessage(args);return promise;
}
function estimate(types,modes,groups,demand,rules=[],options={},onCheckpoint,onDiagnostics){
 const key=JSON.stringify([types,modes,groups,demand,rules,options]);
 if(cached?.key===key)return cached.result;
 const diagnostics=window.SessionBuilderDiagnostics?.analyse(types,modes,groups,demand,rules,options);
 if(diagnostics&&typeof onDiagnostics==='function')onDiagnostics(diagnostics);
 const report=model=>{if(diagnostics){diagnostics.model=model;if(typeof onDiagnostics==='function')onDiagnostics(diagnostics);}};
 const raw=solve(types,modes,groups,demand,rules,options,onCheckpoint,report),result=raw.error&&diagnostics?{...raw,diagnostics}:raw;cached={key,result};return result;
}
function solve(types,modes,groups,demand,rules,options,onCheckpoint,onDiagnostics){
 const timeBudget=solveBudget(options),deadline=Date.now()+timeBudget;
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
 const daysShort=['Mon','Tue','Wed','Thu','Fri'];
 // Whole-day settings have interchangeable AM/PM variables. Use a single
 // representative period only when both rules and working patterns allow it.
 const wholeDays=active.every(rule=>['day','week'].includes(rule.scope))&&Object.values(limits).every(limit=>!Array.isArray(limit.workingPattern)||daysShort.every(day=>limit.workingPattern.includes(day+' AM')===limit.workingPattern.includes(day+' PM')));
 const periods=wholeDays?['morning']:['morning','afternoon'];
 const candidates=[],missing=new Set();
 const dailyBound=(name,day)=>limits[name]?.dailySessions?.[daysShort[day]];
 const hasDailyBounds=name=>Object.values(limits[name]?.dailySessions||{}).some(b=>(b.min||0)>0||b.max!=null&&b.max>0);
 for(const [name,limit]of Object.entries(limits))if(limit.dailySessions!==undefined){
  if(!limit.dailySessions||typeof limit.dailySessions!=='object'||Array.isArray(limit.dailySessions))return fail('Invalid daily session limits for '+name+'.');
  for(const [day,b]of Object.entries(limit.dailySessions))if(!daysShort.includes(day)||!b||!Number.isSafeInteger(b.min)||b.min<0||!(b.max===null||Number.isSafeInteger(b.max)&&b.max>=b.min))return fail('Invalid daily session limits for '+name+'.');
 }
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
  candidates.push({sourceId:type.id,name:type.name,clinician:name,group:clinicians[name],rate:limit.annualRate,nonHome:nonHome*availability,home:home*availability,allowed});
 }
 if(missing.size)return fail('Enter an annualised sessional rate in Clinician Setup for: '+[...missing].join(', ')+'. Missing rates cannot be treated as free.');
 for(const [name,limit] of Object.entries(limits))if(Object.hasOwn(clinicians,name)){
  if((limit.min||0)<0||limit.max!=null&&limit.max<(limit.min||0))return fail('Invalid session limits for '+name+'.');
  if(limit.min>0&&!candidates.some(c=>c.clinician===name))return fail('No available eligible session can meet the minimum for '+name+'. Check working patterns and session eligibility.');
 }
 const slots=[],allocations=[],constraints={},variables={},ints={},model={optimize:'cost',opType:'min',constraints,variables,ints,costScale:1,options:{timeout:2500,tolerance:0,presolve:true,nodeSelection:'hybrid',branching:'pseudocost'}};
 let sequence=0;const constraint=bound=>{const id='c'+sequence++;constraints[id]=bound;return id;};
 const variable=(data,integer=false)=>{const id='v'+sequence++;variables[id]=data;if(integer)ints[id]=1;return id;};
 const coefficient=(id,c,value)=>{if(value)variables[id][c]=(variables[id][c]||0)+value;};
 const minCapacity=Math.min(...candidates.flatMap(c=>[c.nonHome,c.home]).filter(n=>n>0),1);
 const limitSum=Object.values(limits).reduce((n,l)=>n+(l.min||0),0),ruleSum=hard.filter(r=>r.kind==='minimum').reduce((n,r)=>n+(r.minimum??0)*(r.scope==='both'?2:1)*(r.scope==='week'?1:r.days.length),0);
 const bound=Math.max(1,Math.ceil(values.reduce((a,b)=>a+b,0)/minCapacity)+limitSum+ruleSum+10);
 if(bound>10000)return fail('Demand is too large for interactive cost optimisation. Check session capacities.');
 const workforce=new Map(),dailyWorkforce=new Map();
 for(const [name] of Object.entries(clinicians)){const l=limits[name]||{};workforce.set(name,constraint({min:l.min||0,max:l.max??bound}));}
 for(const name of Object.keys(clinicians))for(let day=0;day<5;day++){const b=dailyBound(name,day);if(b)dailyWorkforce.set(name+'|'+day,constraint({min:b.min,...(b.max!=null?{max:b.max}:{})}));}
 // Forecast need is a lower bound. Allocate every productive slot in each
 // selected session; provision may exceed need.
 const needConstraints={sameDay:demand.sameDay.map(n=>constraint({min:Math.ceil(n)})),homeVisit:demand.homeVisit.map(n=>constraint({min:Math.ceil(n)})),weekly:constraint({min:Math.ceil(demand.weekly)}),routine:constraint({min:Math.ceil(demand.routine)}),planned:constraint({min:Math.ceil(demand.planned||0)})};
 // Preserve type eligibility for weekly urgent/routine demand. Planned care and
 // daily urgent demand are pooled, matching the planner's existing definitions.
 const typedNeed=new Map();
 for(const pool of ['weekly','routine'])for(const [name,need] of Object.entries(demand.byType?.[pool]||{}))typedNeed.set(pool+'|'+name,constraint({min:Math.ceil(need)}));
 const addAllocation=(slot,name,pool,capacityConstraint)=>{
  const id=variable({cost:0},true);coefficient(id,capacityConstraint.id,capacityConstraint.scale);
  const need=pool==='sameDay'||pool==='homeVisit'?needConstraints[pool][slot.day]:needConstraints[pool];if(need)coefficient(id,need,1);
  const typed=typedNeed.get(pool+'|'+name);if(typed)coefficient(id,typed,1);
  const allocation={id,slot,name,pool};allocations.push(allocation);return allocation;
 };
 for(const candidate of candidates)for(let day=0;day<5;day++)for(const period of periods){
  const pattern=limits[candidate.clinician]?.workingPattern;if(dailyBound(candidate.clinician,day)?.max===0)continue;if(Array.isArray(pattern)&&!pattern.includes(daysShort[day]+' '+(period==='morning'?'AM':'PM')))continue;
  // Use exact monetary precision for the primary cost objective. Capacity and
  // session counts are handled separately, without a numerical cost epsilon.
  const id=variable({cost:Math.round(candidate.rate*100)/100},true);coefficient(id,workforce.get(candidate.clinician),1);
  const dailyConstraint=dailyWorkforce.get(candidate.clinician+'|'+day);if(dailyConstraint)coefficient(id,dailyConstraint,1);
  const slot={...candidate,id,day,period};slots.push(slot);
  // Integer allocation counts also round combined productive capacity.
  // Use an integer ratio when possible to avoid nearly-integral floor bounds.
  const capacityConstraint=effective=>{
   let x=effective,previousNumerator=0,numerator=1,previousDenominator=1,denominator=0,ratio=null;
   for(let i=0;i<24;i++){
    const whole=Math.floor(x),nextNumerator=whole*numerator+previousNumerator,nextDenominator=whole*denominator+previousDenominator;
    if(!Number.isSafeInteger(nextNumerator)||nextDenominator>1000000)break;
    [previousNumerator,numerator]=[numerator,nextNumerator];[previousDenominator,denominator]=[denominator,nextDenominator];
    if(Math.abs(numerator/denominator-effective)<1e-12){ratio={numerator,denominator};break;}
    const fraction=x-whole;if(!fraction)break;x=1/fraction;
   }
   const scale=ratio?.denominator||1,idTotal=constraint(ratio?{min:-(scale-1),max:0}:{min:-1+1e-7,max:1e-7});
   coefficient(id,idTotal,-(ratio?.numerator??effective));return {id:idTotal,scale};
  };
  const nonHome=capacityConstraint(candidate.nonHome),home=capacityConstraint(candidate.home);
  const choices=[...new Map(candidate.allowed.map(([name,pool])=>[pool==='planned'?plannedLabel:name,{name:normal(name),pool}])).values()];
  for(const choice of choices)if(choice.pool==='homeVisit'?candidate.home>0:candidate.nonHome>0)addAllocation(slot,choice.name,choice.pool,choice.pool==='homeVisit'?home:nonHome);
  // Each consultation-mode capacity must be fully assigned to eligible types.
  // A positive capacity without an eligible type prevents using this session.
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
 const ruleExpressions=[],distributionPenalties=[],ruleSources=[],setupSpreadLocks=[];let setupSpreadAdjusted=false;
 for(const rule of active){
  const previousConstraints=new Set(Object.keys(constraints));
  const recordRule=()=>{if(rule.strength==='must')ruleSources.push({id:rule.id,label:window.SessionBuilderDiagnostics?.ruleLabel(rule,types)||rule.id,constraints:Object.keys(constraints).filter(id=>!previousConstraints.has(id))});};
  if(!['minimum','share','mix','distribution','sessionDistribution','sessionClinicianMix'].includes(rule.kind)||!['morning','afternoon','both','day','week'].includes(rule.scope)||!Array.isArray(rule.days)||!rule.days.length||rule.days.some(d=>!Number.isInteger(d)||d<1||d>5)||rule.kind!=='minimum'&&(!Number.isFinite(rule.minimum)||rule.minimum<0))return fail('Invalid Planning Rule. Review the enabled rules.');
  if(rule.kind==='sessionClinicianMix'){
   const ref=subject(rule),definition=types.find(t=>t.id===rule.sessionTypeId),comparison=rule.comparison||'exact';
   if(rule.scope!=='week'||rule.days.length!==5||new Set(rule.days).size!==5||!definition||ref?.kind!=='type'||!Object.hasOwn(clinicians,ref.name)||!(definition.eligibleClinicians||[]).includes(ref.name)||rule.minimum>100||!['atLeast','atMost','exact'].includes(comparison))return fail('Session clinician mix requires an existing session type, an eligible clinician type, a weekly percentage from 0 to 100 and a valid comparison.');
   const chosen=slots.filter(s=>s.sourceId===rule.sessionTypeId),expression={rule,sessionClinicianMix:true,scope:{days:[0,1,2,3,4],periods},terms:[],numerator:[],denominator:chosen.map(s=>s.id)};
   for(const slot of chosen){const isSubject=slot.clinician===ref.name;if(isSubject)expression.numerator.push(slot.id);const k=(isSubject?1:0)-rule.minimum/100;if(k)expression.terms.push([slot.id,k]);}
   ruleExpressions.push(expression);
   const bounds=comparison==='atMost'?{max:0}:comparison==='exact'?{equal:0}:{min:0},id=constraint(bounds);
   for(const [v,k]of expression.terms)coefficient(v,id,k);
   if(rule.strength==='prefer'){
    // Count session deviations, including zero-appointment on-call sessions.
    const slack=variable({cost:0,balance:1});distributionPenalties.push(slack);
    if(comparison==='exact'){delete constraints[id].equal;constraints[id].max=0;coefficient(slack,id,-1);const lower=constraint({min:0});for(const [v,k]of expression.terms)coefficient(v,lower,k);coefficient(slack,lower,1);}
    else coefficient(slack,id,comparison==='atMost'?-1:1);
   }
   recordRule();continue;
  }
  if(rule.kind==='sessionDistribution'){
   if(rule.scope!=='week'||typeof rule.sessionTypeId!=='string'||!Number.isInteger(rule.sessionTolerance)||rule.sessionTolerance<1||rule.sessionTolerance>500)return fail('Invalid session spread rule.');
   if(rule.sessionTypeId&&!types.some(type=>type.id===rule.sessionTypeId))return fail('The session spread rule refers to a missing session type.');
   const targetTypes=rule.sessionTypeId?types.filter(type=>type.id===rule.sessionTypeId):types;
   for(const type of targetTypes){
    const chosen=slots.filter(slot=>slot.sourceId===type.id),weekly=chosen.map(slot=>slot.id),targetTerms=Array.from({length:5},()=>[]),targetGroups=[];
    for(const name of new Set(chosen.map(slot=>slot.clinician))){
     const mine=chosen.filter(slot=>slot.clinician===name),available=[...new Set(mine.map(slot=>slot.day))],selectedDays=available.filter(day=>rule.days.includes(day+1)),days=selectedDays.length?selectedDays:available;
     const other=Array.from({length:5},(_,day)=>slots.filter(slot=>slot.clinician===name&&slot.sourceId!==type.id&&slot.day===day).map(slot=>slot.id));
     const bounded=hasDailyBounds(name),cap=limits[name]?.max??bound,group={name,mine:mine.map(slot=>slot.id),days,other,bounded,cap};targetGroups.push(group);
     if(!bounded){for(const day of days)for(const slot of mine)targetTerms[day].push([slot.id,1/days.length]);continue;}
     // q[d] is the exact water-filled target after reserving that clinician's
     // other session types: clamp(level, dailyMin-other, dailyMax-other).
     // Binary regimes encode the clamp; the weekly total is a decision, not a
     // target guessed from a previous plan. Actual daily limits stay separate.
     const total=constraint({equal:0});for(const slot of mine)coefficient(slot.id,total,-1);let overflow=null;
     if(rule.strength==='prefer'){overflow=variable({cost:0,balance:1});coefficient(overflow,total,1);distributionPenalties.push(overflow);}
     if(limits[name]?.max!=null&&limits[name].min===limits[name].max&&other.every(ids=>!ids.length)){
      // If this clinician can only perform this type and their weekly total is
      // fixed, the water-fill is a constant. This exact simplification avoids
      // unnecessary binary regimes without estimating a variable weekly count.
      const ranges=days.map(day=>{const b=dailyBound(name,day)||{min:0,max:null};return {day,min:b.min||0,max:Math.min(b.max??cap,cap)};}),wanted=Math.min(cap,ranges.reduce((n,b)=>n+b.max,0));let low=0,high=cap;
      for(let iteration=0;iteration<70;iteration++){const h=(low+high)/2,sum=ranges.reduce((n,b)=>n+Math.min(b.max,Math.max(b.min,h)),0);if(sum<wanted)low=h;else high=h;}
      for(const b of ranges){const q=variable({cost:0}),fixed=constraint({equal:Math.min(b.max,Math.max(b.min,(low+high)/2))});coefficient(q,fixed,1);coefficient(q,total,1);targetTerms[b.day].push([q,1]);}
      continue;
     }
     if(overflow!==null){
      // A soft rule may need to spill sessions outside its selected days, but
      // cannot manufacture spill to shrink otherwise achievable targets.
      // overflow = max(0, T - sum(selected residual daily maxima)).
      const upperSum=days.reduce((n,day)=>n+Math.min(dailyBound(name,day)?.max??cap,cap),0),bigM=upperSum+cap+1,positive=variable({cost:0},true),binary=constraint({max:1});coefficient(positive,binary,1);
      const difference=[[overflow,1],...mine.map(slot=>[slot.id,-1]),...days.flatMap(day=>other[day].map(id=>[id,-1]))];
      const lower=constraint({min:-upperSum}),upper=constraint({max:bigM-upperSum}),zero=constraint({max:0});
      for(const [id,k]of difference){coefficient(id,lower,k);coefficient(id,upper,k);}coefficient(positive,upper,bigM);coefficient(overflow,zero,1);coefficient(positive,zero,-bigM);
     }
     const level=variable({cost:0}),levelBound=constraint({max:cap});coefficient(level,levelBound,1);
     for(const day of days){
      const b=dailyBound(name,day)||{min:0,max:null},lo=b.min||0,hi=Math.min(b.max??cap,cap),bigM=2*(cap+Math.max(lo,hi)+1),q=variable({cost:0});
      targetTerms[day].push([q,1]);coefficient(q,total,1);const qb=constraint({max:cap});coefficient(q,qb,1);
      const reserve=other[day].map(id=>[id,1]),filled=[[q,1],...reserve],height=[[level,1],...reserve];
      const row=(terms,bounds)=>{const id=constraint(bounds);for(const [v,k]of terms)coefficient(v,id,k);};
      row(filled,{min:lo,max:hi});
      const low=variable({cost:0},true),middle=variable({cost:0},true),high=variable({cost:0},true);
      row([[low,1],[middle,1],[high,1]],{equal:1});
      const conditional=(terms,bounds,z)=>{
       if(bounds.min!=null)row([...terms,[z,-bigM]],{min:bounds.min-bigM});
       if(bounds.max!=null)row([...terms,[z,bigM]],{max:bounds.max+bigM});
      };
      conditional(height,{max:lo},low);conditional(filled,{min:lo,max:lo},low);
      conditional(height,{min:lo,max:hi},middle);conditional([[q,1],[level,-1]],{min:0,max:0},middle);
      conditional(height,{min:hi},high);conditional(filled,{min:hi,max:hi},high);
     }
    }
    for(let day=0;day<5;day++){
     const daily=chosen.filter(slot=>slot.day===day).map(slot=>slot.id),targets=targetTerms[day],tolerance=targets.length?rule.sessionTolerance:0;
     ruleExpressions.push({rule,sessionDistribution:true,sessionName:type.name,day,numerator:daily,denominator:weekly,targetGroups,tolerance});
     const terms=new Map(daily.map(id=>[id,1]));for(const [id,k]of targets)terms.set(id,(terms.get(id)||0)-k);
     if([...terms.values()].every(k=>Math.abs(k)<1e-12))continue;
     const upperConstraint=constraint({max:tolerance}),lowerConstraint=constraint({min:-tolerance});
     for(const [id,k]of terms){coefficient(id,upperConstraint,k);coefficient(id,lowerConstraint,k);}
     if(rule.strength==='prefer'){const slack=variable({cost:0,balance:1});distributionPenalties.push(slack);coefficient(slack,upperConstraint,-1);coefficient(slack,lowerConstraint,1);}
    }
   }
   recordRule();continue;
  }
  if(rule.kind==='distribution'){
   if(!window.SessionBuilderDistribution)return fail('The weekly distribution rules could not load. Refresh the page.');
   const issue=window.SessionBuilderDistribution.issue(rule,[...configured.keys()]);if(issue)return fail('Weekly distribution: '+issue);
   const names=new Set(rule.appointmentTypes.map(normal)),chosen=allocations.filter(a=>names.has(a.name)),weekly=chosen.map(a=>a.id),targets=window.SessionBuilderDistribution.targets(rule);
   const availableDays=[...new Set(chosen.map(a=>a.slot.day+1))],selectedDays=availableDays.filter(day=>rule.days.includes(day)),spreadDays=selectedDays.length?selectedDays:availableDays,totalTarget=spreadDays.reduce((n,day)=>n+targets[day],0);
   for(let day=1;day<=5;day++)targets[day]=spreadDays.includes(day)?(totalTarget?targets[day]*100/totalTarget:100/spreadDays.length):0;
   for(let day=0;day<5;day++){
    const daily=chosen.filter(a=>a.slot.day===day).map(a=>a.id),tolerance=spreadDays.includes(day+1)?(rule.distributionTolerance??5):0,target=targets[day+1],lower=Math.max(0,(target-tolerance)/100),upper=Math.min(1,(target+tolerance)/100);
    ruleExpressions.push({rule,distribution:true,day,numerator:daily,denominator:weekly,target,tolerance,lower,upper,setupPriority:chosen.some(a=>hasDailyBounds(a.slot.clinician))});
    const upperConstraint=constraint({max:0}),lowerConstraint=constraint({min:0});
    for(const id of daily){coefficient(id,upperConstraint,1);coefficient(id,lowerConstraint,1);}
    for(const id of weekly){coefficient(id,upperConstraint,-upper);coefficient(id,lowerConstraint,-lower);}
    if(rule.strength==='prefer'||chosen.some(a=>hasDailyBounds(a.slot.clinician))){
     const slack=variable({cost:0,balance:1});distributionPenalties.push(slack);
     coefficient(slack,upperConstraint,-1);coefficient(slack,lowerConstraint,1);
     if(rule.strength==='must'){const lock=constraint({max:0});coefficient(slack,lock,1);setupSpreadLocks.push(lock);}
    }
   }
   recordRule();continue;
  }
  if(rule.kind==='minimum'&&([rule.minimum,rule.maximum].some(n=>n!=null&&(!Number.isSafeInteger(n)||n<0))||rule.minimum!=null&&rule.maximum!=null&&rule.maximum<rule.minimum||!types.some(t=>t.id===rule.sessionTypeId)))return fail('A session-limits rule has invalid bounds or refers to a missing session type.');
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
   const comparison=rule.comparison||(rule.kind==='sessionClinicianMix'?'exact':'atLeast'),bound=rule.kind==='minimum'?{...(rule.minimum!=null?{min:rule.minimum}:{}),...(rule.maximum!=null?{max:rule.maximum}:{})}:comparison==='atMost'?{max:0}:comparison==='exact'?{equal:0}:{min:0},id=constraint(bound);
   for(const [variable,value] of expression.terms)coefficient(variable,id,value);
   if(rule.kind==='share'&&!(rule.minimum===0&&comparison==='atLeast')){const positive=constraint({min:1});for(const variable of expression.denominator)coefficient(variable,positive,1);}
  }
  recordRule();
 }
 let verifiedCheckpoint=null,verifiedValues=null,mipLowerBound;
 const inspection=window.SessionBuilderDiagnostics?.checkModel(model,ruleSources,Math.min(deadline-1000,Date.now()+500));if(inspection&&typeof onDiagnostics==='function')onDiagnostics(inspection);
 function publishCandidate(candidate){
  if(!audit(candidate))return;
  const plan=buildPlan(candidate);
  if(!isVerifiedPlan(plan)||!betterPlan(plan,verifiedCheckpoint))return;
  verifiedCheckpoint=plan;verifiedValues={...candidate};
  if(typeof onCheckpoint==='function')try{onCheckpoint(plan);}catch(error){/* Checkpoint delivery cannot invalidate a solve. */}
 }
 function solveModel(){
  // The pinned solver exposes integer incumbents via keep_solutions. Observe
  // pushes without retaining a growing history or modifying the vendor bundle.
  const solver=window.solver;
  if(typeof solver.Model!=='function'||typeof solver.selectBranchAndCutService!=='function')return solver.Solve(model,1e-8,true);
  const instance=new solver.Model(1e-8,undefined,solver.selectBranchAndCutService(model)).loadJson(model);
  const sessionIds=new Set(slots.map(slot=>slot.id));for(const variable of instance.integerVariables)variable.plannerPriority=sessionIds.has(variable.id)?1:0;
  instance.options=model.options;instance.keep_solutions=true;
  instance.solutions={push:candidate=>{publishCandidate(candidate);if(model.optimize==='seedSessions'&&verifiedValues)throw Error('Verified seed found');}};
  return solver.Solve(instance,1e-8,true);
 }
 function buildPlan(chosen,flags={}){
 const rows=types.map(t=>({id:t.id,name:t.name,group:[...new Set((t.eligibleClinicians||[]).map(n=>clinicians[n]).filter(Boolean))].join(' · '),days:[0,0,0,0,0],weekly:0,routine:0,planned:0,periods:{morning:[0,0,0,0,0],afternoon:[0,0,0,0,0]}})),rowById=new Map(rows.map(r=>[r.id,r]));
 const clinicianCounts={},placements=[],appointmentBreakdown={},capacitySameDay=[0,0,0,0,0],capacitySameDayByPeriod={morning:[0,0,0,0,0],afternoon:[0,0,0,0,0]},capacityHomeVisit=[0,0,0,0,0];let weeklyCapacity=0,routineCapacity=0,plannedCapacity=0,totalCapacity=0;
 for(const slot of slots){const count=Math.round(chosen[slot.id]||0);if(!count)continue;const row=rowById.get(slot.sourceId);row.periods[slot.period][slot.day]+=count;row.days[slot.day]+=count;clinicianCounts[slot.clinician]=(clinicianCounts[slot.clinician]||0)+count;placements.push({id:slot.sourceId,sourceId:slot.sourceId,clinician:slot.clinician,day:slot.day,period:slot.period,pool:'mixed',count});totalCapacity+=Math.floor(count*slot.nonHome+1e-7)+Math.floor(count*slot.home+1e-7);}
 for(const a of allocations){const n=Math.round(chosen[a.id]||0);if(!n)continue;const target=appointmentBreakdown[a.slot.sourceId]||(appointmentBreakdown[a.slot.sourceId]=Array.from({length:5},()=>({morning:{},afternoon:{}}))),cell=target[a.slot.day][a.slot.period];cell[a.name]=(cell[a.name]||0)+n;
  if(a.pool==='sameDay'){capacitySameDay[a.slot.day]+=n;capacitySameDayByPeriod[a.slot.period][a.slot.day]+=n;}else if(a.pool==='homeVisit')capacityHomeVisit[a.slot.day]+=n;else if(a.pool==='weekly')weeklyCapacity+=n;else if(a.pool==='routine')routineCapacity+=n;else if(a.pool==='planned')plannedCapacity+=n;
 }
 const sessionTargetCache=new Map();
 const sessionTargets=group=>{
  if(sessionTargetCache.has(group))return sessionTargetCache.get(group);
  const result=[0,0,0,0,0],total=group.mine.reduce((n,id)=>n+Math.round(chosen[id]||0),0);
  if(!group.bounded){for(const day of group.days)result[day]=total/group.days.length;}
  else{
   // Recompute from purchased sessions and real residual day limits. Reporting
   // never trusts auxiliary target variables or a solver's claimed rule status.
   const bounds=group.days.map(day=>{const b=dailyBound(group.name,day)||{min:0,max:null},other=group.other[day].reduce((n,id)=>n+Math.round(chosen[id]||0),0);return {day,min:Math.max(0,(b.min||0)-other),max:Math.max(0,Math.min(b.max??group.cap,group.cap)-other)};});
   const target=Math.min(total,bounds.reduce((n,b)=>n+b.max,0));let low=0,high=group.cap;
   for(let iteration=0;iteration<70;iteration++){const level=(low+high)/2,sum=bounds.reduce((n,b)=>n+Math.min(b.max,Math.max(b.min,level)),0);if(sum<target)low=level;else high=level;}
   for(const b of bounds)result[b.day]=Math.min(b.max,Math.max(b.min,(low+high)/2));
  }
  sessionTargetCache.set(group,result);return result;
 };
 const ruleResults=active.map(rule=>{
  const failures=[],measurements=[];
  for(const expression of ruleExpressions.filter(e=>e.rule===rule)){
   if(expression.sessionDistribution){
    const numerator=expression.numerator.reduce((n,id)=>n+Math.round(chosen[id]||0),0),denominator=expression.denominator.reduce((n,id)=>n+Math.round(chosen[id]||0),0),target=expression.targetGroups.reduce((n,group)=>n+sessionTargets(group)[expression.day],0);
    if(Math.abs(numerator-target)>expression.tolerance+1e-5)failures.push(expression.sessionName+' · '+daysShort[expression.day]+': outside the session spread target.');
    measurements.push({sessionType:expression.sessionName,day:expression.day,numerator,denominator,target,tolerance:expression.tolerance});continue;
   }
   if(expression.distribution){
    const numerator=expression.numerator.reduce((n,id)=>n+Math.round(chosen[id]||0),0),denominator=expression.denominator.reduce((n,id)=>n+Math.round(chosen[id]||0),0);
    if(numerator<expression.lower*denominator-1e-5||numerator>expression.upper*denominator+1e-5)failures.push(daysShort[expression.day]+': outside the '+expression.target+'% target ±'+expression.tolerance+' percentage points.');
    measurements.push({day:expression.day,numerator,denominator,target:expression.target,tolerance:expression.tolerance});continue;
   }
   const value=expression.terms.reduce((n,[id,c])=>n+(chosen[id]||0)*c,0),numerator=expression.numerator.reduce((n,id)=>n+(chosen[id]||0),0),denominator=expression.denominator.reduce((n,id)=>n+(chosen[id]||0),0),comparison=rule.comparison||(rule.kind==='sessionClinicianMix'?'exact':'atLeast');
   const ok=rule.kind==='minimum'?(rule.minimum==null||value>=rule.minimum-1e-5)&&(rule.maximum==null||value<=rule.maximum+1e-5):(comparison==='atMost'?value<=1e-5:comparison==='exact'?Math.abs(value)<=1e-5:value>=-1e-5)&&(rule.kind==='mix'||rule.kind==='sessionClinicianMix'||denominator>1e-6||rule.minimum===0&&comparison==='atLeast');
   if(!ok)failures.push('Target not met for '+expression.scope.days.map(d=>daysShort[d]).join(', ')+' '+expression.scope.periods.join('/'));
   measurements.push({numerator,denominator});
  }
  return {id:rule.id,kind:rule.kind,strength:rule.strength,ok:!failures.length,adjustedForClinicianSetup:setupSpreadAdjusted&&rule.kind==='distribution'&&failures.length>0&&ruleExpressions.some(e=>e.rule===rule&&e.setupPriority),failures,measurements,minimum:rule.minimum,maximum:rule.maximum,comparison:rule.comparison||(rule.kind==='sessionClinicianMix'?'exact':'atLeast'),appointmentPool:api.sharePool(rule),clinicianGroup:api.shareSubject(rule)?.name,...(rule.kind==='sessionClinicianMix'?{sessionTypeId:rule.sessionTypeId}:{})};
 });
 const cost=slots.reduce((n,s)=>n+Math.round(chosen[s.id]||0)*variables[s.id].cost,0),lower=mipLowerBound??inspection?.costLowerBound,costLowerBound=Number.isFinite(lower)&&lower<=cost+1e-5?Math.max(0,Math.min(cost,lower)):undefined,costGap=Number.isFinite(costLowerBound)&&cost>0?Math.max(0,(cost-costLowerBound)/cost):undefined;
 return {rows,placements,clinicianCounts,appointmentBreakdown,capacitySameDay,capacitySameDayByPeriod,capacityHomeVisit,weeklyCapacity,routineCapacity,plannedCapacity,totalCapacity,totalNeed:values.reduce((a,b)=>a+b,0),days:Array.from({length:5},(_,d)=>rows.reduce((n,r)=>n+r.days[d],0)),unmetDemand:[],ruleResults,unassignedDailyTypes:[],costOptimised:true,annualCost:cost,costLowerBound,costGap,approximate:flags.approximate??true,verifiedPlan:true,optimisationTimedOut:!!flags.optimisationTimedOut,optimisationInterrupted:!!flags.optimisationInterrupted,ruleAdjusted:ruleResults.some(r=>r.adjustedForClinicianSetup),solverName:window.SessionBuilderMip?'HiGHS':'legacy',costOptimal:!!flags.costOptimal,costBoundKind:mipLowerBound!=null?'integer':'fractional'};
 }
 // Production uses a global MIP solve. All staffing and allocation decisions
 // are solved together, so percentage/distribution rules cannot trap a local
 // single-session cleanup. Every incumbent still passes the independent audit.
 if(window.SessionBuilderMip){
  let primary;
  try{
   primary=window.SessionBuilderMip.solve(model,{timeLimit:Math.max(1,Math.min(timeBudget-4000,deadline-Date.now()-4000)),onIncumbent:publishCandidate});
   if(primary.infeasible&&setupSpreadLocks.length&&deadline-Date.now()>100){
    for(const id of setupSpreadLocks)delete constraints[id];setupSpreadAdjusted=true;
    primary=window.SessionBuilderMip.solve(model,{timeLimit:Math.max(1,deadline-Date.now()-4000),onIncumbent:publishCandidate});
   }
   if(Number.isFinite(primary.lowerBound))mipLowerBound=primary.lowerBound;
   if(primary.feasible)publishCandidate(primary.values);
  }catch(error){
   return verifiedCheckpoint?retainedPlan(verifiedCheckpoint):fail('The integer optimiser could not complete. Your previous plan is unchanged. Try Reset planner again.');
  }
  if(!verifiedValues)return primary.infeasible?fail('No plan can meet all current demand, clinician limits, working patterns and required rules. Review Planner checks.'):
   {...fail('The integer optimiser reached its limit before finding a verified plan. This does not prove the settings are infeasible.'),errorCode:'TIMEOUT'};
  const acceptedCost=slots.reduce((n,s)=>n+Math.round(verifiedValues[s.id]||0)*variables[s.id].cost,0);
  const costOptimal=!!primary.optimal&&Math.abs(acceptedCost-primary.objective)<.005;
  const sessionIds=new Set(slots.map(s=>s.id)),allocationIds=new Set(allocations.map(a=>a.id));
  const objectiveValue=(v,key)=>Object.entries(variables).reduce((n,[id,data])=>n+(v[id]||0)*(data[key]||0),0);
  const freeze=key=>{const c=constraint({max:objectiveValue(verifiedValues,key)+1e-6});for(const [id,data]of Object.entries(variables))coefficient(id,c,data[key]||0);};
  freeze('cost');
  for(const [id,data]of Object.entries(variables)){data.capacity=allocationIds.has(id)?1:0;data.sessions=sessionIds.has(id)?1:0;}
  for(const [objective,budget]of [['capacity',2500],['sessions',750],['balance',500]]){
   if(objective==='balance'&&!distributionPenalties.length)continue;
   if(deadline-Date.now()<25)break;
   model.optimize=objective;
   try{
    const refined=window.SessionBuilderMip.solve(model,{timeLimit:Math.max(1,Math.min(budget,deadline-Date.now())),values:verifiedValues,onIncumbent:publishCandidate});
    if(refined.feasible)publishCandidate(refined.values);
   }catch(error){/* Retain the best independently verified plan. */}
   if(objective!=='balance')freeze(objective);
  }
  return buildPlan(verifiedValues,{approximate:!costOptimal,costOptimal,optimisationTimedOut:!costOptimal&&Date.now()>=deadline-25});
 }
 // Find an integer feasible plan before spending the remaining time on cost.
 // This phase uses exactly the same demand, eligibility and required rules.
 const seedIds=new Set(slots.map(slot=>slot.id));for(const [id,data] of Object.entries(variables))data.seedSessions=seedIds.has(id)?1:0;
 model.optimize='seedSessions';model.options.timeout=Math.min(2000,Math.max(1,deadline-Date.now()-4000));model.options.tolerance=0.1;model.options.nodeSelection='depth-first';model.options.branching='most-fractional';
 try{
  const seed=solveModel(),candidate=seed.generateSolutionSet();
  if(seed.feasible&&seed.bounded&&audit(candidate))publishCandidate(candidate);
 }catch(error){/* The cost search can still find a valid plan. */}
 if(verifiedValues&&window.SessionBuilderCostPolish)window.SessionBuilderCostPolish.improve({slots,allocations,variables,constraints,values:verifiedValues,demand,limits,active,audit,accept:publishCandidate,deadline:Math.min(deadline-4000,Date.now()+3000)});
 if(verifiedValues){
  const ceiling=constraint({max:Object.entries(variables).reduce((n,[id,data])=>n+(verifiedValues[id]||0)*(data.cost||0),0)+1e-7});
  for(const [id,data] of Object.entries(variables))coefficient(id,ceiling,data.cost||0);
 }
 model.optimize='cost';model.options.tolerance=0;model.options.nodeSelection='hybrid';model.options.branching='pseudocost';
 const primaryBudget=Math.max(1,deadline-Date.now()-(verifiedCheckpoint?4000:0));model.options.timeout=primaryBudget;
 let result,start=Date.now();
 try{result=solveModel();}catch(error){return verifiedCheckpoint?retainedPlan(verifiedCheckpoint,Date.now()>=deadline-25):fail('Cost optimisation stopped before returning a verified plan. Click Reset planner to try again.');}
 let solution=result?.generateSolutionSet?.()||{},elapsed=Date.now()-start;
 const costTimeLimited=elapsed>=primaryBudget-25;let costSearchIncomplete=false;
 if(verifiedValues&&(!result?.feasible||!result.bounded||!audit(solution))){solution={...verifiedValues};result={feasible:true,bounded:true};costSearchIncomplete=true;}
 function audit(values){
  const totals=Object.fromEntries(Object.keys(constraints).map(c=>[c,0]));
  for(const [id,data] of Object.entries(variables)){
   const raw=values[id]||0;if(!Number.isFinite(raw)||raw< -1e-6||ints[id]&&Math.abs(raw-Math.round(raw))>1e-6)return false;const n=ints[id]?Math.round(raw):raw;
   for(const [c,coefficient] of Object.entries(data))if(Object.hasOwn(totals,c))totals[c]+=n*coefficient;
  }
  return Object.entries(constraints).every(([id,b])=>{const n=totals[id],e=1e-5;return (b.min==null||n>=b.min-e)&&(b.max==null||n<=b.max+e)&&(b.equal==null||Math.abs(n-b.equal)<=e);});
 }
 if(!result?.feasible||!result.bounded||!audit(solution))return verifiedCheckpoint?retainedPlan(verifiedCheckpoint,costTimeLimited||Date.now()>=deadline-25):costTimeLimited?{...fail('Optimisation timed out before returning a verified plan. This does not prove the settings are infeasible. Click Reset planner to try again.'),errorCode:'TIMEOUT'}:fail('No valid costed plan was found. Check clinician minimums/maximums, working patterns, session eligibility and required rules. Every productive slot must have an eligible appointment type for its consultation mode. No invalid plan is shown.');
 publishCandidate(solution);
 if(verifiedValues&&window.SessionBuilderCostPolish)window.SessionBuilderCostPolish.improve({slots,allocations,variables,constraints,values:verifiedValues,demand,limits,active,audit,accept:publishCandidate,deadline:Math.min(deadline-750,Date.now()+1500)});
 if(verifiedValues&&audit(verifiedValues))solution={...verifiedValues};
 // Keep the best cost found, then reduce total productive capacity. Only accept
 // audited refinements that actually improve the requested objective.
 const primaryObjective=slots.reduce((n,s)=>n+Math.round(solution[s.id]||0)*variables[s.id].cost,0);
 const costBound=constraint({max:primaryObjective+1e-8});
 const sessionIds=new Set(slots.map(s=>s.id)),capacityIds=new Set(allocations.map(allocation=>allocation.id));
 for(const [id,data] of Object.entries(variables)){coefficient(id,costBound,data.cost||0);data.capacity=capacityIds.has(id)?1:0;data.sessions=sessionIds.has(id)?1:0;}
 const objectiveValue=(values,objective)=>Object.entries(variables).reduce((n,[id,data])=>n+(values[id]||0)*(data[objective]||0),0);
 const refine=(objective,budget)=>{
  if(deadline-Date.now()<=25)return false;
  model.optimize=objective;model.options.timeout=Math.min(budget,Math.max(1,deadline-Date.now()));
  const before=objectiveValue(solution,objective);
  try{const nextResult=solveModel(),next=nextResult.generateSolutionSet();if(nextResult.feasible&&nextResult.bounded&&audit(next)&&objectiveValue(next,objective)<=before+1e-7){solution=next;publishCandidate(solution);return true;}}catch(error){/* Retain the audited incumbent. */}
  return false;
 };
 const capacityRefined=refine('capacity',2500);
 {const capacityBound=constraint({max:objectiveValue(solution,'capacity')+1e-7});for(const [id,data] of Object.entries(variables))coefficient(id,capacityBound,data.capacity||0);}
 const sessionsRefined=refine('sessions',750);
 {const sessionBound=constraint({max:objectiveValue(solution,'sessions')+1e-7});for(const id of sessionIds)coefficient(id,sessionBound,1);}
 if(distributionPenalties.length)refine('balance',500);
 if(!audit(solution))return verifiedCheckpoint?retainedPlan(verifiedCheckpoint):fail('The calculated plan could not be verified. No invalid plan is shown.');
 const finalPlan=buildPlan(solution,{approximate:costSearchIncomplete||costTimeLimited||!capacityRefined||!sessionsRefined,optimisationTimedOut:costTimeLimited||Date.now()>=deadline-25});
 publishCandidate(solution);
 return isVerifiedPlan(finalPlan)&&betterPlan(finalPlan,verifiedCheckpoint)?finalPlan:verifiedCheckpoint||fail('The calculated plan could not be verified.');

}
window.SessionBuilderOptimisation=Object.freeze({estimate,estimateAsync});
})();
